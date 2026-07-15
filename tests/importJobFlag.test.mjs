import test from "node:test";
import assert from "node:assert/strict";

import { evaluateJobImportAllowed } from "../lib/importJob/flag.ts";

test("explicit ENABLE_JOB_IMPORT=true wins everywhere, including production", () => {
  for (const value of ["true", "1", "yes", "on", "TRUE"]) {
    assert.equal(evaluateJobImportAllowed({ ENABLE_JOB_IMPORT: value, VERCEL_ENV: "production" }), true, value);
  }
});

test("explicit ENABLE_JOB_IMPORT=false wins everywhere, including development", () => {
  for (const value of ["false", "0", "no", "off", "FALSE"]) {
    assert.equal(evaluateJobImportAllowed({ ENABLE_JOB_IMPORT: value, NODE_ENV: "development" }), false, value);
  }
});

test("default: off in production (any production signal)", () => {
  assert.equal(evaluateJobImportAllowed({ APP_ENV: "production" }), false);
  assert.equal(evaluateJobImportAllowed({ NEXT_PUBLIC_APP_ENV: "production" }), false);
  assert.equal(evaluateJobImportAllowed({ VERCEL_ENV: "production" }), false);
});

test("default: on in development, test, staging, and unspecified local envs", () => {
  assert.equal(evaluateJobImportAllowed({ APP_ENV: "development" }), true);
  assert.equal(evaluateJobImportAllowed({ APP_ENV: "test" }), true);
  assert.equal(evaluateJobImportAllowed({ APP_ENV: "staging" }), true);
  assert.equal(evaluateJobImportAllowed({}), true);
});

test("unrecognized flag values fall through to the environment default", () => {
  assert.equal(evaluateJobImportAllowed({ ENABLE_JOB_IMPORT: "maybe", VERCEL_ENV: "production" }), false);
  assert.equal(evaluateJobImportAllowed({ ENABLE_JOB_IMPORT: "maybe" }), true);
});
