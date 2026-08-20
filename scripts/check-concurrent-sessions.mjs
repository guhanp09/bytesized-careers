#!/usr/bin/env node

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { encode } from "next-auth/jwt";

const LOCAL_HOSTS = new Set(["127.0.0.1", "[::1]"]);
const ACCOUNT_TYPES = ["TALENT", "EMPLOYER", "BOTH"];

export function normalizeLocalBaseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("SESSION_CHECK_BASE_URL must be an absolute local HTTP(S) origin.");
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    !LOCAL_HOSTS.has(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "The concurrent-session check is local-only and requires a plain loopback HTTP(S) origin.",
    );
  }
  return url.origin;
}

function expectedSession(index) {
  const suffix = String(index).padStart(3, "0");
  return {
    id: `load-user-${suffix}`,
    email: `load-user-${suffix}@session.invalid`,
    username: `load-user-${suffix}`,
    name: `Load User ${suffix}`,
    accountType: ACCOUNT_TYPES[index % ACCOUNT_TYPES.length],
    backendAccessToken: `load-backend-access-${suffix}`,
    forbiddenProviderSentinel: `provider-secret-${suffix}`,
  };
}

function assertExpectedSession(session, expected) {
  const mismatches = [];
  const expect = (label, actual, wanted, { sensitive = false } = {}) => {
    if (actual !== wanted) {
      mismatches.push(
        sensitive ? `${label} did not match its session` : `${label} was ${JSON.stringify(actual)}`,
      );
    }
  };
  expect("session.user.email", session?.user?.email, expected.email);
  expect("session.user.name", session?.user?.name, expected.name);
  expect("session.user.userId", session?.user?.userId, expected.id);
  expect("session.user.backendUserId", session?.user?.backendUserId, expected.id);
  expect("session.user.username", session?.user?.username, expected.username);
  expect("session.user.accountType", session?.user?.accountType, expected.accountType);
  expect("session.backendUserId", session?.backendUserId, expected.id);
  expect(
    "session.backendAccessToken",
    session?.backendAccessToken,
    expected.backendAccessToken,
    { sensitive: true },
  );
  const serialized = JSON.stringify(session);
  if (serialized.includes(expected.forbiddenProviderSentinel)) {
    mismatches.push("browser session leaked provider credential material");
  }
  if (mismatches.length > 0) {
    throw new Error(`${expected.id}: ${mismatches.join("; ")}`);
  }
}

function assertExpectedWorkspace(body, expected) {
  const accessTokens = new Set(body.match(/load-backend-access-\d{3}/g) ?? []);
  const userIds = new Set(body.match(/load-user-\d{3}/g) ?? []);
  if (accessTokens.size !== 1 || !accessTokens.has(expected.backendAccessToken)) {
    throw new Error(`${expected.id}: workspace carried the wrong backend access identity`);
  }
  if (userIds.size !== 1 || !userIds.has(expected.id)) {
    throw new Error(`${expected.id}: workspace carried the wrong user identity`);
  }
  if (body.includes(expected.forbiddenProviderSentinel)) {
    throw new Error(`${expected.id}: workspace leaked provider credential material`);
  }
  if (body.includes("Sign in to open your applications")) {
    throw new Error(`${expected.id}: workspace rendered the anonymous state`);
  }
}

function failuresFrom(settled) {
  return settled
    .filter((result) => result.status === "rejected")
    .map((result) => (result.reason instanceof Error ? result.reason.message : String(result.reason)));
}

function assertNoFailures(label, settled, sessionCount) {
  const failures = failuresFrom(settled);
  if (failures.length > 0) {
    throw new Error(
      `${failures.length}/${sessionCount} concurrent ${label} checks failed:\n` +
        failures.slice(0, 10).map((failure) => `  ${failure}`).join("\n"),
    );
  }
}

export async function runConcurrentSessionCheck({
  baseUrl,
  secret,
  sessionCount = 100,
  timeoutMs = 30_000,
  fetchImpl = globalThis.fetch,
  encodeImpl = encode,
}) {
  const origin = normalizeLocalBaseUrl(baseUrl);
  if (typeof secret !== "string" || secret.length === 0) {
    throw new Error("SESSION_CHECK_NEXTAUTH_SECRET is required.");
  }
  if (!Number.isInteger(sessionCount) || sessionCount < 1 || sessionCount > 1_000) {
    throw new Error("Session count must be an integer between 1 and 1000.");
  }

  const health = await fetchImpl(`${origin}/api/health`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!health.ok) {
    throw new Error(`Local server health check returned HTTP ${health.status}.`);
  }
  const healthBody = await health.json();
  if (healthBody?.status !== "ok") {
    throw new Error("Local server health response did not report status=ok.");
  }

  const expected = Array.from({ length: sessionCount }, (_, index) => expectedSession(index));
  const encoded = await Promise.all(
    expected.map((identity) =>
      encodeImpl({
        secret,
        token: {
          name: identity.name,
          email: identity.email,
          sub: identity.id,
          username: identity.username,
          displayName: identity.name,
          backendAccessToken: identity.backendAccessToken,
          backendAccessTokenExpiresAt: Date.now() + 60 * 60 * 1000,
          backendTokenType: "bearer",
          backendUserId: identity.id,
          accountType: identity.accountType,
          onboardingIntent: "DECIDE_LATER",
          provider: "google",
          // Existing cookies from before Phase 1B may still carry these. The
          // real callback must strip them even while many sessions are read.
          accessToken: identity.forbiddenProviderSentinel,
          refreshToken: identity.forbiddenProviderSentinel,
          providerAccountId: identity.forbiddenProviderSentinel,
        },
      }),
    ),
  );

  // All promises are created before any is awaited. Each request has a distinct
  // encrypted session cookie and expected identity, so a process-global session
  // cache or cross-request mutation is observable as a mismatch, not a timing.
  const sessionSettled = await Promise.allSettled(
    expected.map(async (identity, index) => {
      const cookieName = origin.startsWith("https:")
        ? "__Secure-next-auth.session-token"
        : "next-auth.session-token";
      const response = await fetchImpl(`${origin}/api/auth/session`, {
        cache: "no-store",
        headers: {
          Accept: "application/json",
          Cookie: `${cookieName}=${encoded[index]}`,
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.status !== 200) {
        throw new Error(`${identity.id}: session endpoint returned HTTP ${response.status}`);
      }
      const session = await response.json();
      assertExpectedSession(session, identity);
      return session.user.userId;
    }),
  );
  assertNoFailures("session", sessionSettled, sessionCount);

  const observedUsers = new Set(sessionSettled.map((result) => result.value));
  if (observedUsers.size !== sessionCount) {
    throw new Error(
      `Expected ${sessionCount} isolated identities, observed ${observedUsers.size}.`,
    );
  }

  // Repeat the same isolation proof through an actual authenticated dynamic
  // workspace render. This catches route-level caching or request-context reuse
  // that `/api/auth/session` alone cannot expose. The route does no server-side
  // workspace write and the fake backend credential is never sent anywhere.
  const workspaceSettled = await Promise.allSettled(
    expected.map(async (identity, index) => {
      const cookieName = origin.startsWith("https:")
        ? "__Secure-next-auth.session-token"
        : "next-auth.session-token";
      const response = await fetchImpl(`${origin}/applications`, {
        cache: "no-store",
        headers: {
          Accept: "text/html",
          Cookie: `${cookieName}=${encoded[index]}`,
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.status !== 200) {
        throw new Error(`${identity.id}: workspace returned HTTP ${response.status}`);
      }
      assertExpectedWorkspace(await response.text(), identity);
    }),
  );
  assertNoFailures("workspace", workspaceSettled, sessionCount);

  return {
    checked: sessionCount,
    isolatedIdentities: observedUsers.size,
    workspaceResponses: workspaceSettled.length,
  };
}

function argumentValue(name) {
  const exactIndex = process.argv.indexOf(name);
  if (exactIndex >= 0) return process.argv[exactIndex + 1];
  const prefix = `${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
}

async function main() {
  const baseUrl =
    argumentValue("--base-url") ||
    process.env.SESSION_CHECK_BASE_URL ||
    "http://127.0.0.1:3100";
  const countValue = argumentValue("--sessions") || "100";
  if (!/^\d+$/.test(countValue)) {
    throw new Error("--sessions must be a positive integer.");
  }
  const result = await runConcurrentSessionCheck({
    baseUrl,
    secret: process.env.SESSION_CHECK_NEXTAUTH_SECRET,
    sessionCount: Number(countValue),
  });
  process.stdout.write(
    `Concurrent session correctness: ${result.checked}/${result.checked} session responses and ` +
      `${result.workspaceResponses}/${result.workspaceResponses} workspace renders matched, ` +
      `${result.isolatedIdentities} isolated identities.\n` +
      "No latency threshold was evaluated.\n",
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
