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
  TrialEffortUnit,
  TrialCompensationBasis,
  TrialPortfolioPermission,
  TrialStatus,
  TrialWorkUsage,
} from "./jobContract";

export type Channel = {
  name: string;
  logoUrl: string;
  subscribers: number | null;
  verified?: boolean;
};

export type ReferenceVideo = {
  id?: string;
  title?: string;
  url: string;
  thumbnailUrl?: string;
  platform?: string;
  description?: string;
  whatToReference?: string;
  timestampNotes?: ReferenceTimestampNote[];
};

export type ReferenceTimestampNote = {
  id?: string;
  time: string;
  seconds: number;
  title: string;
  description: string;
};

export type JobCategory =
  | "Editing"
  | "Design"
  | "Writing"
  | "Thumbnails"
  | "Shorts"
  | "Motion Graphics"
  | "Channel Manager"
  | "Research"
  | "Voice Over"
  | "Marketing"
  | "Uncategorized";

export type StartTimeframe = "ASAP" | "<1mo" | "<2mo" | "<3mo" | "Flexible";

export type JobType = "One-time" | "Monthly" | "Part-time" | "Full-time";

export type Job = {
  id: string;
  title: string;
  category: JobCategory;
  legacyCategory?: string | null;
  listingSchemaVersion?: number;
  primaryRoleId?: string;
  primaryRoleName?: string;
  roleSpecialization?: string;
  budget: string;
  experience: string;
  location: string;
  postedShort: string;
  views: number;
  applicants: number;
  responseRate: number;
  channel: Channel;
  tags: string[];
  tools?: string[];
  requiredToolKeys?: string[] | null;
  otherRequiredTools?: string[] | null;
  deliverables?: JobDeliverable[] | null;
  requiredSkillKeys?: string[] | null;
  preferredSkillKeys?: string[] | null;
  otherRequiredSkills?: string[] | null;
  otherPreferredSkills?: string[] | null;
  requiredSkillsNote?: string;
  preferredSkillsNote?: string;
  revisionPolicy?: RevisionPolicy;
  revisionRounds?: number;
  revisionNotes?: string;
  sourceInputs?: JobSourceInput[] | null;
  sourceInputsNotes?: string;
  creativeAutonomy?: CreativeAutonomy;
  creativeAutonomyNotes?: string;
  languageRequirements?: JobLanguageRequirement[] | null;
  trialStatus?: TrialStatus;
  trialScope?: string;
  trialEffortValue?: number;
  trialEffortUnit?: TrialEffortUnit;
  trialCompensationAmount?: number;
  trialCompensationCurrency?: string;
  trialCompensationBasis?: TrialCompensationBasis;
  trialWorkUsage?: TrialWorkUsage;
  trialPortfolioPermission?: TrialPortfolioPermission;
  trialAttribution?: TrialAttribution;
  unpaidTrialConfirmed?: boolean;
  trialNotes?: string;
  startTiming?: StartTiming;
  startDate?: string;
  durationType?: EngagementDurationType;
  durationValue?: number;
  durationUnit?: EngagementDurationUnit;
  engagementEndDate?: string;
  hiringProcess?: JobHiringProcessStage[] | null;
  hiringProcessNotes?: string;
  screeningQuestions?: JobScreeningQuestion[] | null;
  employerContextType?: EmployerContextType;
  languages?: string[];
  contentNiches?: string[];
  contentGenres?: string[];
  formatsHiredFor?: string[];
  startTimeframe: StartTimeframe;
  workMode?: string;
  engagementType?: string;
  compensationMode?: string;
  budgetAmount?: number;
  budgetMax?: number;
  budgetCurrency?: string;
  budgetUnit?: string;
  budgetUnitCustom?: string;
  budgetNote?: string;
  contractType?: string;
  timezoneOverlap?: string;
  weeklyHours?: string;
  expectedWeeklyHoursMin?: number;
  expectedWeeklyHoursMax?: number;
  turnaroundValue?: number;
  turnaroundUnit?: string;
  turnaroundBasis?: string;
  applicationMode?: string;
  externalApplyUrl?: string;
  deadlineAt?: string;
  type?: JobType;
  referenceVideos?: ReferenceVideo[];
  platform?: string;
  platforms?: string[];
  about?: string;
  responsibilities?: string;
  requirements?: string;
  /** Keys from the first-message requirements registry applicants must answer. */
  applicationRequirements?: string[];
  howToApply?: string;
  channelProfileSlug?: string;
  channelExternalUrl?: string;
  postedByAgency?: boolean;
  agencyProfileSlug?: string;
  postedPlatform?: string;
  postedYoutubeChannelId?: string;
  postedByUserId?: string;
  hiringIdentityId?: string;
  hiringDisplayName?: string;
  hiringPlatform?: string;
  hiringVerificationStatus?: "UNVERIFIED" | "PENDING" | "VERIFIED" | "REJECTED" | string;
  managedByAgencyName?: string;
  status?: string;
  featuredUntil?: string;
  pausedAt?: string;
  closedAt?: string;
  createdAt?: string;
  updatedAt?: string;
  draftCompletion?: {
    hasTitle?: boolean;
    hasBudget?: boolean;
    hasPlatform?: boolean;
    hasWorkMode?: boolean;
    hasChannel?: boolean;
    hasExperience?: boolean;
    hasTimeline?: boolean;
  };
};
