import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { registerHooks } from "node:module";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const exists = (path) => existsSync(new URL(`../${path}`, import.meta.url));

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (
        (specifier.startsWith("./") || specifier.startsWith("../")) &&
        !/\.[a-z0-9]+$/i.test(specifier)
      ) {
        return nextResolve(`${specifier}.ts`, context);
      }
      throw error;
    }
  },
});

const { RECRUITER_JOB_STEPS } = await import("../lib/jobPostingForm.ts");

test("the import route and client boundary exist behind the server-only flag", () => {
  assert.ok(exists("app/post-job/import/page.tsx"));
  assert.ok(exists("app/post-job/import/loading.tsx"));
  assert.ok(exists("components/import-job/ImportJobClientBoundary.tsx"));
  const page = read("app/post-job/import/page.tsx");
  assert.match(page, /isJobImportAllowed\(\)/);
  assert.match(page, /notFound\(\)/);
  const flag = read("lib/importJob/flag.ts");
  assert.match(flag, /ENABLE_JOB_IMPORT/);
  assert.doesNotMatch(flag, /NEXT_PUBLIC_ENABLE_JOB_IMPORT/);
});

test("PostJobPage consumes the owner-stamped import handoff without navigation races", () => {
  const page = read("components/PostJobPage.tsx");
  assert.match(page, /readImportHandoff/);
  assert.match(page, /hasRecentImportConsumption/);
  assert.match(page, /markImportConsumed/);
  assert.match(page, /ImportReviewBanner/);
  assert.match(page, /sessionStatus === "loading"\) return;[\s\S]{0,500}readImportHandoff/);
  assert.match(page, /window\.history\.replaceState\(window\.history\.state, "", "\/post-job"\)/);

  const importEffect = page.match(
    /\/\/ Import Hiring Post arrival[\s\S]*?\[importFlag, sessionStatus, session\?\.backendUserId\]\);/,
  );
  assert.ok(importEffect, "the import hydration effect should exist");
  assert.doesNotMatch(importEffect[0], /router\.(replace|push)/);
  assert.match(importEffect[0], /setTitle\(prefill\.title\)/);
  assert.match(importEffect[0], /setWorkMode\(prefill\.workMode\)/);
  assert.match(importEffect[0], /setTools\(importedTools\)/);
  assert.match(importEffect[0], /setApplicationRequirements\(sanitizeRequirementKeys/);
  assert.match(importEffect[0], /markImportConsumed\(resolvedOwner\)/);
});

test("imported legacy category metadata never selects a canonical creator role", () => {
  const page = read("components/PostJobPage.tsx");
  assert.doesNotMatch(page, /normalizeJobCategory/);
  assert.doesNotMatch(page, /setJobCategory\(/);
  assert.doesNotMatch(page, /setPrimaryRoleId\(prefill\.(?:category|role)/);
  assert.match(page, /const \[primaryRoleId, setPrimaryRoleId\] = useState\(""\)/);
  assert.match(page, /setPrimaryRoleId\(typeof draft\.primary_role_id === "string" \? draft\.primary_role_id : ""\)/);
  assert.doesNotMatch(page, /category:\s*"Editing"\s*,/);
  assert.doesNotMatch(page, /category:\s*primaryRoleId/);
});

test("native and imported wizard state do not invent a compensation unit", () => {
  const page = read("components/PostJobPage.tsx");
  assert.match(page, /const \[budgetUnit, setBudgetUnit\] = useState<CompensationUnit \| "">\(""\)/);
  assert.match(page, /setBudgetUnit\(prefill\.budgetUnit\)/);
  assert.doesNotMatch(page, /setBudgetUnit\(prefill\.budgetUnit === "per month" \? "per month" : "per project"\)/);
  assert.doesNotMatch(page, /useState<CompensationUnit[^;]+\("per project"\)/);
});

test("the /post chooser links the import flow only when the flag allows it", () => {
  const chooser = read("app/post/page.tsx");
  assert.match(chooser, /\/post-job\/import/);
  assert.match(chooser, /isJobImportAllowed/);
});

test("the importer and native wizard share the V3 step source without coupling the form to import code", () => {
  const page = read("components/PostJobPage.tsx");
  assert.equal(RECRUITER_JOB_STEPS.length, 7);
  assert.deepEqual(RECRUITER_JOB_STEPS.map(({ id }) => id), [
    "basics",
    "about",
    "creatorContext",
    "toolsTags",
    "details",
    "applicationRequirements",
    "referenceVideos",
  ]);
  assert.match(page, /const STEPS: Step\[\] = RECRUITER_JOB_STEPS\.map\(\(item\) => item\.id\)/);

  const form = read("components/post-job/PostJobForm.tsx");
  assert.doesNotMatch(form, /importJob|ImportReviewBanner|importPrimitives/);
});
