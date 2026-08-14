import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildSafeAuthSessionUser,
  clearLegacyProviderCredentialState,
} from "../lib/authSession.ts";
import {
  disconnectYouTubeConnection,
  refreshYouTubeConnection,
  YouTubeConnectionError,
} from "../lib/identity/youtubeConnection.ts";
import {
  GOOGLE_IDENTITY_AUTHORIZATION_PARAMS,
  GOOGLE_YOUTUBE_READONLY_SCOPE,
  googleYouTubeAuthorizationParams,
} from "../lib/googleOAuthPolicy.ts";

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

test("ordinary Google login is identity-only and YouTube consent is incremental", () => {
  assert.deepEqual(GOOGLE_IDENTITY_AUTHORIZATION_PARAMS, {
    scope: "openid email profile",
  });
  assert.equal("access_type" in GOOGLE_IDENTITY_AUTHORIZATION_PARAMS, false);
  assert.equal("prompt" in GOOGLE_IDENTITY_AUTHORIZATION_PARAMS, false);
  assert.doesNotMatch(GOOGLE_IDENTITY_AUTHORIZATION_PARAMS.scope, /youtube/i);

  const incremental = googleYouTubeAuthorizationParams();
  assert.match(incremental.scope, new RegExp(GOOGLE_YOUTUBE_READONLY_SCOPE));
  assert.equal(incremental.access_type, "offline");
  assert.equal(incremental.include_granted_scopes, "true");
  assert.equal(incremental.prompt, "consent");
  assert.equal(
    googleYouTubeAuthorizationParams({ selectAccount: true }).prompt,
    "consent select_account"
  );

  const authSource = readFileSync("lib/auth.ts", "utf8");
  const providerStart = authSource.indexOf("GoogleProvider({");
  const providerEnd = authSource.indexOf("CredentialsProvider({", providerStart);
  const providerBlock = authSource.slice(providerStart, providerEnd);
  assert.match(providerBlock, /GOOGLE_IDENTITY_AUTHORIZATION_PARAMS/);
  assert.doesNotMatch(providerBlock, /youtube|access_type|prompt:\s*["']consent/i);
  assert.match(authSource, /process\.env\.GOOGLE_OAUTH_EXCHANGE_SECRET/);
  assert.match(authSource, /X-CreatorJobs-OAuth-Exchange/);
  assert.doesNotMatch(authSource, /NEXT_PUBLIC_GOOGLE_OAUTH_EXCHANGE_SECRET/);
  assert.match(authSource, /accessToken: youtubeAuthorized \? account\.access_token : undefined/);

  for (const path of [
    "components/settings/SettingsClient.tsx",
    "components/PostJobPage.tsx",
    "components/you/YouHubClient.tsx",
  ]) {
    const source = readFileSync(path, "utf8");
    assert.match(source, /googleYouTubeAuthorizationParams\(/, path);
  }
  const authPage = readFileSync("components/AuthPage.tsx", "utf8");
  assert.match(authPage, /Continue with Google/);
  assert.doesNotMatch(authPage, /Continue with YouTube|YouTube login/);
});

test("YouTube browser disconnect sends only a fixed platform request", async () => {
  const calls = [];
  const result = await disconnectYouTubeConnection(async (url, init) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        disconnected: true,
        provider_revocation: "confirmed",
        channel_links_removed: 2,
      }),
    };
  });

  assert.equal(result.provider_revocation, "confirmed");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/identity/disconnect");
  assert.equal(calls[0].init.credentials, "same-origin");
  assert.deepEqual(JSON.parse(calls[0].init.body), { platform: "youtube" });
  assert.equal("Authorization" in calls[0].init.headers, false);
  assert.doesNotMatch(JSON.stringify(calls[0]), /access_token|refresh_token|providerAccountId/);

  await assert.rejects(
    disconnectYouTubeConnection(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, disconnected: true, provider_revocation: "invented" }),
    })),
    /invalid disconnect response/
  );
});

test("disconnect route owns authentication, origin, bounds, and backend revocation", () => {
  const route = readFileSync("app/api/identity/disconnect/route.ts", "utf8");
  assert.match(route, /getServerSession\(authOptions\)/);
  assert.match(route, /disconnectMyYouTube\(session\.backendAccessToken\)/);
  assert.match(route, /origin !== request\.nextUrl\.origin/);
  assert.match(route, /sec-fetch-site/);
  assert.match(route, /MAX_REQUEST_BODY_BYTES/);
  assert.match(route, /Cache-Control", "no-store/);
  assert.doesNotMatch(route, /cookies\.set|providerAccountId|refreshToken|access_token/);
});

test("YouTube refresh route rejects cross-site and QA credential use", () => {
  const route = readFileSync("app/api/identity/youtube/refresh/route.ts", "utf8");
  assert.match(route, /getServerSession\(authOptions\)/);
  assert.match(route, /origin !== request\.nextUrl\.origin/);
  assert.match(route, /sec-fetch-site/);
  assert.match(route, /session\.qaPersona/);
  assert.match(route, /Cache-Control", "no-store/);
  assert.doesNotMatch(route, /providerAccountId|refreshToken|access_token/);
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
