import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("text import creates, processes, reviews, and explicitly applies a private draft", () => {
  const page = read("components/import-job/ImportJobPageClient.tsx");
  const review = read("components/import-job/ImportReviewWorkspace.tsx");
  for (const operation of [
    "createJobImportSource",
    "initializeJobImportDraft",
    "processJobImportDraft",
    "getJobImportDraft",
    "reviewJobImportField",
    "resolveJobImportConflict",
    "applyJobImportDraft",
  ]) {
    assert.match(page, new RegExp(operation));
  }
  assert.match(page, /source_type: "pasted_text"/);
  assert.match(review, /Create job draft/);
  assert.match(page, /\/post-job\?draftId=/);
  assert.doesNotMatch(page, /status:\s*"published"/);
  assert.doesNotMatch(page, /OpenAI|GPT-|model selector/i);
});

test("review workspace exposes provenance, evidence, decisions, conflict alternatives, and grouped missing fields", () => {
  const review = read("components/import-job/ImportReviewWorkspace.tsx");
  for (const state of [
    "Directly supplied",
    "Found in source",
    "Suggested — verify",
    "Conflict — decision required",
    "Confirmed by you",
    "Edited by you",
    "Rejected",
  ]) {
    assert.match(review, new RegExp(state));
  }
  for (const action of [
    "Accept",
    "Edit",
    "Reject",
    "Reset decision",
    "Use this value",
    "Enter a different value",
  ]) {
    assert.match(review, new RegExp(action));
  }
  assert.match(review, /item\.snippet/);
  assert.match(review, /IMPORT_MISSING_GROUP_LABELS/);
  assert.match(review, /Check carefully/);
  assert.match(review, /aria-live|aria-labelledby|fieldset|legend/);
  assert.doesNotMatch(review, /JSON\.stringify/);
});

test("development review example is explicit and cannot be mistaken for a live provider call", () => {
  const page = read("components/import-job/ImportJobPageClient.tsx");
  const fixture = read("backend/app/db/seed_data_job_import.py");
  const devRouter = read("backend/app/api/v1/routers/dev_personas.py");
  assert.match(page, /Open review example/);
  assert.match(page, /without sending text to a provider/);
  assert.match(devRouter, /_ensure_dev_only\(\)/);
  assert.match(devRouter, /processed_review_fixture/);
  assert.match(fixture, /Development-only processed job-import fixture/);
  assert.doesNotMatch(fixture, /api_key|OpenAIJobImportAdapter/);
});
