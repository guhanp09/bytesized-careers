import assert from "node:assert/strict";
import test from "node:test";

const {
  firstImportAttentionScreen,
  importDraftSummary,
  importFieldNeedsAttention,
  importFieldsForScreen,
  nativeFieldForImport,
} = await import("../lib/importedDraftGuidance.ts");
const {
  jobImportValueWasRemoved,
  setJobImportAnalyticsSink,
  trackJobImportEvent,
} = await import("../lib/jobImportAnalytics.ts");

const field = (overrides = {}) => ({
  id: crypto.randomUUID(),
  field_path: "title",
  proposed_value: "Video editor",
  provenance_state: "quoted_from_source",
  review_status: "confirmed",
  authority_state: "prefilled_by_import",
  decision_origin: "explicit",
  decision_confidence: "high",
  needs_review: false,
  rationale_code: "explicit_source_value",
  evidence: [{ snippet: "Hiring a video editor" }],
  conflicting_values: [],
  explanation: null,
  provider_confidence: null,
  confirmed_value: "Video editor",
  edited_value: null,
  effective_value: "Video editor",
  missing_requirement: "publication_blocker",
  requires_confirmation: false,
  validation_errors: [],
  selected_conflict_index: null,
  reviewed_at: null,
  created_at: "2026-08-01T00:00:00Z",
  updated_at: "2026-08-01T00:00:00Z",
  ...overrides,
});

const draft = (fields) => ({ fields });

test("high-confidence explicit values stay quiet while real uncertainty needs attention", () => {
  const explicit = field();
  const contextual = field({
    field_path: "budget_currency",
    proposed_value: "USD",
    confirmed_value: "USD",
    effective_value: "USD",
    provenance_state: "suggested_inference",
    decision_origin: "contextual_inference",
    rationale_code: "currency_from_role_country",
  });
  const suggestion = field({
    field_path: "experience_level",
    proposed_value: "senior",
    confirmed_value: null,
    effective_value: null,
    review_status: "pending",
    authority_state: "unconfirmed",
    provenance_state: "suggested_inference",
    decision_origin: "suggestion",
    decision_confidence: "medium",
    needs_review: true,
    requires_confirmation: true,
  });
  const missing = field({
    field_path: "engagement_type",
    proposed_value: null,
    confirmed_value: null,
    effective_value: null,
    review_status: "pending",
    authority_state: "unconfirmed",
    provenance_state: "missing",
    decision_origin: "unknown",
    decision_confidence: null,
    needs_review: true,
    rationale_code: null,
  });

  assert.equal(importFieldNeedsAttention(explicit), false);
  assert.equal(importFieldNeedsAttention(contextual), false);
  assert.equal(importFieldNeedsAttention(suggestion), true);
  assert.equal(importFieldNeedsAttention(missing), true);
  assert.deepEqual(importDraftSummary(draft([explicit, contextual, suggestion, missing])), {
    filled: 2,
    needsReview: 2,
    optionalMissing: 0,
  });
});

test("manual changes remove imported warnings and role keys map to the canonical role field", () => {
  const ambiguousRole = field({
    field_path: "primary_role_key",
    needs_review: true,
    review_status: "pending",
    authority_state: "unconfirmed",
  });
  const changed = new Set(["primary_role_id"]);

  assert.equal(nativeFieldForImport("primary_role_key"), "primary_role_id");
  assert.equal(importFieldNeedsAttention(ambiguousRole, changed), false);
  assert.deepEqual(importDraftSummary(draft([ambiguousRole]), changed), {
    filled: 1,
    needsReview: 0,
    optionalMissing: 0,
  });
});

test("a recruiter-confirmed suggestion no longer remains in the attention queue", () => {
  const confirmed = field({
    field_path: "budget_unit",
    proposed_value: "per month",
    confirmed_value: "per month",
    effective_value: "per month",
    provenance_state: "suggested_inference",
    review_status: "confirmed",
    authority_state: "confirmed_by_recruiter",
    decision_origin: "suggestion",
    decision_confidence: "medium",
    needs_review: true,
    requires_confirmation: true,
  });
  assert.equal(importFieldNeedsAttention(confirmed), false);
});

test("conditionally required fields appear only when their controlling value makes them relevant", () => {
  const conditionalMissing = (fieldPath) =>
    field({
      field_path: fieldPath,
      proposed_value: null,
      confirmed_value: null,
      effective_value: null,
      review_status: "pending",
      authority_state: "unconfirmed",
      provenance_state: "missing",
      decision_origin: "unknown",
      decision_confidence: null,
      needs_review: true,
      missing_requirement: "conditionally_required",
    });
  const remote = field({ field_path: "work_mode", effective_value: "remote" });
  const onsite = field({ field_path: "work_mode", effective_value: "onsite" });
  const location = conditionalMissing("location");
  const roleSpecialization = conditionalMissing("role_specialization");

  assert.equal(importFieldNeedsAttention(location, new Set(), draft([remote, location])), false);
  assert.equal(importFieldNeedsAttention(location, new Set(), draft([onsite, location])), true);
  assert.equal(
    importFieldNeedsAttention(roleSpecialization, new Set(), draft([roleSpecialization])),
    false
  );
});

test("review navigation opens the earliest canonical section and stays section-local", () => {
  const needsReview = {
    needs_review: true,
    review_status: "pending",
    authority_state: "unconfirmed",
  };
  const role = field({ ...needsReview, field_path: "primary_role_key" });
  const currency = field({ ...needsReview, field_path: "budget_currency" });
  const questions = field({ ...needsReview, field_path: "screening_questions" });
  const imported = draft([questions, currency, role]);
  const screens = ["role", "compensation", "screening", "review"];

  assert.equal(firstImportAttentionScreen(imported, screens), "role");
  assert.deepEqual(importFieldsForScreen(imported, "role").map((item) => item.id), [role.id]);
});

test("analytics emits only the bounded event payload and cannot break product behavior", () => {
  const events = [];
  setJobImportAnalyticsSink((event) => events.push(event));
  trackJobImportEvent("job_import.completed", {
    sourceType: "url",
    durationMs: 1250,
    explicitCount: 4,
    inferredCount: 2,
    suggestedCount: 1,
    reviewCount: 1,
    missingCount: 3,
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].name, "job_import.completed");
  assert.deepEqual(Object.keys(events[0].payload).sort(), [
    "durationMs",
    "explicitCount",
    "inferredCount",
    "missingCount",
    "reviewCount",
    "sourceType",
    "suggestedCount",
  ]);

  setJobImportAnalyticsSink(() => {
    throw new Error("analytics unavailable");
  });
  assert.doesNotThrow(() => trackJobImportEvent("job_import.failed", { sourceType: "text" }));
  setJobImportAnalyticsSink(null);
});

test("analytics classifies removed imported values without inspecting their content", () => {
  assert.equal(jobImportValueWasRemoved(null), true);
  assert.equal(jobImportValueWasRemoved("   "), true);
  assert.equal(jobImportValueWasRemoved([]), true);
  assert.equal(jobImportValueWasRemoved("USD"), false);
  assert.equal(jobImportValueWasRemoved(["youtube"]), false);
  assert.equal(jobImportValueWasRemoved(0), false);
  assert.equal(jobImportValueWasRemoved(false), false);
});
