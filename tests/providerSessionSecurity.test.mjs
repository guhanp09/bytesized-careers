import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildSafeAuthSessionUser,
  clearLegacyProviderCredentialState,
} from "../lib/authSession.ts";
import {
  refreshYouTubeConnection,
  YouTubeConnectionError,
} from "../lib/identity/youtubeConnection.ts";

const PROVIDER_FIELDS = [
  "accessToken",
  "refreshToken",
  "providerAccountId",
  "oauthExpiresAt",
  "oauthScope",
  "profile",
];

test("serialized auth user is an allowlist that excludes provider credentials", () => {
  const sessionUser = buildSafeAuthSessionUser(
    {
      sub: "nextauth-user",
      email: "verified@example.com",
      displayName: "Verified User",
      provider: "google",
      backendUserId: "backend-user",
      username: "verified-user",
      accountType: "BOTH",
      onboardingIntent: "BOTH",
      accessToken: "provider-access-secret",
      refreshToken: "provider-refresh-secret",
      providerAccountId: "google-subject-secret",
      oauthExpiresAt: 1_234_567,
      oauthScope: "private-scope",
      profile: { sub: "raw-profile-subject" },
    },
    {
      name: "Fallback Name",
      email: "fallback@example.com",
      image: "https://images.example/avatar.png",
      accessToken: "injected-provider-access",
    }
  );

  assert.deepEqual(sessionUser, {
    name: "Verified User",
    email: "fallback@example.com",
    image: "https://images.example/avatar.png",
    provider: "google",
    userId: "backend-user",
    backendUserId: "backend-user",
    username: "verified-user",
    accountType: "BOTH",
    accountTypeSelectedAt: undefined,
    onboardingIntent: "BOTH",
    onboardingIntentSelectedAt: undefined,
  });
  for (const field of PROVIDER_FIELDS) {
    assert.equal(Object.hasOwn(sessionUser, field), false, `${field} must not be serialized`);
  }
  const serialized = JSON.stringify(sessionUser);
  assert.doesNotMatch(serialized, /provider-(access|refresh)-secret|google-subject-secret|raw-profile-subject/);
});

test("existing JWT cookies are upgraded by deleting legacy provider material", () => {
  const token = {
    provider: "google",
    sub: "provider-primary-subject",
    backendUserId: "backend-user",
    backendAccessToken: "backend-access",
    backendRefreshToken: "backend-refresh",
    accessToken: "provider-access",
    refreshToken: "provider-refresh",
    providerAccountId: "provider-subject",
    oauthExpiresAt: 123,
    oauthScope: "openid email",
    profile: { sub: "provider-subject" },
  };

  assert.equal(clearLegacyProviderCredentialState(token), token);
  for (const field of PROVIDER_FIELDS) {
    assert.equal(Object.hasOwn(token, field), false, `${field} must be removed from the JWT`);
  }
  assert.equal(token.provider, "google");
  assert.equal(token.sub, "backend-user");
  assert.equal(token.backendAccessToken, "backend-access");
  assert.equal(token.backendRefreshToken, "backend-refresh");
});

test("YouTube browser refresh sends no provider or backend credential", async () => {
  const calls = [];
  const result = await refreshYouTubeConnection(async (url, init) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      json: async () => ({ status: "ok", channels: [] }),
    };
  });

  assert.deepEqual(result, { status: "ok", channels: [] });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/identity/youtube/refresh");
  assert.deepEqual(calls[0].init, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  assert.equal("body" in calls[0].init, false);
  assert.equal("Authorization" in calls[0].init.headers, false);
});

test("YouTube reconnect signal is preserved without reflecting arbitrary bodies", async () => {
  await assert.rejects(
    refreshYouTubeConnection(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: "youtube_reauth_required" }),
    })),
    (error) =>
      error instanceof YouTubeConnectionError &&
      error.status === 401 &&
      error.message === "youtube_reauth_required"
  );

  await assert.rejects(
    refreshYouTubeConnection(async () => ({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error("not json");
      },
    })),
    /YouTube connection request failed \(502\)/
  );
});

test("NextAuth session callback and frontend types cannot reintroduce provider fields", () => {
  const authSource = readFileSync("lib/auth.ts", "utf8");
  const declarations = readFileSync("types/next-auth.d.ts", "utf8");
  const youHub = readFileSync("components/you/YouHubClient.tsx", "utf8");
  const postJob = readFileSync("components/PostJobPage.tsx", "utf8");
  const backendClient = readFileSync("lib/backendClient.ts", "utf8");
  const refreshRoute = readFileSync("app/api/identity/youtube/refresh/route.ts", "utf8");
  const settingsClient = readFileSync("components/settings/SettingsClient.tsx", "utf8");

  assert.match(authSource, /clearLegacyProviderCredentialState\(token\)/);
  assert.match(authSource, /session\.user = buildSafeAuthSessionUser\(token, session\.user\)/);
  assert.doesNotMatch(authSource, /token\.(?:accessToken|refreshToken|providerAccountId|oauthExpiresAt|oauthScope|profile)\s*=/);
  for (const field of PROVIDER_FIELDS) {
    assert.doesNotMatch(declarations, new RegExp(`\\b${field}\\??:`));
  }
  assert.doesNotMatch(youHub, /oauthAccessToken|oauthRefreshToken|upsertGoogleOAuthForMe/);
  assert.doesNotMatch(postJob, /oauthAccessToken|oauthRefreshToken|upsertGoogleOAuthForMe/);
  assert.doesNotMatch(backendClient, /BackendOAuthUpsertPayload|upsertGoogleOAuthForMe/);
  assert.match(refreshRoute, /getServerSession\(authOptions\)/);
  assert.match(refreshRoute, /refreshMyYouTubeChannels\(session\.backendAccessToken\)/);
  assert.doesNotMatch(refreshRoute, /providerAccountId|refreshToken|account\.access_token/);
  assert.match(authSource, /events:\s*{[\s\S]*async signOut\(\{ token \}\)/);
  assert.match(authSource, /revokeBackendSession\(\{[\s\S]*refreshToken,[\s\S]*accessToken,/);
  assert.doesNotMatch(authSource, /session\.strongAuthGoogleReauth(?:IdToken|ExpiresAt)\s*=/);
  assert.doesNotMatch(declarations.split('declare module "next-auth/jwt"')[0], /strongAuthGoogleReauth/);
  assert.match(settingsClient, /logoutAllBackendSessions\(backendAccessToken\)/);
  assert.match(backendClient, /"\/auth\/logout-all"/);
});
