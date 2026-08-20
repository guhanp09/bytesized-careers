import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  normalizeLocalBaseUrl,
  runConcurrentSessionCheck,
} from "../scripts/check-concurrent-sessions.mjs";

const accountTypes = ["TALENT", "EMPLOYER", "BOTH"];

const responseFor = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

function concurrentFetch(sessionCount, mutateSession = (session) => session) {
  const started = { session: 0, workspace: 0 };
  const releases = {};
  const allStarted = {
    session: new Promise((resolve) => {
      releases.session = resolve;
    }),
    workspace: new Promise((resolve) => {
      releases.workspace = resolve;
    }),
  };

  return {
    started: () => ({ ...started }),
    fetch: async (url, options = {}) => {
      const pathname = new URL(url).pathname;
      if (pathname === "/api/health") return responseFor({ status: "ok" });

      const kind = pathname === "/api/auth/session" ? "session" : "workspace";
      started[kind] += 1;
      if (started[kind] === sessionCount) releases[kind]();
      await allStarted[kind];

      const cookie = options.headers.Cookie;
      const id = cookie.match(/encoded-(load-user-\d{3})$/)?.[1];
      assert.ok(id, "each request carries its own encoded session cookie");
      const index = Number(id.slice(-3));
      const suffix = String(index).padStart(3, "0");
      const session = mutateSession(
        {
          backendUserId: id,
          backendAccessToken: `load-backend-access-${suffix}`,
          user: {
            email: `${id}@session.invalid`,
            name: `Load User ${suffix}`,
            userId: id,
            backendUserId: id,
            username: id,
            accountType: accountTypes[index % accountTypes.length],
          },
        },
        index,
      );
      if (kind === "workspace") {
        return new Response(
          `<html>${session.backendUserId} ${session.backendAccessToken}</html>`,
          { status: 200, headers: { "content-type": "text/html" } },
        );
      }
      return responseFor(session);
    },
    encode: async ({ token }) => `encoded-${token.backendUserId}`,
  };
}

test("the check is physically unable to target a non-loopback deployment", () => {
  assert.equal(normalizeLocalBaseUrl("http://127.0.0.1:3100"), "http://127.0.0.1:3100");
  assert.equal(normalizeLocalBaseUrl("https://[::1]:3443"), "https://[::1]:3443");
  for (const url of [
    "https://creatorjobs.example",
    "http://localhost:3100",
    "http://127.0.0.1.evil.test:3100",
    "http://user:pass@127.0.0.1:3100",
    "http://127.0.0.1:3100/path",
    "file:///tmp/server",
  ]) {
    assert.throws(() => normalizeLocalBaseUrl(url), /local-only|absolute local/);
  }
});

test("one hundred distinct sessions are in flight together and remain isolated", { timeout: 3000 }, async () => {
  const fixture = concurrentFetch(100);
  const result = await runConcurrentSessionCheck({
    baseUrl: "http://127.0.0.1:3100",
    secret: "unit-test-secret",
    sessionCount: 100,
    fetchImpl: fixture.fetch,
    encodeImpl: fixture.encode,
  });
  assert.deepEqual(fixture.started(), { session: 100, workspace: 100 });
  assert.deepEqual(result, {
    checked: 100,
    isolatedIdentities: 100,
    workspaceResponses: 100,
  });
});

test("one crossed session fails the exercise instead of being averaged away", async () => {
  const fixture = concurrentFetch(8, (session, index) =>
    index === 3
      ? {
          ...session,
          backendUserId: "load-user-004",
          backendAccessToken: "do-not-log-this-access-token",
        }
      : session,
  );
  let failure;
  try {
    await runConcurrentSessionCheck({
      baseUrl: "http://127.0.0.1:3100",
      secret: "unit-test-secret",
      sessionCount: 8,
      fetchImpl: fixture.fetch,
      encodeImpl: fixture.encode,
    });
  } catch (error) {
    failure = error;
  }
  assert.ok(failure instanceof Error);
  assert.match(failure.message, /1\/8 concurrent session checks failed[\s\S]*load-user-003/);
  assert.doesNotMatch(failure.message, /do-not-log-this-access-token/);
});

test("package.json exposes the local correctness exercise", () => {
  const packageJson = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.equal(
    packageJson.scripts["check:concurrent-sessions"],
    "node scripts/check-concurrent-sessions.mjs",
  );
});
