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
  // Post Job is the ordinary editor again: the conversation happens on the
  // assistant canvas before the handoff, and what arrives here is a normal
  // draft with its fields already filled in.
  assert.doesNotMatch(postJob, /<ImportedDraftConversation/);
  assert.equal(exists("components/import-job/ImportReviewWorkspace.tsx"), false);
  assert.equal(exists("components/import-job/ImportedDraftNotice.tsx"), false);
  assert.doesNotMatch(importPage, /status:\s*"published"/);
  assert.doesNotMatch(importPage, /OpenAI|GPT-|model selector/i);
});

test("questions exist only on the checkpointed assistant canvas before handoff", () => {
  const canvas = read("components/import-job/assistant/DraftAssistantCanvas.tsx");
  const turn = read("components/import-job/assistant/ConversationTurn.tsx");
  const importPage = read("components/import-job/ImportJobPageClient.tsx");
  const postJob = read("components/PostJobPage.tsx");

  assert.match(canvas, /ConversationTurn/);
  assert.match(canvas, /DraftAssistantRobot/);
  assert.match(canvas, /onAnswerQuestion/);
  assert.match(importPage, /answerJobImportQuestion/);
  assert.match(turn, /question/);
  for (const removed of [
    "components/import-job/ImportedDraftConversation.tsx",
    "lib/jobImportConversation.ts",
    "lib/jobImportRoleGuidance.ts",
  ]) {
    assert.equal(exists(removed), false, `${removed} should remain deleted`);
  }
  assert.doesNotMatch(postJob, /jobImportConversation|ImportedDraftConversation|importGuidance/);
  assert.doesNotMatch(postJob, /reviewJobImportField|resolveJobImportConflict/);
});

test("screening questions and suggestions use the normal form model and save path", () => {
  const postJob = read("components/PostJobPage.tsx");
  const formModel = read("lib/jobPostingForm.ts");

  assert.match(postJob, /setDomain\(hydrateJobPostingDomain\(values as unknown as BackendJob\)\)/);
  assert.match(postJob, /attachJobImportDraft/);
  assert.match(formModel, /screening_questions: screeningQuestions/);
  assert.match(formModel, /job\.screening_questions\.map/);
  assert.match(postJob, /buildCompleteJobPayload\("published"/);
  assert.doesNotMatch(postJob, /publishImportedJob|validateImportedJob/);
});

test("reopened native drafts treat filled formerly-missing fields as authoritative", () => {
  const postJob = read("components/PostJobPage.tsx");
  assert.match(postJob, /jobImportValueWasRemoved\(currentValue\)/);
  // The reconciliation still runs — a value the recruiter has since changed is
  // never overwritten by import context — but it no longer jumps the flow to
  // the screen that needs attention. An imported draft opens at the beginning,
  // like every other draft, so the recruiter reviews what was filled in.
  assert.match(postJob, /setManuallyChangedImportFields/);
  assert.doesNotMatch(postJob, /firstImportAttentionScreen|importGuidance/);
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
