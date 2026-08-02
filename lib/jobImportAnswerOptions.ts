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
  ENGAGEMENT_TYPES,
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
    { value: "Within 2 weeks", label: "Within two weeks" },
    { value: "Within 1 month", label: "Within a month" },
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
  "deliverables",
  "source_inputs",
  "hiring_process",
]);

/** Likely answers for a field, or an empty list when free text is honest. */
export function answerOptionsFor(
  fieldPath: string,
  context: AnswerOptionContext = {}
): AnswerOption[] {
  if (FREE_TEXT_FIELDS.has(fieldPath)) return [];

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
  requirements: {
    heading: "What must candidates already be able to do?",
    prompt: "Keep it to genuine must-haves so good people do not rule themselves out.",
  },
  responsibilities: {
    heading: "What will this person actually do?",
    prompt: "Concrete work is easier to judge than a job description.",
  },
  about_channel: {
    heading: "What should candidates know about you?",
    prompt: "A sentence or two about the channel and its audience.",
  },
  reference_videos: {
    heading: "Any examples that show the style?",
    prompt: "One link communicates more than a paragraph of description.",
  },
  deliverables: {
    heading: "What should this person produce, and how often?",
    prompt: "Naming the output lets candidates estimate the commitment.",
  },
  turnaround_value: {
    heading: "How long is there for each piece of work?",
    prompt: "Turnaround decides whether this fits alongside other commitments.",
  },
};

/** Recruiter-facing phrasing for a field, or null to fall back to the label. */
export function questionPhraseFor(
  fieldPath: string
): { heading: string; prompt: string } | null {
  return QUESTION_PHRASES[fieldPath] ?? null;
}
