import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const scannedRoots = ["app", "components"];
const ignoredFiles = new Set(["app/activity/page.tsx"]);

function filesUnder(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...filesUnder(full));
    } else if (/\.(tsx?|jsx?)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

test("no user-facing app or component link points to retired /activity", () => {
  const offenders = [];
  for (const scope of scannedRoots) {
    for (const file of filesUnder(join(root, scope))) {
      const path = relative(root, file);
      if (ignoredFiles.has(path)) continue;
      const source = readFileSync(file, "utf8");
      if (/["'`]\/activity(?:\?|["'`])/.test(source)) {
        offenders.push(path);
      }
    }
  }

  assert.deepEqual(offenders, []);
});

test("draft routes do not point back to retired activity tabs", () => {
  const offenders = [];
  for (const scope of scannedRoots) {
    for (const file of filesUnder(join(root, scope))) {
      const path = relative(root, file);
      if (ignoredFiles.has(path)) continue;
      const source = readFileSync(file, "utf8");
      if (source.includes("/activity?tab=drafts")) {
        offenders.push(path);
      }
    }
  }

  assert.deepEqual(offenders, []);
});
