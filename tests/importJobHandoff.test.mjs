import test from "node:test";
import assert from "node:assert/strict";

import {
  ANON_OWNER,
  IMPORT_CONSUMED_KEY,
  IMPORT_HANDOFF_KEY,
  IMPORT_HANDOFF_MAX_AGE_MS,
  IMPORT_SOURCE_KEY,
  decodeImportHandoff,
  decodeImportSource,
  encodeImportHandoff,
  encodeImportSource,
  hasRecentImportConsumption,
  markImportConsumed,
  readImportHandoff,
  readImportSource,
  writeImportHandoff,
  writeImportSource,
} from "../lib/importJob/handoff.ts";

const samplePayload = (owner = "user-1") => ({
  version: 1,
  createdAt: Date.now(),
  owner,
  initialStep: "basics",
  prefill: { title: "Video Editor" },
  meta: { title: { status: "imported" } },
});

// Minimal sessionStorage stand-in so the browser wrappers are testable in Node.
function installFakeStorage() {
  const map = new Map();
  globalThis.window = {
    sessionStorage: {
      getItem: (k) => (map.has(k) ? map.get(k) : null),
      setItem: (k, v) => map.set(k, String(v)),
      removeItem: (k) => map.delete(k),
    },
  };
  return map;
}

function removeFakeStorage() {
  delete globalThis.window;
}

test("codec roundtrip for the resolved owner", () => {
  const payload = samplePayload("user-1");
  const decoded = decodeImportHandoff(encodeImportHandoff(payload), "user-1");
  assert.deepEqual(decoded, payload);
});

test("malformed JSON, wrong version, and stale payloads decode to null", () => {
  assert.equal(decodeImportHandoff("{not json", "user-1"), null);
  assert.equal(decodeImportHandoff(JSON.stringify({ ...samplePayload(), version: 2 }), "user-1"), null);
  const stale = { ...samplePayload(), createdAt: Date.now() - IMPORT_HANDOFF_MAX_AGE_MS - 1000 };
  assert.equal(decodeImportHandoff(JSON.stringify(stale), "user-1"), null);
  assert.equal(decodeImportHandoff(null, "user-1"), null);
  assert.equal(decodeImportHandoff(undefined, "user-1"), null);
});

test("owner mismatch decodes to null (anon→user and user→user transitions)", () => {
  const anonPayload = samplePayload(ANON_OWNER);
  assert.equal(decodeImportHandoff(encodeImportHandoff(anonPayload), "user-1"), null);
  const userPayload = samplePayload("user-1");
  assert.equal(decodeImportHandoff(encodeImportHandoff(userPayload), "user-2"), null);
  assert.equal(decodeImportHandoff(encodeImportHandoff(userPayload), ANON_OWNER), null);
  // Same owner still works.
  assert.ok(decodeImportHandoff(encodeImportHandoff(userPayload), "user-1"));
});

test("readImportHandoff purges foreign/stale payloads but leaves valid ones until consumed", () => {
  const map = installFakeStorage();
  try {
    writeImportHandoff(samplePayload("user-1"));
    assert.ok(map.has(IMPORT_HANDOFF_KEY));
    // Foreign owner → null + purge.
    assert.equal(readImportHandoff("user-2"), null);
    assert.equal(map.has(IMPORT_HANDOFF_KEY), false);
    // Valid read does not purge (consumption is the wizard's explicit step).
    writeImportHandoff(samplePayload("user-1"));
    assert.ok(readImportHandoff("user-1"));
    assert.ok(map.has(IMPORT_HANDOFF_KEY));
  } finally {
    removeFakeStorage();
  }
});

test("source key roundtrip is owner-validated too", () => {
  const map = installFakeStorage();
  try {
    writeImportSource("pasted post text", ANON_OWNER);
    assert.equal(readImportSource(ANON_OWNER), "pasted post text");
    // A different resolved owner never inherits the paste; the key purges.
    assert.equal(readImportSource("user-1"), null);
    assert.equal(map.has(IMPORT_SOURCE_KEY), false);
  } finally {
    removeFakeStorage();
  }
});

test("source codec rejects stale and foreign payloads", () => {
  const good = { version: 1, createdAt: Date.now(), owner: "user-1", text: "hello" };
  assert.ok(decodeImportSource(encodeImportSource(good), "user-1"));
  assert.equal(decodeImportSource(encodeImportSource(good), "user-2"), null);
  const stale = { ...good, createdAt: Date.now() - IMPORT_HANDOFF_MAX_AGE_MS - 1 };
  assert.equal(decodeImportSource(encodeImportSource(stale), "user-1"), null);
});

test("consumed marker is owner-stamped: foreign and stale markers purge and read false", () => {
  const map = installFakeStorage();
  try {
    markImportConsumed("user-1");
    assert.equal(hasRecentImportConsumption("user-1"), true);
    // Foreign owner reads false AND purges the marker.
    assert.equal(hasRecentImportConsumption("user-2"), false);
    assert.equal(map.has(IMPORT_CONSUMED_KEY), false);
    // Stale marker reads false.
    map.set(IMPORT_CONSUMED_KEY, JSON.stringify({ at: Date.now() - IMPORT_HANDOFF_MAX_AGE_MS - 1, owner: "user-1" }));
    assert.equal(hasRecentImportConsumption("user-1"), false);
    assert.equal(map.has(IMPORT_CONSUMED_KEY), false);
  } finally {
    removeFakeStorage();
  }
});

test("no storage available degrades to absent, never throws", () => {
  removeFakeStorage();
  assert.equal(readImportHandoff("user-1"), null);
  assert.equal(readImportSource("user-1"), null);
  assert.equal(hasRecentImportConsumption("user-1"), false);
  // Writes are safe no-ops.
  writeImportHandoff(samplePayload());
  writeImportSource("text", ANON_OWNER);
  markImportConsumed("user-1");
});
