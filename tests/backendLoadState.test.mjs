import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyBackendLoadResult,
  classifyBackendLoadResults,
  hasBackendSessionAuthError,
  isBackendLoadAuthError,
} from "../lib/backendLoadState.ts";

const fulfilled = (value) => ({ status: "fulfilled", value });
const rejected = (reason) => ({ status: "rejected", reason });
const backendError = (status, message) => Object.assign(new Error(message), { status });

test("classifies successful empty data as ready", () => {
  assert.deepEqual(classifyBackendLoadResult(fulfilled([])), {
    kind: "ready",
    data: [],
  });
});

test("classifies successful data as ready", () => {
  assert.deepEqual(classifyBackendLoadResult(fulfilled({ items: ["one"] })), {
    kind: "ready",
    data: { items: ["one"] },
  });
});

test("classifies backend 401 and 403 errors as auth", () => {
  assert.deepEqual(
    classifyBackendLoadResult(rejected(backendError(401, "Unauthorized"))),
    { kind: "auth" }
  );
  assert.deepEqual(
    classifyBackendLoadResult(rejected(backendError(403, "Forbidden"))),
    { kind: "auth" }
  );
});

test("classifies backendAuthError as auth before inspecting requests", () => {
  assert.equal(hasBackendSessionAuthError({ backendAuthError: "refresh_failed" }), true);
  assert.equal(hasBackendSessionAuthError({ backendAuthError: "missing_refresh_token" }), true);
  assert.deepEqual(classifyBackendLoadResult(fulfilled([]), true), { kind: "auth" });
});

test("classifies backend credential errors by message as auth", () => {
  assert.equal(isBackendLoadAuthError(new Error("Could not validate credentials")), true);
});

test("classifies backend 500 and network failures as generic errors", () => {
  assert.deepEqual(
    classifyBackendLoadResult(rejected(backendError(500, "Server error"))),
    { kind: "error" }
  );
  assert.deepEqual(classifyBackendLoadResult(rejected(new TypeError("fetch failed"))), {
    kind: "error",
  });
});

test("classifies multiple successful loads as ready tuple data", () => {
  assert.deepEqual(
    classifyBackendLoadResults([fulfilled(["job"]), fulfilled(["talent"])]),
    {
      kind: "ready",
      data: [["job"], ["talent"]],
    }
  );
});

test("classifies partial generic failure as error", () => {
  assert.deepEqual(
    classifyBackendLoadResults([fulfilled(["job"]), rejected(new Error("backend unavailable"))]),
    { kind: "error" }
  );
});

test("classifies partial auth failure as auth", () => {
  assert.deepEqual(
    classifyBackendLoadResults([
      fulfilled(["job"]),
      rejected(backendError(401, "Unauthorized")),
    ]),
    { kind: "auth" }
  );
});
