import demoMarketplaceJson from "../fixtures/demo_job_marketplace.json" with { type: "json" };

import type {
  CreativeAutonomy,
  EmployerContextType,
  EngagementDurationType,
  EngagementDurationUnit,
  JobDeliverable,
  JobHiringProcessStage,
  JobLanguageRequirement,
  JobScreeningQuestion,
  JobSourceInput,
  RevisionPolicy,
  StartTiming,
  TrialAttribution,
  TrialCompensationBasis,
  TrialEffortUnit,
  TrialPortfolioPermission,
  TrialStatus,
  TrialWorkUsage,
} from "./jobContract";
import { resolveToolDisplay } from "./toolCatalog.ts";
import type { Job, JobCategory, ReferenceVideo, StartTimeframe } from "./types";

export const CATEGORIES = [
  "All",
  "Editing",
  "Design",
  "Writing",
  "Thumbnails",
  "Shorts",
  "Motion Graphics",
  "Channel Manager",
  "Research",
  "Voice Over",
  "Marketing",
] as const;

export const START_TIME_VALUES: StartTimeframe[] = ["ASAP", "<1mo", "<2mo", "<3mo", "Flexible"];

type DemoIdentity = {
  key: string;
  username: string;
  display_name: string;
  platform: string;
  managed_by_agency_name?: string;
  employer_context_type: EmployerContextType;
  verification_status: string;
  subscribers: number;
};

type DemoCompensation = {
  mode: string;
  amount?: number;
  max?: number;
  currency?: string | null;
  unit: string;
  custom_unit?: string;
  note?: string;
};

type DemoEngagement = {
  type: string;
  work_mode: string;
  location: string;
  weekly_min?: number;
  weekly_max?: number;
  turnaround_value?: number;
  turnaround_unit?: string;
  turnaround_basis?: string;
  timezone_overlap?: string;
};

type DemoTrial = {
  status: TrialStatus;
  scope?: string;
  effort_value?: number;
  effort_unit?: TrialEffortUnit;
  amount?: number;
  currency?: string;
  basis?: TrialCompensationBasis;
  work_usage?: TrialWorkUsage;
  portfolio_permission?: TrialPortfolioPermission;
  attribution?: TrialAttribution;
  unpaid_confirmed?: boolean;
  notes?: string;
};

type DemoJobSpec = {
  key: string;
  status: string;
  identity_key: string;
  role: string;
  specialization?: string;
  title: string;
  about: string;
  responsibilities: string[];
  requirements: string[];
  platforms: string[];
  niches: string[];
  genres: string[];
  formats: string[];
  experience: string;
  tags: string[];
  compensation: DemoCompensation;
  engagement: DemoEngagement;
  deliverables: JobDeliverable[];
  required_skills?: string[];
  preferred_skills?: string[];
  required_custom_skills?: string[];
  preferred_custom_skills?: string[];
  required_tools?: string[];
  other_required_tools?: string[];
  required_skills_note?: string;
  preferred_skills_note?: string;
  languages?: JobLanguageRequirement[];
  revision: { policy: RevisionPolicy; rounds?: number; notes?: string };
  source_inputs?: JobSourceInput[];
  source_inputs_notes?: string;
  autonomy: { level: CreativeAutonomy; notes?: string };
  trial: DemoTrial;
  start: {
    timing: StartTiming;
    start_days?: number;
    duration_type: EngagementDurationType;
    duration_value?: number;
    duration_unit?: EngagementDurationUnit;
  };
  application: {
    mode: string;
    external_url?: string;
    requirements?: string[];
    how_to_apply: string;
    screening?: JobScreeningQuestion[];
    process?: JobHiringProcessStage["stage"][];
  };
  reference?: boolean;
  posted_hours_ago: number;
  deadline_days: number;
  views: number;
  applicants: number;
  response_rate: number;
};

type DemoMarketplace = {
  version: number;
  identities: DemoIdentity[];
  jobs: DemoJobSpec[];
};

const marketplace = demoMarketplaceJson as unknown as DemoMarketplace;
const identities = new Map(marketplace.identities.map((identity) => [identity.key, identity]));

const roleCategory: Record<string, JobCategory> = {
  "Long-form Editor": "Editing",
  "Shorts Editor": "Shorts",
  "Podcast Producer": "Editing",
  "Thumbnail Designer": "Thumbnails",
  "Motion Designer": "Motion Graphics",
  Scriptwriter: "Writing",
  Researcher: "Research",
  "Voice Over Artist": "Voice Over",
  "Content Strategist": "Marketing",
  "Channel Manager": "Channel Manager",
  "Social Media Manager": "Marketing",
  "Community Manager": "Channel Manager",
  "Other Creator Role": "Uncategorized",
  "Project Manager": "Channel Manager",
  "UGC Creator": "Marketing",
  "Graphic Designer": "Design",
  Videographer: "Editing",
  "Newsletter Writer": "Writing",
  "Audio Engineer": "Editing",
  Copywriter: "Writing",
  Animator: "Motion Graphics",
  "Paid Ads Specialist": "Marketing",
};

const roleSlug = (value: string) =>
  value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

const addDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
const subtractHours = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();

const formatMoney = (value: number, currency?: string | null) => {
  if (!currency) return value.toLocaleString("en-IN");
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency,
      maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
    }).format(value);
  } catch {
    return `${currency} ${value.toLocaleString("en-IN")}`;
  }
};

const compensationDisplay = (value: DemoCompensation) => {
  if (value.unit === "commission") return "Commission-based · terms disclosed";
  if (value.unit === "mixed") return `Mixed compensation · ${value.note || "see details"}`;
  if (value.mode === "negotiable") return `Negotiable ${value.unit}`;
  const minimum = value.amount === undefined ? "" : formatMoney(value.amount, value.currency);
  const maximum = value.max === undefined ? "" : formatMoney(value.max, value.currency);
  const range = maximum ? `${minimum}–${maximum}` : minimum;
  const unit = value.unit === "custom" ? value.custom_unit : value.unit;
  return `${range}${unit ? ` ${unit}` : ""}`.trim();
};

const postedLabel = (hours: number) => (hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`);

const jobType = (engagement: string): Job["type"] => {
  if (engagement === "one_time_project") return "One-time";
  if (engagement === "full_time") return "Full-time";
  if (["part_time", "internship", "fixed_term"].includes(engagement)) return "Part-time";
  return "Monthly";
};

const startTimeframe = (timing: StartTiming): StartTimeframe => {
  if (timing === "immediate") return "ASAP";
  if (timing === "within_two_weeks") return "<1mo";
  if (timing === "specific_date") return "<2mo";
  return "Flexible";
};

const referenceVideos = (spec: DemoJobSpec): ReferenceVideo[] =>
  spec.reference
    ? [
        {
          id: `${spec.key}-reference`,
          title: "Fictional style and workflow reference",
          url: `https://example.com/creatorjobs-demo/references/${spec.key}`,
          platform: "Demo reference",
          description: "A stable non-playable fixture link used only in local development.",
          whatToReference:
            "Use the pacing, hierarchy, or workflow notes in the supplied fictional brief; do not copy creative assets.",
          timestampNotes: [
            {
              id: `${spec.key}-reference-opening`,
              time: "0:00",
              seconds: 0,
              title: "Opening expectation",
              description: "The first beat states the audience promise clearly.",
            },
            {
              id: `${spec.key}-reference-handoff`,
              time: "0:35",
              seconds: 35,
              title: "Execution detail",
              description: "Use this note to calibrate the requested polish and handoff quality.",
            },
            {
              id: `${spec.key}-reference-finish`,
              time: "1:10",
              seconds: 70,
              title: "Finish standard",
              description: "This checkpoint documents the expected final delivery quality.",
            },
          ],
        },
      ]
    : [];

const toJob = (spec: DemoJobSpec): Job => {
  const identity = identities.get(spec.identity_key);
  if (!identity) throw new Error(`Unknown demo identity: ${spec.identity_key}`);
  const category = roleCategory[spec.role] || "Uncategorized";
  const requiredTools = spec.required_tools || [];
  const otherTools = spec.other_required_tools || [];
  const startDate = spec.start.start_days === undefined ? undefined : addDays(spec.start.start_days).slice(0, 10);

  return {
    id: spec.key.replace(/^job_/, ""),
    listingSchemaVersion: 3,
    title: spec.title,
    category,
    legacyCategory: category === "Uncategorized" ? null : category,
    primaryRoleId: `demo-role-${roleSlug(spec.role)}`,
    primaryRoleName: spec.role,
    roleSpecialization: spec.specialization,
    budget: compensationDisplay(spec.compensation),
    budgetAmount: spec.compensation.amount,
    budgetMax: spec.compensation.max,
    budgetCurrency: spec.compensation.currency || undefined,
    budgetUnit: spec.compensation.unit,
    budgetUnitCustom: spec.compensation.custom_unit,
    compensationMode: spec.compensation.mode,
    budgetNote: spec.compensation.note,
    experience: spec.experience,
    location:
      spec.engagement.work_mode === "remote" && spec.engagement.location === "Remote"
        ? ""
        : spec.engagement.location,
    postedShort: postedLabel(spec.posted_hours_ago),
    createdAt: subtractHours(spec.posted_hours_ago),
    updatedAt: subtractHours(spec.posted_hours_ago),
    views: spec.views,
    applicants: spec.applicants,
    responseRate: spec.response_rate,
    channel: {
      name: identity.display_name,
      // Demo identities intentionally use the product's initials fallback. A
      // random public image is neither identity evidence nor a deterministic
      // dependency for the marketplace and browser certification suite.
      logoUrl: "",
      subscribers: identity.subscribers,
      verified: identity.verification_status === "VERIFIED",
    },
    tags: spec.tags,
    tools: [...requiredTools.map((key) => resolveToolDisplay(key).displayName), ...otherTools],
    requiredToolKeys: requiredTools,
    otherRequiredTools: otherTools,
    deliverables: spec.deliverables,
    requiredSkillKeys: spec.required_skills || [],
    preferredSkillKeys: spec.preferred_skills || [],
    otherRequiredSkills: spec.required_custom_skills || [],
    otherPreferredSkills: spec.preferred_custom_skills || [],
    requiredSkillsNote: spec.required_skills_note,
    preferredSkillsNote: spec.preferred_skills_note,
    revisionPolicy: spec.revision.policy,
    revisionRounds: spec.revision.rounds,
    revisionNotes: spec.revision.notes,
    sourceInputs: spec.source_inputs || [],
    sourceInputsNotes: spec.source_inputs_notes,
    creativeAutonomy: spec.autonomy.level,
    creativeAutonomyNotes: spec.autonomy.notes,
    languageRequirements: spec.languages || [],
    languages: (spec.languages || []).map((language) => language.language),
    trialStatus: spec.trial.status,
    trialScope: spec.trial.scope,
    trialEffortValue: spec.trial.effort_value,
    trialEffortUnit: spec.trial.effort_unit,
    trialCompensationAmount: spec.trial.amount,
    trialCompensationCurrency: spec.trial.currency,
    trialCompensationBasis: spec.trial.basis,
    trialWorkUsage: spec.trial.work_usage,
    trialPortfolioPermission: spec.trial.portfolio_permission,
    trialAttribution: spec.trial.attribution,
    unpaidTrialConfirmed: spec.trial.unpaid_confirmed,
    trialNotes: spec.trial.notes,
    startTiming: spec.start.timing,
    startDate,
    durationType: spec.start.duration_type,
    durationValue: spec.start.duration_value,
    durationUnit: spec.start.duration_unit,
    hiringProcess: (spec.application.process || []).map((stage) => ({ stage })),
    screeningQuestions: spec.application.screening || [],
    employerContextType: identity.employer_context_type,
    contentNiches: spec.niches,
    contentGenres: spec.genres,
    formatsHiredFor: spec.formats,
    startTimeframe: startTimeframe(spec.start.timing),
    workMode: spec.engagement.work_mode,
    engagementType: spec.engagement.type,
    timezoneOverlap: spec.engagement.timezone_overlap,
    expectedWeeklyHoursMin: spec.engagement.weekly_min,
    expectedWeeklyHoursMax: spec.engagement.weekly_max,
    turnaroundValue: spec.engagement.turnaround_value,
    turnaroundUnit: spec.engagement.turnaround_unit,
    turnaroundBasis: spec.engagement.turnaround_basis,
    applicationMode: spec.application.mode,
    externalApplyUrl: spec.application.external_url,
    deadlineAt: addDays(spec.deadline_days),
    type: jobType(spec.engagement.type),
    referenceVideos: referenceVideos(spec),
    platform: spec.platforms[0],
    platforms: spec.platforms,
    about: spec.about,
    responsibilities: spec.responsibilities.join("\n"),
    requirements: spec.requirements.join("\n"),
    applicationRequirements: spec.application.requirements || [],
    howToApply: spec.application.how_to_apply,
    channelProfileSlug: identity.username,
    channelExternalUrl: `https://example.com/creatorjobs-demo/${identity.key}`,
    postedByAgency: Boolean(identity.managed_by_agency_name),
    agencyProfileSlug: identity.managed_by_agency_name ? identity.username : undefined,
    managedByAgencyName: identity.managed_by_agency_name,
    hiringDisplayName: identity.display_name,
    hiringVerificationStatus: identity.verification_status,
    hiringPlatform: identity.platform,
    hiringIdentityId: `demo-identity-${identity.key}`,
    status: spec.status,
  };
};

/** Public-only fixture consumed by the isolated frontend mock data source. */
export const JOBS: Job[] = marketplace.jobs.filter((spec) => spec.status === "published").map(toJob);

/** Owner-only status fixtures are exported for focused development/tests, not discovery. */
export const OWNER_JOB_FIXTURES: Job[] = marketplace.jobs
  .filter((spec) => spec.status !== "published")
  .map(toJob);
