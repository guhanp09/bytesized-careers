import test from "node:test";
import assert from "node:assert/strict";

import {
  applyBackendLoginPayload,
  backendAccessTokenExpiresAtMs,
  buildSafeBackendSessionFields,
  markBackendRefreshFailed,
  refreshBackendAccessToken,
  revokeBackendSession,
  shouldRefreshBackendToken,
} from "../lib/backendTokenRefresh.ts";

const jwtWithExp = (exp) => {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none", typ: "JWT" })}.${encode({ exp })}.`;
};

test("fresh backend token is reused when it is not close to expiry", () => {
  assert.equal(
    shouldRefreshBackendToken({
      accessToken: "token",
      expiresAt: 2_000_000,
      now: 1_000_000,
      bufferMs: 300_000,
    }),
    false
  );
});

test("near-expired backend token triggers refresh", () => {
  assert.equal(
    shouldRefreshBackendToken({
      accessToken: "token",
      expiresAt: 1_250_000,
      now: 1_000_000,
      bufferMs: 300_000,
    }),
    true
  );
});

test("backend token expiry can be read from response metadata or JWT exp", () => {
  assert.equal(
    backendAccessTokenExpiresAtMs({
      access_token: jwtWithExp(123),
      access_token_expires_at: 456,
    }),
    456_000
  );
  assert.equal(backendAccessTokenExpiresAtMs({ access_token: jwtWithExp(789) }), 789_000);
});

test("successful refresh updates backend token state", () => {
  const token = applyBackendLoginPayload(
    {},
    {
      access_token: jwtWithExp(200),
      refresh_token: jwtWithExp(900),
      token_type: "bearer",
      user: { id: "user-1" },
    }
  );

  assert.equal(token.backendAccessToken, jwtWithExp(200));
  assert.equal(token.backendRefreshToken, jwtWithExp(900));
  assert.equal(token.backendAccessTokenExpiresAt, 200_000);
  assert.equal(token.backendRefreshTokenExpiresAt, 900_000);
  assert.equal(token.backendAuthError, undefined);
});

test("refresh token is not exposed in safe session fields", () => {
  const sessionFields = buildSafeBackendSessionFields({
    backendAccessToken: "access",
    backendTokenType: "bearer",
    backendUserId: "user-1",
    backendAccessTokenExpiresAt: 123_000,
    backendAuthError: undefined,
    backendRefreshToken: "secret-refresh",
  });

  assert.deepEqual(Object.keys(sessionFields).sort(), [
    "backendAccessToken",
    "backendAccessTokenExpiresAt",
    "backendAuthError",
    "backendTokenType",
    "backendUserId",
  ]);
  assert.equal("backendRefreshToken" in sessionFields, false);
});

test("failed refresh clears refresh material and marks a recoverable auth error", () => {
  const token = markBackendRefreshFailed({
    backendAccessToken: "access",
    backendRefreshToken: "refresh",
    backendAccessTokenExpiresAt: 123,
  });

  assert.equal(token.backendAccessToken, "access");
  assert.equal(token.backendRefreshToken, undefined);
  assert.equal(token.backendAccessTokenExpiresAt, 123);
  assert.equal(token.backendAuthError, "refresh_failed");
});

test("refreshBackendAccessToken posts refresh token and returns refreshed payload", async () => {
  const calls = [];
  const payload = {
    access_token: "new-access",
    refresh_token: "new-refresh",
    token_type: "bearer",
    access_token_expires_at: 200,
    refresh_token_expires_at: 900,
    user: { id: "user-1" },
  };
  const result = await refreshBackendAccessToken({
    backendBaseUrl: "http://backend.test/api/v1/",
    refreshToken: "old-refresh",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        json: async () => payload,
      };
    },
  });

  assert.deepEqual(result, payload);
  assert.equal(calls[0].url, "http://backend.test/api/v1/auth/refresh");
  assert.deepEqual(JSON.parse(calls[0].init.body), { refresh_token: "old-refresh" });
});

test("refreshBackendAccessToken throws on failed refresh", async () => {
  await assert.rejects(
    refreshBackendAccessToken({
      backendBaseUrl: "http://backend.test/api/v1",
      refreshToken: "expired-refresh",
      fetchImpl: async () => ({
        ok: false,
        status: 401,
        json: async () => ({}),
      }),
    }),
    /Backend token refresh failed with 401/
  );
});

test("concurrent refreshes for one credential are coalesced", async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    await gate;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        access_token: "shared-access",
        refresh_token: "shared-rotated-refresh",
      }),
    };
  };

  const first = refreshBackendAccessToken({
    backendBaseUrl: "http://backend.test/api/v1",
    refreshToken: "single-use-refresh",
    fetchImpl,
  });
  const second = refreshBackendAccessToken({
    backendBaseUrl: "http://backend.test/api/v1/",
    refreshToken: "single-use-refresh",
    fetchImpl,
  });

  assert.equal(calls, 1);
  release();
  const [firstPayload, secondPayload] = await Promise.all([first, second]);
  assert.deepEqual(firstPayload, secondPayload);
  assert.equal(calls, 1);
});

test("a failed coalesced refresh is evicted so a later retry can run", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 1) {
      return { ok: false, status: 503, json: async () => ({}) };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        access_token: "recovered-access",
        refresh_token: "recovered-refresh",
      }),
    };
  };

  await assert.rejects(
    refreshBackendAccessToken({
      backendBaseUrl: "http://backend.test/api/v1",
      refreshToken: "retryable-refresh",
      fetchImpl,
    }),
    /503/
  );
  const recovered = await refreshBackendAccessToken({
    backendBaseUrl: "http://backend.test/api/v1",
    refreshToken: "retryable-refresh",
    fetchImpl,
  });

  assert.equal(recovered.refresh_token, "recovered-refresh");
  assert.equal(calls, 2);
});

test("refresh rejects a response that omits the rotated refresh credential", async () => {
  await assert.rejects(
    refreshBackendAccessToken({
      backendBaseUrl: "http://backend.test/api/v1",
      refreshToken: "single-use-refresh",
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ access_token: "access-only" }),
      }),
    }),
    /no rotated refresh token/
  );
});

test("server-side logout prefers refresh proof without sending an access header", async () => {
  const calls = [];
  await revokeBackendSession({
    backendBaseUrl: "http://backend.test/api/v1/",
    refreshToken: "server-held-refresh",
    accessToken: "fallback-access",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 200 };
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://backend.test/api/v1/auth/logout");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    refresh_token: "server-held-refresh",
  });
  assert.equal("Authorization" in calls[0].init.headers, false);
  assert.equal(calls[0].init.cache, "no-store");
  assert.ok(calls[0].init.signal instanceof AbortSignal);
});

test("server-side logout falls back to access proof and treats repeated logout as safe", async () => {
  const calls = [];
  await revokeBackendSession({
    backendBaseUrl: "http://backend.test/api/v1",
    accessToken: "short-lived-access",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return { ok: false, status: 401 };
    },
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(JSON.parse(calls[0].init.body), {});
  assert.equal(calls[0].init.headers.Authorization, "Bearer short-lived-access");
});

test("server-side logout is bounded and surfaces backend failures", async () => {
  await assert.rejects(
    revokeBackendSession({
      backendBaseUrl: "http://backend.test/api/v1",
      refreshToken: "refresh",
      fetchImpl: async () => ({ ok: false, status: 503 }),
    }),
    /revocation failed with 503/
  );

  let calls = 0;
  await revokeBackendSession({
    backendBaseUrl: "http://backend.test/api/v1",
    fetchImpl: async () => {
      calls += 1;
      return { ok: true, status: 200 };
    },
  });
  assert.equal(calls, 0);
});
