import {
  JOB_FIELD_REGISTRY,
  screenForField,
  type JobFieldName,
} from "./jobFieldRegistry.ts";
import type { RecruiterJobScreen } from "./jobPostingForm.ts";
import type { JobImportDraft, JobImportField } from "./jobImportReadiness.ts";

const IMPORT_TO_NATIVE_FIELD: Readonly<Record<string, JobFieldName>> = {
  primary_role_key: "primary_role_id",
};

export function nativeFieldForImport(fieldPath: string): JobFieldName | null {
  if (fieldPath in IMPORT_TO_NATIVE_FIELD) return IMPORT_TO_NATIVE_FIELD[fieldPath];
  return fieldPath in JOB_FIELD_REGISTRY ? (fieldPath as JobFieldName) : null;
}

export function importFieldLabel(fieldPath: string): string {
  const native = nativeFieldForImport(fieldPath);
  return native
    ? JOB_FIELD_REGISTRY[native].label
    : fieldPath.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

export function importFieldScreen(fieldPath: string): RecruiterJobScreen | null {
  const native = nativeFieldForImport(fieldPath);
  return native ? screenForField(native) ?? null : null;
}

export type ImportCanonicalValues = Readonly<Record<string, unknown>>;

const importDraftValue = (
  draft: JobImportDraft,
  fieldPath: string,
  canonicalValues: ImportCanonicalValues = {}
): unknown => {
  if (Object.prototype.hasOwnProperty.call(canonicalValues, fieldPath)) {
    return canonicalValues[fieldPath];
  }
  return draft.fields.find((field) => field.field_path === fieldPath)?.effective_value;
};

const jobImportValueIsEmpty = (value: unknown): boolean =>
  value === null ||
  value === undefined ||
  (typeof value === "string" && value.trim().length === 0) ||
  (Array.isArray(value) && value.length === 0);

const hasCompleteTurnaround = (
  draft: JobImportDraft,
  canonicalValues: ImportCanonicalValues
): boolean =>
  ["turnaround_value", "turnaround_unit", "turnaround_basis"].every((fieldPath) =>
    !jobImportValueIsEmpty(importDraftValue(draft, fieldPath, canonicalValues))
  );

export function importConditionalFieldIsActive(
  fieldPath: string,
  draft: JobImportDraft,
  canonicalValues: ImportCanonicalValues = {}
): boolean {
  const value = (path: string) => importDraftValue(draft, path, canonicalValues);
  const engagement = value("engagement_type");
  const compensationMode = value("compensation_mode");
  const budgetUnit = value("budget_unit");
  const trialStatus = value("trial_status");

  switch (fieldPath) {
    case "role_specialization":
      return value("primary_role_key") === "other-creator-role";
    case "location":
      return ["hybrid", "onsite"].includes(String(value("work_mode")));
    case "budget_amount":
      return ["fixed", "range"].includes(String(compensationMode));
    case "budget_max":
      return compensationMode === "range";
    case "budget_note":
      return ["commission", "mixed"].includes(String(budgetUnit));
    case "budget_currency":
      return (
        ["fixed", "range"].includes(String(compensationMode)) ||
        (compensationMode === "negotiable" && !["commission", "mixed"].includes(String(budgetUnit)))
      );
    case "budget_unit_custom":
      return budgetUnit === "custom";
    case "expected_weekly_hours_min":
      return (
        ["part_time", "full_time", "fixed_term", "internship"].includes(String(engagement)) ||
        (["ongoing_freelance", "retainer"].includes(String(engagement)) &&
          !hasCompleteTurnaround(draft, canonicalValues))
      );
    case "expected_weekly_hours_max":
      return false;
    case "turnaround_value":
    case "turnaround_unit":
    case "turnaround_basis":
      return (
        engagement === "one_time_project" ||
        (["ongoing_freelance", "retainer"].includes(String(engagement)) &&
          jobImportValueIsEmpty(value("expected_weekly_hours_min")))
      );
    case "external_apply_url":
      return value("application_mode") === "external";
    case "deliverables":
      return [
        "per deliverable",
        "per video",
        "per short",
        "per thumbnail",
        "per script",
        "per episode",
        "per post",
        "per project",
      ].includes(String(budgetUnit));
    case "revision_rounds":
      return value("revision_policy") === "fixed";
    case "start_date":
      return value("start_timing") === "specific_date";
    case "duration_value":
    case "duration_unit":
      return value("duration_type") === "fixed_period";
    case "engagement_end_date":
      return value("duration_type") === "until_date";
    case "trial_scope":
    case "trial_effort_value":
    case "trial_effort_unit":
    case "trial_work_usage":
    case "trial_portfolio_permission":
    case "trial_attribution":
      return ["paid", "unpaid"].includes(String(trialStatus));
    case "trial_compensation_amount":
    case "trial_compensation_currency":
    case "trial_compensation_basis":
      return trialStatus === "paid";
    case "unpaid_trial_confirmed":
      return trialStatus === "unpaid";
    default:
      // Unknown conditions stay quiet; the canonical Post Job validator owns
      // the final requirement once the recruiter's controlling choice is known.
      return false;
  }
}

export function importFieldNeedsAttention(
  field: JobImportField,
  manuallyChanged: ReadonlySet<string> = new Set(),
  draft?: JobImportDraft,
  canonicalValues: ImportCanonicalValues = {}
): boolean {
  const native = nativeFieldForImport(field.field_path);
  if (manuallyChanged.has(field.field_path) || (native && manuallyChanged.has(native))) {
    return false;
  }
  if (field.validation_errors.length > 0) {
    return true;
  }
  if (["confirmed", "edited"].includes(field.review_status)) return false;
  if (field.provenance_state === "conflicting_source_values") return true;
  if (field.provenance_state === "missing") {
    if (field.missing_requirement === "publication_blocker") return true;
    if (field.missing_requirement === "conditionally_required") {
      return draft
        ? importConditionalFieldIsActive(field.field_path, draft, canonicalValues)
        : true;
    }
    return false;
  }
  return field.needs_review;
}

export function importDraftSummary(
  draft: JobImportDraft,
  manuallyChanged: ReadonlySet<string> = new Set()
) {
  const filled = draft.fields.filter(
    (field) => field.effective_value !== null && field.effective_value !== undefined
  ).length;
  const needsReview = draft.fields.filter((field) =>
    importFieldNeedsAttention(field, manuallyChanged, draft)
  ).length;
  const optionalMissing = draft.fields.filter(
    (field) =>
      field.provenance_state === "missing" &&
      ["recommended", "optional"].includes(field.missing_requirement)
  ).length;
  return { filled, needsReview, optionalMissing };
}

export function firstImportAttentionScreen(
  draft: JobImportDraft,
  screenOrder: readonly RecruiterJobScreen[],
  manuallyChanged: ReadonlySet<string> = new Set()
): RecruiterJobScreen | null {
  const attentionScreens = new Set(
    draft.fields
      .filter((field) => importFieldNeedsAttention(field, manuallyChanged, draft))
      .map((field) => importFieldScreen(field.field_path))
      .filter((screen): screen is RecruiterJobScreen => Boolean(screen))
  );
  return screenOrder.find((screen) => attentionScreens.has(screen)) ?? null;
}

export function importFieldsForScreen(
  draft: JobImportDraft,
  screen: RecruiterJobScreen,
  manuallyChanged: ReadonlySet<string> = new Set()
): JobImportField[] {
  return draft.fields.filter((field) => {
    if (importFieldScreen(field.field_path) !== screen) return false;
    if (importFieldNeedsAttention(field, manuallyChanged, draft)) return true;
    return (
      !manuallyChanged.has(field.field_path) &&
      field.decision_origin === "contextual_inference" &&
      field.effective_value !== null
    );
  });
}
