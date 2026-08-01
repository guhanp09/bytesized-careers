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
  assert.match(postJob, /<ImportedDraftConversation/);
  assert.equal(exists("components/import-job/ImportReviewWorkspace.tsx"), false);
  assert.equal(exists("components/import-job/ImportedDraftNotice.tsx"), false);
  assert.doesNotMatch(importPage, /status:\s*"published"/);
  assert.doesNotMatch(importPage, /OpenAI|GPT-|model selector/i);
});

test("uncertainty becomes one contextual conversation turn above the canonical form", () => {
  const notice = read("components/import-job/ImportedDraftConversation.tsx");
  const guidance = read("lib/importedDraftGuidance.ts");
  const conversation = read("lib/jobImportConversation.ts");

  assert.match(notice, /CreatorJobs Assistant/);
  assert.match(notice, /What I found/);
  assert.match(notice, /one decision still needs your expertise/i);
  assert.match(notice, /Use the normal Post Job field directly below/);
  assert.match(notice, /Use the full editor/);
  assert.match(notice, /Not now/);
  assert.doesNotMatch(notice, /Review flagged fields|Optional details not found|Review field|Why was this filled\?|legacy/i);
  assert.match(guidance, /firstImportAttentionScreen/);
  assert.match(guidance, /manuallyChanged/);
  assert.match(conversation, /buildJobImportGuidanceTurns/);
  assert.match(conversation, /JOB_FIELD_REGISTRY/);
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
  assert.match(page, /Open local scenario/);
  assert.match(page, /without calling a provider/);
  assert.match(devRouter, /_ensure_dev_only\(\)/);
  assert.match(devRouter, /processed_review_fixture\(scenario\)/);
  assert.match(devRouter, /processing-failure/);
  assert.match(fixture, /Development-only processed job-import fixture/);
  assert.match(fixture, /thumbnail-designer/);
  assert.match(fixture, /clean-import/);
  assert.doesNotMatch(fixture, /api_key|OpenAIJobImportAdapter/);
});
