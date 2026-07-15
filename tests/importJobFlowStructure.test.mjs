import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const exists = (path) => existsSync(new URL(`../${path}`, import.meta.url));

test("the import route and client boundary exist behind the server-only flag", () => {
  assert.ok(exists("app/post-job/import/page.tsx"));
  assert.ok(exists("app/post-job/import/loading.tsx"));
  assert.ok(exists("components/import-job/ImportJobClientBoundary.tsx"));
  const page = read("app/post-job/import/page.tsx");
  assert.match(page, /isJobImportAllowed\(\)/);
  assert.match(page, /notFound\(\)/);
  // Server-only flag: the gate must not depend on a NEXT_PUBLIC_ variable.
  const flag = read("lib/importJob/flag.ts");
  assert.match(flag, /ENABLE_JOB_IMPORT/);
  assert.doesNotMatch(flag, /NEXT_PUBLIC_ENABLE_JOB_IMPORT/);
});

test("PostJobPage integrates the import handoff the approved way", () => {
  const page = read("components/PostJobPage.tsx");
  assert.match(page, /readImportHandoff/);
  assert.match(page, /hasRecentImportConsumption/);
  assert.match(page, /markImportConsumed/);
  assert.match(page, /ImportReviewBanner/);
  assert.match(page, /normalizeJobCategory/);
  // Durable general job-category state, not import-only state.
  assert.match(page, /useState<JobCategory>\("Editing"\)/);
  // Draft resume must restore the saved category (reopen keeps Writing, etc.).
  assert.match(page, /setJobCategory\(normalizeJobCategory\(draft\.category\)\)/);
  // Session readiness precedes owner-stamped reads.
  assert.match(page, /sessionStatus === "loading"\) return;[\s\S]{0,400}readImportHandoff/);
  // State-preserving URL cleanup — never a router navigation, never null state.
  assert.match(page, /window\.history\.replaceState\(window\.history\.state, "", "\/post-job"\)/);
  const importEffect = page.match(/\/\/ Import Hiring Post arrival[\s\S]*?\[importFlag, sessionStatus, session\?\.backendUserId\]\);/);
  assert.ok(importEffect, "the import hydration effect should exist");
  assert.doesNotMatch(importEffect[0], /router\.(replace|push)/);
});

test("no payload site hardcodes category: \"Editing\" anymore", () => {
  const page = read("components/PostJobPage.tsx");
  assert.doesNotMatch(page, /category:\s*"Editing"\s*,/);
  const sites = page.match(/category:\s*jobCategory\s*,/g) || [];
  assert.equal(sites.length, 3, "publish jobToCreate + backendPayload + draft payload");
});

test("the /post chooser links the import flow when the flag allows it", () => {
  const chooser = read("app/post/page.tsx");
  assert.match(chooser, /\/post-job\/import/);
  assert.match(chooser, /isJobImportAllowed/);
});

test("the wizard's own step structure is untouched (re-runs the STEPS extraction)", () => {
  const page = read("components/PostJobPage.tsx");
  const match = page.match(/const STEPS: Step\[\] = \[([\s\S]*?)\];/);
  assert.ok(match);
  const steps = Array.from(match[1].matchAll(/"([^"]+)"/g)).map((entry) => entry[1]);
  assert.deepEqual(steps, [
    "basics",
    "details",
    "about",
    "creatorContext",
    "toolsTags",
    "applicationRequirements",
    "referenceVideos",
  ]);
  // PostJobForm remains untouched by the import feature.
  const form = read("components/post-job/PostJobForm.tsx");
  assert.doesNotMatch(form, /importJob|ImportReviewBanner|importPrimitives/);
});
