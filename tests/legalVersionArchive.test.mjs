/**
 * Can an acceptance record be turned back into the wording it names?
 *
 * Until the registry existed it could not. The pages held their text inline and
 * showed no version, so "they accepted 2026-06-01" pointed at nothing
 * retrievable, and editing a page silently changed what every earlier
 * acceptance appeared to mean.
 *
 * These tests hold two properties.
 *
 * A published version's bytes do not change. That is enforced by a checksum
 * rather than by asking people to be careful, because the failure is invisible:
 * an edited archive still renders, still passes every other test, and quietly
 * rewrites history.
 *
 * And the version the backend records acceptances against must be one the
 * frontend can actually render. A backend naming a version that does not exist
 * here is the exact failure its own module warns about.
 *
 * Nothing here decides what future wording says, or whether superseded versions
 * must stay reachable to a reader. Those are counsel and product questions. This
 * only guarantees the bytes survive to answer them with.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import test from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const versionsDir = join(here, "..", "lib", "legal", "versions");
const backendLegal = join(
  here,
  "..",
  "backend",
  "app",
  "core",
  "legal_documents.py",
);

/**
 * Checksums of every published version.
 *
 * A new version adds a line here. Changing an existing line means the archive
 * was edited, which is the thing being prevented — so a failure is the test
 * working, not the test being stale.
 */
const PUBLISHED_CHECKSUMS = {
  "2026-06-01.ts":
    "4606c70609fdfc180fbaea57fd4fb667b2dfe21e02da44b2600a4b460d251d58",
};

function checksum(file) {
  const contents = readFileSync(join(versionsDir, file));
  return createHash("sha256").update(contents).digest("hex");
}

test("every archived version file has a recorded checksum", () => {
  const files = readdirSync(versionsDir).filter((name) => name.endsWith(".ts"));

  assert.ok(files.length > 0, "expected at least one published version");
  for (const file of files) {
    assert.ok(
      file in PUBLISHED_CHECKSUMS,
      `${file} is published but has no recorded checksum — add one deliberately`,
    );
  }
});

test("a published version's bytes never change", () => {
  const drifted = [];
  for (const [file, expected] of Object.entries(PUBLISHED_CHECKSUMS)) {
    const actual = checksum(file);
    if (actual !== expected) {
      drifted.push(`${file}: recorded ${expected}, found ${actual}`);
    }
  }

  assert.deepEqual(
    drifted,
    [],
    "an archived legal version changed. If the wording is meant to change, add a " +
      "NEW version file and register it; editing a published one rewrites what " +
      "existing acceptances appear to mean.\n" +
      drifted.join("\n"),
  );
});

test("the backend records acceptances against a version the frontend can render", () => {
  const backendSource = readFileSync(backendLegal, "utf8");
  const declared = [...backendSource.matchAll(/version="([0-9]{4}-[0-9]{2}-[0-9]{2})"/g)].map(
    (match) => match[1],
  );

  assert.ok(declared.length > 0, "expected the backend to declare a version");

  const archived = readdirSync(versionsDir)
    .filter((name) => name.endsWith(".ts"))
    .map((name) => name.replace(/\.ts$/, ""));

  for (const version of declared) {
    assert.ok(
      archived.includes(version),
      `the backend accepts against ${version}, which has no archived wording. ` +
        "An acceptance naming wording nobody can produce is not provenance.",
    );
  }
});

test("the archive contains wording rather than an empty shell", () => {
  const source = readFileSync(join(versionsDir, "2026-06-01.ts"), "utf8");

  assert.match(source, /TERMS_SECTIONS/);
  assert.match(source, /PRIVACY_SECTIONS/);
  // A shell that exported empty arrays would satisfy every structural check
  // above while archiving nothing.
  assert.ok(source.length > 1500, "archived version looks suspiciously small");
});

test("versioned archive routes exist for every published version", () => {
  const files = readdirSync(versionsDir)
    .filter((name) => name.endsWith(".ts"))
    .map((name) => name.replace(/\.ts$/, ""));

  // One dynamic route serves every version, so what matters is that the route
  // exists at all — without it, a stored version resolves to nothing.
  for (const kind of ["terms", "privacy"]) {
    const route = join(here, "..", "app", kind, "[version]", "page.tsx");
    const source = readFileSync(route, "utf8");
    assert.match(source, /legalVersion\(version\)/);
    // An unknown version must 404 rather than fall back: showing current
    // wording under an old version's URL is worse than showing nothing.
    assert.match(source, /notFound\(\)/);
  }

  assert.ok(files.length > 0);
});

test("archive pages are noindex and point canonically at the active page", () => {
  for (const kind of ["terms", "privacy"]) {
    const source = readFileSync(
      join(here, "..", "app", kind, "[version]", "page.tsx"),
      "utf8",
    );

    // A provenance surface, not an acquisition one: indexed old terms would
    // compete with the current ones in search results.
    assert.match(source, /index: false/);
    assert.match(source, new RegExp(`canonical: "/${kind}"`));
  }
});

test("archive routes are absent from the sitemap", () => {
  const sitemap = readFileSync(join(here, "..", "app", "sitemap.ts"), "utf8");

  // The unversioned pages are listed; the versioned permalinks must not be.
  assert.match(sitemap, /\/terms`/);
  assert.ok(!sitemap.includes("[version]"));
  assert.ok(!sitemap.includes("2026-06-01"));
});
