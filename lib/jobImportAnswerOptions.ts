/**
 * Likely answers the assistant can offer instead of an empty box.
 *
 * A question with a text field asks the recruiter to do the thinking. Most of
 * these fields have a small, known set of sensible answers — the product's own
 * taxonomy — so the assistant should show them and let one click settle it.
 * Free text is reserved for the genuinely open cases: reference links, a
 * channel description, a list of responsibilities.
 *
 * Options are derived from the shared taxonomy arrays wherever one exists, so
 * adding a compensation unit or engagement type surfaces here automatically
 * rather than drifting out of sync with the Post Job form.
 */

import {
  DELIVERABLE_FREQUENCIES,
  DELIVERABLE_TYPES,
  ENGAGEMENT_TYPES,
  HIRING_PROCESS_STAGES,
  SOURCE_INPUT_TYPES,
  TURNAROUND_UNITS,
  type CompensationUnit,
  type EngagementType,
} from "./jobContract.ts";

export type AnswerOption = {
  value: string;
  label: string;
  /** Short consequence, shown under the label when it earns its space. */
  detail?: string;
};

/** Context the assistant already knows, used to order and filter options. */
export type AnswerOptionContext = {
  jobTitle?: string | null;
  roleName?: string | null;
  engagementType?: string | null;
  platforms?: readonly string[];
};

const sentence = (value: string) =>
  value.replace(/_/g, " ").replace(/^./, (letter) => letter.toUpperCase());

const ENGAGEMENT_LABELS: Readonly<Record<EngagementType, string>> = {
  one_time_project: "One-off project",
  ongoing_freelance: "Ongoing freelance",
  retainer: "Monthly retainer",
  part_time: "Part-time",
  full_time: "Full-time",
  fixed_term: "Fixed term",
  internship: "Internship",
};

/**
 * Units that actually make sense for creator work, in the order a recruiter is
 * likely to want them. The full list includes several that only apply to
 * specific crafts, so the role narrows it below.
 */
const COMMON_UNITS: readonly CompensationUnit[] = [
  "per month",
  "per video",
  "per project",
  "per hour",
  "per deliverable",
  "per week",
];

const ROLE_UNIT_HINTS: ReadonlyArray<{ match: RegExp; units: readonly CompensationUnit[] }> = [
  { match: /thumbnail|designer/i, units: ["per thumbnail", "per month", "per project"] },
  { match: /script|writer/i, units: ["per script", "per project", "per month"] },
  { match: /podcast|audio/i, units: ["per episode", "per month", "per hour"] },
  { match: /short|reel/i, units: ["per short", "per video", "per month"] },
  { match: /editor|editing/i, units: ["per video", "per month", "per project"] },
];

const STATIC_OPTIONS: Readonly<Record<string, readonly AnswerOption[]>> = {
  work_mode: [
    { value: "remote", label: "Remote", detail: "Anyone, anywhere." },
    { value: "hybrid", label: "Hybrid", detail: "Some time on site." },
    { value: "onsite", label: "On-site", detail: "Based at one location." },
  ],
  compensation_mode: [
    { value: "fixed", label: "A fixed amount" },
    { value: "range", label: "A range" },
    { value: "negotiable", label: "Negotiable", detail: "Agree it with the candidate." },
  ],
  budget_currency: [
    { value: "INR", label: "INR ₹" },
    { value: "USD", label: "USD $" },
    { value: "EUR", label: "EUR €" },
    { value: "GBP", label: "GBP £" },
  ],
  trial_status: [
    { value: "none", label: "No trial", detail: "Hire straight from the application." },
    { value: "paid", label: "Paid trial", detail: "A short paid piece of work first." },
    { value: "unpaid", label: "Unpaid trial", detail: "Needs explicit confirmation." },
  ],
  revision_policy: [
    { value: "fixed", label: "A set number of rounds" },
    { value: "unlimited", label: "Unlimited", detail: "Until you are happy." },
    { value: "negotiable", label: "Agree per project" },
  ],
  revision_rounds: [
    { value: "1", label: "1 round" },
    { value: "2", label: "2 rounds" },
    { value: "3", label: "3 rounds" },
  ],
  start_timing: [
    { value: "immediate", label: "As soon as possible" },
    { value: "within_two_weeks", label: "Within two weeks" },
    { value: "flexible", label: "Flexible" },
    { value: "specific_date", label: "A specific date" },
  ],
  start_timeframe: [
    { value: "ASAP", label: "As soon as possible" },
    { value: "<1mo", label: "Within one month" },
    { value: "<2mo", label: "Within two months" },
    { value: "<3mo", label: "Within three months" },
    { value: "Flexible", label: "Flexible" },
  ],
  duration_type: [
    { value: "ongoing", label: "Ongoing", detail: "No planned end date." },
    { value: "fixed_period", label: "A fixed period" },
    { value: "project_based", label: "Until the project ends" },
    { value: "flexible", label: "Flexible" },
  ],
  creative_autonomy: [
    { value: "follow_established_style", label: "Follow our established style" },
    { value: "guided_by_references", label: "Work from references" },
    { value: "collaborative_direction", label: "Decide direction together" },
    { value: "own_creative_approach", label: "Own the creative approach" },
  ],
  employer_context_type: [
    { value: "creator", label: "Creator / channel" },
    { value: "agency", label: "Agency" },
    { value: "brand", label: "Brand" },
    { value: "production_house", label: "Production house" },
  ],
  expected_weekly_hours_min: [
    { value: "10", label: "About 10 hours" },
    { value: "20", label: "About 20 hours" },
    { value: "30", label: "About 30 hours" },
    { value: "40", label: "Full-time, ~40 hours" },
  ],
  turnaround_value: [
    { value: "1", label: "1" },
    { value: "2", label: "2" },
    { value: "3", label: "3" },
    { value: "5", label: "5" },
  ],
};

/**
 * Fields the model stores as structured rows, offered as pick-lists.
 *
 * These are the ones that produced "That answer is not valid for this detail":
 * hiring_process is a list of stage objects, so a typed sentence could never be
 * accepted. Offering a text box for them guaranteed the error. Picking from the
 * real taxonomy makes an invalid answer unexpressible instead of rejected.
 */
export const MULTI_SELECT_FIELDS: ReadonlySet<string> = new Set([
  "hiring_process",
  "source_inputs",
  "deliverables",
]);

const STAGE_LABELS: Readonly<Record<string, string>> = {
  application_review: "Review applications",
  portfolio_review: "Review portfolios",
  screening_call: "Screening call",
  interview: "Interview",
  assessment: "Skills assessment",
  paid_trial: "Paid trial",
  unpaid_trial: "Unpaid trial",
  final_discussion: "Final discussion",
  offer: "Offer",
};

const SOURCE_INPUT_LABELS: Readonly<Record<string, string>> = {
  raw_footage: "Raw footage",
  script: "Script",
  research: "Research",
  creative_brief: "Creative brief",
  brand_guidelines: "Brand guidelines",
  reference_videos: "Reference videos",
  thumbnail_assets: "Thumbnail assets",
  music_or_stock_subscription: "Music / stock",
  voice_over: "Voice-over",
  project_files: "Project files",
  analytics_access: "Analytics access",
  account_access: "Account access",
  product_footage: "Product footage",
};

const DELIVERABLE_LABELS: Readonly<Record<string, string>> = {
  long_form_video: "Long-form video",
  short: "Short / Reel",
  thumbnail: "Thumbnail",
  script: "Script",
  episode: "Podcast episode",
  post: "Social post",
  graphic: "Graphic",
};

/** Choices for a structured field, or an empty list when it is not one. */
export function multiSelectOptionsFor(fieldPath: string): AnswerOption[] {
  if (fieldPath === "hiring_process") {
    return HIRING_PROCESS_STAGES.filter((stage) => stage !== "other").map((value) => ({
      value,
      label: STAGE_LABELS[value] ?? sentence(value),
    }));
  }
  if (fieldPath === "source_inputs") {
    return SOURCE_INPUT_TYPES.filter((type) => type !== "other").map((value) => ({
      value,
      label: SOURCE_INPUT_LABELS[value] ?? sentence(value),
    }));
  }
  if (fieldPath === "deliverables") {
    return DELIVERABLE_TYPES.filter((type) => type !== "other")
      .slice(0, 8)
      .map((value) => ({
        value,
        label: DELIVERABLE_LABELS[value] ?? sentence(value),
      }));
  }
  return [];
}

/**
 * Build the structured value the model expects from the picked keys.
 *
 * Keeping the shaping beside the options is what stops the two drifting apart
 * and reintroducing the rejection this replaced.
 */
export type DeliverableAnswerDetail = {
  quantity?: string | number;
  frequency?: string;
  customFrequency?: string;
};

export type StructuredAnswerContext = {
  deliverables?: Readonly<Record<string, DeliverableAnswerDetail>>;
  sensitiveAccessConfirmed?: boolean;
};

const SENSITIVE_SOURCE_INPUTS = new Set(["analytics_access", "account_access"]);

/** Custom labels must not provide a back door around access confirmation. */
export function sourceInputLabelNeedsSensitiveConfirmation(label: string): boolean {
  return /\b(?:accounts?|admins?|administrators?|credentials?|log[ -]?ins?|log\s+(?:in|into|on(?:to)?)|passwords?|permissions?|sign\s+(?:in|into|on(?:to)?)|workspaces?|ownership|api\s+keys?|oauth\s+tokens?|2fa\s+codes?|two[- ]factor\s+codes?|session\s+cookies?|private\s+keys?|secret\s+tokens?|business\s+manager\s+invites?)\b|\b(?:(?:account|analytics|channel|profile|platform|workspace|dashboard|cms|admin|administrator|website|backend|portal|youtube|instagram|tiktok|facebook|linkedin|google\s+drive|dropbox|notion|slack|email|inbox|business\s+manager)\s+access|access\s+(?:to|for)\s+(?:the\s+)?(?:account|analytics|channel|profile|platform|workspace|dashboard|cms|website|backend|portal|youtube|instagram|tiktok|facebook|linkedin|google\s+drive|dropbox|notion|slack|email|inbox|business\s+manager))\b|\b(?:add|invite|grant)\s+(?:an?\s+)?(?:editor|manager|admin|administrator|user|member)\b/iu.test(label);
}

/** Frequencies the inline deliverable composer can persist without translation. */
export const DELIVERABLE_FREQUENCY_OPTIONS: readonly AnswerOption[] =
  DELIVERABLE_FREQUENCIES.map((value) => ({
    value,
    label:
      value === "one_time"
        ? "One time"
        : value === "ongoing"
          ? "Ongoing / as needed"
          : value === "other"
            ? "Another cadence"
            : sentence(value),
  }));

function deliverableRow(
  type: string,
  detail: DeliverableAnswerDetail | undefined,
  customType?: string
): Record<string, unknown> | null {
  const quantity = Number(detail?.quantity);
  const frequency = detail?.frequency?.trim() ?? "";
  const customFrequency = detail?.customFrequency?.trim() ?? "";
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10_000 || !frequency) {
    return null;
  }
  if (!DELIVERABLE_FREQUENCIES.includes(frequency as never)) return null;
  if (
    frequency === "other" &&
    (!customFrequency ||
      customFrequency.length > 80 ||
      looksLikePlaceholder(customFrequency))
  ) {
    return null;
  }

  return {
    type,
    ...(type === "other" ? { custom_type: customType } : {}),
    quantity,
    frequency,
    ...(frequency === "other" ? { custom_frequency: customFrequency } : {}),
  };
}

/**
 * Build only complete, recruiter-supplied structured rows.
 *
 * Deliverable quantity/cadence and sensitive-access consent are business facts;
 * this helper deliberately returns null instead of inventing either one.
 */
export function shapeMultiSelect(
  fieldPath: string,
  selected: readonly string[],
  context: StructuredAnswerContext = {}
): Array<Record<string, unknown>> | null {
  const unique = [...new Set(selected)];
  if (fieldPath === "hiring_process") {
    if (
      unique.some(
        (stage) =>
          stage === "other" || !HIRING_PROCESS_STAGES.includes(stage as never)
      )
    ) {
      return null;
    }
    return unique.map((stage) => ({ stage }));
  }
  if (fieldPath === "source_inputs") {
    if (
      unique.some(
        (type) => type === "other" || !SOURCE_INPUT_TYPES.includes(type as never)
      ) ||
      (unique.some((type) => SENSITIVE_SOURCE_INPUTS.has(type)) &&
      context.sensitiveAccessConfirmed !== true
      )
    ) {
      return null;
    }
    return unique.map((type) => ({
      type,
      ...(SENSITIVE_SOURCE_INPUTS.has(type)
        ? { sensitive_access_confirmed: true }
        : {}),
    }));
  }
  if (fieldPath === "deliverables") {
    if (
      unique.some(
        (type) => type === "other" || !DELIVERABLE_TYPES.includes(type as never)
      )
    ) {
      return null;
    }
    const rows = unique.map((type) =>
      deliverableRow(type, context.deliverables?.[type])
    );
    return rows.every((row): row is Record<string, unknown> => row !== null)
      ? rows
      : null;
  }
  return [];
}

/**
 * Shape a native list-of-strings picker without pretending it is a structured
 * row catalog. Catalog choices are shortcuts; an open custom value can sit
 * beside them, and case-insensitive duplicates are removed before submission.
 */
export function shapeStringMultiSelect(
  selected: readonly string[],
  customValue?: string
): string[] | null {
  const candidates = [...selected, ...(customValue === undefined ? [] : [customValue])];
  const values: string[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const normalized = candidate.trim().replace(/\s+/g, " ");
    const key = normalized.toLocaleLowerCase();
    if (
      normalized.length < 2 ||
      normalized.length > 40 ||
      looksLikePlaceholder(normalized)
    ) {
      return null;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    values.push(normalized);
  }
  return values.length > 0 ? values : null;
}

const structuredRows = (value: unknown): Array<Record<string, unknown>> | null => {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some(
      (row) => row === null || typeof row !== "object" || Array.isArray(row)
    )
  ) {
    return null;
  }
  return value as Array<Record<string, unknown>>;
};

/** Whether accepting a structured value would assert sensitive access. */
export function structuredAnswerNeedsSensitiveConfirmation(
  fieldPath: string,
  value: unknown
): boolean {
  if (fieldPath !== "source_inputs" || !Array.isArray(value)) return false;
  return value.some((item) => {
    if (typeof item === "string") return SENSITIVE_SOURCE_INPUTS.has(item);
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      return false;
    }
    const type = (item as Record<string, unknown>).type;
    const customLabel = (item as Record<string, unknown>).custom_label;
    return (
      (typeof type === "string" && SENSITIVE_SOURCE_INPUTS.has(type)) ||
      (type === "other" &&
        typeof customLabel === "string" &&
        sourceInputLabelNeedsSensitiveConfirmation(customLabel))
    );
  });
}

/**
 * Validate and sanitize a server-suggested structured answer before a one-click
 * accept action can send it back.
 *
 * Suggestions can outlive the schema version that created them. Rebuilding the
 * rows here prevents an incomplete deliverable, unknown stage, or provider-set
 * sensitive-access flag from becoming an apparently successful recruiter
 * answer. Sensitive access always requires this session's explicit checkbox.
 */
export function shapeStructuredAnswer(
  fieldPath: string,
  value: unknown,
  context: StructuredAnswerContext = {}
): Array<Record<string, unknown>> | null {
  const rows = structuredRows(value);
  if (!rows) return null;

  if (fieldPath === "hiring_process") {
    const shaped: Array<Record<string, unknown> | null> = rows.map((row) => {
      const stage = typeof row.stage === "string" ? row.stage : "";
      if (!HIRING_PROCESS_STAGES.includes(stage as never)) return null;
      if (stage !== "other") return { stage };
      const label =
        typeof row.custom_label === "string"
          ? row.custom_label.trim().replace(/\s+/g, " ")
          : "";
      return label.length >= 2 && label.length <= 80 && !looksLikePlaceholder(label)
        ? { stage, custom_label: label }
        : null;
    });
    return shaped.every((row): row is Record<string, unknown> => row !== null)
      ? shaped
      : null;
  }

  if (fieldPath === "source_inputs") {
    if (
      structuredAnswerNeedsSensitiveConfirmation(fieldPath, rows) &&
      context.sensitiveAccessConfirmed !== true
    ) {
      return null;
    }
    const shaped: Array<Record<string, unknown> | null> = rows.map((row) => {
      const type = typeof row.type === "string" ? row.type : "";
      if (!SOURCE_INPUT_TYPES.includes(type as never)) return null;
      if (type === "other") {
        const label =
          typeof row.custom_label === "string"
            ? row.custom_label.trim().replace(/\s+/g, " ")
            : "";
        return label.length >= 2 && label.length <= 80 && !looksLikePlaceholder(label)
          ? {
              type,
              custom_label: label,
              ...(sourceInputLabelNeedsSensitiveConfirmation(label)
                ? { sensitive_access_confirmed: true }
                : {}),
            }
          : null;
      }
      return {
        type,
        ...(SENSITIVE_SOURCE_INPUTS.has(type)
          ? { sensitive_access_confirmed: true }
          : {}),
      };
    });
    return shaped.every((row): row is Record<string, unknown> => row !== null)
      ? shaped
      : null;
  }

  if (fieldPath === "deliverables") {
    const shaped = rows.map((row) => {
      const type = typeof row.type === "string" ? row.type : "";
      if (!DELIVERABLE_TYPES.includes(type as never)) return null;
      const customType =
        typeof row.custom_type === "string"
          ? row.custom_type.trim().replace(/\s+/g, " ")
          : "";
      if (
        type === "other" &&
        (!customType || customType.length > 80 || looksLikePlaceholder(customType))
      ) {
        return null;
      }
      return deliverableRow(
        type,
        {
          quantity:
            typeof row.quantity === "number" || typeof row.quantity === "string"
              ? row.quantity
              : undefined,
          frequency: typeof row.frequency === "string" ? row.frequency : undefined,
          customFrequency:
            typeof row.custom_frequency === "string"
              ? row.custom_frequency
              : undefined,
        },
        customType || undefined
      );
    });
    return shaped.every((row): row is Record<string, unknown> => row !== null)
      ? shaped
      : null;
  }

  return null;
}

/** Shape either the compact key list or the persisted row form of a suggestion. */
export function shapeStructuredCandidateAnswer(
  fieldPath: string,
  value: unknown,
  context: StructuredAnswerContext = {}
): Array<Record<string, unknown>> | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  if (value.every((item): item is string => typeof item === "string")) {
    return shapeMultiSelect(fieldPath, value, context);
  }
  return shapeStructuredAnswer(fieldPath, value, context);
}

/** Shape one valid `other` row for a structured open field. */
export function shapeCustomStructuredAnswer(
  fieldPath: string,
  label: string,
  context: StructuredAnswerContext = {}
): Record<string, unknown> | null {
  const trimmed = label.trim().replace(/\s+/g, " ");
  if (trimmed.length < 2 || trimmed.length > 80 || looksLikePlaceholder(trimmed)) {
    return null;
  }
  if (fieldPath === "hiring_process") {
    return { stage: "other", custom_label: trimmed };
  }
  if (fieldPath === "source_inputs") {
    const sensitive = sourceInputLabelNeedsSensitiveConfirmation(trimmed);
    if (sensitive && context.sensitiveAccessConfirmed !== true) return null;
    return {
      type: "other",
      custom_label: trimmed,
      ...(sensitive ? { sensitive_access_confirmed: true } : {}),
    };
  }
  if (fieldPath === "deliverables") {
    return deliverableRow(
      "other",
      context.deliverables?.__custom__,
      trimmed
    );
  }
  return null;
}

/**
 * Fields where a list of options would be a guess dressed as help.
 *
 * Reference links, a channel description, a list of responsibilities — these
 * are the recruiter's own words and cannot be offered from a menu.
 */
export const FREE_TEXT_FIELDS: ReadonlySet<string> = new Set([
  "reference_videos",
  "about_channel",
  "responsibilities",
  "requirements",
  "budget_note",
  "budget_amount",
  "budget_max",
  "title",
  "role_specialization",
  "external_apply_url",
  "how_to_apply",
]);

/** Likely answers for a field, or an empty list when free text is honest. */
export function answerOptionsFor(
  fieldPath: string,
  context: AnswerOptionContext = {}
): AnswerOption[] {
  if (FREE_TEXT_FIELDS.has(fieldPath)) return [];
  if (MULTI_SELECT_FIELDS.has(fieldPath)) return [];

  if (fieldPath === "engagement_type") {
    return ENGAGEMENT_TYPES.map((value) => ({
      value,
      label: ENGAGEMENT_LABELS[value] ?? sentence(value),
    }));
  }

  if (fieldPath === "budget_unit") {
    const roleText = `${context.roleName ?? ""} ${context.jobTitle ?? ""}`;
    const hinted = ROLE_UNIT_HINTS.find((hint) => hint.match.test(roleText))?.units;
    // Role-specific units first, then the common ones, without repeats.
    const ordered = [...(hinted ?? []), ...COMMON_UNITS].filter(
      (unit, index, all) => all.indexOf(unit) === index
    );
    return ordered.slice(0, 6).map((value) => ({ value, label: value }));
  }

  if (fieldPath === "turnaround_unit") {
    return TURNAROUND_UNITS.map((value) => ({ value, label: sentence(value) }));
  }

  return [...(STATIC_OPTIONS[fieldPath] ?? [])];
}

/** True when the assistant can offer choices rather than an empty box. */
export function hasAnswerOptions(
  fieldPath: string,
  context: AnswerOptionContext = {}
): boolean {
  return answerOptionsFor(fieldPath, context).length > 0;
}

/**
 * Controlled choices that remain safer than a free-text control when an older
 * server describes the underlying field as plain text.
 *
 * `start_timeframe` predates the canonical start-timing enum, so its schema is
 * intentionally still a string for compatibility. That storage detail must not
 * turn "When should this person start?" into a box that accepts arbitrary text.
 * Keep this exception narrow: genuinely open text fields still need the
 * recruiter's own words.
 */
export function controlledAnswerOptionsFor(
  fieldPath: string,
  serverKind: string | undefined,
  context: AnswerOptionContext = {}
): AnswerOption[] {
  const options = answerOptionsFor(fieldPath, context);
  if (!serverKind) return options;
  if (fieldPath === "start_timeframe" && serverKind === "text") return options;
  return [];
}

/**
 * How each field is asked about, in words a recruiter uses.
 *
 * Registry labels are written for a form: "Earlier start window" makes sense
 * beside an input and is nonsense spoken aloud. Templating them into
 * "What should {label} be?" produced questions no person would ask, so the
 * fields the assistant actually raises get phrasing of their own.
 */
const QUESTION_PHRASES: Readonly<Record<string, { heading: string; prompt: string }>> = {
  start_timeframe: {
    heading: "When should this person start?",
    prompt: "Candidates use this to check the timing works for them.",
  },
  start_timing: {
    heading: "When should this person start?",
    prompt: "Candidates use this to check the timing works for them.",
  },
  start_date: {
    heading: "Which date should it start on?",
    prompt: "You chose a specific date, so this is the one candidates will see.",
  },
  location: {
    heading: "Where is this role based?",
    prompt: "It decides who can realistically apply.",
  },
  primary_role_key: {
    // Only ever asked when the source named several crafts and none of them
    // dominates. A listing filed under the wrong craft is shown to the wrong
    // people, and that is not something the recruiter can see and correct later.
    heading: "Which craft is this role mainly for?",
    prompt: "The listing names a few, and this is the one candidates search by.",
  },
  experience_level: {
    heading: "How much experience should candidates already have?",
    prompt: "Candidates filter on this before they read anything else.",
  },
  content_niches: {
    heading: "What subjects does this content cover?",
    prompt: "Editors who know the subject need far less direction.",
  },
  trial_work_usage: {
    heading: "Can you use the work from the trial?",
    prompt: "Unpaid work someone else publishes is the thing candidates check for.",
  },
  trial_portfolio_permission: {
    heading: "Can candidates show their trial work in their portfolio?",
    prompt: "For a freelancer, work they cannot show is worth much less.",
  },
  unpaid_trial_confirmed: {
    heading: "Confirm this trial is unpaid",
    prompt: "Unpaid work has to be stated plainly before anyone commits time.",
  },
  work_mode: {
    heading: "Where will this person work?",
    prompt: "It decides who can realistically apply.",
  },
  budget_currency: {
    heading: "Which currency should the pay be shown in?",
    prompt: "A figure without a currency is read differently by everyone.",
  },
  budget_unit: {
    heading: "How is the pay measured?",
    prompt: "Per video and per month describe very different offers.",
  },
  compensation_mode: {
    heading: "How is this role paid?",
    prompt: "Candidates compare the offer against the workload.",
  },
  trial_status: {
    heading: "Is there a trial before the hire?",
    prompt: "Candidates want to know before they commit time.",
  },
  engagement_type: {
    heading: "What kind of engagement is this?",
    prompt: "It sets expectations about commitment and stability.",
  },
  expected_weekly_hours_min: {
    heading: "Roughly how many hours a week?",
    prompt: "It lets candidates weigh the workload against the pay.",
  },
  duration_type: {
    heading: "How long does this run for?",
    prompt: "Candidates plan their other work around it.",
  },
  revision_policy: {
    heading: "How many rounds of changes are included?",
    prompt: "An open-ended cycle is the most common source of friction.",
  },
  creative_autonomy: {
    heading: "How much creative latitude does this person have?",
    prompt: "It is often the difference between two very different jobs.",
  },
  employer_context_type: {
    heading: "Who is hiring for this role?",
    prompt: "Creators, agencies and brands work differently.",
  },
  responsibilities: {
    heading: "What will this person actually do?",
    prompt: "Concrete work is easier to judge than a job description.",
  },
  turnaround_value: {
    heading: "How long is there for each piece of work?",
    prompt: "Turnaround decides whether this fits alongside other commitments.",
  },
  requirements: {
    heading: "What must candidates already be able to do?",
    prompt: "Keep it to genuine must-haves so good people do not rule themselves out.",
  },
  hiring_process: {
    heading: "What happens after someone applies?",
    prompt: "Knowing the steps up front is why good candidates finish an application.",
  },
  source_inputs: {
    heading: "What will you hand over to work from?",
    prompt: "It is usually the difference between a two-hour job and a two-day one.",
  },
  deliverables: {
    heading: "What should this person produce?",
    prompt: "Concrete output is what candidates price and plan their week around.",
  },
  budget_amount: {
    heading: "What does the role pay?",
    prompt: "Listings with a real figure get taken seriously; ones without get skipped.",
  },
  reference_videos: {
    heading: "Anything that shows the style you want?",
    prompt: "One link saves a paragraph and a first-round misfire.",
  },
  about_channel: {
    heading: "What should candidates know about you?",
    prompt: "People apply to a channel they can picture, not a job description.",
  },
};

/** Recruiter-facing phrasing for a field, or null to fall back to the label. */
export function questionPhraseFor(
  fieldPath: string
): { heading: string; prompt: string } | null {
  return QUESTION_PHRASES[fieldPath] ?? null;
}


/**
 * A concrete example for a free-text answer.
 *
 * Showing what a good answer looks like is how a text box stops being a guess.
 * An empty placeholder invites something the field cannot accept; an example
 * makes the right shape obvious before anything is typed.
 */
const TEXT_EXAMPLES: Readonly<Record<string, string>> = {
  about_channel:
    "e.g. A weekly personal-finance channel for early-career viewers, around 80k subscribers",
  requirements: "e.g. Confident with pacing and story structure in long-form video",
  responsibilities: "e.g. Edit one 10-minute video each week, from raw footage to final cut",
  reference_videos: "Paste a link to a video whose style you like",
  budget_note: "e.g. Rate reviewed after the first three videos",
  title: "e.g. Video editor for a personal finance channel",
  role_specialization: "e.g. Long-form YouTube editing",
  experience_level: "e.g. 1–7 years, 10+ years, or Experience preferred",
  budget_amount: "e.g. 60000",
  budget_max: "e.g. 80000",
  how_to_apply: "e.g. Share two recent edits and a note on your turnaround",
};

export function textExampleFor(fieldPath: string): string {
  return TEXT_EXAMPLES[fieldPath] ?? "Type your answer…";
}

/**
 * The smallest answer worth sending, so Send stays disabled rather than
 * producing a rejection the recruiter has to interpret.
 */
export function minimumAnswerLength(fieldPath: string): number {
  if (fieldPath === "about_channel") return 20;
  if (fieldPath === "requirements" || fieldPath === "responsibilities") return 8;
  return 1;
}

export type NumericAnswerConstraints = {
  minimum?: number;
  maximum?: number;
  minimum_exclusive?: boolean;
  maximum_exclusive?: boolean;
  integer_only?: boolean;
  step?: number | "any";
};

/** Validate exactly what a numeric answer shape promises. */
export function numericAnswerError(
  value: string,
  constraints: NumericAnswerConstraints = {}
): string | null {
  const normalized = value.trim();
  if (!/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) {
    return "Enter a valid number.";
  }
  const numeric = Number(normalized);
  if (!Number.isFinite(numeric)) return "Enter a valid number.";
  if (constraints.integer_only && !Number.isInteger(numeric)) {
    return "Enter a whole number.";
  }
  if (
    constraints.minimum !== undefined &&
    (constraints.minimum_exclusive
      ? numeric <= constraints.minimum
      : numeric < constraints.minimum)
  ) {
    return constraints.minimum_exclusive
      ? `Enter a number greater than ${constraints.minimum}.`
      : `Enter ${constraints.minimum} or more.`;
  }
  if (
    constraints.maximum !== undefined &&
    (constraints.maximum_exclusive
      ? numeric >= constraints.maximum
      : numeric > constraints.maximum)
  ) {
    return constraints.maximum_exclusive
      ? `Enter a number less than ${constraints.maximum}.`
      : `Enter ${constraints.maximum} or less.`;
  }
  if (
    typeof constraints.step === "number" &&
    constraints.step > 0 &&
    !constraints.integer_only
  ) {
    const base = constraints.minimum ?? 0;
    const units = (numeric - base) / constraints.step;
    if (Math.abs(units - Math.round(units)) > 1e-9) {
      return `Use increments of ${constraints.step}.`;
    }
  }
  return null;
}

/** Reference links accepted in chat are public web URLs, never route-like text. */
export function isHttpUrlAnswer(value: string): boolean {
  try {
    const parsed = new URL(value.trim());
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      Boolean(parsed.hostname) &&
      !parsed.username &&
      !parsed.password
    );
  } catch {
    return false;
  }
}

/** Shape a URL answer or URL-list suggestion into the native list contract. */
export function shapeHttpUrlList(value: unknown): string[] | null {
  const candidates = typeof value === "string" ? [value] : value;
  if (
    !Array.isArray(candidates) ||
    candidates.length === 0 ||
    !candidates.every((item) => typeof item === "string")
  ) {
    return null;
  }
  const unique = [
    ...new Set(candidates.map((item) => item.trim())),
  ];
  return unique.every(isHttpUrlAnswer) ? unique : null;
}

const MEANINGLESS_IMPORT_PHRASES = new Set([
  "asdf",
  "blah",
  "blah blah",
  "dummy text",
  "i dont know",
  "idk",
  "lorem ipsum",
  "n a",
  "na",
  "none",
  "not sure",
  "provided during qa",
  "test",
  "test answer",
  "tbd",
  "todo",
  "unknown",
]);

function looksLikePlaceholder(value: string): boolean {
  const normalized = value.trim().replace(/\s+/g, " ");
  const phraseKey = normalized
    .toLocaleLowerCase()
    .replace(/['’]/gu, "")
    .replace(/[^\p{L}\p{N}_]+/gu, " ")
    .trim();
  if (MEANINGLESS_IMPORT_PHRASES.has(phraseKey)) return true;

  const compact = normalized.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  if (/(.)\1{4,}/u.test(compact)) return true;
  return compact.length >= 8 && new Set(compact).size <= 3;
}

const EXPERIENCE_VALUE =
  /^(?:(minimum(?:\s+of)?|min\.?|at\s+least|up\s+to|maximum(?:\s+of)?|max\.?)\s*)?(\d{1,3})\s*(?:(\+)|(?:-|–|—|to)\s*(\d{1,3}))?\s*(years?|yrs?|months?|mos?)\b(?:\s+(?:of\s+)?(?:[\p{L}\p{N}_'’\-]+\s+){0,5}experience)?$/iu;
const NON_NUMERIC_EXPERIENCE =
  /^(?:(?:strong\s+)?portfolio(?:\s+(?:required|preferred))?[;,: -]+no\s+(?:prior\s+experience|minimum\s+(?:years?|experience))\s+required|no\s+(?:prior\s+)?experience\s+(?:required|needed|necessary)|no\s+minimum\s+(?:years?|experience)\s+required|experience\s+(?:preferred|optional|not\s+required)|fresher(?:s)?|entry[-\s]?level|any\s+(?:experience\s+level|level\s+of\s+experience))$/iu;

/**
 * Validate the short, candidate-facing wording stored in `experience_level`.
 *
 * This field is intentionally not an enum: the source may honestly say
 * "1–7 years", "10+ years", "Fresher", or "Experience preferred". The
 * assistant still should not accept keyboard noise or a malformed/impossible
 * range merely because the database can hold an arbitrary string.
 */
export function experienceAnswerError(value: string): string | null {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) return "Enter a clear experience requirement.";
  if (normalized.length > 64) return "Keep the experience requirement to 64 characters or fewer.";
  if (looksLikePlaceholder(normalized)) {
    return "Enter a real experience requirement rather than placeholder text.";
  }

  if (NON_NUMERIC_EXPERIENCE.test(normalized)) return null;

  const numeric = normalized.match(EXPERIENCE_VALUE);
  if (numeric) {
    const qualifier = (numeric[1] ?? "").toLocaleLowerCase();
    const lower = Number(numeric[2]);
    const plus = Boolean(numeric[3]);
    const upper = numeric[4] === undefined ? null : Number(numeric[4]);
    const inMonths = /^(?:months?|mos?)$/iu.test(numeric[5]);
    const maximum = inMonths ? 600 : 60;

    if (upper !== null && lower > upper) {
      return "Put the lower experience amount before the higher one.";
    }
    if (lower > maximum || (upper !== null && upper > maximum)) {
      return `Keep the experience amount at ${maximum} ${inMonths ? "months" : "years"} or fewer.`;
    }
    if (plus && /^(?:up\s+to|maximum|max\.?)$/iu.test(qualifier)) {
      return "Use either a minimum or a maximum, not both.";
    }
    return null;
  }

  return "Use years or months, or a clear level such as “Fresher” or “Experience preferred”.";
}

/**
 * Reject obvious filler before it can become a candidate-facing requirement or
 * responsibility.
 *
 * This is deliberately a small structural guard, not an attempt to judge the
 * recruiter's prose. These two fields describe work in phrases or sentences; a
 * single token, a long run of one character, or a string made from only a few
 * repeated characters cannot do that. The server remains authoritative and
 * applies the same rule to direct callers.
 */
export function isMeaningfulImportAnswer(fieldPath: string, value: string): boolean {
  if (fieldPath === "experience_level") return experienceAnswerError(value) === null;
  if (fieldPath !== "requirements" && fieldPath !== "responsibilities") return true;

  const normalized = value.trim().replace(/\s+/g, " ");
  if (looksLikePlaceholder(normalized)) return false;

  const words = normalized.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? [];
  if (
    words.length < 2 ||
    new Set(words.map((word) => word.toLocaleLowerCase())).size < 2
  ) {
    return false;
  }

  return true;
}
