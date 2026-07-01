import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeProfileTag,
  sanitizeProfileTags,
  validateProfileTag,
  validateProfileTags,
} from "../lib/profileTags.ts";

test("profile tags normalize spacing and accept real creator tags", () => {
  assert.equal(normalizeProfileTag("  Premiere   Pro  "), "Premiere Pro");
  for (const tag of ["CapCut", "Premiere Pro", "YouTube", "Shorts", "Motion Graphics", "Thumbnail Design", "Channel Manager", "UGC", "AI tools"]) {
    assert.equal(validateProfileTag(tag), null, `${tag} should be valid`);
  }
});

test("profile tags reject unclear repeated-character entries", () => {
  for (const tag of ["ioooo", "loooo", "aaaa", "xxxxxx", "11111", "!!!!"]) {
    assert.equal(validateProfileTag(tag), "Enter a clear skill, tool, niche, or content type.", `${tag} should be rejected`);
  }
});

test("profile tags reject duplicates case-insensitively", () => {
  assert.equal(validateProfileTag("capcut", ["CapCut"]), "\"capcut\" is already added.");
  assert.equal(validateProfileTags(["CapCut", "capcut"]), "\"capcut\" is already added.");
});

test("profile tag sanitizer filters invalid existing public tags", () => {
  assert.deepEqual(
    sanitizeProfileTags(["CapCut", "ioooo", "Premiere   Pro", "capcut", "!!!!", "AI tools"]),
    ["CapCut", "Premiere Pro", "AI tools"]
  );
});
