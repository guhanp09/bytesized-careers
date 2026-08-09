import {
  compensationUnitLabel,
  engagementLabel,
  type CompensationMode,
  type CompensationUnit,
  type CreatorSkillKey,
  type DeliverableFrequency,
  type DeliverableType,
  type EmployerContextType,
  type JobDeliverable,
  type JobHiringProcessStage,
  type JobLanguageRequirement,
  type JobSourceInput,
  type RevisionPolicy,
  type TrialAttribution,
  type TrialPortfolioPermission,
  type TrialStatus,
  type TrialWorkUsage,
} from "./jobContract.ts";
import { getRequirementDef } from "./firstMessageRequirements.ts";
import { findToolCatalogEntry } from "./toolCatalog.ts";
import type { Job } from "./types.ts";

export const cleanJobText = (value?: string | null) => value?.trim() || "";

export const sentenceCaseJobValue = (value: string) =>
  value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

export const uniqueJobText = (items: readonly (string | null | undefined)[]) => {
  const seen = new Set<string>();
  return items
    .map((item) => cleanJobText(item))
    .filter(Boolean)
    .filter((item) => {
      const key = item.toLocaleLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

export const splitJobLines = (value?: string | null) =>
  (value || "")
    .split("\n")
    .map((line) => line.replace(/^\s*[-•]\s*/, "").trim())
    .filter(Boolean);

const hasNumber = (value?: number | string | null): value is number | string =>
  value !== null && value !== undefined && String(value).trim() !== "" && Number.isFinite(Number(value));

export function formatJobMoney(value: number | string, currency?: string | null) {
  const amount = Number(value);
  const code = cleanJobText(currency).toUpperCase();
  if (!Number.isFinite(amount)) return [code, String(value).trim()].filter(Boolean).join(" ");
  if (!code) return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(amount);
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: code,
      maximumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    }).format(amount);
  } catch {
    return `${code} ${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(amount)}`;
  }
}

/**
 * "About Finance Simplified", or "About the brand" when nothing reliable is known.
 *
 * One helper rather than three constructions, because the editor label, the
 * recruiter preview and the candidate heading were already disagreeing: the
 * field is labelled "About the brand" in Post Job and rendered as "About the
 * opportunity" to candidates. It is a brand description in both places, and
 * naming it two different things is the kind of drift that only gets worse
 * once a third surface copies one of them.
 *
 * The name comes from the CreatorJobs hiring identity attached to the job —
 * never from a scraped source employer, which is a different entity and is
 * deliberately kept separate.
 */
export function aboutBrandLabel(brandName?: string | null) {
  const name = cleanJobText(brandName);
  // No truncation: a brand's own name is not ours to shorten. Long names wrap,
  // which is why the heading and the section body both allow it.
  return name ? `About ${name}` : "About the brand";
}

/** Digits in a money phrase, ignoring separators and trailing zero decimals. */
const payFigures = (value: string) =>
  new Set(
    (value.match(/\d[\d,]*(?:\.\d+)?/g) || []).map((figure) =>
      String(Number(figure.replace(/,/g, ""))),
    ),
  );

/**
 * Whether a compensation note says only what the headline already says.
 *
 * Compares the *figures*, because the two are routinely written differently —
 * "₹22,000+ per month" against "From ₹22,000.00 per month" is one fact in two
 * spellings. A note naming a figure the headline does not carry is new
 * information and is kept, so a bonus or a second rate is never suppressed.
 */
function noteOnlyRestatesPay(note: string, headline: string) {
  const inNote = payFigures(note);
  if (inNote.size === 0) return false;
  const inHeadline = payFigures(headline);
  if (inHeadline.size === 0) return false;
  for (const figure of inNote) {
    if (!inHeadline.has(figure)) return false;
  }
  // Words the note adds beyond pay vocabulary make it more than a restatement.
  const extra = note
    .toLocaleLowerCase()
    .replace(/\d[\d,]*(?:\.\d+)?/g, " ")
    .match(/[\p{L}]{3,}/gu);
  const PAY_WORDS = new Set([
    "the", "post", "also", "states", "state", "says", "say", "listing",
    "source", "original", "according", "per", "month", "monthly", "year",
    "yearly", "annum", "annually", "hour", "hourly", "week", "weekly", "day",
    "daily", "project", "video", "post", "episode", "from", "upto", "and",
    "between", "starting", "minimum", "maximum", "about", "approximately",
    "around", "inr", "usd", "eur", "gbp", "rupees", "dollars", "salary", "pay",
    "compensation", "budget", "rate", "stipend",
  ]);
  return (extra || []).every((word) => PAY_WORDS.has(word));
}

export type JobCompensationPresentation = {
  headline: string;
  note: string;
  disclosed: boolean;
  outputBased: boolean;
  unitLabel: string;
  legacy: boolean;
};

const OUTPUT_COMPENSATION_UNITS = new Set([
  "per deliverable",
  "per video",
  "per short",
  "per thumbnail",
  "per script",
  "per episode",
  "per post",
]);

export function formatJobCompensation(input: {
  mode?: CompensationMode | string | null;
  minimum?: number | string | null;
  maximum?: number | string | null;
  currency?: string | null;
  unit?: CompensationUnit | string | null;
  customUnit?: string | null;
  note?: string | null;
  legacyDisplay?: string | null;
}): JobCompensationPresentation {
  const mode = cleanJobText(input.mode);
  const unit = cleanJobText(input.unit);
  const customUnit = cleanJobText(input.customUnit);
  const rawNote = cleanJobText(input.note);
  const legacyDisplay = cleanJobText(input.legacyDisplay);
  const minimum = input.minimum;
  const maximum = input.maximum;
  const knownUnit = unit as CompensationUnit;
  const unitLabel =
    unit === "custom"
      ? customUnit
      : unit
        ? compensationUnitLabel(knownUnit) || sentenceCaseJobValue(unit)
        : "";
  const hasMinimum = hasNumber(minimum);
  const hasMaximum = hasNumber(maximum);
  const suffix = unitLabel && unit !== "commission" && unit !== "mixed" ? ` ${unitLabel}` : "";
  let headline = "";

  if (unit === "commission") {
    headline = "Commission-based";
  } else if (unit === "mixed") {
    headline = hasMinimum && hasMaximum
      ? `Mixed compensation · ${formatJobMoney(minimum, input.currency)}–${formatJobMoney(maximum, input.currency)} base`
      : hasMinimum
        ? `Mixed compensation · ${formatJobMoney(minimum, input.currency)} base`
        : "Mixed compensation";
  } else if (mode === "approximate" && hasMinimum) {
    // A figure the employer declined to stand behind exactly. Its own mode, so
    // it is never reported as an exact rate and never as a range.
    headline = `About ${formatJobMoney(minimum, input.currency)}${suffix}`;
  } else if (mode === "range" && hasMinimum && hasMaximum) {
    headline =
      Number(minimum) === Number(maximum)
        ? // A genuine range whose ends happen to coincide. Printing
          // "₹20,000–₹20,000" is technically true and obviously wrong.
          `About ${formatJobMoney(minimum, input.currency)}${suffix}`
        : `${formatJobMoney(minimum, input.currency)}–${formatJobMoney(
            maximum,
            input.currency,
          )}${suffix}`;
  } else if (mode === "range" && hasMinimum) {
    // A floor with no ceiling. "₹20,000+" is what the employer promised, and
    // dropping the "+" reports a maximum they never agreed to.
    headline = `${formatJobMoney(minimum, input.currency)}+${suffix}`;
  } else if (mode === "fixed" && hasMinimum) {
    headline = `${formatJobMoney(minimum, input.currency)}${suffix}`;
  } else if (mode === "negotiable") {
    headline = unitLabel ? `Negotiable · ${unitLabel}` : "Negotiable";
  } else if (hasMaximum && !hasMinimum) {
    // A ceiling with no floor. Job pages write pay this way constantly — "Up to
    // ₹20,000 a month" — and with no branch for it the whole compensation read
    // as "Compensation not specified" while a stray "Up to" sat in the note
    // beside it. Saying what the page said is better than saying nothing and
    // better than promoting the ceiling into a flat rate.
    //
    // Below `negotiable` on purpose: a negotiable job carries no amounts, and a
    // stray maximum must not turn it into a figure.
    headline = `Up to ${formatJobMoney(maximum, input.currency)}${suffix}`;
  } else if (hasMinimum && !hasMaximum) {
    // Same shape from the other side, for a job stored without a mode.
    headline = `${formatJobMoney(minimum, input.currency)}+${suffix}`;
  } else if (hasMinimum && hasMaximum) {
    headline = `${formatJobMoney(minimum, input.currency)}–${formatJobMoney(
      maximum,
      input.currency,
    )}${suffix}`;
  } else if (hasMinimum) {
    headline = `${formatJobMoney(minimum, input.currency)}${suffix}`;
  }

  // A note that only repeats the headline is noise, and a note that is a
  // *fragment* of it is worse than noise. An imported listing reading "Up to
  // ₹20,000 a month" arrived with a stray note of "Up to", which rendered as
  // "Compensation not specified · Up to" — a qualifier with nothing to qualify.
  // Callers join the two with "·", so the check belongs here rather than in
  // each of them.
  const comparable = (value: string) =>
    value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const restatesHeadline =
    Boolean(rawNote) && comparable(headline).includes(comparable(rawNote));
  // The same suppression, judged by the figures rather than the spelling.
  // A candidate saw "₹22,000+ per month · The post also states: From ₹22,000.00
  // per month." — one fact, written twice, the second time in the import's own
  // voice. The import path now strips that at source; this covers rows already
  // stored, and anything a future path forgets.
  const note =
    rawNote && (restatesHeadline || noteOnlyRestatesPay(rawNote, headline))
      ? ""
      : rawNote;

  if (!headline && legacyDisplay && legacyDisplay !== "Compensation not specified") {
    return {
      headline: legacyDisplay,
      note,
      disclosed: true,
      outputBased: OUTPUT_COMPENSATION_UNITS.has(unit),
      unitLabel,
      legacy: true,
    };
  }

  return {
    headline: headline || "Compensation not specified",
    note,
    disclosed: Boolean(headline || note),
    outputBased: OUTPUT_COMPENSATION_UNITS.has(unit),
    unitLabel,
    legacy: false,
  };
}

export const compensationForJob = (job: Job) =>
  formatJobCompensation({
    mode: job.compensationMode,
    minimum: job.budgetAmount,
    maximum: job.budgetMax,
    currency: job.budgetCurrency,
    unit: job.budgetUnit,
    customUnit: job.budgetUnitCustom,
    note: job.budgetNote,
    legacyDisplay: job.budget,
  });

export function roleForJob(job: Job) {
  const canonical = cleanJobText(job.primaryRoleName);
  const specialization = cleanJobText(job.roleSpecialization);
  const legacy = cleanJobText(job.legacyCategory || job.category);
  const fallback = legacy && legacy !== "Uncategorized" ? legacy : "";
  return {
    name: canonical || fallback || "Role not specified",
    specialization,
    canonical: Boolean(canonical),
    legacy: !canonical && Boolean(fallback),
  };
}

export function engagementForJob(job: Pick<Job, "engagementType" | "contractType" | "type">) {
  const canonical = cleanJobText(job.engagementType);
  if (canonical) {
    return engagementLabel(canonical as Parameters<typeof engagementLabel>[0]) || sentenceCaseJobValue(canonical);
  }
  return cleanJobText(job.contractType || job.type) || "Engagement not specified";
}

export function workSetupForJob(job: Pick<Job, "workMode" | "location">) {
  const mode = cleanJobText(job.workMode);
  const location = cleanJobText(job.location);
  const modeLabel = mode ? (mode.toLowerCase() === "onsite" ? "On-site" : sentenceCaseJobValue(mode)) : "";
  return [modeLabel, location].filter(Boolean).join(" · ") || "Work setup not specified";
}

export function formatWeeklyHours(minimum?: number | string | null, maximum?: number | string | null) {
  const min = hasNumber(minimum) ? Number(minimum) : null;
  const max = hasNumber(maximum) ? Number(maximum) : null;
  if (min !== null && max !== null && min !== max) return `${min}–${max} hours per week`;
  if (min !== null || max !== null) return `${min ?? max} hours per week`;
  return "Weekly hours not specified";
}

const TURNAROUND_UNITS: Record<string, string> = {
  hours: "hours",
  business_days: "business days",
  calendar_days: "calendar days",
  weeks: "weeks",
};
const TURNAROUND_BASES: Record<string, string> = {
  per_deliverable: "per deliverable",
  batch: "per batch",
  first_draft: "to first draft",
  final_delivery: "to final delivery",
};

export function formatTurnaround(
  value?: number | string | null,
  unit?: string | null,
  basis?: string | null,
) {
  if (!hasNumber(value) || !cleanJobText(unit)) return "Turnaround not specified";
  const unitLabel = TURNAROUND_UNITS[cleanJobText(unit)] || cleanJobText(unit).replaceAll("_", " ");
  const basisLabel = TURNAROUND_BASES[cleanJobText(basis)] || cleanJobText(basis).replaceAll("_", " ");
  return `${value} ${unitLabel}${basisLabel ? ` ${basisLabel}` : ""}`;
}

export function formatJobDate(value?: string | null, includeTime = false) {
  const raw = cleanJobText(value);
  if (!raw) return "";
  const date = new Date(raw.length === 10 ? `${raw}T00:00:00Z` : raw);
  if (Number.isNaN(date.getTime())) return raw;
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    ...(includeTime ? { timeStyle: "short" as const } : {}),
    timeZone: "UTC",
  }).format(date);
}

export function deadlineForJob(value?: string | null, now = new Date()) {
  const raw = cleanJobText(value);
  if (!raw) return { label: "", expired: false, valid: false };
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return { label: "", expired: false, valid: false };
  const expired = date.getTime() <= now.getTime();
  return {
    label: expired ? `Closed ${formatJobDate(raw, true)} UTC` : `Apply by ${formatJobDate(raw, true)} UTC`,
    expired,
    valid: true,
  };
}

const START_LABELS: Record<string, string> = {
  immediate: "Immediately",
  within_two_weeks: "Within two weeks",
  flexible: "Flexible",
};

export function startForJob(job: Pick<Job, "startTiming" | "startDate" | "startTimeframe">) {
  if (job.startTiming === "specific_date") {
    const date = formatJobDate(job.startDate);
    return date ? `Starts ${date}` : "Start date not specified";
  }
  if (job.startTiming) return START_LABELS[job.startTiming] || sentenceCaseJobValue(job.startTiming);
  return cleanJobText(job.startTimeframe) || "Start not specified";
}

export function durationForJob(
  job: Pick<Job, "durationType" | "durationValue" | "durationUnit" | "engagementEndDate">,
) {
  if (job.durationType === "fixed_period") {
    return job.durationValue && job.durationUnit
      ? `${job.durationValue} ${job.durationUnit}`
      : "Fixed duration not specified";
  }
  if (job.durationType === "until_date") {
    const date = formatJobDate(job.engagementEndDate);
    return date ? `Until ${date}` : "End date not specified";
  }
  return job.durationType ? sentenceCaseJobValue(job.durationType) : "Duration not specified";
}

const SKILL_LABELS: Record<CreatorSkillKey, string> = {
  video_editing: "Video editing",
  short_form_editing: "Short-form editing",
  storytelling: "Storytelling",
  motion_graphics: "Motion graphics",
  color_grading: "Color grading",
  audio_editing: "Audio editing",
  thumbnail_design: "Thumbnail design",
  graphic_design: "Graphic design",
  scriptwriting: "Scriptwriting",
  copywriting: "Copywriting",
  research: "Research",
  seo: "SEO",
  channel_strategy: "Channel strategy",
  community_management: "Community management",
  project_management: "Project management",
  ugc_creation: "UGC creation",
  voice_over: "Voice over",
};

export const jobSkillLabel = (key: string) =>
  SKILL_LABELS[key as CreatorSkillKey] || sentenceCaseJobValue(key);

const DELIVERABLE_LABELS: Record<DeliverableType, string> = {
  long_form_video: "long-form video",
  short: "Short / Reel",
  thumbnail: "thumbnail",
  script: "script",
  podcast_episode: "podcast episode",
  community_post: "community post",
  social_post: "social post",
  newsletter: "newsletter",
  livestream: "livestream",
  audio_asset: "audio asset",
  design_asset: "design asset",
  research_brief: "research brief",
  voice_over: "voice over",
  other: "deliverable",
};
const DELIVERABLE_PLURALS: Partial<Record<DeliverableType, string>> = {
  long_form_video: "long-form videos",
  short: "Shorts / Reels",
  thumbnail: "thumbnails",
  script: "scripts",
  podcast_episode: "podcast episodes",
  community_post: "community posts",
  social_post: "social posts",
  newsletter: "newsletters",
  livestream: "livestreams",
  audio_asset: "audio assets",
  design_asset: "design assets",
  research_brief: "research briefs",
  voice_over: "voice overs",
  other: "deliverables",
};
const FREQUENCY_LABELS: Record<DeliverableFrequency, string> = {
  one_time: "one time",
  per_day: "per day",
  per_week: "per week",
  per_month: "per month",
  per_video: "per video",
  per_episode: "per episode",
  every_two_weeks: "every two weeks",
  ongoing: "ongoing",
  other: "custom frequency",
};

export const jobDeliverableTypeLabel = (type: DeliverableType | string) =>
  DELIVERABLE_LABELS[type as DeliverableType] || sentenceCaseJobValue(type);

export const jobDeliverableFrequencyLabel = (frequency: DeliverableFrequency | string) =>
  FREQUENCY_LABELS[frequency as DeliverableFrequency] || sentenceCaseJobValue(frequency).toLowerCase();

export function formatJobDeliverable(item: JobDeliverable) {
  const customType = cleanJobText(item.custom_type);
  const customFrequency = cleanJobText(item.custom_frequency);
  const type =
    item.type === "other"
      ? customType || "deliverable"
      : item.quantity === 1
        ? jobDeliverableTypeLabel(item.type)
        : DELIVERABLE_PLURALS[item.type] || `${jobDeliverableTypeLabel(item.type)}s`;
  const frequency = item.frequency === "other"
    ? customFrequency || "custom frequency"
    : jobDeliverableFrequencyLabel(item.frequency);
  return `${item.quantity} ${type} · ${frequency}`;
}

export function requiredToolsForJob(job: Job) {
  if (job.requiredToolKeys !== null && job.requiredToolKeys !== undefined) {
    return uniqueJobText([
      ...job.requiredToolKeys.map((key) => findToolCatalogEntry(key)?.name || key),
      ...(job.otherRequiredTools || []),
    ]);
  }
  return uniqueJobText(job.tools || []);
}

export function requiredSkillsForJob(job: Job) {
  return uniqueJobText([
    ...(job.requiredSkillKeys || []).map(jobSkillLabel),
    ...(job.otherRequiredSkills || []),
  ]);
}

export function preferredSkillsForJob(job: Job) {
  return uniqueJobText([
    ...(job.preferredSkillKeys || []).map(jobSkillLabel),
    ...(job.otherPreferredSkills || []),
  ]);
}

export const jobLanguagePurposeLabel = (value: string) => sentenceCaseJobValue(value);

export function formatJobLanguage(item: JobLanguageRequirement) {
  const priority = item.priority === "required" ? "Required" : "Preferred";
  const proficiency = item.proficiency ? sentenceCaseJobValue(item.proficiency) : "Proficiency not specified";
  const purposes = item.purposes?.length
    ? `For ${item.purposes.map(jobLanguagePurposeLabel).join(", ").toLowerCase()}`
    : "";
  return { language: cleanJobText(item.language) || "Language", priority, proficiency, purposes, notes: cleanJobText(item.notes) };
}

const REVISION_LABELS: Record<RevisionPolicy, string> = {
  fixed: "Fixed revision rounds",
  unlimited: "Unlimited revisions",
  negotiable: "Revisions are negotiable",
  not_applicable: "Revisions do not apply",
};

export function revisionForJob(job: Pick<Job, "revisionPolicy" | "revisionRounds" | "revisionNotes">) {
  if (!job.revisionPolicy) return "";
  return [
    REVISION_LABELS[job.revisionPolicy],
    job.revisionPolicy === "fixed" && job.revisionRounds
      ? `${job.revisionRounds} round${job.revisionRounds === 1 ? "" : "s"}`
      : "",
    cleanJobText(job.revisionNotes),
  ].filter(Boolean).join(" · ");
}

const AUTONOMY_LABELS: Record<string, string> = {
  follow_established_style: "Follow an established style",
  guided_by_references: "Guided by references",
  collaborative_direction: "Collaborative creative direction",
  own_creative_approach: "Room for your own creative approach",
  varies_by_assignment: "Varies by assignment",
  not_applicable: "Not applicable",
};

export function autonomyForJob(job: Pick<Job, "creativeAutonomy" | "creativeAutonomyNotes">) {
  if (!job.creativeAutonomy) return "";
  return [AUTONOMY_LABELS[job.creativeAutonomy] || sentenceCaseJobValue(job.creativeAutonomy), cleanJobText(job.creativeAutonomyNotes)]
    .filter(Boolean)
    .join(" · ");
}

export function sourceInputLabel(input: JobSourceInput) {
  if (input.type === "other") return cleanJobText(input.custom_label) || "Other material";
  return sentenceCaseJobValue(input.type);
}

export const sourceInputNeedsSensitiveAccess = (input: JobSourceInput) =>
  input.type === "account_access" || input.type === "analytics_access";

const TRIAL_STATUS_LABELS: Record<TrialStatus, string> = {
  none: "No trial",
  undecided: "Trial not decided",
  paid: "Paid trial",
  unpaid: "Unpaid trial",
};
const TRIAL_USAGE_LABELS: Record<TrialWorkUsage, string> = {
  evaluation_only: "Evaluation only",
  may_use_privately: "May be used privately",
  may_publish: "May be published",
};
const TRIAL_PORTFOLIO_LABELS: Record<TrialPortfolioPermission, string> = {
  allowed: "You may show the trial in your portfolio",
  not_allowed: "Portfolio use is not allowed",
  with_permission: "Portfolio use requires permission",
};
const TRIAL_ATTRIBUTION_LABELS: Record<TrialAttribution, string> = {
  credited: "You will be credited",
  not_credited: "No public credit",
  not_applicable: "Attribution does not apply",
  to_be_agreed: "Attribution will be agreed",
};
const TRIAL_BASIS_LABELS: Record<string, string> = {
  flat: "flat",
  per_hour: "per hour",
  per_deliverable: "per deliverable",
  custom: "custom basis",
};

export function trialForJob(job: Job) {
  const status = job.trialStatus;
  if (!status) return null;
  if (status === "none") return { title: TRIAL_STATUS_LABELS.none, status, details: [] };
  const details: string[] = [];
  const completePaidCompensation = Boolean(
    status === "paid" &&
      hasNumber(job.trialCompensationAmount) &&
      Number(job.trialCompensationAmount) > 0 &&
      cleanJobText(job.trialCompensationCurrency),
  );
  if (cleanJobText(job.trialScope)) details.push(job.trialScope!.trim());
  if (job.trialEffortValue && job.trialEffortUnit) {
    details.push(`Expected effort: ${job.trialEffortValue} ${sentenceCaseJobValue(job.trialEffortUnit).toLowerCase()}`);
  }
  if (completePaidCompensation) {
    details.push(
      `Trial pay: ${formatJobMoney(job.trialCompensationAmount!, job.trialCompensationCurrency)}${
        job.trialCompensationBasis ? ` ${TRIAL_BASIS_LABELS[job.trialCompensationBasis] || sentenceCaseJobValue(job.trialCompensationBasis).toLowerCase()}` : ""
      }`,
    );
  } else if (status === "paid") {
    details.push("Trial compensation is not fully specified in this listing.");
  }
  if (job.trialWorkUsage) details.push(`Use of trial work: ${TRIAL_USAGE_LABELS[job.trialWorkUsage]}`);
  if (job.trialPortfolioPermission) details.push(TRIAL_PORTFOLIO_LABELS[job.trialPortfolioPermission]);
  if (job.trialAttribution) details.push(TRIAL_ATTRIBUTION_LABELS[job.trialAttribution]);
  if (cleanJobText(job.trialNotes)) details.push(job.trialNotes!.trim());
  return {
    title: status === "paid" && !completePaidCompensation
      ? "Trial — compensation not specified"
      : TRIAL_STATUS_LABELS[status],
    status: status === "paid" && !completePaidCompensation ? "undecided" : status,
    details,
  };
}

export const employerContextLabel = (value?: EmployerContextType | string | null) => {
  if (!value) return "";
  return value === "production_house" ? "Production house" : sentenceCaseJobValue(value);
};

export function hiringVerificationForJob(
  job: Pick<Job, "hiringVerificationStatus" | "channel">,
) {
  const status = cleanJobText(job.hiringVerificationStatus).toUpperCase();
  const legacyVerified = !status && Boolean(job.channel.verified);
  return {
    status,
    verified: status === "VERIFIED" || legacyVerified,
    captured: Boolean(status) || legacyVerified,
  };
}

export const hiringStageLabel = (stage: JobHiringProcessStage) =>
  stage.stage === "other"
    ? cleanJobText(stage.custom_label) || "Other stage"
    : sentenceCaseJobValue(stage.stage);

export const applicationRequirementLabel = (key: string) =>
  getRequirementDef(key)?.job?.requester || sentenceCaseJobValue(key);

export function safeJobExternalUrl(value?: string | null) {
  const raw = cleanJobText(value);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export type JobTransparencyItem = { label: string; detail?: string };
export type JobTransparency = {
  explicit: JobTransparencyItem[];
  attention: JobTransparencyItem[];
  legacyNotice: string;
};

export function buildJobTransparency(job: Job): JobTransparency {
  const explicit: JobTransparencyItem[] = [];
  const attention: JobTransparencyItem[] = [];
  const canonical = (job.listingSchemaVersion || 1) >= 3;
  const compensation = compensationForJob(job);
  const deliverables = job.deliverables || [];
  const sensitiveInputs = (job.sourceInputs || []).filter(sourceInputNeedsSensitiveAccess);
  const verification = hiringVerificationForJob(job);
  const trial = job.trialStatus ? trialForJob(job) : null;

  if (verification.verified) explicit.push({ label: "Hiring identity verified" });
  if (compensation.disclosed) explicit.push({ label: "Compensation disclosed" });
  if (job.expectedWeeklyHoursMin !== undefined || job.turnaroundValue !== undefined) {
    explicit.push({ label: "Workload or turnaround disclosed" });
  }
  if (deliverables.length) explicit.push({ label: "Deliverables and volume disclosed" });
  if (trial && trial.status !== "undecided") explicit.push({ label: "Trial terms disclosed" });
  if (job.hiringProcess?.length) explicit.push({ label: "Hiring stages disclosed" });
  if (deadlineForJob(job.deadlineAt).valid) explicit.push({ label: "Application deadline disclosed" });
  if (job.employerContextType && (job.hiringDisplayName || job.channel.name)) {
    explicit.push({ label: "Employer context disclosed" });
  }

  if (canonical) {
    if (!job.primaryRoleName) attention.push({ label: "Creator role not specified" });
    if (!compensation.disclosed) attention.push({ label: "Compensation not specified" });
    if (job.budgetUnit === "per hour" && job.expectedWeeklyHoursMin === undefined) {
      attention.push({ label: "Weekly hours not specified for this hourly role" });
    }
    if (compensation.outputBased && !deliverables.length) {
      attention.push({ label: "Output volume not specified" });
    }
    if (job.trialStatus === "undecided") attention.push({ label: "Trial requirement is still undecided" });
    if (job.trialStatus === "paid" && trial?.status === "undecided") {
      attention.push({ label: "Trial compensation is not fully specified" });
    }
    if (!job.revisionPolicy) attention.push({ label: "Revision policy not specified" });
    if (!job.employerContextType || !(job.hiringDisplayName || job.channel.name)) {
      attention.push({ label: "Employer context is incomplete" });
    }
    if (sensitiveInputs.length) {
      attention.push({
        label: "Sensitive access is required",
        detail: uniqueJobText(sensitiveInputs.map(sourceInputLabel)).join(", "),
      });
    }
    if (job.compensationMode === "negotiable" && !cleanJobText(job.budgetNote)) {
      attention.push({ label: "Compensation is negotiable without further detail" });
    }
  }

  return {
    explicit,
    attention,
    legacyNotice: canonical
      ? ""
      : "This older listing did not capture every structured detail now available on CreatorJobs.",
  };
}
