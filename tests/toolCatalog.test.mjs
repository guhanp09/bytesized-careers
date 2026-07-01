import assert from "node:assert/strict";
import test from "node:test";

import {
  findToolCatalogEntry,
  resolveToolDisplay,
  toolInitials,
  TOOL_CATALOG,
} from "../lib/toolCatalog.ts";

test("tool catalog includes broad creator-economy tool coverage", () => {
  assert.ok(TOOL_CATALOG.length >= 50);
  assert.ok(findToolCatalogEntry("Premiere Pro"));
  assert.ok(findToolCatalogEntry("After Effects"));
  assert.ok(findToolCatalogEntry("YouTube Studio"));
  assert.ok(findToolCatalogEntry("Frame.io"));
});

test("tool catalog resolves aliases case-insensitively", () => {
  assert.equal(resolveToolDisplay(" premiere ").displayName, "Adobe Premiere Pro");
  assert.equal(resolveToolDisplay("ADOBE PREMIERE").logoKey, "premiere-pro");
  assert.equal(resolveToolDisplay("AE").displayName, "Adobe After Effects");
  assert.equal(resolveToolDisplay("sheets").displayName, "Google Sheets");
  assert.equal(resolveToolDisplay("twitter").displayName, "X / Twitter");
});

test("unknown tools render with a safe fallback", () => {
  const custom = resolveToolDisplay("Custom Retention Tool");
  assert.equal(custom.known, false);
  assert.equal(custom.logoKey, null);
  assert.equal(custom.displayName, "Custom Retention Tool");
  assert.equal(custom.initials, "CR");
  assert.equal(toolInitials("singleword"), "SI");
});
