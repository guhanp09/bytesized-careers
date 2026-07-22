import { TOOL_CATALOG, findToolCatalogEntry } from "./toolCatalog.ts";

export const COMPENSATION_UNITS = [
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
] as const;

export const ENGAGEMENT_TYPES = [
  "one_time_project",
  "ongoing_freelance",
  "retainer",
  "part_time",
  "full_time",
  "fixed_term",
  "internship",
] as const;

export const TURNAROUND_UNITS = ["hours", "business_days", "calendar_days", "weeks"] as const;
export const TURNAROUND_BASES = ["per_deliverable", "batch", "first_draft", "final_delivery"] as const;

export const DELIVERABLE_TYPES = [
  "long_form_video",
  "short",
  "thumbnail",
  "script",
  "podcast_episode",
  "community_post",
  "social_post",
  "newsletter",
  "livestream",
  "audio_asset",
  "design_asset",
  "research_brief",
  "voice_over",
  "other",
] as const;

export const DELIVERABLE_FREQUENCIES = [
  "one_time",
  "per_day",
  "per_week",
  "per_month",
  "per_video",
  "per_episode",
  "every_two_weeks",
  "ongoing",
  "other",
] as const;

export const CREATOR_SKILL_KEYS = [
  "video_editing",
  "short_form_editing",
  "storytelling",
  "motion_graphics",
  "color_grading",
  "audio_editing",
  "thumbnail_design",
  "graphic_design",
  "scriptwriting",
  "copywriting",
  "research",
  "seo",
  "channel_strategy",
  "community_management",
  "project_management",
  "ugc_creation",
  "voice_over",
] as const;

export const SOURCE_INPUT_TYPES = [
  "raw_footage",
  "script",
  "research",
  "creative_brief",
  "brand_guidelines",
  "reference_videos",
  "thumbnail_assets",
  "music_or_stock_subscription",
  "voice_over",
  "project_files",
  "analytics_access",
  "account_access",
  "product_footage",
  "other",
] as const;

export const LANGUAGE_PURPOSES = [
  "speaking",
  "writing",
  "reading",
  "content_understanding",
  "audience_fluency",
] as const;

export const HIRING_PROCESS_STAGES = [
  "application_review",
  "portfolio_review",
  "screening_call",
  "interview",
  "assessment",
  "paid_trial",
  "unpaid_trial",
  "final_discussion",
  "offer",
  "other",
] as const;

export type CompensationUnit = (typeof COMPENSATION_UNITS)[number];
export type CompensationMode = "fixed" | "range" | "negotiable";
export type EngagementType = (typeof ENGAGEMENT_TYPES)[number];
export type TurnaroundUnit = (typeof TURNAROUND_UNITS)[number];
export type TurnaroundBasis = (typeof TURNAROUND_BASES)[number];
export type DeliverableType = (typeof DELIVERABLE_TYPES)[number];
export type DeliverableFrequency = (typeof DELIVERABLE_FREQUENCIES)[number];
export type CreatorSkillKey = (typeof CREATOR_SKILL_KEYS)[number];
export type RevisionPolicy = "fixed" | "unlimited" | "negotiable" | "not_applicable";
export type SourceInputType = (typeof SOURCE_INPUT_TYPES)[number];
export type CreativeAutonomy = "follow_established_style" | "guided_by_references" | "collaborative_direction" | "own_creative_approach" | "varies_by_assignment" | "not_applicable";
export type LanguagePriority = "required" | "preferred";
export type LanguageProficiency = "basic" | "conversational" | "professional" | "native_or_fluent";
export type LanguagePurpose = (typeof LANGUAGE_PURPOSES)[number];
export type TrialStatus = "none" | "undecided" | "paid" | "unpaid";
export type TrialEffortUnit = "hours" | "days" | "deliverables";
export type TrialCompensationBasis = "flat" | "per_hour" | "per_deliverable" | "custom";
export type TrialWorkUsage = "evaluation_only" | "may_use_privately" | "may_publish";
export type TrialPortfolioPermission = "allowed" | "not_allowed" | "with_permission";
export type TrialAttribution = "credited" | "not_credited" | "not_applicable" | "to_be_agreed";
export type StartTiming = "immediate" | "within_two_weeks" | "specific_date" | "flexible";
export type EngagementDurationType = "ongoing" | "fixed_period" | "project_based" | "until_date" | "flexible";
export type EngagementDurationUnit = "weeks" | "months";
export type HiringProcessStageType = (typeof HIRING_PROCESS_STAGES)[number];
export type EmployerContextType = "creator" | "agency" | "brand" | "production_house" | "other";

export type JobDeliverable = {
  type: DeliverableType;
  custom_type?: string | null;
  quantity: number;
  frequency: DeliverableFrequency;
  custom_frequency?: string | null;
  notes?: string | null;
};

export type JobSourceInput = {
  type: SourceInputType;
  custom_label?: string | null;
  sensitive_access_confirmed?: boolean | null;
};

export type JobLanguageRequirement = {
  language: string;
  priority: LanguagePriority;
  proficiency?: LanguageProficiency | null;
  purposes: LanguagePurpose[];
  notes?: string | null;
};

export type JobHiringProcessStage = {
  stage: HiringProcessStageType;
  custom_label?: string | null;
  notes?: string | null;
};

export type JobScreeningQuestion = {
  prompt: string;
  required: boolean;
  response_guidance?: string | null;
};

export const engagementLabel = (value: EngagementType) =>
  ({
    one_time_project: "One-time project",
    ongoing_freelance: "Ongoing freelance",
    retainer: "Retainer",
    part_time: "Part-time",
    full_time: "Full-time",
    fixed_term: "Fixed-term",
    internship: "Internship",
  })[value];

export const compensationUnitLabel = (value: CompensationUnit) =>
  value === "per year" ? "Annual" : value;

export function splitRequiredTools(tools: readonly string[]) {
  const selectedToolKeys = new Set<string>();
  const otherRequiredTools: string[] = [];
  const seenOther = new Set<string>();
  for (const raw of tools) {
    const value = raw.trim();
    if (!value) continue;
    const entry = findToolCatalogEntry(value);
    if (entry) {
      selectedToolKeys.add(entry.key);
      continue;
    }
    const folded = value.toLowerCase();
    if (!seenOther.has(folded)) {
      seenOther.add(folded);
      otherRequiredTools.push(value);
    }
  }
  const requiredToolKeys = TOOL_CATALOG.filter((tool) => selectedToolKeys.has(tool.key)).map(
    (tool) => tool.key
  );
  return { requiredToolKeys, otherRequiredTools };
}
