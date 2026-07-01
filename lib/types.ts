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
  | "Marketing";

export type StartTimeframe = "ASAP" | "<1mo" | "<2mo" | "<3mo" | "Flexible";

export type JobType = "One-time" | "Monthly" | "Part-time" | "Full-time";

export type Job = {
  id: string;
  title: string;
  category: JobCategory;
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
  languages?: string[];
  contentNiches?: string[];
  contentGenres?: string[];
  formatsHiredFor?: string[];
  startTimeframe: StartTimeframe;
  workMode?: string;
  contractType?: string;
  timezoneOverlap?: string;
  weeklyHours?: string;
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
