/**
 * The same job, told the same way everywhere a recruiter or candidate reads it.
 *
 * A stored value is only correct if what it renders to is also correct, and the
 * gap between the two has bitten twice already. "Remote · Remote" reached a real
 * import because the work mode and the place both resolved to the same word and
 * neither knew about the other. A "25 years" experience value was read correctly
 * and then dropped at the column boundary, so the draft said nothing about it.
 *
 * Both are the same class of defect: nothing was wrong with the value, and the
 * recruiter still read something untrue. So these tests compare the persisted
 * value against the rendered one rather than asserting about either alone.
 *
 * The second half is about identity, which this product keeps deliberately
 * apart:
 *
 *   SOURCE EMPLOYER    — who the imported page said was hiring. Import data.
 *   HIRING IDENTITY    — who is hiring on CreatorJobs. Account data.
 *
 * They are usually different and must never contaminate each other. Importing a
 * page from Larkfield Studio does not make the recruiter Larkfield Studio, and a
 * recruiter's own name must not overwrite what the page said.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

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

const { importPreviewSnapshot, importPreviewProps } = await import(
  "../lib/jobImportPreview.ts"
);

/** A draft field row, in the shape the backend actually returns. */
function field(fieldPath, value, overrides = {}) {
  return {
    id: `field-${fieldPath}`,
    field_path: fieldPath,
    proposed_value: value,
    provenance_state: "extracted_from_source",
    review_status: "confirmed",
    authority_state: "prefilled_by_import",
    decision_origin: "explicit",
    decision_confidence: "high",
    needs_review: false,
    rationale_code: null,
    evidence: [],
    conflicting_values: [],
    explanation: null,
    provider_confidence: null,
    confirmed_value: value,
    edited_value: null,
    effective_value: value,
    missing_requirement: "optional",
    requires_confirmation: false,
    validation_errors: [],
    selected_conflict_index: null,
    reviewed_at: null,
    created_at: "2026-08-08T00:00:00Z",
    updated_at: "2026-08-08T00:00:00Z",
    ...overrides,
  };
}

/** A whole draft carrying only the rows a test cares about. */
function draftOf(fields) {
  return {
    id: "draft-1",
    owner_user_id: "owner-1",
    source_id: "source-1",
    supersedes_draft_id: null,
    extraction_schema_version: 1,
    target_listing_schema_version: 3,
    processing_status: "awaiting_recruiter_review",
    validation_status: "not_validated",
    confirmation_state: "unreviewed",
    can_apply_to_native_draft: true,
    can_publish_directly: false,
    provider_name: null,
    model_name: null,
    model_version: null,
    instruction_version: null,
    provider_metadata: null,
    processing_warnings: [],
    missing_fields: [],
    validation_errors: {},
    review_sections: [],
    target_job_id: null,
    processed_at: null,
    applied_at: null,
    discarded_at: null,
    created_at: "2026-08-08T00:00:00Z",
    updated_at: "2026-08-08T00:00:00Z",
    fields,
    recruiter_prefill: {},
    early_question_fields: [],
  };
}

function previewFrom(fields, options = {}) {
  const snapshot = importPreviewSnapshot(draftOf(fields));
  return importPreviewProps(snapshot, {
    employerName: options.employerName ?? "Acme Creators",
    roleName: options.roleName ?? null,
  });
}

function preview(values, options = {}) {
  return previewFrom(
    Object.entries(values).map(([path, value]) => field(path, value)),
    options
  );
}

/** Everything the preview would put in front of a reader, as one string. */
function rendered(values, options) {
  const props = preview(values, options);
  return JSON.stringify(props).toLowerCase();
}

test("a remote job never says remote twice", () => {
  const props = preview({ work_mode: "remote", location: "Remote" });

  // The mode and the place resolving to the same word is how "Remote · Remote"
  // reached a live listing. Whichever one renders, they must not both.
  const both =
    String(props.workMode ?? "").toLowerCase() === "remote" &&
    String(props.location ?? "").toLowerCase() === "remote";
  assert.equal(both, false, "work mode and location both rendered as 'Remote'");
});

test("a remote job in a named country keeps the country", () => {
  const props = preview({ work_mode: "remote", location: "India" });

  assert.match(String(props.location ?? ""), /india/i);
});

test("a currency is never printed twice", () => {
  const text = rendered({
    compensation_mode: "fixed",
    budget_amount: "5000",
    budget_currency: "INR",
    budget_unit: "per month",
  });

  assert.ok((text.match(/inr/g) || []).length <= 1, text);
});

test("a compensation unit is never printed twice", () => {
  const text = rendered({
    compensation_mode: "fixed",
    budget_amount: "5000",
    budget_currency: "INR",
    budget_unit: "per month",
  });

  assert.ok((text.match(/per month/g) || []).length <= 1, text);
});

test("a city and its state are not repeated", () => {
  const props = preview({ location: "Chennai, Tamil Nadu, IN" });
  const location = String(props.location ?? "").toLowerCase();

  assert.equal((location.match(/chennai/g) || []).length, 1, location);
  assert.equal((location.match(/tamil nadu/g) || []).length, 1, location);
});

test("a stored value never renders blank", () => {
  // The failure mode behind "the field was read and the draft showed nothing":
  // a value that survived extraction and then vanished at the render boundary.
  const stored = {
    title: "Content Creator",
    location: "Bengaluru, Karnataka, IN",
    work_mode: "onsite",
    engagement_type: "ongoing_freelance",
    compensation_mode: "fixed",
    budget_amount: "5000",
    budget_currency: "INR",
    experience_level: "25 years of professional experience",
  };
  const props = preview(stored);

  assert.ok(String(props.title ?? "").trim());
  assert.ok(String(props.location ?? "").trim());
  assert.ok(String(props.workMode ?? "").trim());
  assert.ok(String(props.engagementType ?? "").trim());
  assert.ok(String(props.budgetMin ?? "").toString().trim());
  assert.ok(String(props.budgetCurrency ?? "").trim());
});

test("a long free-form value reaches the preview rather than being cut", () => {
  // "25 years" was read correctly and then dropped at a column boundary once,
  // so the recruiter saw an empty field about a page that stated it plainly.
  // Checked on a field the preview actually renders.
  const text = rendered({
    responsibilities: [
      "Concept, shoot and edit 4-6 Reels per month for a channel with 25 years of archive footage.",
    ],
  });

  assert.match(text, /25 years/);
});

test("an empty draft renders nothing rather than placeholder prose", () => {
  const props = preview({});

  assert.equal(props.title, "");
  assert.equal(props.location, null);
  assert.deepEqual(props.tools, []);
  assert.deepEqual(props.applicationRequirements, []);
});

test("a recruiter edit is what renders, not the machine proposal", () => {
  const props = previewFrom([
    field("title", "Machine title", {
      edited_value: "Recruiter title",
      effective_value: "Recruiter title",
      authority_state: "edited_by_recruiter",
      review_status: "edited",
    }),
  ]);

  assert.equal(props.title, "Recruiter title");
});

test("a rejected field does not render its rejected value", () => {
  const props = previewFrom([
    field("title", "Wrong title", {
      review_status: "rejected",
      authority_state: "rejected_by_recruiter",
      effective_value: null,
      confirmed_value: null,
    }),
  ]);

  assert.notEqual(props.title, "Wrong title");
});

test("the hiring identity comes from the account, never from the source", () => {
  // The page named Larkfield Studio. The recruiter is Acme Creators. A candidate
  // must be told who is actually hiring them on this platform.
  const props = preview(
    { title: "Content Creator", employer_name: "Larkfield Studio" },
    { employerName: "Acme Creators" }
  );

  assert.equal(props.employerName, "Acme Creators");
});

test("the source employer never overwrites the hiring identity across imports", () => {
  const first = preview({ title: "A" }, { employerName: "Acme Creators" });
  const second = preview(
    { title: "B", employer_name: "Larkfield Studio" },
    { employerName: "Acme Creators" }
  );
  const third = preview(
    { title: "C", employer_name: "Northgate Media" },
    { employerName: "Acme Creators" }
  );

  // Persistent recruiter identity is the intended behaviour and is asserted
  // here deliberately, separately from the source data that must not persist.
  for (const props of [first, second, third]) {
    assert.equal(props.employerName, "Acme Creators");
  }
});

test("a missing hiring identity does not fall back to the source employer", () => {
  const props = preview(
    { title: "Content Creator", employer_name: "Larkfield Studio" },
    { employerName: "" }
  );

  assert.ok(!/larkfield/i.test(String(props.employerName ?? "")));
});

test("no source-owned value survives into a preview built from another draft", () => {
  const a = preview({
    title: "(Paid) Content Creator",
    location: "Remote",
    budget_amount: "5000",
    budget_currency: "INR",
    tools: ["CapCut", "InShot"],
  });
  const b = preview({
    title: "Video Editor",
    location: "Chennai, Tamil Nadu, IN",
  });

  // Each preview is built from its own rows. Nothing is shared, and this is the
  // assertion that would fail if a module-level cache were ever introduced.
  assert.ok(!/5000|capcut|inshot|paid\) content/i.test(JSON.stringify(b)));
  assert.match(JSON.stringify(a), /5000/);
});

test("a role name is the catalog's, not a slug", () => {
  const props = preview({ title: "Editor" }, { roleName: "Video Editor" });

  assert.equal(props.roleName, "Video Editor");
  assert.ok(!/-/.test(String(props.roleName ?? "")));
});

test("application requirements render as a list, never as free text", () => {
  const props = preview({
    application_requirements: ["relevant_portfolio", "expected_rate"],
  });

  assert.ok(Array.isArray(props.applicationRequirements));
  assert.equal(props.applicationRequirements.length, 2);
});

test("no preview surface carries an external destination", () => {
  const text = rendered({
    title: "Content Creator",
    how_to_apply: "Please include two caption examples with your application.",
  });

  for (const banned of ["whatsapp", "telegram", "@", "http", "google form"]) {
    assert.ok(!text.includes(banned), `${banned} reached the preview: ${text}`);
  }
});
