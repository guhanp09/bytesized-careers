import assert from "node:assert/strict";
import test from "node:test";

import {
  STRONG_AUTH_GOOGLE_REAUTH_MAX_AGE_MS,
  clearStrongAuthGoogleReauthentication,
  readStrongAuthGoogleReauthentication,
  rememberStrongAuthGoogleReauthentication,
} from "../lib/strongAuthReauthentication.ts";

test("Google reauthentication material is policy-bounded and server-state only", () => {
  const now = 1_000_000;
  const token = {};
  rememberStrongAuthGoogleReauthentication(token, {
    idToken: "verified-by-the-backend",
    idTokenExpiresAt: now + 60 * 60 * 1000,
    now,
  });

  assert.equal(token.strongAuthGoogleReauthExpiresAt, now + STRONG_AUTH_GOOGLE_REAUTH_MAX_AGE_MS);
  assert.equal(readStrongAuthGoogleReauthentication(token, now + 1), "verified-by-the-backend");
  assert.equal(
    readStrongAuthGoogleReauthentication(
      token,
      now + STRONG_AUTH_GOOGLE_REAUTH_MAX_AGE_MS
    ),
    undefined
  );
  assert.equal("strongAuthGoogleReauthIdToken" in token, false);
  assert.equal("strongAuthGoogleReauthExpiresAt" in token, false);
});

test("provider expiry wins and invalid or explicitly cleared state is unusable", () => {
  const now = 2_000_000;
  const token = {};
  rememberStrongAuthGoogleReauthentication(token, {
    idToken: "short-lived",
    idTokenExpiresAt: now + 10_000,
    now,
  });
  assert.equal(token.strongAuthGoogleReauthExpiresAt, now + 10_000);
  assert.equal(readStrongAuthGoogleReauthentication(token, now + 10_000), undefined);

  rememberStrongAuthGoogleReauthentication(token, {
    idToken: "already-expired",
    idTokenExpiresAt: now - 1,
    now,
  });
  assert.equal(readStrongAuthGoogleReauthentication(token, now), undefined);

  rememberStrongAuthGoogleReauthentication(token, { idToken: "missing-expiry", now });
  assert.equal(readStrongAuthGoogleReauthentication(token, now), undefined);

  rememberStrongAuthGoogleReauthentication(token, {
    idToken: "fresh",
    idTokenExpiresAt: now + 10_000,
    now,
  });
  clearStrongAuthGoogleReauthentication(token);
  assert.equal(readStrongAuthGoogleReauthentication(token, now), undefined);
});
