import { JOB_FIELD_REGISTRY } from "./jobFieldRegistry.ts";
import type { RecruiterJobScreen } from "./jobPostingForm.ts";
import type {
  JobImportDraft,
  JobImportEvidence,
  JobImportField,
} from "./jobImportReadiness.ts";
import {
  importConditionalFieldIsActive,
  importFieldLabel,
  importFieldNeedsAttention,
  importFieldScreen,
  nativeFieldForImport,
  type ImportCanonicalValues,
} from "./importedDraftGuidance.ts";

export type JobImportGuidancePhase = "essential" | "quality" | "complete";
export type JobImportGuidanceKind =
  | "conflict"
  | "required"
  | "confirmation"
  | "clarification"
  | "quality";

export type JobImportGuidanceTurn = {
  id: string;
  phase: Exclude<JobImportGuidancePhase, "complete">;
  kind: JobImportGuidanceKind;
  fieldPaths: string[];
  primaryFieldPath: string;
  screen: RecruiterJobScreen;
  heading: string;
  explanation: string;
  question: string;
  candidateImpact: string;
  evidence: JobImportEvidence[];
  alternatives: Array<{ value: unknown; evidence: JobImportEvidence[] }>;
  resolved: boolean;
  resolutionLabel: string | null;
  canDecideLater: boolean;
  canSkip: boolean;
  priority: number;
};

export type JobImportGuidanceContext = {
  jobTitle?: string | null;
  roleName?: string | null;
  employerName?: string | null;
  sourceLabel: string;
  canonicalValues?: ImportCanonicalValues;
  manuallyChanged?: ReadonlySet<string>;
};

const GROUPS: ReadonlyArray<{ id: string; fieldPaths: readonly string[] }> = [
  { id: "role", fieldPaths: ["primary_role_key", "role_specialization"] },
  { id: "work-arrangement", fieldPaths: ["work_mode", "location", "timezone_overlap"] },
  { id: "engagement", fieldPaths: ["engagement_type"] },
  {
    id: "compensation",
    fieldPaths: [
      "compensation_mode",
      "budget_amount",
      "budget_max",
      "budget_currency",
      "budget_unit",
      "budget_unit_custom",
      "budget_note",
    ],
  },
  {
    id: "weekly-hours",
    fieldPaths: ["expected_weekly_hours_min", "expected_weekly_hours_max"],
  },
  {
    id: "turnaround",
    fieldPaths: ["turnaround_value", "turnaround_unit", "turnaround_basis"],
  },
  {
    id: "duration",
    fieldPaths: [
      "duration_type",
      "duration_value",
      "duration_unit",
      "engagement_end_date",
    ],
  },
  { id: "start", fieldPaths: ["start_timing", "start_date", "start_timeframe"] },
  { id: "deliverables", fieldPaths: ["deliverables"] },
  {
    id: "revisions",
    fieldPaths: ["revision_policy", "revision_rounds", "revision_notes"],
  },
  { id: "source-inputs", fieldPaths: ["source_inputs", "source_inputs_notes"] },
  {
    id: "skills",
    fieldPaths: [
      "required_skill_keys",
      "preferred_skill_keys",
      "other_required_skills",
      "other_preferred_skills",
    ],
  },
  { id: "tools", fieldPaths: ["required_tool_keys", "other_required_tools"] },
  {
    id: "trial",
    fieldPaths: [
      "trial_status",
      "trial_scope",
      "trial_effort_value",
      "trial_effort_unit",
      "trial_compensation_amount",
      "trial_compensation_currency",
      "trial_compensation_basis",
      "trial_work_usage",
      "trial_portfolio_permission",
      "trial_attribution",
      "unpaid_trial_confirmed",
      "trial_notes",
    ],
  },
  { id: "hiring-process", fieldPaths: ["hiring_process", "hiring_process_notes"] },
  { id: "screening", fieldPaths: ["screening_questions"] },
  {
    id: "application",
    fieldPaths: [
      "application_mode",
      "external_apply_url",
      "application_requirements",
      "how_to_apply",
      "deadline_at",
    ],
  },
  { id: "creative-autonomy", fieldPaths: ["creative_autonomy", "creative_autonomy_notes"] },
  { id: "references", fieldPaths: ["reference_videos"] },
];

const GROUP_BY_FIELD = new Map(
  GROUPS.flatMap((group) => group.fieldPaths.map((fieldPath) => [fieldPath, group.id] as const))
);

const CONSEQUENTIAL_FIELDS = new Set([
  "primary_role_key",
  "role_specialization",
  "work_mode",
  "location",
  "engagement_type",
  "compensation_mode",
  "budget_amount",
  "budget_max",
  "budget_currency",
  "budget_unit",
  "budget_unit_custom",
  "expected_weekly_hours_min",
  "expected_weekly_hours_max",
  "turnaround_value",
  "turnaround_unit",
  "turnaround_basis",
  "start_timing",
  "start_date",
  "duration_type",
  "duration_value",
  "duration_unit",
  "engagement_end_date",
  "application_mode",
  "external_apply_url",
  "trial_status",
  "trial_scope",
  "trial_effort_value",
  "trial_effort_unit",
  "trial_compensation_amount",
  "trial_compensation_currency",
  "trial_compensation_basis",
  "trial_work_usage",
  "trial_portfolio_permission",
  "trial_attribution",
  "unpaid_trial_confirmed",
]);

const OPTIONAL_GROUP_BASE_SCORE: Readonly<Record<string, number>> = {
  revisions: 50,
  "source-inputs": 48,
  "creative-autonomy": 35,
  turnaround: 34,
  references: 32,
  "hiring-process": 28,
  application: 22,
};

const OPTIONAL_PROMPT_FIELDS: Readonly<Record<string, ReadonlySet<string>>> = {
  revisions: new Set(["revision_policy"]),
  "source-inputs": new Set(["source_inputs"]),
  "creative-autonomy": new Set(["creative_autonomy"]),
  turnaround: new Set(["turnaround_value", "turnaround_unit", "turnaround_basis"]),
  references: new Set(["reference_videos"]),
  "hiring-process": new Set(["hiring_process"]),
  application: new Set(["deadline_at"]),
};

const valueIsEmpty = (value: unknown): boolean =>
  value === null ||
  value === undefined ||
  (typeof value === "string" && value.trim().length === 0) ||
  (Array.isArray(value) && value.length === 0);

export function conciseImportValue(value: unknown): string {
  if (Array.isArray(value)) {
    const parts = value.slice(0, 3).map((item) => {
      if (typeof item === "string" || typeof item === "number") return String(item);
      if (item && typeof item === "object" && "prompt" in item) {
        return String((item as { prompt?: unknown }).prompt ?? "");
      }
      if (item && typeof item === "object" && "type" in item) {
        return String((item as { type?: unknown }).type ?? "").replaceAll("_", " ");
      }
      return "Imported detail";
    });
    return parts.filter(Boolean).join(" · ");
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string" || typeof value === "number") {
    const normalized = String(value).replaceAll("_", " ");
    if (/^[a-z]+(?:-[a-z]+)+$/.test(normalized)) {
      const words = normalized.replaceAll("-", " ");
      return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
    }
    return normalized;
  }
  return "Saved in the draft";
}

const currentValue = (
  field: JobImportField,
  canonicalValues: ImportCanonicalValues
): unknown => {
  if (Object.prototype.hasOwnProperty.call(canonicalValues, field.field_path)) {
    return canonicalValues[field.field_path];
  }
  return field.effective_value;
};

const manuallyChangedField = (
  field: JobImportField,
  manuallyChanged: ReadonlySet<string>
): boolean => {
  const native = nativeFieldForImport(field.field_path);
  return manuallyChanged.has(field.field_path) || Boolean(native && manuallyChanged.has(native));
};

const fieldResolved = (
  field: JobImportField,
  context: Required<Pick<JobImportGuidanceContext, "canonicalValues" | "manuallyChanged">>
): boolean => {
  if (["confirmed", "edited", "rejected"].includes(field.review_status)) return true;
  return manuallyChangedField(field, context.manuallyChanged);
};

const relevantOptionalScore = (groupId: string, roleText: string): number => {
  const base = OPTIONAL_GROUP_BASE_SCORE[groupId] ?? 0;
  if (!base) return 0;
  const productionRole = /editor|editing|designer|thumbnail|motion|animation|podcast|producer|script|writer/.test(
    roleText
  );
  const strategyRole = /strateg|growth|channel|community|marketing|ugc/.test(roleText);
  if (
    ["revisions", "source-inputs", "turnaround", "references"].includes(groupId) &&
    !productionRole &&
    !(strategyRole && groupId === "source-inputs")
  ) {
    return 0;
  }
  if (groupId === "creative-autonomy" && !strategyRole && !productionRole) return 0;
  let bonus = 0;
  if (productionRole && ["revisions", "source-inputs", "turnaround", "references"].includes(groupId)) {
    bonus += 45;
  }
  if (strategyRole && ["creative-autonomy", "source-inputs", "hiring-process"].includes(groupId)) {
    bonus += 35;
  }
  if (/thumbnail|designer|motion|animation/.test(roleText) && groupId === "references") bonus += 35;
  if (/podcast|editor|producer/.test(roleText) && groupId === "source-inputs") bonus += 35;
  return base + bonus;
};

const fieldRequirement = (field: JobImportField): string => {
  const native = nativeFieldForImport(field.field_path);
  return native ? JOB_FIELD_REGISTRY[native].requirement : "optional";
};

const unresolvedKind = (fields: JobImportField[], draft: JobImportDraft): JobImportGuidanceKind => {
  if (fields.some((field) => field.provenance_state === "conflicting_source_values")) {
    return "conflict";
  }
  if (
    fields.some(
      (field) =>
        field.provenance_state === "missing" &&
        ["publication_blocker", "conditionally_required"].includes(field.missing_requirement)
    )
  ) {
    return "required";
  }
  if (fields.some((field) => field.requires_confirmation || CONSEQUENTIAL_FIELDS.has(field.field_path))) {
    return "confirmation";
  }
  if (fields.some((field) => importFieldNeedsAttention(field, new Set(), draft))) {
    return "clarification";
  }
  return "quality";
};

const fieldIsEssential = (
  field: JobImportField,
  draft: JobImportDraft,
  canonicalValues: ImportCanonicalValues
): boolean => {
  if (field.validation_errors.length) return true;
  if (field.provenance_state === "conflicting_source_values") {
    return CONSEQUENTIAL_FIELDS.has(field.field_path) || fieldRequirement(field) === "publish";
  }
  if (field.provenance_state === "missing") {
    if (field.missing_requirement === "publication_blocker") return true;
    if (field.missing_requirement === "conditionally_required") {
      return importConditionalFieldIsActive(field.field_path, draft, canonicalValues);
    }
    return field.field_path === "trial_status";
  }
  return Boolean(
    field.needs_review &&
      (field.requires_confirmation ||
        CONSEQUENTIAL_FIELDS.has(field.field_path) ||
        ["publish", "step"].includes(fieldRequirement(field)))
  );
};

const turnPriority = (
  fields: JobImportField[],
  phase: Exclude<JobImportGuidancePhase, "complete">,
  draft: JobImportDraft,
  canonicalValues: ImportCanonicalValues
): number => {
  if (phase === "quality") return 60;
  if (
    fields.some(
      (field) =>
        field.provenance_state === "conflicting_source_values" &&
        fieldIsEssential(field, draft, canonicalValues)
    )
  ) return 0;
  if (
    fields.some(
      (field) =>
        field.provenance_state === "missing" && field.missing_requirement === "publication_blocker"
    )
  ) return 10;
  if (
    fields.some(
      (field) =>
        field.provenance_state === "missing" && field.missing_requirement === "conditionally_required"
    )
  ) return 20;
  if (fields.some((field) => CONSEQUENTIAL_FIELDS.has(field.field_path))) return 30;
  return 40;
};

const uniqueEvidence = (fields: JobImportField[]): JobImportEvidence[] => {
  const seen = new Set<string>();
  return fields
    .flatMap((field) => [
      ...field.evidence,
      ...field.conflicting_values.flatMap((alternative) => alternative.evidence),
    ])
    .filter((item) => {
      const key = `${item.snippet}:${item.location?.char_start ?? ""}:${item.location?.char_end ?? ""}`;
      if (!item.snippet.trim() || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 3);
};

const contextSubject = (context: JobImportGuidanceContext): string => {
  const role = context.roleName?.trim();
  const title = context.jobTitle?.trim();
  return role || title || "this creator role";
};

function guidanceCopy(
  groupId: string,
  fields: JobImportField[],
  kind: JobImportGuidanceKind,
  context: JobImportGuidanceContext
): Pick<JobImportGuidanceTurn, "heading" | "explanation" | "question" | "candidateImpact"> {
  const role = contextSubject(context);
  const title = context.jobTitle?.trim() || role;
  const label = importFieldLabel(fields[0].field_path);
  const omitted = fields.some((field) => field.provenance_state === "missing");
  const conflicted = kind === "conflict";
  const sourceFinding = conflicted
    ? `I found two possible answers in ${context.sourceLabel}.`
    : omitted
      ? `${context.sourceLabel} did not make ${label.toLowerCase()} clear.`
      : `I found a possible value for ${label.toLowerCase()} in ${context.sourceLabel}.`;

  switch (groupId) {
    case "work-arrangement":
      return {
        heading: conflicted ? "Let’s clarify where this role can be done" : "Where will this person work?",
        explanation: `${sourceFinding} The work arrangement for ${title} determines who can realistically apply and whether a location needs to be shown.`,
        question: "What work arrangement should candidates see?",
        candidateImpact: "Candidates can quickly tell whether the role fits where and how they can work.",
      };
    case "compensation":
      return {
        heading: conflicted ? "Let’s make the pay unambiguous" : "One pay detail needs your decision",
        explanation: `${sourceFinding} For ${role}, the amount, currency and payment unit need to describe one consistent offer so the pay does not appear misleading.`,
        question: "What compensation should candidates see?",
        candidateImpact: "Clear pay helps candidates compare the workload with the offer.",
      };
    case "weekly-hours":
      return {
        heading: "What weekly workload should candidates expect?",
        explanation: `${sourceFinding} The source describes ${title} as ${String(context.canonicalValues?.engagement_type || "an ongoing role").replaceAll("_", " ")}, but only you can confirm the real workload.`,
        question: "What minimum and maximum weekly-hour range should candidates plan for?",
        candidateImpact: "The range lets candidates judge whether the workload fits the pay and their availability.",
      };
    case "turnaround":
      return {
        heading: "Set a realistic delivery expectation",
        explanation: `${sourceFinding} ${role} candidates need to distinguish delivery speed from how often content is published.`,
        question: "What turnaround applies, and what does that timing cover?",
        candidateImpact: "A precise turnaround prevents cadence from being mistaken for a deadline.",
      };
    case "application":
      return {
        heading: "How should candidates apply?",
        explanation: `${sourceFinding} Candidates for ${title} need one clear place to send their application and materials.`,
        question: "Should they apply inside CreatorJobs or through an external page?",
        candidateImpact: "A clear route prevents qualified candidates from abandoning or duplicating an application.",
      };
    case "trial":
      return {
        heading: "Will the hiring process include a trial?",
        explanation: `${sourceFinding} For ${role}, candidates should know before applying whether sample work will be requested and, if so, how it will be paid and used.`,
        question: "What should the listing say about a trial?",
        candidateImpact: "Up-front trial terms protect candidate time and make the evaluation process predictable.",
      };
    case "revisions":
      return {
        heading: "Set expectations for revisions",
        explanation: `${sourceFinding} Revision scope can materially change the workload for ${role}.`,
        question: "Would you like to add a revision policy?",
        candidateImpact: "A clear limit helps candidates estimate effort and avoids open-ended revision expectations.",
      };
    case "source-inputs":
      return {
        heading: "Clarify what you will provide",
        explanation: `${sourceFinding} ${role} candidates can estimate the work more accurately when they know which footage, briefs, assets or access will be ready.`,
        question: "What source material or access will you provide?",
        candidateImpact: "This helps candidates judge whether the proposed timeline and workflow are realistic.",
      };
    case "creative-autonomy":
      return {
        heading: "Describe the creative freedom in this role",
        explanation: `${sourceFinding} The right ${role} candidate will want to know whether they are executing a defined direction or shaping it.`,
        question: "How much creative autonomy will this person have?",
        candidateImpact: "Clear autonomy attracts candidates whose working style matches the role.",
      };
    case "references":
      return {
        heading: "Show what good work looks like",
        explanation: `${sourceFinding} A reference can communicate the desired style for ${role} faster than a long description.`,
        question: "Would you like to add a reference example?",
        candidateImpact: "Candidates can assess fit and tailor their portfolio more accurately.",
      };
    case "engagement":
      return {
        heading: "Choose how this working relationship is structured",
        explanation: `${sourceFinding} The engagement type for ${title} affects availability, duration and how candidates interpret the pay.`,
        question: "What type of engagement are you offering?",
        candidateImpact: "Candidates can understand the commitment before they apply.",
      };
    case "duration":
      return {
        heading: "How long will this engagement last?",
        explanation: `${sourceFinding} Duration gives ${role} candidates enough context to plan their availability.`,
        question: "Is this ongoing, a fixed period, or ending on a specific date?",
        candidateImpact: "Candidates can decide whether the timing fits their existing commitments.",
      };
    case "role":
      return {
        heading: "Confirm the closest creator role",
        explanation: `${sourceFinding} The role selection determines how ${title} appears in discovery and which candidates see it.`,
        question: "Which creator role best describes this work?",
        candidateImpact: "The right role helps relevant candidates find the listing.",
      };
    default:
      return {
        heading: `A quick decision about ${label.toLowerCase()}`,
        explanation: `${sourceFinding} For ${title}, this affects how accurately candidates understand the opportunity.`,
        question: `What should candidates see for ${label.toLowerCase()}?`,
        candidateImpact: `Your answer keeps ${label.toLowerCase()} accurate and clear for candidates.`,
      };
  }
}

const resolutionForFields = (
  fields: JobImportField[],
  canonicalValues: ImportCanonicalValues,
  manuallyChanged: ReadonlySet<string>
): string | null => {
  const resolvedField = fields.find(
    (field) =>
      ["confirmed", "edited"].includes(field.review_status) ||
      manuallyChangedField(field, manuallyChanged)
  );
  if (!resolvedField) {
    return fields.every((field) => field.review_status === "rejected") ? "Saved for later" : null;
  }
  const value = currentValue(resolvedField, canonicalValues);
  return valueIsEmpty(value) ? "Updated in the draft" : conciseImportValue(value);
};

export function buildJobImportGuidanceTurns(
  draft: JobImportDraft,
  context: JobImportGuidanceContext
): JobImportGuidanceTurn[] {
  const canonicalValues = context.canonicalValues ?? {};
  const manuallyChanged = context.manuallyChanged ?? new Set<string>();
  const roleText = `${context.roleName ?? ""} ${context.jobTitle ?? ""}`.toLowerCase();
  const fieldsByGroup = new Map<string, JobImportField[]>();

  for (const field of draft.fields) {
    if (!importFieldScreen(field.field_path)) continue;
    if (
      field.provenance_state === "missing" &&
      field.missing_requirement === "conditionally_required" &&
      !importConditionalFieldIsActive(field.field_path, draft, canonicalValues)
    ) {
      continue;
    }
    const originallyRelevant = Boolean(
      field.validation_errors.length ||
        field.needs_review ||
        field.requires_confirmation ||
        field.provenance_state === "conflicting_source_values" ||
        field.provenance_state === "missing"
    );
    if (!originallyRelevant) continue;
    const groupId = GROUP_BY_FIELD.get(field.field_path) ?? `field:${field.field_path}`;
    const current = fieldsByGroup.get(groupId) ?? [];
    current.push(field);
    fieldsByGroup.set(groupId, current);
  }

  const turns: JobImportGuidanceTurn[] = [];
  for (const [groupId, fields] of fieldsByGroup) {
    const unresolved = fields.filter(
      (field) => !fieldResolved(field, { canonicalValues, manuallyChanged })
    );
    const essential = fields.some((field) =>
      fieldIsEssential(field, draft, canonicalValues)
    );
    const phase: Exclude<JobImportGuidancePhase, "complete"> = essential
      ? "essential"
      : "quality";
    if (phase === "quality") {
      const promptFields = OPTIONAL_PROMPT_FIELDS[groupId];
      if (
        relevantOptionalScore(groupId, roleText) <= 0 ||
        !promptFields ||
        (!unresolved.some((field) => promptFields.has(field.field_path)) &&
          !fields.some(
            (field) =>
              promptFields.has(field.field_path) &&
              (field.needs_review || field.provenance_state === "missing") &&
              ["confirmed", "edited", "rejected"].includes(field.review_status)
          ))
      ) {
        continue;
      }
    }
    const screen = fields
      .map((field) => importFieldScreen(field.field_path))
      .find((candidate): candidate is RecruiterJobScreen => Boolean(candidate));
    if (!screen) continue;
    const kind = phase === "quality" ? "quality" : unresolvedKind(fields, draft);
    const copy = guidanceCopy(groupId, fields, kind, {
      ...context,
      canonicalValues,
      manuallyChanged,
    });
    const alternatives = fields
      .flatMap((field) => field.conflicting_values)
      .slice(0, 8);
    turns.push({
      id: groupId,
      phase,
      kind,
      fieldPaths: fields.map((field) => field.field_path),
      primaryFieldPath: (unresolved[0] ?? fields[0]).field_path,
      screen,
      ...copy,
      evidence: uniqueEvidence(fields),
      alternatives,
      resolved: unresolved.length === 0,
      resolutionLabel: resolutionForFields(fields, canonicalValues, manuallyChanged),
      canDecideLater: phase === "essential",
      canSkip: phase === "quality",
      priority: turnPriority(fields, phase, draft, canonicalValues),
    });
  }

  const essentialTurns = turns
    .filter((turn) => turn.phase === "essential")
    .sort((left, right) => left.priority - right.priority);
  const qualityTurns = turns
    .filter((turn) => turn.phase === "quality")
    .sort(
      (left, right) =>
        relevantOptionalScore(right.id, roleText) - relevantOptionalScore(left.id, roleText)
    );
  const resolvedQuality = qualityTurns.filter((turn) => turn.resolved);
  const unresolvedQuality = qualityTurns.filter((turn) => !turn.resolved).slice(0, 3);
  return [...essentialTurns, ...resolvedQuality, ...unresolvedQuality];
}

export function nextJobImportGuidanceTurn(
  turns: readonly JobImportGuidanceTurn[],
  currentId?: string | null
): JobImportGuidanceTurn | null {
  const unresolved = turns.filter((turn) => !turn.resolved);
  if (!unresolved.length) return null;
  if (!currentId) return unresolved[0];
  const index = turns.findIndex((turn) => turn.id === currentId);
  return (
    turns.slice(Math.max(0, index + 1)).find((turn) => !turn.resolved) ??
    unresolved[0]
  );
}

export function jobImportGuidancePhase(
  turns: readonly JobImportGuidanceTurn[]
): JobImportGuidancePhase {
  if (turns.some((turn) => turn.phase === "essential" && !turn.resolved)) return "essential";
  if (turns.some((turn) => turn.phase === "quality" && !turn.resolved)) return "quality";
  return "complete";
}
