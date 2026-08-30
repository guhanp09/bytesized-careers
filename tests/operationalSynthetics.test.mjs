import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const QA_DIR = join(ROOT, "tests", "e2e", "qa");

const REQUIRED = new Map([
  ["auth", "qa-personas.spec.ts"],
  ["browse", "deep-search.spec.ts"],
  ["publish", "brand-about-candidate.spec.ts"],
  ["apply", "applicant-requirements.spec.ts"],
  ["message", "workspace-next-action.spec.ts"],
  ["admin", "qa-personas.spec.ts"],
]);

function source(path) {
  return readFileSync(join(ROOT, path), "utf8");
}

function taggedJourneys() {
  const found = [];
  for (const filename of readdirSync(QA_DIR).filter((name) => name.endsWith(".spec.ts"))) {
    const contents = readFileSync(join(QA_DIR, filename), "utf8");
    for (const match of contents.matchAll(/@synthetic:([a-z_]+)/g)) {
      found.push({ journey: match[1], filename, offset: match.index });
    }
  }
  return found;
}

test("the operational subset has exactly one real QA test for every required journey", () => {
  const found = taggedJourneys();
  assert.equal(found.length, REQUIRED.size);

  const byJourney = new Map();
  for (const entry of found) {
    assert.equal(byJourney.has(entry.journey), false, `duplicate @synthetic:${entry.journey}`);
    byJourney.set(entry.journey, entry.filename);

    const contents = readFileSync(join(QA_DIR, entry.filename), "utf8");
    const lineStart = contents.lastIndexOf("\n", entry.offset) + 1;
    const lineEnd = contents.indexOf("\n", entry.offset);
    const line = contents.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
    assert.match(line, /^test\(/, `@synthetic:${entry.journey} is not attached to a test`);
  }

  assert.deepEqual([...byJourney.entries()].sort(), [...REQUIRED.entries()].sort());
});

test("the synthetic command consumes those tags through the existing serial QA harness", () => {
  const packageJson = JSON.parse(source("package.json"));
  assert.equal(
    packageJson.scripts["test:e2e:synthetics"],
    "playwright test -c playwright.qa.config.ts --grep @synthetic:"
  );

  const config = source("playwright.qa.config.ts");
  assert.match(config, /testDir:\s*["']\.\/tests\/e2e\/qa["']/);
  assert.match(config, /workers:\s*1/);
  assert.match(config, /fullyParallel:\s*false/);
  assert.match(config, /APP_ENV=test/);
  assert.match(config, /sqlite\+aiosqlite:\/\/\/\.\/\.local-data\/qa-playwright\.db/);
});

test("the selected publish journey is deterministic and no selected test is a live-provider smoke", () => {
  const publish = source("tests/e2e/qa/brand-about-candidate.spec.ts");
  assert.match(publish, /armProbe/);
  assert.match(publish, /@synthetic:publish/);

  for (const entry of taggedJourneys()) {
    assert.notEqual(entry.filename, "import-live-smoke.spec.ts");
  }
});
