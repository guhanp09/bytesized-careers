import type { JobImportField, JobImportNonNullJsonValue } from "./jobImportReadiness";

export const IMPORT_REVIEW_SECTION_LABELS: Record<string, string> = {
  basics: "Role basics",
  compensation: "Compensation",
  work: "Work expectations",
  description: "Listing details",
  skills_tools: "Skills and tools",
  terms: "Terms and trial",
  application: "Application",
  identity: "Hiring identity",
};

export const IMPORT_MISSING_GROUP_LABELS: Record<
  JobImportField["missing_requirement"],
  string
> = {
  publication_blocker: "Required before publishing",
  conditionally_required: "Required when relevant",
  recommended: "Recommended for listing quality",
  optional: "Optional details",
};

const WORD_OVERRIDES: Record<string, string> = {
  id: "ID",
  url: "URL",
  asap: "ASAP",
  ugc: "UGC",
};

export function humanizeImportKey(value: string): string {
  return value
    .split("_")
    .map((word) => WORD_OVERRIDES[word] ?? word)
    .join(" ")
    .replace(/^./, (character) => character.toUpperCase());
}

export const IMPORT_FIELD_LABELS: Record<string, string> = {
  primary_role_key: "Primary creator role",
  role_specialization: "Role specialization",
  about_channel: "About the channel or project",
  budget_amount: "Compensation amount",
  budget_max: "Maximum compensation",
  budget_note: "Compensation note",
  budget_currency: "Currency",
  budget_unit: "Compensation unit",
  budget_unit_custom: "Custom compensation unit",
  expected_weekly_hours_min: "Minimum weekly hours",
  expected_weekly_hours_max: "Maximum weekly hours",
  turnaround_value: "Turnaround",
  turnaround_unit: "Turnaround unit",
  turnaround_basis: "Turnaround basis",
  deadline_at: "Application deadline",
  external_apply_url: "External application URL",
  required_tool_keys: "Required tools",
  other_required_tools: "Other required tools",
  required_skill_keys: "Required skills",
  preferred_skill_keys: "Preferred skills",
  trial_status: "Trial status",
  trial_compensation_amount: "Trial compensation",
  trial_compensation_currency: "Trial currency",
  trial_work_usage: "Trial work usage",
  trial_portfolio_permission: "Trial portfolio rights",
  trial_attribution: "Trial attribution",
  unpaid_trial_confirmed: "Unpaid trial confirmation",
  source_inputs: "Source materials and access",
};

export function importFieldLabel(fieldPath: string): string {
  return IMPORT_FIELD_LABELS[fieldPath] ?? humanizeImportKey(fieldPath);
}

export const CONSEQUENTIAL_IMPORT_FIELDS = new Set([
  "compensation_mode",
  "budget_amount",
  "budget_max",
  "budget_note",
  "budget_currency",
  "budget_unit",
  "budget_unit_custom",
  "engagement_type",
  "expected_weekly_hours_min",
  "expected_weekly_hours_max",
  "turnaround_value",
  "turnaround_unit",
  "turnaround_basis",
  "trial_status",
  "trial_compensation_amount",
  "trial_compensation_currency",
  "trial_compensation_basis",
  "trial_work_usage",
  "trial_portfolio_permission",
  "trial_attribution",
  "unpaid_trial_confirmed",
  "source_inputs",
  "deadline_at",
  "work_mode",
  "location",
  "engagement_end_date",
]);

export const IMPORT_CONTROLLED_OPTIONS: Record<string, string[]> = {
  compensation_mode: ["fixed", "range", "negotiable"],
  budget_currency: ["INR", "USD", "EUR", "GBP", "AUD", "CAD"],
  budget_unit: [
    "per hour",
    "per day",
    "per deliverable",
    "per video",
    "per short",
    "per thumbnail",
    "per script",
    "per episode",
    "per post",
    "per project",
    "per week",
    "per month",
    "per year",
    "commission",
    "mixed",
    "custom",
  ],
  engagement_type: [
    "one_time_project",
    "ongoing_freelance",
    "retainer",
    "part_time",
    "full_time",
    "fixed_term",
    "internship",
  ],
  work_mode: ["remote", "hybrid", "onsite"],
  application_mode: ["internal", "external"],
  turnaround_unit: ["hours", "business_days", "calendar_days", "weeks"],
  turnaround_basis: ["per_deliverable", "batch", "first_draft", "final_delivery"],
  start_timeframe: ["ASAP", "<1mo", "<2mo", "<3mo", "Flexible"],
  trial_status: ["none", "paid", "unpaid"],
  trial_compensation_basis: ["flat", "per_hour", "per_deliverable", "custom"],
  trial_work_usage: ["evaluation_only", "may_use_privately", "may_publish"],
  trial_portfolio_permission: ["allowed", "not_allowed", "with_permission"],
  trial_attribution: ["credited", "not_credited", "not_applicable", "to_be_agreed"],
};

const NUMERIC_FIELDS = new Set([
  "budget_amount",
  "budget_max",
  "expected_weekly_hours_min",
  "expected_weekly_hours_max",
  "turnaround_value",
  "revision_rounds",
  "trial_effort_value",
  "trial_compensation_amount",
  "duration_value",
]);

const BOOLEAN_FIELDS = new Set(["unpaid_trial_confirmed"]);

const LIST_FIELDS = new Set([
  "platforms",
  "responsibilities",
  "requirements",
  "application_requirements",
  "tags",
  "content_niches",
  "content_genres",
  "formats_hired_for",
  "required_tool_keys",
  "other_required_tools",
  "required_skill_keys",
  "preferred_skill_keys",
  "other_required_skills",
  "other_preferred_skills",
]);

export type ImportEditorKind = "text" | "number" | "boolean" | "list" | "select" | "unsupported";

export function importEditorKind(field: JobImportField): ImportEditorKind {
  if (IMPORT_CONTROLLED_OPTIONS[field.field_path]) return "select";
  if (NUMERIC_FIELDS.has(field.field_path)) return "number";
  if (BOOLEAN_FIELDS.has(field.field_path)) return "boolean";
  if (LIST_FIELDS.has(field.field_path)) return "list";
  const sample =
    field.effective_value ??
    field.proposed_value ??
    field.conflicting_values[0]?.value;
  if (typeof sample === "number") return "number";
  if (typeof sample === "boolean") return "boolean";
  if (Array.isArray(sample) && sample.every((item) => typeof item !== "object")) {
    return "list";
  }
  if (sample === null || typeof sample === "string") return "text";
  return "unsupported";
}

export function importValueToEditorText(value: unknown, kind: ImportEditorKind): string {
  if (kind === "list" && Array.isArray(value)) return value.map(String).join("\n");
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value === null || typeof value === "undefined") return "";
  return String(value);
}

export function parseImportEditorValue(
  raw: string,
  kind: ImportEditorKind
): JobImportNonNullJsonValue {
  const value = raw.trim();
  if (kind === "number") {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) throw new Error("Enter a valid number.");
    return parsed;
  }
  if (kind === "boolean") return value === "true";
  if (kind === "list") {
    const items = raw
      .split(/\n|,/)
      .map((item) => item.trim())
      .filter(Boolean);
    if (!items.length) throw new Error("Enter at least one value.");
    return items;
  }
  if (!value) throw new Error("Enter a value.");
  return value;
}

export function formatImportValue(value: unknown): string {
  if (value === null || typeof value === "undefined" || value === "") return "Not provided";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return value.toLocaleString("en-US");
  if (typeof value === "string") {
    if (/^-?\d+(?:\.\d+)?$/.test(value)) {
      const numeric = Number(value);
      if (Number.isFinite(numeric)) return numeric.toLocaleString("en-US");
    }
    return humanizeImportKey(value);
  }
  if (Array.isArray(value)) {
    if (!value.length) return "None";
    return value.map(formatImportValue).join(" · ");
  }
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => `${humanizeImportKey(key)}: ${formatImportValue(item)}`)
      .join(" · ");
  }
  return String(value);
}
