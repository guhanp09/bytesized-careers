import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("pasted text and public URLs converge on one private review and apply API", () => {
  const router = read("backend/app/api/v1/routers/job_imports.py");

  for (const route of [
    '"/sources"',
    '"/url-sources"',
    '"/sources/{source_id}/drafts"',
    '"/drafts/{draft_id}/process"',
    '"/drafts/{draft_id}/fields/{field_path}"',
    '"/drafts/{draft_id}/fields/{field_path}/resolve"',
    '"/drafts/{draft_id}/apply"',
  ]) {
    assert.match(router, new RegExp(route.replace(/[{}]/g, "\\$&")));
  }

  assert.equal((router.match(/apply_to_native_draft/g) ?? []).length, 1);
  assert.doesNotMatch(router, /apply_url|url_review|publish_import/i);
});

test("only recruiter-reviewed values can create an idempotent native draft", () => {
  const service = read("backend/app/services/job_import_service.py");

  assert.match(service, /if field\.review_status == "edited":\s+return field\.edited_value/);
  assert.match(service, /if field\.review_status == "confirmed":\s+return field\.confirmed_value/);
  assert.match(service, /allowed_statuses=\{"ready_to_apply"\}/);
  assert.match(service, /if existing\.target_job_id is not None:/);
  assert.match(service, /status="draft"/);
  assert.doesNotMatch(service, /status="published"[\s\S]{0,500}create_job/);
});

test("deep search reads authoritative public listings and strips private hiring fields", () => {
  const repository = read("backend/app/repositories/search_repository.py");
  const serializer = read("backend/app/services/public_listing_serializer.py");

  assert.match(repository, /Job\.status == "published"/);
  assert.match(repository, /Job\.deleted_at\.is_\(None\)/);
  assert.match(repository, /TalentListing\.status\.in_\(\("published", "featured"\)\)/);
  assert.match(repository, /User\.suspended_at\.is_\(None\)/);
  assert.doesNotMatch(
    repository,
    /JobImport|JobApplication|Message|Screening|Evidence|Provider/,
  );
  assert.match(serializer, /screening_questions = None/);
  assert.match(serializer, /languages = \[\]/);
  assert.match(serializer, /language_requirements = None/);
});

test("the integrated UI stays provider-neutral and routes applied drafts to Post Job", () => {
  const page = read("components/import-job/ImportJobPageClient.tsx");

  assert.match(page, /<ImportReviewWorkspace/);
  assert.match(page, /\/post-job\?draftId=/);
  assert.match(page, /without sending text to a provider/);
  assert.doesNotMatch(page, /OpenAI|GPT-|model selector/i);
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
