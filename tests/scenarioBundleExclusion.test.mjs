import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * Seed content must not ship to users.
 *
 * Hiding the Mock toggle would not achieve this — the JSON would still be in
 * the download. The boundary is that manifests are read from disk by a
 * server-only route handler, so they cannot be bundled whatever a component
 * imports. This asserts that property against the *actual build output* rather
 * than trusting the arrangement.
 *
 * Skips rather than fails when there is no build to inspect, so the ordinary
 * unit run stays fast; the validation matrix runs it after `npm run build`.
 */

const CLIENT_DIR = path.join(process.cwd(), ".next", "static");

/** Distinctive, and deliberately not sensitive: these are seed-only strings. */
const SEED_SENTINELS = [
  "scenario.invalid",            // every generated email and URL host
  "thumbs.scenario.invalid",
  "Bartholomew Maximilian",      // an edge-scenario display name
  "Case Files Weekly",           // a generated channel
  "creator_scenarios",           // the generator package path
];

function clientChunks() {
  if (!fs.existsSync(CLIENT_DIR)) return null;
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(js|mjs|json)$/.test(entry.name)) files.push(full);
    }
  };
  walk(CLIENT_DIR);
  return files;
}

test("no seed sentinel appears in any client chunk", (t) => {
  const files = clientChunks();
  if (!files) return t.skip("no production build to inspect — run `npm run build` first");
  assert.ok(files.length > 0, "the build produced no client chunks to inspect");

  const offenders = [];
  for (const file of files) {
    const contents = fs.readFileSync(file, "utf8");
    for (const sentinel of SEED_SENTINELS) {
      if (contents.includes(sentinel)) {
        offenders.push(`${path.relative(process.cwd(), file)} contains ${JSON.stringify(sentinel)}`);
      }
    }
  }
  assert.deepEqual(offenders, [], `seed content reached the client bundle:\n${offenders.join("\n")}`);
});

test("no client chunk is large enough to be a scenario manifest", (t) => {
  const files = clientChunks();
  if (!files) return t.skip("no production build to inspect");
  // The smallest non-empty manifest is ~90KB and `busy` approaches 1MB. A
  // chunk that size would mean one was inlined even if the sentinels changed.
  const manifestDir = path.join(process.cwd(), "fixtures", "creator_scenarios", "generated");
  const manifestSizes = fs
    .readdirSync(manifestDir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => fs.statSync(path.join(manifestDir, name)).size);
  const smallestRealManifest = Math.min(...manifestSizes.filter((size) => size > 10_000));

  for (const file of files) {
    const size = fs.statSync(file).size;
    if (size < smallestRealManifest) continue;
    const contents = fs.readFileSync(file, "utf8");
    assert.ok(
      !contents.includes('"relationships"') || !contents.includes('"participant_stage"'),
      `${path.relative(process.cwd(), file)} looks like it inlined a manifest`
    );
  }
});

test("the committed manifests are not inside the public directory", () => {
  // A public copy would be fetchable in production regardless of the route
  // guard, which is the same failure by another path.
  const publicDir = path.join(process.cwd(), "public");
  if (!fs.existsSync(publicDir)) return;
  const found = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/creator_scenarios|scenario\.invalid/.test(entry.name)) found.push(full);
    }
  };
  walk(publicDir);
  assert.deepEqual(found, [], "scenario data must not be publicly served");
});

test("the manifest loader is a server route, not an importable module", () => {
  // The route uses node:fs. If it ever stopped doing so — for example by
  // importing the JSON directly — the manifests would become bundleable again.
  const route = fs.readFileSync(
    path.join(process.cwd(), "app", "api", "dev", "scenario", "[scenario]", "route.ts"),
    "utf8"
  );
  assert.match(route, /node:fs\/promises/, "the loader must read from disk");
  assert.match(route, /isProductionRuntime\(\)/, "the loader must be gated out of production");
  assert.doesNotMatch(route, /import .*\.json/, "importing a manifest would make it bundleable");
});
