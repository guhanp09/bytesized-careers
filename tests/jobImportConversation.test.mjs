import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const {
  buildJobImportGuidanceTurns,
  jobImportGuidancePhase,
  nextJobImportGuidanceTurn,
} = await import("../lib/jobImportConversation.ts");

const field = (overrides = {}) => ({
  id: crypto.randomUUID(),
  field_path: "title",
  proposed_value: "Video editor",
  provenance_state: "extracted_from_source",
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

const missing = (fieldPath, requirement = "publication_blocker") =>
  field({
    field_path: fieldPath,
    proposed_value: null,
    provenance_state: "missing",
    review_status: "pending",
    authority_state: "unconfirmed",
    decision_origin: "unknown",
    decision_confidence: null,
    needs_review: true,
    rationale_code: null,
    evidence: [],
    confirmed_value: null,
    effective_value: null,
    missing_requirement: requirement,
  });

const conflict = (fieldPath, alternatives) =>
  field({
    field_path: fieldPath,
    proposed_value: null,
    provenance_state: "conflicting_source_values",
    review_status: "pending",
    authority_state: "unconfirmed",
    decision_origin: "explicit",
    needs_review: true,
    evidence: [],
    conflicting_values: alternatives.map((value) => ({
      value,
      evidence: [{ snippet: `Source says ${value}` }],
    })),
    confirmed_value: null,
    effective_value: null,
    requires_confirmation: true,
  });

const draft = (fields) => ({
  id: crypto.randomUUID(),
  fields,
});

const context = (overrides = {}) => ({
  jobTitle: "YouTube Video Editor",
  roleName: "Video Editor",
  employerName: "Finance Explained",
  sourceLabel: "the imported finance-channel post",
  canonicalValues: {},
  manuallyChanged: new Set(),
  ...overrides,
});

test("consequential conflicts lead the queue and explain their job-specific impact", () => {
  const workMode = conflict("work_mode", ["remote", "hybrid"]);
  const applicationMode = missing("application_mode");
  const turns = buildJobImportGuidanceTurns(
    draft([applicationMode, workMode]),
    context()
  );

  assert.equal(turns[0].id, "work-arrangement");
  assert.equal(turns[0].kind, "conflict");
  assert.match(turns[0].explanation, /YouTube Video Editor/);
  assert.match(turns[0].explanation, /who can realistically apply/);
  assert.deepEqual(turns[0].alternatives.map((item) => item.value), ["remote", "hybrid"]);
  assert.equal(jobImportGuidancePhase(turns), "essential");
});

test("weekly-hours guidance uses role and engagement context without inventing a value", () => {
  const hours = missing("expected_weekly_hours_min", "conditionally_required");
  const turns = buildJobImportGuidanceTurns(draft([hours]), context({
    canonicalValues: { engagement_type: "full_time" },
  }));

  assert.equal(turns.length, 1);
  assert.equal(turns[0].id, "weekly-hours");
  assert.equal(turns[0].phase, "essential");
  assert.match(turns[0].explanation, /Video Editor/);
  assert.match(turns[0].candidateImpact, /workload.*pay/i);
  assert.doesNotMatch(turns[0].explanation, /40 hours|35 hours/);
});

test("conditional questions follow current canonical dependencies", () => {
  const location = missing("location", "conditionally_required");
  const externalUrl = missing("external_apply_url", "conditionally_required");
  const importDraft = draft([location, externalUrl]);

  const quiet = buildJobImportGuidanceTurns(importDraft, context({
    canonicalValues: { work_mode: "remote", application_mode: "internal" },
  }));
  assert.equal(quiet.length, 0);

  const active = buildJobImportGuidanceTurns(importDraft, context({
    canonicalValues: { work_mode: "onsite", application_mode: "external" },
  }));
  assert.deepEqual(active.map((turn) => turn.id), ["work-arrangement", "application"]);
});

test("compensation dependencies are grouped into one coherent decision", () => {
  const turns = buildJobImportGuidanceTurns(
    draft([
      missing("compensation_mode"),
      missing("budget_amount", "conditionally_required"),
      missing("budget_currency", "conditionally_required"),
      missing("budget_unit"),
    ]),
    context({ canonicalValues: { compensation_mode: "range" } })
  );

  assert.equal(turns.length, 1);
  assert.equal(turns[0].id, "compensation");
  assert.deepEqual(new Set(turns[0].fieldPaths), new Set([
    "compensation_mode",
    "budget_amount",
    "budget_currency",
    "budget_unit",
  ]));
  assert.match(turns[0].question, /compensation/i);
});

test("trial details appear only after the controlling choice activates them", () => {
  const trialScope = missing("trial_scope", "conditionally_required");
  assert.equal(
    buildJobImportGuidanceTurns(draft([trialScope]), context({
      canonicalValues: { trial_status: "none" },
    })).length,
    0
  );
  const active = buildJobImportGuidanceTurns(draft([trialScope]), context({
    canonicalValues: { trial_status: "paid" },
  }));
  assert.equal(active[0].id, "trial");
  assert.equal(active[0].phase, "essential");
});

test("role-specific optional suggestions are useful, capped, and non-blocking", () => {
  const optionalFields = [
    missing("revision_policy", "recommended"),
    missing("source_inputs", "conditionally_required"),
    missing("reference_videos", "optional"),
    missing("deadline_at", "optional"),
    missing("hiring_process", "recommended"),
  ];
  const turns = buildJobImportGuidanceTurns(draft(optionalFields), context({
    jobTitle: "Thumbnail Designer for a science channel",
    roleName: "Thumbnail Designer",
  }));

  assert.ok(turns.length <= 3);
  assert.ok(turns.some((turn) => turn.id === "revisions"));
  assert.ok(turns.some((turn) => turn.id === "references"));
  assert.ok(turns.every((turn) => turn.phase === "quality" && turn.canSkip));
  assert.equal(jobImportGuidancePhase(turns), "quality");
});

test("guidance is not hardcoded to editors", () => {
  const autonomy = missing("creative_autonomy", "recommended");
  const turns = buildJobImportGuidanceTurns(draft([autonomy]), context({
    jobTitle: "Content Strategist for an education brand",
    roleName: "Content Strategist",
  }));

  assert.equal(turns[0].id, "creative-autonomy");
  assert.doesNotMatch(turns[0].explanation, /editor/i);
  // The bar is reasoning that belongs to strategy work, not the job title
  // pasted into a sentence that would fit any role. Asserting on the title
  // would reward exactly the substitution this guidance replaced.
  assert.match(turns[0].explanation, /ownership|direction|decides/i);
  assert.match(turns[0].question, /latitude|autonomy|decide/i);
});

test("fallback copy remains contextual and never exposes internal labels", () => {
  const unknownCopy = missing("content_niches", "recommended");
  const turns = buildJobImportGuidanceTurns(draft([unknownCopy]), context());
  assert.equal(turns.length, 0, "unranked optional details stay quiet");

  const required = missing("about_channel");
  const [turn] = buildJobImportGuidanceTurns(draft([required]), context());
  assert.match(turn.explanation, /YouTube Video Editor/);
  assert.match(turn.explanation, /the imported finance-channel post/);
  assert.doesNotMatch(`${turn.heading} ${turn.explanation} ${turn.question}`, /about_channel|legacy/i);
});

test("answered and skipped decisions leave the active queue but remain reconstructable", () => {
  const confirmed = missing("application_mode");
  confirmed.review_status = "edited";
  confirmed.edited_value = "internal";
  confirmed.effective_value = "internal";
  const skipped = missing("deadline_at", "optional");
  skipped.review_status = "rejected";
  const turns = buildJobImportGuidanceTurns(draft([confirmed, skipped]), context());

  assert.ok(turns.every((turn) => turn.resolved));
  assert.equal(nextJobImportGuidanceTurn(turns), null);
  assert.equal(jobImportGuidancePhase(turns), "complete");
  assert.match(turns[0].resolutionLabel, /internal/i);
});

test("manual changes resolve a turn without allowing stale imported values to overwrite them", () => {
  const role = field({
    field_path: "primary_role_key",
    proposed_value: "video-editor",
    review_status: "pending",
    authority_state: "unconfirmed",
    decision_origin: "suggestion",
    decision_confidence: "medium",
    needs_review: true,
    requires_confirmation: true,
    confirmed_value: null,
    effective_value: null,
  });
  const turns = buildJobImportGuidanceTurns(draft([role]), context({
    roleName: "Thumbnail Designer",
    canonicalValues: { primary_role_key: "thumbnail-designer" },
    manuallyChanged: new Set(["primary_role_id"]),
  }));
  assert.equal(turns[0].resolved, true);
  assert.equal(turns[0].resolutionLabel, "Thumbnail designer");
});

test("a clean import does not manufacture questions from unreviewed companion notes", () => {
  const imported = [
    field({ field_path: "title", effective_value: "Content strategist", confirmed_value: "Content strategist" }),
    field({ field_path: "primary_role_key", effective_value: "content-strategist", confirmed_value: "content-strategist" }),
    field({ field_path: "creative_autonomy", effective_value: "own_creative_approach", confirmed_value: "own_creative_approach" }),
    field({ field_path: "source_inputs", effective_value: [{ type: "analytics_access" }], confirmed_value: [{ type: "analytics_access" }] }),
    field({ field_path: "hiring_process", effective_value: [{ stage: "interview" }], confirmed_value: [{ stage: "interview" }] }),
    missing("creative_autonomy_notes", "optional"),
    missing("source_inputs_notes", "optional"),
    missing("hiring_process_notes", "optional"),
  ];
  const turns = buildJobImportGuidanceTurns(draft(imported), context({
    jobTitle: "Content strategist for an education brand",
    roleName: "Content Strategist",
  }));

  assert.equal(turns.length, 0);
  assert.equal(jobImportGuidancePhase(turns), "complete");
});

test("the guidance layer is deterministic and cannot make another provider call", () => {
  const guidanceSource = readFileSync(
    new URL("../lib/jobImportConversation.ts", import.meta.url),
    "utf8"
  );
  const componentSource = readFileSync(
    new URL("../components/import-job/ImportedDraftConversation.tsx", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(`${guidanceSource}\n${componentSource}`, /OpenAI|fetch\(|processJobImportDraft|generateText|chat\.completions/i);
  assert.doesNotMatch(componentSource, /flagged fields|optional details not found|review field|why was this filled|legacy/i);
});
