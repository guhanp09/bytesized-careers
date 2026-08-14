import { expect, test, type BrowserContext, type Route } from "@playwright/test";
import { encode } from "next-auth/jwt";

const SESSION_SECRET = "e2e-secret";

const recoveryCodes = [
  "AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH",
  "BAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH",
  "CAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH",
  "DAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH",
  "EAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH",
  "FAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH",
  "GAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH",
  "HAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH",
  "JAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH",
  "KAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH",
];

const status = (overrides: Record<string, unknown> = {}) => ({
  required: true,
  enrolled: false,
  enrollment_pending: false,
  enrollment_expires_at: null,
  recovery_codes_remaining: 0,
  strong_auth_satisfied: false,
  strong_auth_method: null,
  strong_auth_expires_at: null,
  available_methods: [],
  google_reauthentication_available: false,
  ...overrides,
});

async function signInAdmin(
  context: BrowserContext,
  provider: "credentials" | "google" = "credentials"
) {
  const sessionToken = await encode({
    token: {
      name: "Admin Operator",
      email: "admin-e2e@example.com",
      sub: "e2e-admin",
      username: "admin-operator",
      displayName: "Admin Operator",
      accountType: "ADMIN",
      backendAccessToken: "e2e-offline-token",
      backendTokenType: "bearer",
      backendUserId: "e2e-admin",
      provider,
    },
    secret: SESSION_SECRET,
  });
  await context.addCookies([
    {
      name: "next-auth.session-token",
      value: sessionToken,
      domain: "127.0.0.1",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}

async function fulfillJson(route: Route, payload: unknown, responseStatus = 200) {
  await route.fulfill({
    status: responseStatus,
    contentType: "application/json",
    headers: { "Cache-Control": "no-store" },
    body: JSON.stringify(payload),
  });
}

test.describe("administrator strong-authentication boundary", () => {
  test("the same-origin proxy rejects anonymous, cross-site, and oversized requests", async ({
    context,
    page,
  }) => {
    const anonymous = await page.request.get("/api/security/strong-auth");
    expect(anonymous.status()).toBe(401);
    expect(await anonymous.json()).toMatchObject({ error: "session_expired" });

    await signInAdmin(context);
    const crossSite = await page.request.post("/api/security/strong-auth", {
      headers: {
        "Content-Type": "application/json",
        Origin: "https://attacker.example",
        "Sec-Fetch-Site": "cross-site",
      },
      data: { action: "challenge", method: "totp", code: "123456" },
    });
    expect(crossSite.status()).toBe(403);
    expect(await crossSite.json()).toEqual({
      error: "origin_rejected",
      message: "Request origin was not accepted.",
    });

    const oversized = await page.request.post("/api/security/strong-auth", {
      headers: {
        "Content-Type": "application/json",
        "Sec-Fetch-Site": "same-origin",
      },
      data: JSON.stringify({ action: "challenge", code: "A".repeat(17 * 1024) }),
    });
    expect(oversized.status()).toBe(400);
    expect(await oversized.json()).toMatchObject({ error: "invalid_request" });
  });

  test("enrollment keeps the admin shell closed until recovery codes are saved", async ({
    context,
    page,
  }) => {
    await signInAdmin(context);
    const submitted: unknown[] = [];
    await page.route("**/api/security/strong-auth", async (route) => {
      const request = route.request();
      if (request.method() === "GET") {
        await fulfillJson(route, status());
        return;
      }
      const body = request.postDataJSON() as Record<string, unknown>;
      submitted.push(body);
      if (body.action === "enroll") {
        await fulfillJson(route, {
          secret: "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP",
          provisioning_uri:
            "otpauth://totp/CreatorJobs%3Aadmin-e2e%40example.com?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP",
          expires_at: "2026-08-14T12:00:00Z",
        });
        return;
      }
      await fulfillJson(route, {
        status: "ok",
        method: "totp",
        expires_at: "2026-08-14T12:05:00Z",
        recovery_codes_remaining: recoveryCodes.length,
        recovery_codes: recoveryCodes,
      });
    });

    await page.goto("/admin", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("strong-auth-enrollment")).toBeVisible();
    await expect(page.getByTestId("admin-nav")).toHaveCount(0);

    await page.getByLabel("Current password").fill("correct horse battery staple");
    await page.getByRole("button", { name: "Start authenticator setup" }).click();
    await expect(page.getByTestId("strong-auth-setup-key")).toHaveText(
      "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP"
    );
    await page.getByLabel("Authenticator code").fill("123456");
    await page.getByRole("button", { name: "Confirm authenticator" }).click();

    const recoveryPanel = page.getByTestId("strong-auth-recovery-codes");
    await expect(recoveryPanel).toBeVisible();
    await expect(recoveryPanel.locator("code")).toHaveCount(10);
    await expect(page.getByTestId("admin-nav")).toHaveCount(0);
    await expect(recoveryPanel.getByRole("button", { name: "Continue" })).toBeDisabled();
    await recoveryPanel.getByRole("checkbox", { name: /saved these codes/i }).check();
    await recoveryPanel.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByTestId("admin-nav")).toBeVisible();

    expect(submitted).toEqual([
      { action: "enroll", password: "correct horse battery staple" },
      { action: "confirm", code: "123456" },
    ]);
    expect(JSON.stringify(submitted)).not.toContain("id_token");
  });

  test("a failed TOTP proof stays gated and an unused recovery code can elevate", async ({
    context,
    page,
  }) => {
    await signInAdmin(context);
    const submitted: unknown[] = [];
    await page.route("**/api/security/strong-auth", async (route) => {
      if (route.request().method() === "GET") {
        await fulfillJson(
          route,
          status({
            enrolled: true,
            recovery_codes_remaining: 9,
            available_methods: ["totp", "recovery_code"],
          })
        );
        return;
      }
      const body = route.request().postDataJSON() as Record<string, unknown>;
      submitted.push(body);
      if (body.method === "totp") {
        await fulfillJson(
          route,
          { error: "strong_auth_failed", message: "The authentication proof was not accepted." },
          403
        );
        return;
      }
      await fulfillJson(route, {
        status: "ok",
        method: "recovery_code",
        expires_at: "2026-08-14T12:05:00Z",
        recovery_codes_remaining: 8,
      });
    });

    await page.goto("/admin", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("strong-auth-challenge")).toBeVisible();
    await page.getByLabel("Authenticator code").fill("111111");
    await page.getByRole("button", { name: "Verify and continue" }).click();
    await expect(page.getByTestId("strong-auth-challenge").getByRole("alert")).toContainText(
      "not accepted"
    );
    await expect(page.getByTestId("admin-nav")).toHaveCount(0);

    await page.getByRole("button", { name: "Recovery code" }).click();
    await page.getByLabel("Recovery code").fill(recoveryCodes[0]);
    await page.getByRole("button", { name: "Verify and continue" }).click();
    await expect(page.getByTestId("admin-nav")).toBeVisible();
    expect(submitted).toEqual([
      { action: "challenge", method: "totp", code: "111111" },
      { action: "challenge", method: "recovery_code", code: recoveryCodes[0] },
    ]);
  });

  test("exhausted recovery codes are not offered as an administrator proof", async ({
    context,
    page,
  }) => {
    await signInAdmin(context);
    await page.route("**/api/security/strong-auth", async (route) => {
      await fulfillJson(
        route,
        status({
          enrolled: true,
          recovery_codes_remaining: 0,
          available_methods: ["totp"],
        })
      );
    });

    await page.goto("/admin", { waitUntil: "domcontentloaded" });
    const challenge = page.getByTestId("strong-auth-challenge");
    await expect(challenge.getByRole("button", { name: "Authenticator" })).toBeVisible();
    await expect(challenge.getByRole("button", { name: "Recovery code" })).toHaveCount(0);
    await expect(page.getByTestId("admin-nav")).toHaveCount(0);
  });

  test("Google administrators must perform recent provider reauthentication before enrollment", async ({
    context,
    page,
  }) => {
    await signInAdmin(context, "google");
    await page.route("**/api/security/strong-auth", async (route) => {
      await fulfillJson(route, status({ google_reauthentication_available: false }));
    });

    await page.goto("/admin", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: "Reauthenticate with Google" })).toBeVisible();
    await expect(page.getByLabel("Current password")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Start authenticator setup" })).toHaveCount(0);
    await expect(page.getByTestId("admin-nav")).toHaveCount(0);
  });
});

test("administrator settings rotate recovery codes and disable the factor safely", async ({
  context,
  page,
}) => {
  test.slow();
  await signInAdmin(context);
  const submitted: unknown[] = [];
  await page.route("**/api/security/strong-auth", async (route) => {
    if (route.request().method() === "GET") {
      await fulfillJson(
        route,
        status({
          enrolled: true,
          recovery_codes_remaining: 7,
          strong_auth_satisfied: true,
          strong_auth_method: "totp",
          strong_auth_expires_at: "2026-08-14T12:05:00Z",
          available_methods: ["totp", "recovery_code"],
        })
      );
      return;
    }
    const body = route.request().postDataJSON() as Record<string, unknown>;
    submitted.push(body);
    if (body.action === "disable") {
      await fulfillJson(route, { status: "ok", revoked_sessions: 2 });
      return;
    }
    await fulfillJson(route, {
      status: "ok",
      expires_at: "2026-08-14T12:10:00Z",
      recovery_codes: recoveryCodes,
    });
  });

  await page.goto("/settings", { waitUntil: "domcontentloaded" });
  const row = page.getByTestId("settings-row-security-strong-auth");
  await expect(row).toContainText("Enabled");
  await row.getByRole("button", { name: "Manage" }).click();
  await row.getByRole("button", { name: "Replace recovery codes" }).click();
  await row.getByLabel("Authenticator code").fill("654321");
  await row.getByRole("button", { name: "Replace codes" }).click();
  await expect(row.locator("code")).toHaveCount(10);
  await row.getByRole("checkbox", { name: /saved these codes/i }).check();
  await row.getByRole("button", { name: "Continue" }).click();
  await expect(row.locator("code")).toHaveCount(0);
  expect(submitted).toEqual([
    { action: "regenerate_recovery_codes", code: "654321" },
  ]);
  const storedBrowserState = await page.evaluate(() =>
    JSON.stringify({
      local: Object.fromEntries(Object.entries(localStorage)),
      session: Object.fromEntries(Object.entries(sessionStorage)),
    })
  );
  expect(storedBrowserState).not.toContain(recoveryCodes[0]);

  await row.getByRole("button", { name: "Disable authenticator" }).click();
  await row.getByLabel("Current password").fill("correct horse battery staple");
  await row.getByLabel("Authenticator code").fill("987654");
  await row.getByRole("button", { name: "Disable and sign out everywhere" }).click();
  await page.waitForURL("**/");
  expect(submitted).toEqual([
    { action: "regenerate_recovery_codes", code: "654321" },
    {
      action: "disable",
      method: "totp",
      code: "987654",
      password: "correct horse battery staple",
    },
  ]);
});
