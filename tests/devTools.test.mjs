import test from "node:test";
import assert from "node:assert/strict";

import { evaluateDevToolsAllowed, DEV_PERSONA_PASSWORD } from "../lib/devTools.ts";

test("a shared dev persona password is exported", () => {
  assert.equal(typeof DEV_PERSONA_PASSWORD, "string");
  assert.ok(DEV_PERSONA_PASSWORD.length >= 8);
});

test("production signals hard-deny the dev tools", () => {
  assert.equal(evaluateDevToolsAllowed({ APP_ENV: "production" }), false);
  assert.equal(evaluateDevToolsAllowed({ NEXT_PUBLIC_APP_ENV: "production" }), false);
  assert.equal(evaluateDevToolsAllowed({ VERCEL_ENV: "production" }), false);
  // A production signal wins even alongside dev/local signals.
  assert.equal(
    evaluateDevToolsAllowed({
      APP_ENV: "production",
      NODE_ENV: "development",
      NEXT_PUBLIC_BACKEND_URL: "http://localhost:8000/api/v1",
    }),
    false
  );
});

test("explicit dev/test environments are allowed", () => {
  assert.equal(evaluateDevToolsAllowed({ APP_ENV: "development" }), true);
  assert.equal(evaluateDevToolsAllowed({ APP_ENV: "test" }), true);
  assert.equal(evaluateDevToolsAllowed({ NEXT_PUBLIC_APP_ENV: "development" }), true);
  assert.equal(evaluateDevToolsAllowed({ NEXT_PUBLIC_APP_ENV: "test" }), true);
  assert.equal(evaluateDevToolsAllowed({ NODE_ENV: "development" }), true);
});

test("local URLs are allowed when no explicit env is set (e.g. next start on localhost)", () => {
  assert.equal(evaluateDevToolsAllowed({ NEXTAUTH_URL: "http://127.0.0.1:3100" }), true);
  assert.equal(
    evaluateDevToolsAllowed({ NEXT_PUBLIC_BACKEND_URL: "http://localhost:8000/api/v1" }),
    true
  );
  assert.equal(evaluateDevToolsAllowed({ FRONTEND_BASE_URL: "http://localhost:3000" }), true);
});

test("an unknown/remote environment defaults to denied", () => {
  assert.equal(
    evaluateDevToolsAllowed({
      NODE_ENV: "production",
      NEXTAUTH_URL: "https://creatorjobs.example",
      NEXT_PUBLIC_BACKEND_URL: "https://api.creatorjobs.example/api/v1",
    }),
    false
  );
  assert.equal(evaluateDevToolsAllowed({}), false);
});
