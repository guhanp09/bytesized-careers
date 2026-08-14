import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  StrongAuthClientError,
  confirmStrongAuthEnrollment,
  disableStrongAuth,
  loadStrongAuthStatus,
  startStrongAuthEnrollment,
  verifyStrongAuth,
} from "../lib/strongAuthClient.ts";

const statusPayload = {
  required: true,
  enrolled: true,
  enrollment_pending: false,
  enrollment_expires_at: null,
  recovery_codes_remaining: 9,
  strong_auth_satisfied: false,
  strong_auth_method: null,
  strong_auth_expires_at: null,
  available_methods: ["totp", "recovery_code"],
  google_reauthentication_available: false,
};

const jsonResponse = (payload, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });

test("status uses the same-origin no-store contract and validates every security field", async () => {
  let captured;
  const result = await loadStrongAuthStatus(async (input, init) => {
    captured = { input, init };
    return jsonResponse(statusPayload);
  });

  assert.equal(captured.input, "/api/security/strong-auth");
  assert.equal(captured.init.method, "GET");
  assert.equal(captured.init.credentials, "same-origin");
  assert.equal(captured.init.cache, "no-store");
  assert.deepEqual(result.available_methods, ["totp", "recovery_code"]);

  await assert.rejects(
    loadStrongAuthStatus(async () => jsonResponse({ ...statusPayload, required: "yes" })),
    (error) => error instanceof StrongAuthClientError && error.code === "invalid_response"
  );
});

test("enrollment forwards only the explicit action and optional password", async () => {
  const bodies = [];
  const enrollment = await startStrongAuthEnrollment(
    "current-password",
    async (_input, init) => {
      bodies.push(JSON.parse(init.body));
      return jsonResponse({
        secret: "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP",
        provisioning_uri:
          "otpauth://totp/CreatorJobs%3Aadmin%40example.com?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP",
        expires_at: "2026-08-14T12:00:00Z",
      });
    }
  );
  await startStrongAuthEnrollment(undefined, async (_input, init) => {
    bodies.push(JSON.parse(init.body));
    return jsonResponse(enrollment);
  });

  assert.deepEqual(bodies, [
    { action: "enroll", password: "current-password" },
    { action: "enroll" },
  ]);
  assert.equal(JSON.stringify(bodies).includes("id_token"), false);
});

test("confirmation accepts unique recovery codes and rejects malformed secret material", async () => {
  const validCodes = [
    "AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH",
    "BAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH",
    "CAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH",
    "DAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH",
    "EAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH",
    "FAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH",
    "GAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH",
    "HAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH",
    "IAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH".replace("I", "J"),
    "KAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH",
  ];
  const result = await confirmStrongAuthEnrollment("123456", async () =>
    jsonResponse({
      status: "ok",
      method: "totp",
      expires_at: "2026-08-14T12:00:00Z",
      recovery_codes_remaining: 10,
      recovery_codes: validCodes,
    })
  );
  assert.deepEqual(result.recovery_codes, validCodes);

  await assert.rejects(
    confirmStrongAuthEnrollment("123456", async () =>
      jsonResponse({
        status: "ok",
        method: "totp",
        expires_at: "2026-08-14T12:00:00Z",
        recovery_codes_remaining: 1,
        recovery_codes: ["plaintext-password"],
      })
    ),
    (error) => error instanceof StrongAuthClientError && error.code === "invalid_response"
  );
});

test("challenge and disable serialize only the selected proof contract", async () => {
  const bodies = [];
  await verifyStrongAuth("recovery_code", "AAAA-BBBB", async (_input, init) => {
    bodies.push(JSON.parse(init.body));
    return jsonResponse({
      status: "ok",
      method: "recovery_code",
      expires_at: "2026-08-14T12:00:00Z",
      recovery_codes_remaining: 8,
    });
  });
  await disableStrongAuth("totp", "123456", "current-password", async (_input, init) => {
    bodies.push(JSON.parse(init.body));
    return jsonResponse({ status: "ok", revoked_sessions: 2 });
  });

  assert.deepEqual(bodies, [
    { action: "challenge", method: "recovery_code", code: "AAAA-BBBB" },
    { action: "disable", method: "totp", code: "123456", password: "current-password" },
  ]);
});

test("errors never reflect an untrusted non-JSON response", async () => {
  await assert.rejects(
    loadStrongAuthStatus(async () => new Response("<script>secret</script>", { status: 502 })),
    (error) =>
      error instanceof StrongAuthClientError &&
      error.status === 502 &&
      !error.message.includes("script") &&
      !error.message.includes("secret")
  );
});

test("the browser flow cannot persist factor secrets and the proxy enforces its server boundary", () => {
  const controls = readFileSync("components/security/StrongAuthControls.tsx", "utf8");
  const route = readFileSync("app/api/security/strong-auth/route.ts", "utf8");
  const auth = readFileSync("lib/auth.ts", "utf8");

  assert.doesNotMatch(controls, /localStorage|sessionStorage|indexedDB/);
  assert.match(route, /getServerSession\(authOptions\)/);
  assert.match(route, /getToken\(\{ req: request, secret: process\.env\.NEXTAUTH_SECRET \}\)/);
  assert.match(route, /fetchSite !== "cross-site"/);
  assert.match(route, /MAX_REQUEST_BODY_BYTES/);
  assert.match(route, /new TextEncoder\(\)\.encode\(text\)\.byteLength/);
  assert.doesNotMatch(route, /error\.message \|\| "The factor state changed/);
  assert.match(auth, /rememberStrongAuthGoogleReauthentication/);
  assert.doesNotMatch(auth, /session\.strongAuthGoogleReauthIdToken\s*=/);
});
