import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";

// The production modules use bundler-style extensionless imports. Keep the test
// on Node's native type stripper while resolving those imports to their .ts files.
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

const {
  importPreviewFilledCount,
  importPreviewProps,
  importPreviewRoleName,
  importPreviewSnapshot,
  previewValueForField,
} = await import("../lib/jobImportPreview.ts");

const field = (overrides = {}) => ({
  id: crypto.randomUUID(),
  field_path: "title",
  proposed_value: "Video editor",
  provenance_state: "extracted_from_source",
  review_status: "pending",
  authority_state: "prefilled_by_import",
  decision_origin: "explicit",
  decision_confidence: "high",
  needs_review: false,
  rationale_code: "explicit_source_value",
  evidence: [],
  conflicting_values: [],
  explanation: null,
  provider_confidence: null,
  confirmed_value: null,
  edited_value: null,
  effective_value: null,
  missing_requirement: "optional",
  requires_confirmation: false,
  validation_errors: [],
  selected_conflict_index: null,
  ...overrides,
});

/**
 * Domain hydration mints a fresh client id for each repeatable row, so two
 * calls are equal in every way that matters but differ in those ids. Strip them
 * before comparing; comparing them would only assert that uuids are unique.
 */
const withoutRowIds = (value) =>
  JSON.parse(
    JSON.stringify(value, (key, entry) => (key === "id" ? undefined : entry))
  );

const draft = (fields, recruiterPrefill = {}) => ({
  id: "draft-1",
  processing_status: "awaiting_recruiter_review",
  validation_status: "needs_review",
  confirmation_state: "unreviewed",
  can_apply_to_native_draft: true,
  can_publish_directly: false,
  fields,
  recruiter_prefill: recruiterPrefill,
  early_question_fields: [],
});

test("a recruiter edit outranks everything else", () => {
  const value = previewValueForField(
    field({
      proposed_value: "Machine value",
      confirmed_value: "Confirmed value",
      edited_value: "Recruiter value",
      review_status: "edited",
    })
  );
  assert.deepEqual(value, { value: "Recruiter value", state: "recruiter" });
});

test("a confirmed value counts as the recruiter's, not the machine's", () => {
  const value = previewValueForField(
    field({ confirmed_value: "Confirmed value", review_status: "confirmed" })
  );
  assert.deepEqual(value, { value: "Confirmed value", state: "recruiter" });
});

test("an unreviewed imported value shows, but is marked provisional", () => {
  const value = previewValueForField(field({ proposed_value: "Video editor" }));
  assert.equal(value.value, "Video editor");
  // The candidate view can show it, but the UI must not imply approval.
  assert.equal(value.state, "provisional");
});

test("a rejected value disappears from the preview entirely", () => {
  const value = previewValueForField(
    field({ proposed_value: "Wrong title", review_status: "rejected" })
  );
  assert.deepEqual(value, { value: null, state: "blank" });
});

test("an unresolved conflict does not silently pick a side", () => {
  const value = previewValueForField(
    field({
      proposed_value: "Remote",
      provenance_state: "conflicting_source_values",
      conflicting_values: [{ value: "Remote", evidence: [] }, { value: "Hybrid", evidence: [] }],
    })
  );
  assert.deepEqual(value, { value: null, state: "blank" });
});

test("a value that failed validation is never shown to anyone", () => {
  const value = previewValueForField(
    field({ proposed_value: "-500", validation_errors: ["Must be positive."] })
  );
  assert.deepEqual(value, { value: null, state: "blank" });
});

test("a missing value stays blank rather than being invented", () => {
  const value = previewValueForField(
    field({ proposed_value: null, provenance_state: "missing" })
  );
  assert.deepEqual(value, { value: null, state: "blank" });
});

test("the snapshot separates what the recruiter settled from what is provisional", () => {
  const snapshot = importPreviewSnapshot(
    draft([
      field({ field_path: "title", proposed_value: "Video editor" }),
      field({
        field_path: "work_mode",
        proposed_value: "remote",
        review_status: "confirmed",
        confirmed_value: "remote",
      }),
      field({ field_path: "budget_amount", proposed_value: 1200, review_status: "rejected" }),
    ])
  );

  assert.deepEqual(snapshot.recruiterFields, ["work_mode"]);
  assert.deepEqual(snapshot.provisionalFields, ["title"]);
  assert.ok(!("budget_amount" in snapshot.values), "rejected values leave the preview");
  assert.equal(importPreviewFilledCount(snapshot), 2);
});

test("an early answer counts as a recruiter decision even before a field row exists", () => {
  const snapshot = importPreviewSnapshot(
    draft([field({ field_path: "title", proposed_value: "Video editor" })], {
      application_mode: "external",
    })
  );
  assert.equal(snapshot.values.application_mode, "external");
  assert.ok(snapshot.recruiterFields.includes("application_mode"));
  assert.ok(!snapshot.provisionalFields.includes("application_mode"));
});

test("an early answer overrides a later provider proposal in the preview too", () => {
  const snapshot = importPreviewSnapshot(
    draft(
      [field({ field_path: "application_mode", proposed_value: "internal" })],
      { application_mode: "external" }
    )
  );
  assert.equal(snapshot.values.application_mode, "external");
  assert.deepEqual(snapshot.provisionalFields, []);
  assert.ok(snapshot.recruiterFields.includes("application_mode"));
});

test("live canonical values win once the job actually exists", () => {
  const snapshot = importPreviewSnapshot(
    draft([field({ field_path: "title", proposed_value: "Imported title" })]),
    { title: "Title the recruiter typed" }
  );
  assert.equal(snapshot.values.title, "Title the recruiter typed");
  assert.deepEqual(snapshot.provisionalFields, []);
});

test("a stable imported role key resolves through the public role catalog", () => {
  const snapshot = importPreviewSnapshot(
    draft([
      field({ field_path: "primary_role_key", proposed_value: "video-editor" }),
    ])
  );
  const roles = [
    {
      id: "role-video-editor",
      slug: "video-editor",
      name: "Video Editor",
      category: "Editing",
    },
  ];
  assert.equal(importPreviewRoleName(snapshot, roles), "Video Editor");
  assert.equal(
    importPreviewRoleName(snapshot, []),
    "Video Editor",
    "the stable slug prevents a false blank while the catalog is loading"
  );

  const singleToken = importPreviewSnapshot(
    draft([
      field({ field_path: "primary_role_key", proposed_value: "scriptwriter" }),
    ])
  );
  assert.equal(
    importPreviewRoleName(singleToken, []),
    "Scriptwriter",
    "single-token catalog slugs must not flash as an unselected role"
  );
});

test("preview props go through the same hydration Post Job uses on a saved draft", async () => {
  const snapshot = importPreviewSnapshot(
    draft([
      field({ field_path: "title", proposed_value: "Retention editor" }),
      field({ field_path: "work_mode", proposed_value: "remote" }),
      field({ field_path: "platforms", proposed_value: ["youtube"] }),
      field({ field_path: "responsibilities", proposed_value: ["Edit one video"] }),
      field({ field_path: "compensation_mode", proposed_value: "fixed" }),
      field({ field_path: "budget_amount", proposed_value: 1200 }),
    ])
  );
  const props = importPreviewProps(snapshot, { employerName: "Test channel" });

  assert.equal(props.title, "Retention editor");
  assert.equal(props.workMode, "Remote");
  assert.equal(props.location, "Remote");
  assert.equal(props.platform, "youtube");
  assert.equal(props.compensationMode, "fixed");
  assert.equal(props.budgetMin, 1200);
  assert.equal(props.responsibilities, "Edit one video");

  // Parity, stated exactly: the preview's structured half is byte-for-byte what
  // the Post Job editor produces from the same values. Any transformation or
  // approximation in importPreviewProps would break this.
  const { hydrateJobPostingDomain } = await import("../lib/jobPostingForm.ts");
  assert.deepEqual(
    withoutRowIds(props.domain),
    withoutRowIds(hydrateJobPostingDomain(snapshot.values))
  );
});

test("structured rows hydrate through the shared domain model, not a local shape", async () => {
  const { hydrateJobPostingDomain } = await import("../lib/jobPostingForm.ts");
  const snapshot = importPreviewSnapshot(
    draft([
      field({
        field_path: "deliverables",
        proposed_value: [
          { type: "long_form_video", quantity: 4, frequency: "per_month" },
        ],
      }),
      field({ field_path: "revision_policy", proposed_value: "fixed" }),
      field({ field_path: "revision_rounds", proposed_value: 2 }),
    ])
  );
  const props = importPreviewProps(snapshot, { employerName: "Test channel" });

  assert.ok(Array.isArray(props.domain.deliverables));
  assert.equal(props.domain.deliverables.length, 1);
  assert.equal(props.domain.revisionRounds, "2");
  assert.deepEqual(
    withoutRowIds(props.domain),
    withoutRowIds(hydrateJobPostingDomain(snapshot.values))
  );
});

test("unknown enum values become blank instead of being forced into the union", () => {
  const snapshot = importPreviewSnapshot(
    draft([
      field({ field_path: "compensation_mode", proposed_value: "barter" }),
      field({ field_path: "engagement_type", proposed_value: "moonlighting" }),
    ])
  );
  const props = importPreviewProps(snapshot, { employerName: "Test channel" });
  assert.equal(props.compensationMode, null);
  assert.equal(props.engagementType, null);
});

test("an empty draft produces no preview values at all", () => {
  const snapshot = importPreviewSnapshot(draft([]));
  assert.deepEqual(snapshot.values, {});
  assert.equal(importPreviewFilledCount(snapshot), 0);
});
