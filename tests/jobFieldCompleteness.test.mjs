import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

// Resolve extensionless relative TS imports (mirrors postJobFlowStructure.test.mjs).
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
  JOB_FIELD_REGISTRY,
  ALL_REPRESENTATIONS,
  ALL_REQUIREMENTS,
  RECRUITER_FACING_REPRESENTATIONS,
  requiredJobFields,
  confirmationJobFields,
  recruiterFacingJobFields,
  screenForField,
} = await import("../lib/jobFieldRegistry.ts");

const {
  RECRUITER_JOB_STEPS,
  RECRUITER_JOB_SCREENS,
  groupForScreen,
  serializeJobPostingDomain,
  emptyJobPostingDomainState,
  backendJobFieldStep,
} = await import("../lib/jobPostingForm.ts");

const STEP_IDS = new Set(RECRUITER_JOB_STEPS.map((item) => item.id));
const SCREEN_IDS = new Set(RECRUITER_JOB_SCREENS.map((item) => item.id));

/** Field names declared on the writable `BackendCreateJobPayload` contract. */
const backendPayloadFields = () => {
  const client = read("lib/backendClient.ts");
  const start = client.indexOf("export type BackendCreateJobPayload = {");
  assert.notEqual(start, -1, "BackendCreateJobPayload type not found");
  const end = client.indexOf("\n};", start);
  assert.notEqual(end, -1, "BackendCreateJobPayload type is not closed");
  const block = client.slice(start, end);
  const fields = [];
  for (const line of block.split("\n").slice(1)) {
    const match = line.match(/^\s*([a-z_][a-z0-9_]*)\??:/);
    if (match) fields.push(match[1]);
  }
  return fields;
};

/**
 * Fields the publication validators (getBasicsErrors + validateJobPostingDomainForPublication)
 * gate on. Each must map to a step and an actionable recruiter-facing input.
 */
const PUBLICATION_VALIDATION_FIELDS = [
  // basics (getBasicsErrors)
  "title",
  "primary_role_id",
  "role_specialization",
  "platforms",
  "work_mode",
  "location",
  "compensation_mode",
  "budget_amount",
  "hiring_identity_id",
  // domain (validateJobPostingDomainForPublication)
  "deliverables",
  "source_inputs_notes",
  "revision_rounds",
  "start_timing",
  "start_date",
  "duration_type",
  "duration_value",
  "duration_unit",
  "engagement_end_date",
  "trial_status",
  "trial_scope",
  "trial_effort_value",
  "trial_effort_unit",
  "trial_work_usage",
  "trial_portfolio_permission",
  "trial_attribution",
  "trial_compensation_amount",
  "unpaid_trial_confirmed",
  "hiring_process",
  "external_apply_url",
  "deadline_at",
];

test("every writable V3 job field is represented in the flow registry", () => {
  const payloadFields = backendPayloadFields();
  assert.ok(payloadFields.length >= 60, `expected the full payload contract, found ${payloadFields.length}`);

  const registryKeys = new Set(Object.keys(JOB_FIELD_REGISTRY));

  for (const field of payloadFields) {
    assert.ok(
      registryKeys.has(field),
      `writable field "${field}" is missing from JOB_FIELD_REGISTRY — every V3 field must be represented`
    );
  }

  const payloadSet = new Set(payloadFields);
  for (const field of registryKeys) {
    assert.ok(
      payloadSet.has(field),
      `registry field "${field}" is not on BackendCreateJobPayload — remove it or fix the drift`
    );
  }
});

test("registry entries use valid representations, requirements, and owning steps", () => {
  for (const [field, entry] of Object.entries(JOB_FIELD_REGISTRY)) {
    assert.ok(entry.label && entry.label.length > 1, `${field} needs a recruiter-facing label`);
    assert.ok(
      ALL_REPRESENTATIONS.includes(entry.representation),
      `${field} has an invalid representation: ${entry.representation}`
    );
    assert.ok(
      ALL_REQUIREMENTS.includes(entry.requirement),
      `${field} has an invalid requirement: ${entry.requirement}`
    );

    // Actively-editable fields must declare an owning step. Purely-retained legacy
    // values (representation "legacy-preserved" + requirement "system") are kept
    // verbatim without a live control, so they may omit a step.
    const isPurelyRetainedLegacy =
      entry.representation === "legacy-preserved" && entry.requirement === "system";
    const needsStep =
      RECRUITER_FACING_REPRESENTATIONS.includes(entry.representation) && !isPurelyRetainedLegacy;
    if (needsStep) {
      assert.ok(entry.step, `recruiter-facing field ${field} must declare an owning step`);
    }
    if (entry.step) {
      assert.ok(STEP_IDS.has(entry.step), `${field} points at unknown step "${entry.step}"`);
    }
    // System-owned fields are never presented as recruiter inputs.
    if (entry.representation === "system-owned") {
      assert.equal(entry.requirement, "system", `${field} is system-owned so its requirement must be "system"`);
    }
  }
});

test("every publication-validation field maps to a step and an actionable input", () => {
  for (const field of PUBLICATION_VALIDATION_FIELDS) {
    const entry = JOB_FIELD_REGISTRY[field];
    assert.ok(entry, `publication field "${field}" is not registered`);
    assert.ok(entry.step && STEP_IDS.has(entry.step), `publication field "${field}" must map to a real step`);
    assert.notEqual(
      entry.representation,
      "system-owned",
      `publication field "${field}" must be recruiter-facing, not system-owned`
    );
    // Backend field-error routing resolves to a step; the registry must agree with it,
    // so a publish failure always lands the recruiter on the field-owning step.
    assert.equal(
      entry.step,
      backendJobFieldStep(field),
      `registry step for "${field}" disagrees with backendJobFieldStep routing`
    );
  }
});

test("registry step ownership agrees with backend-error routing for every routed field", () => {
  const source = read("lib/jobPostingForm.ts");
  const start = source.indexOf("export const backendJobFieldStep");
  assert.notEqual(start, -1, "backendJobFieldStep not found");
  const end = source.indexOf("\n};", start);
  const body = source.slice(start, end === -1 ? undefined : end);

  const routed = new Map();
  const groupRe = /\[([^\]]*)\]\.includes\(field\)\)\s*return\s*"([a-zA-Z]+)"/g;
  let match;
  while ((match = groupRe.exec(body)) !== null) {
    const stepId = match[2];
    const fields = match[1]
      .split(",")
      .map((raw) => raw.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
    for (const field of fields) routed.set(field, stepId);
  }

  assert.ok(routed.size >= 40, `expected the full routing table, parsed ${routed.size}`);

  for (const [field, stepId] of routed) {
    const entry = JOB_FIELD_REGISTRY[field];
    if (!entry) continue; // routing may list read-only mirror fields; registry owns writable ones.
    assert.ok(STEP_IDS.has(stepId), `routing points "${field}" at unknown step "${stepId}"`);
    assert.equal(
      entry.step,
      stepId,
      `registry step "${entry.step}" for "${field}" disagrees with routing step "${stepId}"`
    );
  }
});

test("every recruiter-facing field maps to a reachable screen consistent with its group", () => {
  // Actively-editable fields must resolve to a real screen whose group is the field's step.
  for (const field of recruiterFacingJobFields()) {
    const entry = JOB_FIELD_REGISTRY[field];
    const isPurelyRetainedLegacy =
      entry.representation === "legacy-preserved" && entry.requirement === "system";
    const screen = screenForField(field);
    if (isPurelyRetainedLegacy && !screen) continue; // retained-only legacy may lack a live screen
    assert.ok(screen, `recruiter-facing field "${field}" must map to a screen`);
    assert.ok(SCREEN_IDS.has(screen), `field "${field}" points at unknown screen "${screen}"`);
    assert.equal(
      groupForScreen(screen),
      entry.step,
      `screen "${screen}" group disagrees with the "${field}" domain step "${entry.step}"`
    );
  }

  // Reachability: every field-entry screen owns at least one field. The terminal
  // "review" screen is a preview/publish surface and intentionally owns no writable field.
  const TERMINAL_SCREENS = new Set(["review"]);
  const ownedScreens = new Set(
    recruiterFacingJobFields()
      .map((field) => screenForField(field))
      .filter(Boolean)
  );
  for (const meta of RECRUITER_JOB_SCREENS) {
    if (TERMINAL_SCREENS.has(meta.id)) continue;
    assert.ok(ownedScreens.has(meta.id), `screen "${meta.id}" has no fields — it is unreachable/empty`);
  }

  // Every publication-validation field lands on a specific screen (actionable error location).
  for (const field of PUBLICATION_VALIDATION_FIELDS) {
    const screen = screenForField(field);
    assert.ok(screen && SCREEN_IDS.has(screen), `publication field "${field}" must map to a screen`);
  }
});

test("every serialized domain field is represented and confirmation fields stay explicit", () => {
  const domainKeys = Object.keys(serializeJobPostingDomain(emptyJobPostingDomainState()));
  for (const field of domainKeys) {
    assert.ok(JOB_FIELD_REGISTRY[field], `serialized domain field "${field}" is missing from the registry`);
  }

  // Consequential values must be classified as explicit confirmations, never derived/system.
  const confirmations = new Set(confirmationJobFields());
  assert.ok(confirmations.has("unpaid_trial_confirmed"), "unpaid-trial confirmation must be explicit");
  assert.ok(confirmations.has("hiring_identity_id"), "hiring-identity authorization must be explicit");

  // The required set must include the core publication gates.
  const required = new Set(requiredJobFields());
  for (const field of ["title", "primary_role_id", "trial_status", "start_timing", "deliverables"]) {
    assert.ok(required.has(field), `${field} should be a required (publish/step) field`);
  }
});
