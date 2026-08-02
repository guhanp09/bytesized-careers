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

test("the obsolete sessionStorage import branch cannot come back", () => {
  // The ?import=1 handoff and its review banner were removed once the backend
  // draft became the only way in. Nothing wrote the payload any more, so the
  // branch was reachable only by hand-crafting browser storage. These
  // assertions exist so a future change cannot quietly reintroduce a second
  // import journey alongside the canonical one.
  const page = read("components/PostJobPage.tsx");
  for (const gone of [
    "readImportHandoff",
    "markImportConsumed",
    "clearImportHandoff",
    "hasRecentImportConsumption",
    "ImportReviewBanner",
    "importFlag",
    "importMeta",
  ]) {
    assert.doesNotMatch(page, new RegExp(gone), `${gone} must not return`);
  }

  // The query parameter itself must no longer switch behaviour.
  assert.doesNotMatch(page, /searchParams\.get\("import"\)/);

  // And the modules behind it are gone rather than merely unreferenced.
  for (const removed of [
    "lib/importJob/handoff.ts",
    "lib/importJob/applyToWizard.ts",
    "lib/importJob/parseJobPost.ts",
    "lib/importJob/types.ts",
    "lib/jobImportReview.ts",
    "components/import-job/ImportReviewBanner.tsx",
  ]) {
    assert.equal(exists(removed), false, `${removed} should have been removed`);
  }
});

test("exactly one import journey reaches Post Job", () => {
  const page = read("components/PostJobPage.tsx");
  // The two canonical entries: an applied draft, and a partial import that
  // attaches after the ordinary save. Nothing else.
  assert.match(page, /searchParams\.get\("draftId"\)/);
  assert.match(page, /searchParams\.get\("importDraftId"\)/);

  const client = read("components/import-job/ImportJobPageClient.tsx");
  assert.match(client, /\/post-job\?draftId=/);
  assert.match(client, /\/post-job\?importDraftId=/);
  assert.doesNotMatch(client, /\/post-job\?import=1/);
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
  // The prefill assertions here belonged to the removed sessionStorage branch.
  // The rule they protected is unchanged and still enforced: the unit starts
  // empty and nothing may default it to a guess.
  assert.match(page, /const \[budgetUnit, setBudgetUnit\] = useState<CompensationUnit \| "">\(""\)/);
  assert.doesNotMatch(page, /useState<CompensationUnit[^;]+\("per project"\)/);
  assert.doesNotMatch(page, /setBudgetUnit\("per project"\)/);
});

test("the /post chooser links the import flow only when the flag allows it", () => {
  const chooser = read("app/post/page.tsx");
  assert.match(chooser, /\/post-job\/import/);
  assert.match(chooser, /isJobImportAllowed/);
});

test("the importer and native wizard share the V3 step source without coupling the form to import code", () => {
  const page = read("components/PostJobPage.tsx");
  // RECRUITER_JOB_STEPS is the domain/routing group set (7 field-ownership buckets).
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
  // Navigation is driven by the finer screen sequence, derived from the same module.
  assert.match(page, /const STEPS: Step\[\] = RECRUITER_JOB_SCREENS\.map\(\(item\) => item\.id\)/);

  const form = read("components/post-job/PostJobForm.tsx");
  assert.doesNotMatch(form, /importJob|ImportReviewBanner|importPrimitives/);
});
