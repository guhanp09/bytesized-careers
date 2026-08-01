import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const exists = (path) => existsSync(new URL(`../${path}`, import.meta.url));

test("text import processes and applies a private draft into the normal Post Job form", () => {
  const importPage = read("components/import-job/ImportJobPageClient.tsx");
  const postJob = read("components/PostJobPage.tsx");
  for (const operation of [
    "createJobImportSource",
    "initializeJobImportDraft",
    "processJobImportDraft",
    "getJobImportDraft",
    "applyJobImportDraft",
  ]) {
    assert.match(importPage, new RegExp(operation));
  }
  assert.match(importPage, /source_type: "pasted_text"/);
  assert.match(importPage, /\/post-job\?draftId=/);
  assert.match(postJob, /<PostJobForm/);
  assert.match(postJob, /<ImportedDraftNotice/);
  assert.equal(exists("components/import-job/ImportReviewWorkspace.tsx"), false);
  assert.doesNotMatch(importPage, /status:\s*"published"/);
  assert.doesNotMatch(importPage, /OpenAI|GPT-|model selector/i);
});

test("uncertainty and provenance stay compact inside the canonical form", () => {
  const notice = read("components/import-job/ImportedDraftNotice.tsx");
  const guidance = read("lib/importedDraftGuidance.ts");

  for (const state of [
    "Conflicting details",
    "Needs your input",
    "Suggestion",
    "Inferred",
  ]) {
    assert.match(notice, new RegExp(state));
  }
  assert.match(notice, /Why was this filled\?/);
  assert.match(notice, /field\.evidence\[0\]\?\.snippet/);
  assert.match(notice, /Review flagged fields/);
  assert.match(notice, /Use suggestion/);
  assert.match(notice, /Only inferred, missing, or ambiguous details appear here/);
  assert.match(guidance, /firstImportAttentionScreen/);
  assert.match(guidance, /manuallyChanged/);
  assert.doesNotMatch(notice, /JSON\.stringify|chain.of.thought/i);
});

test("screening questions and suggestions use the normal form model and save path", () => {
  const postJob = read("components/PostJobPage.tsx");
  const formModel = read("lib/jobPostingForm.ts");

  assert.match(postJob, /setDomain\(hydrateJobPostingDomain\(values as unknown as BackendJob\)\)/);
  assert.match(postJob, /reviewJobImportField/);
  assert.match(postJob, /applyImportedSuggestionValue/);
  assert.match(formModel, /screening_questions: screeningQuestions/);
  assert.match(formModel, /job\.screening_questions\.map/);
  assert.match(postJob, /buildCompleteJobPayload\("published"/);
  assert.doesNotMatch(postJob, /publishImportedJob|validateImportedJob/);
});

test("reopened native drafts treat filled formerly-missing fields as authoritative", () => {
  const postJob = read("components/PostJobPage.tsx");
  assert.match(postJob, /jobImportValueWasRemoved\(currentValue\)/);
  assert.match(
    postJob,
    /firstImportAttentionScreen\(importContext\.draft, STEPS, changed\)/
  );
});

test("development example is explicit and cannot be mistaken for a live provider call", () => {
  const page = read("components/import-job/ImportJobPageClient.tsx");
  const fixture = read("backend/app/db/seed_data_job_import.py");
  const devRouter = read("backend/app/api/v1/routers/dev_personas.py");
  assert.match(page, /Open prepared example/);
  assert.match(page, /without calling a provider/);
  assert.match(devRouter, /_ensure_dev_only\(\)/);
  assert.match(devRouter, /processed_review_fixture/);
  assert.match(fixture, /Development-only processed job-import fixture/);
  assert.doesNotMatch(fixture, /api_key|OpenAIJobImportAdapter/);
});
