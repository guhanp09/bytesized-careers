import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const exists = (path) => existsSync(new URL(`../${path}`, import.meta.url));

test("pasted text and public URLs converge on one private process and apply API", () => {
  const router = read("backend/app/api/v1/routers/job_imports.py");

  for (const route of [
    '"/sources"',
    '"/url-sources"',
    '"/sources/{source_id}/drafts"',
    '"/drafts/{draft_id}/process"',
    '"/drafts/{draft_id}/apply"',
    '"/native-jobs/{job_id}/context"',
  ]) {
    assert.match(router, new RegExp(route.replace(/[{}]/g, "\\$&")));
  }

  assert.equal((router.match(/apply_to_native_draft/g) ?? []).length, 1);
  assert.doesNotMatch(router, /apply_url|url_review|publish_import/i);
});

test("approved import decisions create an idempotent private canonical draft", () => {
  const service = read("backend/app/services/job_import_service.py");

  assert.match(service, /"review_status": "confirmed" if auto_fill else "pending"/);
  assert.match(service, /if field\.review_status == "edited":\s+return field\.edited_value/);
  assert.match(service, /if field\.review_status == "confirmed":\s+return field\.confirmed_value/);
  assert.match(service, /allowed_statuses=\{"ready_to_apply"\}/);
  assert.match(service, /if existing\.target_job_id is not None:/);
  assert.match(service, /status="draft"/);
  assert.match(service, /return "prefilled_by_import"/);
  assert.doesNotMatch(service, /status="published"[\s\S]{0,500}create_job/);
});

test("deep search reads authoritative public listings and strips private hiring fields", () => {
  const repository = read("backend/app/repositories/search_repository.py");
  const visibility = read("backend/app/repositories/public_visibility.py");
  const accountState = read("backend/app/core/account_state.py");
  const serializer = read("backend/app/services/public_listing_serializer.py");

  // R1A centralized these predicates. Check the query wiring AND the shared
  // implementation; requiring duplicate inline filters contradicts that contract.
  assert.match(repository, /from app\.repositories\.public_visibility import public_job_predicates, public_talent_predicates/);
  assert.match(repository, /\.where\(\*public_job_predicates\(\)\)/);
  assert.match(repository, /\.where\(\*public_talent_predicates\(\)\)/);
  assert.match(visibility, /Job\.status == "published"/);
  assert.match(visibility, /Job\.deleted_at\.is_\(None\)/);
  assert.match(visibility, /TalentListing\.status\.in_\(\("published", "featured"\)\)/);
  assert.match(visibility, /TalentListing\.deleted_at\.is_\(None\)/);
  assert.match(visibility, /User\.id == Job\.posted_by_user_id, ~active_account_clause\(User\)/);
  assert.match(visibility, /~blocked_owner/);
  assert.match(visibility, /active_account_clause\(User\)/);
  assert.match(accountState, /user_model\.suspended_at\.is_\(None\)/);
  assert.match(accountState, /user_model\.deletion_hidden_at\.is_\(None\)/);
  assert.doesNotMatch(repository, /JobImport|JobApplication|Message|Screening|Evidence|Provider/);
  assert.match(serializer, /screening_questions = None/);
  assert.match(serializer, /languages = \[\]/);
  assert.match(serializer, /language_requirements = None/);
});

test("the integrated UI is provider-neutral and opens the canonical Post Job form", () => {
  const importPage = read("components/import-job/ImportJobPageClient.tsx");
  const postJob = read("components/PostJobPage.tsx");

  assert.match(importPage, /applyJobImportDraft/);
  assert.match(importPage, /\/post-job\?draftId=/);
  // Questions are asked on the assistant canvas, not inside the editor.
  assert.doesNotMatch(postJob, /<ImportedDraftConversation/);
  assert.match(postJob, /getJobImportContextForNativeJob/);
  assert.equal(exists("components/import-job/ImportReviewWorkspace.tsx"), false);
  assert.equal(exists("components/import-job/ReviewSummary.tsx"), false);
  assert.doesNotMatch(`${importPage}\n${postJob}`, /OpenAI|GPT-|model selector/i);
});

test("the URL-source migration is additive, reversible, and follows the accepted head", () => {
  const migration = read("backend/alembic/versions/0050_job_import_url_retrieval.py");

  assert.match(migration, /down_revision = "0049_engagement_payment_state"/);
  assert.match(migration, /op\.add_column\(\s+"job_import_sources"/);
  for (const field of ["final_source_url", "retrieved_at", "retrieval_metadata"]) {
    assert.match(migration, new RegExp(field));
    assert.match(migration, new RegExp(`drop_column\\("job_import_sources", "${field}"\\)`));
  }
});
