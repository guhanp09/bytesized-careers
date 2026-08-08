/**
 * Candidate-preview values for an import draft that is still being prepared.
 *
 * The preview shown during preparation is the real CreatorJobs candidate view,
 * not a second approximation of it. This module's only job is to decide *which
 * value* each field currently has, honouring review state, and to hand back a
 * record shaped like the backend job that `hydrateJobPostingDraft` already
 * knows how to turn into preview props.
 *
 * The precedence below is the whole point. An imported value the recruiter has
 * not looked at is not a fact about their job yet, so the preview must be able
 * to say "this is provisional" rather than presenting it as approved.
 *
 *   1. recruiter-edited value
 *   2. recruiter-confirmed value
 *   3. safe unconfirmed proposal, flagged as provisional
 *   4. blank
 *
 * Rejected fields disappear. Unresolved conflicts resolve to blank rather than
 * silently picking an alternative the recruiter has not chosen.
 */

import { hydrateJobPostingDomain, type JobPostingDomainState } from "./jobPostingForm.ts";
import { ENGAGEMENT_TYPES, type CompensationMode, type EngagementType } from "./jobContract.ts";
import type { BackendJob, BackendRole } from "./backendClient.ts";
import type { JobImportDraft, JobImportField } from "./jobImportReadiness.ts";

export type PreviewValueState =
  /** The recruiter typed or picked this. */
  | "recruiter"
  /** Imported and shown, but the recruiter has not confirmed it yet. */
  | "provisional"
  /** Nothing to show. */
  | "blank";

export type PreviewValue = {
  value: unknown;
  state: PreviewValueState;
};

const isEmpty = (value: unknown): boolean =>
  value === null ||
  value === undefined ||
  (typeof value === "string" && value.trim().length === 0) ||
  (Array.isArray(value) && value.length === 0);

/**
 * The value a single imported field contributes to the preview, and how sure
 * we are of it.
 */
export function previewValueForField(field: JobImportField): PreviewValue {
  // A rejected value is gone. It must not linger in the candidate view.
  if (field.review_status === "rejected") {
    return { value: null, state: "blank" };
  }
  if (field.review_status === "edited" && !isEmpty(field.edited_value)) {
    return { value: field.edited_value, state: "recruiter" };
  }
  if (field.review_status === "confirmed" && !isEmpty(field.confirmed_value)) {
    return { value: field.confirmed_value, state: "recruiter" };
  }
  // An unresolved contradiction is not a value. Choosing one side here would
  // put words in the recruiter's mouth and could mislead a candidate.
  if (field.provenance_state === "conflicting_source_values") {
    return { value: null, state: "blank" };
  }
  // A value that failed canonical validation is not fit to show anyone.
  if (field.validation_errors.length > 0) {
    return { value: null, state: "blank" };
  }
  if (!isEmpty(field.proposed_value)) {
    return { value: field.proposed_value, state: "provisional" };
  }
  return { value: null, state: "blank" };
}

export type ImportPreviewSnapshot = {
  /** Backend-job-shaped record for the ordinary hydration path. */
  values: Record<string, unknown>;
  /** Field paths currently showing an unconfirmed imported value. */
  provisionalFields: string[];
  /** Field paths the recruiter has personally settled. */
  recruiterFields: string[];
};

/**
 * Collapse an import draft into the values the candidate preview should show.
 *
 * `canonicalValues` are the live Post Job values when the draft has already
 * become a native job. They win outright: once a value exists on the real job,
 * that is the job, and the import record is only history.
 */
export function importPreviewSnapshot(
  draft: JobImportDraft,
  canonicalValues: Readonly<Record<string, unknown>> = {}
): ImportPreviewSnapshot {
  const values: Record<string, unknown> = {};
  const provisionalFields: string[] = [];
  const recruiterFields: string[] = [];

  for (const field of draft.fields) {
    const canonical = Object.prototype.hasOwnProperty.call(
      canonicalValues,
      field.field_path
    )
      ? canonicalValues[field.field_path]
      : undefined;

    if (canonical !== undefined) {
      if (!isEmpty(canonical)) {
        values[field.field_path] = canonical;
        recruiterFields.push(field.field_path);
      }
      continue;
    }

    const { value, state } = previewValueForField(field);
    if (state === "blank") continue;
    values[field.field_path] = value;
    (state === "recruiter" ? recruiterFields : provisionalFields).push(field.field_path);
  }

  // Answers given while extraction was still running are recruiter decisions
  // even before a field row exists for them.
  for (const [fieldPath, value] of Object.entries(draft.recruiter_prefill ?? {})) {
    if (isEmpty(value)) continue;
    values[fieldPath] = value;
    if (!recruiterFields.includes(fieldPath)) recruiterFields.push(fieldPath);
    const provisionalIndex = provisionalFields.indexOf(fieldPath);
    if (provisionalIndex >= 0) provisionalFields.splice(provisionalIndex, 1);
  }

  return { values, provisionalFields, recruiterFields };
}

/**
 * How complete the candidate-facing listing currently looks.
 *
 * Used only to decide how much of the preview is worth showing; it is not a
 * readiness signal and never gates publication.
 */
export function importPreviewFilledCount(snapshot: ImportPreviewSnapshot): number {
  return snapshot.recruiterFields.length + snapshot.provisionalFields.length;
}

/** Resolve the import's stable role key through the same public catalog as Post Job. */
export function importPreviewRoleName(
  snapshot: ImportPreviewSnapshot,
  roles: readonly BackendRole[]
): string | null {
  const key = snapshot.values.primary_role_key;
  if (typeof key !== "string" || !key.trim()) return null;
  const normalized = key.trim().toLocaleLowerCase();
  const catalogName = roles.find(
    (role) =>
      role.id.toLocaleLowerCase() === normalized ||
      role.slug?.toLocaleLowerCase() === normalized
  )?.name;
  if (catalogName) return catalogName;

  // The catalog request and the draft request resolve independently. A stable
  // slug is already enough to avoid a false "role not selected" flash while the
  // display name is loading; opaque ids deliberately stay blank until resolved.
  if (
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalized) ||
    /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(normalized)
  ) {
    return null;
  }
  const acronyms: Readonly<Record<string, string>> = {
    ai: "AI",
    seo: "SEO",
    ugc: "UGC",
  };
  return normalized
    .split("-")
    .map(
      (part) =>
        acronyms[part] ?? part.replace(/^./, (letter) => letter.toLocaleUpperCase())
    )
    .join(" ");
}

const str = (value: unknown): string => (typeof value === "string" ? value : "");
const strOrNull = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value : null;
const strList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

const COMPENSATION_MODES: readonly CompensationMode[] = ["fixed", "range", "negotiable"];

/** Unknown enum values become blank rather than being forced into the union. */
const asCompensationMode = (value: unknown): CompensationMode | null =>
  COMPENSATION_MODES.includes(value as CompensationMode) ? (value as CompensationMode) : null;

const asEngagementType = (value: unknown): EngagementType | null =>
  (ENGAGEMENT_TYPES as readonly string[]).includes(value as string)
    ? (value as EngagementType)
    : null;

const WORK_MODE_LABELS: Readonly<Record<string, string>> = {
  remote: "Remote",
  hybrid: "Hybrid",
  onsite: "On-site",
};

/**
 * Preview props for a draft still being prepared.
 *
 * The structured half goes through `hydrateJobPostingDomain` — the very function
 * the Post Job editor uses when it loads a saved draft — so the deliverables,
 * hiring stages and screening rows a candidate sees here are produced by the
 * same code that will produce them after conversion. That is what makes the
 * preview a preview rather than a lookalike.
 */
/** Words that restate the work mode rather than naming a place. */
const RESTATES_REMOTE = /^(?:remote|remote[- ]friendly|remote[- ]first|fully[- ]remote|anywhere|work from home|wfh|distributed)$/i;

/**
 * Where the job is, given how it is worked.
 *
 * This used to be `workMode === "remote" ? "Remote" : location`, which got both
 * halves wrong. A remote role in India rendered as "Remote" and lost the
 * country — material on a marketplace where remote-in-India and remote-anywhere
 * are different jobs to apply for. And when the stored location was itself the
 * word "Remote", the mode and the place printed the same word twice, which is
 * where "Remote · Remote" came from.
 *
 * So a stated place is always kept, and a "place" that only restates the mode is
 * dropped rather than echoed.
 */
function previewLocation(workMode: string, stored: unknown): string | null {
  const location = strOrNull(stored);
  if (workMode !== "remote") return location;
  if (!location) return "Remote";
  return RESTATES_REMOTE.test(location.trim()) ? null : location;
}

export function importPreviewProps(
  snapshot: ImportPreviewSnapshot,
  options: { employerName: string; roleName?: string | null }
): {
  title: string;
  employerName: string;
  roleName: string | null;
  roleSpecialization: string | null;
  platform: string | null;
  compensationMode: CompensationMode | null;
  budgetMin: string | number | null;
  budgetMax: string | number | null;
  budgetCurrency: string | null;
  budgetNote: string | null;
  engagementType: EngagementType | null;
  workMode: string | null;
  location: string | null;
  expectedWeeklyHoursMin: string | number | null;
  expectedWeeklyHoursMax: string | number | null;
  about: string | null;
  responsibilities: string | null;
  legacyRequirements: string | null;
  tools: string[];
  applicationRequirements: string[];
  tags: string[];
  contentNiches: string[];
  contentGenres: string[];
  formatsHiredFor: string[];
  domain: JobPostingDomainState;
} {
  const values = snapshot.values;
  const workMode = str(values.work_mode).toLowerCase();

  return {
    title: str(values.title),
    employerName: options.employerName,
    roleName: options.roleName ?? null,
    roleSpecialization: strOrNull(values.role_specialization),
    platform: strList(values.platforms)[0] ?? null,
    compensationMode: asCompensationMode(values.compensation_mode),
    budgetMin: (values.budget_amount as string | number | null) ?? null,
    budgetMax: (values.budget_max as string | number | null) ?? null,
    budgetCurrency: strOrNull(values.budget_currency),
    budgetNote: strOrNull(values.budget_note),
    engagementType: asEngagementType(values.engagement_type),
    workMode: WORK_MODE_LABELS[workMode] ?? strOrNull(values.work_mode),
    location: previewLocation(workMode, values.location),
    expectedWeeklyHoursMin:
      (values.expected_weekly_hours_min as string | number | null) ?? null,
    expectedWeeklyHoursMax:
      (values.expected_weekly_hours_max as string | number | null) ?? null,
    about: strOrNull(values.about_channel),
    responsibilities: strList(values.responsibilities).join("\n") || null,
    legacyRequirements: strList(values.requirements).join("\n") || null,
    tools: strList(values.tools),
    applicationRequirements: strList(values.application_requirements),
    tags: strList(values.tags),
    contentNiches: strList(values.content_niches),
    contentGenres: strList(values.content_genres),
    formatsHiredFor: strList(values.formats_hired_for),
    // The same hydration the Post Job editor runs on a saved draft.
    domain: hydrateJobPostingDomain(values as unknown as BackendJob),
  };
}
