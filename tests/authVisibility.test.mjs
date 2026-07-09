import test from "node:test";
import assert from "node:assert/strict";

import { isEmailAuthEnabled } from "../lib/authVisibility.ts";

test("email auth is enabled by default for local development", () => {
  assert.equal(isEmailAuthEnabled({}), true);
  assert.equal(isEmailAuthEnabled({ NEXT_PUBLIC_APP_ENV: "development" }), true);
});

test("email auth is disabled by default in staging and production", () => {
  assert.equal(isEmailAuthEnabled({ NEXT_PUBLIC_APP_ENV: "staging" }), false);
  assert.equal(isEmailAuthEnabled({ NEXT_PUBLIC_APP_ENV: "production" }), false);
});

test("explicit public email auth flag controls non-production auth visibility", () => {
  assert.equal(
    isEmailAuthEnabled({
      NEXT_PUBLIC_APP_ENV: "staging",
      NEXT_PUBLIC_ENABLE_EMAIL_AUTH: "true",
    }),
    true
  );
  assert.equal(
    isEmailAuthEnabled({
      NEXT_PUBLIC_APP_ENV: "development",
      NEXT_PUBLIC_ENABLE_EMAIL_AUTH: "false",
    }),
    false
  );
});

