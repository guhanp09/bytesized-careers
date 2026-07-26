// `import type` and the explicit `.ts` are the repo's ESM convention: without
// them this module cannot be loaded by `node --test`, which the parity suite
// needs in order to reuse the real normalisation rather than reimplement it.
import type { Job, JobCategory, ReferenceVideo, StartTimeframe } from "./types";
import { normalizeReferenceVideo } from "./referenceVideos.ts";

const START_VALUES: StartTimeframe[] = ["ASAP", "<1mo", "<2mo", "<3mo", "Flexible"];

const parseBool = (value?: string) => {
  if (!value) return false;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
};

export const isLocalMocksEnabled = () =>
  parseBool(process.env.NEXT_PUBLIC_USE_LOCAL_MOCKS);

export const isProductionRuntime = () => {
  const appEnv = process.env.APP_ENV || process.env.NEXT_PUBLIC_APP_ENV;
  if (appEnv) return appEnv === "production";
  return process.env.VERCEL_ENV === "production";
};

const isLocalBackendUrl = () => {
  const raw = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000/api/v1";
  return /localhost|127\.0\.0\.1/.test(raw);
};

export const canUseLocalMockFallback = () => {
  if (isProductionRuntime()) return false;
  if (isLocalMocksEnabled()) return true;
  return process.env.NODE_ENV === "development" && isLocalBackendUrl();
};

export const isExternalBackendEnabled = () => !isLocalMocksEnabled();

const getBackendBaseUrl = () => {
  const raw = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000/api/v1";
  const normalized = raw.replace(/\/+$/, "");
  return normalized.endsWith("/api/v1") ? normalized : `${normalized}/api/v1`;
};

export const getBackendApiBaseUrl = () => getBackendBaseUrl();

export type BackendJob = {
  id?: string | number;
  title?: string;
  category?: string | null;
  listing_schema_version?: number | null;
  primary_role_id?: string | null;
  primary_role_name_snapshot?: string | null;
  role_specialization?: string | null;
  location?: string | null;
  budget_amount?: string | number | null;
  budget_min?: string | number | null;
  budget_max?: string | number | null;
  budget_note?: string | null;
  budgetNote?: string | null;
  compensation_mode?: string | null;
  budget_currency?: string | null;
  budget_unit?: string | null;
  budget_unit_custom?: string | null;
  experience_level?: string | null;
  experienceLevel?: string | null;
  platforms?: string[] | null;
  platform?: string | null;
  start_timeframe?: string | null;
  startTimeframe?: string | null;
  work_mode?: string | null;
  contract_type?: string | null;
  engagement_type?: string | null;
  timezone_overlap?: string | null;
  weekly_hours?: string | null;
  expected_weekly_hours_min?: string | number | null;
  expected_weekly_hours_max?: string | number | null;
  turnaround_value?: number | null;
  turnaround_unit?: string | null;
  turnaround_basis?: string | null;
  application_mode?: "internal" | "external" | string | null;
  external_apply_url?: string | null;
  deadline_at?: string | null;
  about_channel?: string | null;
  aboutChannel?: string | null;
  responsibilities?: string[] | null;
  requirements?: string[] | null;
  application_requirements?: string[] | null;
  how_to_apply?: string | null;
  howToApply?: string | null;
  tools?: string[] | null;
  required_tool_keys?: string[] | null;
  other_required_tools?: string[] | null;
  deliverables?: import("./jobContract").JobDeliverable[] | null;
  required_skill_keys?: string[] | null;
  preferred_skill_keys?: string[] | null;
  other_required_skills?: string[] | null;
  other_preferred_skills?: string[] | null;
  required_skills_note?: string | null;
  preferred_skills_note?: string | null;
  revision_policy?: import("./jobContract").RevisionPolicy | null;
  revision_rounds?: number | null;
  revision_notes?: string | null;
  source_inputs?: import("./jobContract").JobSourceInput[] | null;
  source_inputs_notes?: string | null;
  creative_autonomy?: import("./jobContract").CreativeAutonomy | null;
  creative_autonomy_notes?: string | null;
  language_requirements?: import("./jobContract").JobLanguageRequirement[] | null;
  trial_status?: import("./jobContract").TrialStatus | null;
  trial_scope?: string | null;
  trial_effort_value?: number | null;
  trial_effort_unit?: import("./jobContract").TrialEffortUnit | null;
  trial_compensation_amount?: string | number | null;
  trial_compensation_currency?: string | null;
  trial_compensation_basis?: import("./jobContract").TrialCompensationBasis | null;
  trial_work_usage?: import("./jobContract").TrialWorkUsage | null;
  trial_portfolio_permission?: import("./jobContract").TrialPortfolioPermission | null;
  trial_attribution?: import("./jobContract").TrialAttribution | null;
  unpaid_trial_confirmed?: boolean | null;
  trial_notes?: string | null;
  start_timing?: import("./jobContract").StartTiming | null;
  start_date?: string | null;
  duration_type?: import("./jobContract").EngagementDurationType | null;
  duration_value?: number | null;
  duration_unit?: import("./jobContract").EngagementDurationUnit | null;
  engagement_end_date?: string | null;
  hiring_process?: import("./jobContract").JobHiringProcessStage[] | null;
  hiring_process_notes?: string | null;
  screening_questions?: import("./jobContract").JobScreeningQuestion[] | null;
  employer_context_type?: import("./jobContract").EmployerContextType | null;
  reference_videos?: unknown;
  referenceVideos?: unknown;
  tags?: string[] | null;
  languages?: string[] | null;
  content_niches?: string[] | null;
  contentNiches?: string[] | null;
  content_genres?: string[] | null;
  contentGenres?: string[] | null;
  formats_hired_for?: string[] | null;
  formatsHiredFor?: string[] | null;
  youtube_channel_id?: string | null;
  is_verified?: boolean | null;
  channel_name?: string | null;
  channelName?: string | null;
  channel_logo_url?: string | null;
  channel_avatar_url?: string | null;
  channelAvatarUrl?: string | null;
  channel_subscribers?: number | null;
  subscriber_count?: number | null;
  subscriberCount?: number | null;
  channel_profile_slug?: string | null;
  posted_by_agency?: boolean | null;
  agency_profile_slug?: string | null;
  posted_platform?: string | null;
  posted_youtube_channel_id?: string | null;
  posted_by_user_id?: string | null;
  hiring_identity_id?: string | null;
  hiring_display_name_snapshot?: string | null;
  hiring_platform_snapshot?: string | null;
  hiring_verification_status_snapshot?: string | null;
  hiring_external_url_snapshot?: string | null;
  managed_by_agency_name_snapshot?: string | null;
  views?: number | null;
  applicants?: number | null;
  response_rate?: number | null;
  match_percentage?: number | null;
  matchPercentage?: number | null;
  status?: string | null;
  featured_until?: string | null;
  paused_at?: string | null;
  closed_at?: string | null;
  created_at?: string;
  createdAt?: string;
  updated_at?: string;
  updatedAt?: string;
  [key: string]: unknown;
};

type BackendListResponse = {
  items?: unknown;
  total?: unknown;
  limit?: unknown;
  offset?: unknown;
  results?: unknown;
  data?: unknown;
};

type BackendErrorShape = {
  detail?: string | { message?: string; code?: string; field_errors?: Record<string, string[]> };
  error?: {
    code?: string;
    message?: string;
    request_id?: string;
    details?:
      | {
          field_errors?: Record<string, string[]>;
          details?: unknown;
          [key: string]: unknown;
        }
      | Array<{ loc?: Array<string | number>; msg?: string; message?: string }>;
  };
};

export function normalizeBackendFieldErrors(payload: BackendErrorShape): Record<string, string[]> | undefined {
  const mapped =
    (typeof payload.detail === "object" && payload.detail !== null
      ? payload.detail.field_errors
      : undefined) ||
    (!Array.isArray(payload.error?.details) ? payload.error?.details?.field_errors : undefined);
  if (mapped) return mapped;
  if (!Array.isArray(payload.error?.details)) return undefined;

  const normalized: Record<string, string[]> = {};
  for (const detail of payload.error.details) {
    const path = Array.isArray(detail.loc) ? detail.loc : [];
    const field = path.find((part) => typeof part === "string" && !["body", "query", "path"].includes(part));
    const message = detail.msg || detail.message;
    if (typeof field !== "string" || !message) continue;
    normalized[field] = [...(normalized[field] || []), message];
  }
  return Object.keys(normalized).length ? normalized : undefined;
}

export type BackendCreateJobPayload = {
  title: string;
  category?: string | null;
  primary_role_id?: string | null;
  role_specialization?: string | null;
  location?: string | null;
  budget_amount?: number | null;
  budget_max?: number | null;
  budget_note?: string | null;
  compensation_mode?: import("./jobContract").CompensationMode | null;
  budget_currency?: string | null;
  budget_unit?: import("./jobContract").CompensationUnit | null;
  budget_unit_custom?: string | null;
  experience_level?: string | null;
  platforms?: string[];
  start_timeframe?: string | null;
  work_mode?: string | null;
  contract_type?: string | null;
  engagement_type?: import("./jobContract").EngagementType | null;
  timezone_overlap?: string | null;
  weekly_hours?: string | null;
  expected_weekly_hours_min?: number | null;
  expected_weekly_hours_max?: number | null;
  turnaround_value?: number | null;
  turnaround_unit?: import("./jobContract").TurnaroundUnit | null;
  turnaround_basis?: import("./jobContract").TurnaroundBasis | null;
  application_mode?: "internal" | "external";
  external_apply_url?: string | null;
  deadline_at?: string | null;
  about_channel?: string | null;
  responsibilities?: string[];
  requirements?: string[];
  application_requirements?: string[];
  how_to_apply?: string | null;
  tools?: string[];
  required_tool_keys?: string[] | null;
  other_required_tools?: string[] | null;
  deliverables?: import("./jobContract").JobDeliverable[] | null;
  required_skill_keys?: import("./jobContract").CreatorSkillKey[] | null;
  preferred_skill_keys?: import("./jobContract").CreatorSkillKey[] | null;
  other_required_skills?: string[] | null;
  other_preferred_skills?: string[] | null;
  required_skills_note?: string | null;
  preferred_skills_note?: string | null;
  revision_policy?: import("./jobContract").RevisionPolicy | null;
  revision_rounds?: number | null;
  revision_notes?: string | null;
  source_inputs?: import("./jobContract").JobSourceInput[] | null;
  source_inputs_notes?: string | null;
  creative_autonomy?: import("./jobContract").CreativeAutonomy | null;
  creative_autonomy_notes?: string | null;
  language_requirements?: import("./jobContract").JobLanguageRequirement[] | null;
  trial_status?: import("./jobContract").TrialStatus | null;
  trial_scope?: string | null;
  trial_effort_value?: number | null;
  trial_effort_unit?: import("./jobContract").TrialEffortUnit | null;
  trial_compensation_amount?: number | null;
  trial_compensation_currency?: string | null;
  trial_compensation_basis?: import("./jobContract").TrialCompensationBasis | null;
  trial_work_usage?: import("./jobContract").TrialWorkUsage | null;
  trial_portfolio_permission?: import("./jobContract").TrialPortfolioPermission | null;
  trial_attribution?: import("./jobContract").TrialAttribution | null;
  unpaid_trial_confirmed?: boolean | null;
  trial_notes?: string | null;
  start_timing?: import("./jobContract").StartTiming | null;
  start_date?: string | null;
  duration_type?: import("./jobContract").EngagementDurationType | null;
  duration_value?: number | null;
  duration_unit?: import("./jobContract").EngagementDurationUnit | null;
  engagement_end_date?: string | null;
  hiring_process?: import("./jobContract").JobHiringProcessStage[] | null;
  hiring_process_notes?: string | null;
  screening_questions?: import("./jobContract").JobScreeningQuestion[] | null;
  employer_context_type?: import("./jobContract").EmployerContextType | null;
  reference_videos?: Array<string | Record<string, unknown>>;
  tags?: string[];
  languages?: string[];
  content_niches?: string[];
  content_genres?: string[];
  formats_hired_for?: string[];
  youtube_channel_id?: string | null;
  channel_name?: string | null;
  channel_logo_url?: string | null;
  channel_subscribers?: number | null;
  channel_profile_slug?: string | null;
  hiring_external_url_snapshot?: string | null;
  posted_by_agency?: boolean;
  agency_profile_slug?: string | null;
  posted_platform?: string | null;
  posted_youtube_channel_id?: string | null;
  hiring_identity_id?: string | null;
  status?: "draft" | "published" | "paused" | "closed" | "archived";
};

export type BackendAuthStatusResponse = {
  status: string;
  message?: string;
  verification_url?: string | null;
};

export type BackendAccountType = "TALENT" | "EMPLOYER" | "BOTH" | "ADMIN";
export type BackendPublicAccountType = Exclude<BackendAccountType, "ADMIN">;
export type BackendOnboardingIntent =
  | "LOOKING_FOR_WORK"
  | "HIRING_CREATOR_TALENT"
  | "BOTH"
  | "DECIDE_LATER";

export type BackendProfileCapabilities = {
  canApplyToJobs: boolean;
  canPostJobs: boolean;
  hasPortfolio: boolean;
  hasPublicProfile: boolean;
  hasHiringIdentity: boolean;
  hasVerifiedSocialOrChannel: boolean;
  isAdmin: boolean;
  applyMissingSections: string[];
  postMissingSections: string[];
  missingHiringFields?: string[];
};

export type BackendOAuthGoogleExchangePayload = {
  email: string;
  provider_account_id: string;
  username?: string | null;
  display_name?: string | null;
  youtube_handle?: string | null;
  youtube_channel_title?: string | null;
  access_token?: string | null;
  refresh_token?: string | null;
  expires_at?: number | null;
  scope?: string | null;
};

export type BackendLoginExchangeResponse = {
  access_token: string;
  token_type: string;
  refresh_token?: string | null;
  access_token_expires_at?: number | null;
  refresh_token_expires_at?: number | null;
  user: {
    id: string;
    email: string;
    username?: string | null;
    display_name?: string | null;
    account_type: BackendAccountType;
    account_type_selected_at?: string | null;
    onboarding_intent: BackendOnboardingIntent;
    onboarding_intent_selected_at?: string | null;
  };
};

export type BackendResendVerificationResponse = {
  ok: boolean;
  message: string;
};

export type BackendPasswordResetResponse = {
  ok: boolean;
  message: string;
  reset_url?: string | null;
};

export type BackendMeYouTubeChannel = {
  id: string;
  channel_id: string;
  title: string;
  thumbnail_url?: string | null;
};

export type BackendMeResponse = {
  id: string;
  email: string;
  username?: string | null;
  display_name?: string | null;
  account_type: BackendAccountType;
  account_type_selected_at?: string | null;
  onboarding_intent: BackendOnboardingIntent;
  onboarding_intent_selected_at?: string | null;
  profile_capabilities: BackendProfileCapabilities;
  email_verified: boolean;
  verified_youtube_channels: BackendMeYouTubeChannel[];
};

export type BackendPrivacySettings = {
  show_bio: boolean;
  show_links: boolean;
  show_skills: boolean;
  show_location: boolean;
  show_availability: boolean;
  show_youtube_badge: boolean;
};

export type BackendSocialYouTubeConnection = {
  connected: boolean;
  channel_id?: string | null;
  channel_title?: string | null;
  channel_handle?: string | null;
  channel_avatar_url?: string | null;
  channel_url?: string | null;
};

export type BackendSocialInstagramConnection = {
  connected: boolean;
  handle?: string | null;
  url?: string | null;
};

export type BackendSocialConnections = {
  youtube: BackendSocialYouTubeConnection;
  instagram: BackendSocialInstagramConnection;
};

export type BackendProfileStats = {
  jobs_posted_count: number;
  jobs_completed_count: number;
  projects_count: number;
  reviews_count: number;
};

export type BackendReviewsSummary = {
  avg_rating: number;
  review_count: number;
};

export type BackendProfileReviewItem = {
  id: string;
  reviewer_name: string;
  reviewer_avatar_url?: string | null;
  reviewer_role?: string | null;
  relationship_label?: string | null;
  rating: number;
  body: string;
  created_at: string;
  verified?: boolean | null;
};

export type BackendProfileReviewCollection = {
  summary: BackendReviewsSummary;
  items: BackendProfileReviewItem[];
};

export type BackendReviewsByMode = {
  talent: BackendProfileReviewCollection;
  hiring: BackendProfileReviewCollection;
};

export type BackendProfileExperienceItem = {
  id: string;
  role: string;
  organization_name: string;
  organization_url?: string | null;
  organization_logo_url?: string | null;
  organization_links?: BackendProfileExperienceLink[] | null;
  platform?: string | null;
  work_type?: string | null;
  work_mode?: string | null;
  start_month?: string | null;
  start_year?: string | null;
  end_month?: string | null;
  end_year?: string | null;
  is_current?: boolean;
  description?: string | null;
  tools?: string[];
};

export type BackendProfileExperienceLink = {
  id: string;
  url: string;
  platform?: string | null;
  resolved_name?: string | null;
  logo_url?: string | null;
};

export type BackendCollaborationPreferences = {
  project_type_preference?: "oneOff" | "retainer" | "either" | null;
  turnaround?: string | null;
  revisions?: string | null;
  working_hours?: string | null;
  tools?: string | null;
  styles?: string[] | null;
  work_mode?: string | null;
};

export type BackendHiringType =
  | "individual creator"
  | "creator agency"
  | "influencer marketing agency"
  | "social media agency"
  | "brand"
  | "production house"
  | "other";

export type BackendHiringPrimaryPlatform = "YouTube" | "Instagram" | "Both";

export type BackendHiringInfo = {
  hiring_type?: BackendHiringType | null;
  website_or_social_url?: string | null;
  primary_platform?: BackendHiringPrimaryPlatform | null;
  platforms?: string[] | null;
  niches?: string[] | null;
  genres?: string[] | null;
  formats?: string[] | null;
  channels_or_pages_managed?: string | null;
  verification_status: "unverified" | "verified" | "rejected";
};

export type BackendHiringIdentityType = "INDIVIDUAL_CHANNEL" | "AGENCY_REPRESENTED_CHANNEL";
export type BackendHiringIdentityPlatform = "YOUTUBE" | "INSTAGRAM";
export type BackendHiringIdentityVerificationStatus =
  | "UNVERIFIED"
  | "PENDING"
  | "VERIFIED"
  | "REJECTED";
export type BackendHiringIdentityVerificationMethod =
  | "YOUTUBE_OAUTH"
  | "INSTAGRAM_LINK_IN_BIO"
  | "MANUAL_ADMIN_REVIEW"
  | "VERIFICATION_CODE"
  | "NONE";

export type BackendHiringIdentity = {
  id: string;
  owner_user_id: string;
  type: BackendHiringIdentityType;
  platform: BackendHiringIdentityPlatform;
  display_name: string;
  handle?: string | null;
  url?: string | null;
  avatar_url?: string | null;
  description?: string | null;
  managed_by_agency_name?: string | null;
  is_agency_represented: boolean;
  verification_status: BackendHiringIdentityVerificationStatus;
  verification_method: BackendHiringIdentityVerificationMethod;
  verification_code?: string | null;
  verification_code_expires_at?: string | null;
  verification_attempt_count?: number | null;
  verification_last_checked_at?: string | null;
  verification_last_error?: string | null;
  proof_url?: string | null;
  verified_at?: string | null;
  created_at: string;
  updated_at: string;
};

export type BackendRepresentedChannel = {
  id: string;
  name: string;
  avatar_url?: string | null;
  url?: string | null;
  platform?: string | null;
  authorization_status?: "verified" | "pending" | "rejected" | "revoked" | null;
  is_self?: boolean | null;
};

export type BackendHiringIdentitiesResponse = {
  items: BackendHiringIdentity[];
};

export type BackendHiringIdentityPayload = {
  type: BackendHiringIdentityType;
  platform: BackendHiringIdentityPlatform;
  display_name: string;
  handle?: string | null;
  url?: string | null;
  avatar_url?: string | null;
  description?: string | null;
  managed_by_agency_name?: string | null;
  is_agency_represented?: boolean;
  proof_url?: string | null;
};

export type BackendHiringIdentityUpdatePayload = Partial<BackendHiringIdentityPayload>;

export type BackendHiringIdentityVerificationResponse = {
  identity: BackendHiringIdentity;
  message: string;
};

export type BackendRole = {
  id: string;
  name: string;
  slug?: string;
  category: string;
  description?: string | null;
};

export type BackendRoleListResponse = {
  items: BackendRole[];
};

export type BackendRoleQuestionOption = {
  id: string;
  value: string;
};

export type BackendRoleQuestion = {
  id: string;
  role_id: string;
  label: string;
  help_text?: string | null;
  type: "single_select" | "multi_select" | "text" | "number";
  required: boolean;
  options: BackendRoleQuestionOption[];
};

export type BackendRoleQuestionsResponse = {
  role_id: string;
  items: BackendRoleQuestion[];
};

export type BackendUserRolesResponse = {
  items: BackendRole[];
};

export type BackendUserRoleAnswer = {
  role_question_id: string;
  answer: unknown;
};

export type BackendUserRoleAnswersResponse = {
  items: BackendUserRoleAnswer[];
};

export type BackendRoleAnswerSummary = {
  role_question_id: string;
  role_name: string;
  question_label: string;
  answer: unknown;
};

export type BackendContentStyle = {
  primary_niche?: string | null;
  format: string[];
  tone: string[];
  target_audience?: string | null;
  editing_complexity?: string | null;
};

export type BackendContentStyleNichesResponse = {
  items: string[];
};

export type BackendProfileCompletionResponse = {
  completion_percent: number;
  missing_required_sections: string[];
};

export type BackendProfileResponse = {
  id: string;
  email: string;
  account_type: BackendAccountType;
  account_type_selected_at?: string | null;
  onboarding_intent: BackendOnboardingIntent;
  onboarding_intent_selected_at?: string | null;
  username?: string | null;
  username_change_count: number;
  username_last_changed_at?: string | null;
  display_name?: string | null;
  headline?: string | null;
  bio?: string | null;
  skills: string[];
  public_links: string[];
  experience?: BackendProfileExperienceItem[];
  availability_status?: "available" | "selective" | "unavailable";
  location?: string | null;
  timezone?: string | null;
  avatar_mode: "generic" | "youtube_channel";
  avatar_url?: string | null;
  avatar_youtube_channel_id?: string | null;
  banner_url?: string | null;
  social_connections: BackendSocialConnections;
  stats: BackendProfileStats;
  reviews: BackendReviewsSummary;
  review_items?: BackendProfileReviewItem[];
  reviews_by_mode?: BackendReviewsByMode;
  collaboration_preferences: BackendCollaborationPreferences;
  hiring_info: BackendHiringInfo;
  creator_platforms?: string[] | null;
  roles: BackendRole[];
  role_answers_summary: BackendRoleAnswerSummary[];
  content_style: BackendContentStyle;
  privacy_settings: BackendPrivacySettings;
  profile_capabilities: BackendProfileCapabilities;
  can_change_username: boolean;
  username_next_change_at?: string | null;
};

export type BackendProfileUpdatePayload = {
  username?: string;
  display_name?: string;
  headline?: string;
  bio?: string;
  skills?: string[];
  public_links?: string[];
  experience?: BackendProfileExperienceItem[];
  availability_status?: "available" | "selective" | "unavailable";
  location?: string;
  timezone?: string;
  avatar_mode?: "generic" | "youtube_channel";
  avatar_youtube_channel_id?: string | null;
  avatar_url?: string;
  instagram_handle?: string;
  instagram_url?: string;
  project_type_preference?: "oneOff" | "retainer" | "either" | null;
  collaboration_turnaround?: string;
  collaboration_revisions?: string;
  collaboration_working_hours?: string;
  collaboration_tools?: string;
  collaboration_styles?: string[];
  work_mode?: string | null;
  hiring_type?: BackendHiringType | null;
  hiring_website_or_social_url?: string | null;
  hiring_primary_platform?: BackendHiringPrimaryPlatform | null;
  hiring_platforms?: string[];
  hiring_niches?: string[];
  hiring_genres?: string[];
  hiring_formats?: string[];
  creator_platforms?: string[];
  hiring_channels_or_pages_managed?: string | null;
};

export type BackendAvatarUploadPayload = {
  file_name: string;
  content_type: string;
  data_url: string;
};

export type BackendPrivacyUpdatePayload = Partial<BackendPrivacySettings>;

export type BackendPortfolioItem = {
  id: string;
  user_id: string;
  title: string;
  source_type?: "youtube" | "custom" | "website" | "drive" | "behance" | "instagram" | "vimeo" | "other";
  source_url?: string | null;
  role_id?: string | null;
  role_name?: string | null;
  role?: string | null;
  user_role_in_project?: string | null;
  description?: string | null;
  contribution_summary?: string | null;
  what_i_did?: string | null;
  whatIDid?: string | null;
  contribution_highlights?: string[] | null;
  contributionHighlights?: string[] | null;
  timestamp_notes?: Array<Record<string, unknown>> | null;
  timestampNotes?: Array<Record<string, unknown>> | null;
  timeframe?: "now" | "past";
  media_url?: string | null;
  metrics?: string | null;
  youtube_url?: string | null;
  thumbnail_url?: string | null;
  thumbnail_options?: Array<Record<string, unknown>>;
  channel_name?: string | null;
  channel_id?: string | null;
  views?: number | null;
  published_date?: string | null;
  published_at?: string | null;
  duration?: string | null;
  retention_percent?: number | null;
  links: string[];
  tags: string[];
  contribution_tags?: string[];
  tools: string[];
  content_niches?: string[];
  contentNiches?: string[];
  content_genres?: string[];
  contentGenres?: string[];
  platforms?: string[];
  formats?: string[];
  results?: string[];
  public_metrics?: Record<string, unknown>;
  manual_metrics?: Record<string, unknown>;
  verification_status?: "youtube_metadata_verified" | "manual" | "unverified";
  visibility?: "public" | "private";
  publish_status?: "draft" | "published";
  portfolio_status?: "now" | "past";
  is_featured?: boolean;
  status: "now" | "past";
  is_public: boolean;
  created_at: string;
  updated_at: string;
};

export type BackendPortfolioListResponse = {
  items: BackendPortfolioItem[];
};

export type BackendPortfolioCreatePayload = {
  title: string;
  source_type?: "youtube" | "custom" | "website" | "drive" | "behance" | "instagram" | "vimeo" | "other";
  source_url?: string;
  role_id?: string;
  role_name?: string;
  role?: string;
  user_role_in_project?: string;
  description?: string;
  contribution_summary?: string;
  what_i_did?: string;
  contribution_highlights?: string[];
  timestamp_notes?: Array<Record<string, unknown>>;
  timeframe?: "now" | "past";
  links?: string[];
  tags?: string[];
  contribution_tags?: string[];
  tools?: string[];
  content_niches?: string[];
  content_genres?: string[];
  platforms?: string[];
  formats?: string[];
  results?: string[];
  media_url?: string;
  metrics?: string;
  youtube_url?: string;
  thumbnail_url?: string;
  thumbnail_options?: Array<Record<string, unknown>>;
  channel_name?: string;
  channel_id?: string;
  views?: number;
  published_date?: string;
  published_at?: string;
  duration?: string;
  retention_percent?: number;
  public_metrics?: Record<string, unknown>;
  manual_metrics?: Record<string, unknown>;
  verification_status?: "youtube_metadata_verified" | "manual" | "unverified";
  visibility?: "public" | "private";
  publish_status?: "draft" | "published";
  portfolio_status?: "now" | "past";
  is_featured?: boolean;
  status?: "now" | "past";
  is_public?: boolean;
};

export type BackendPortfolioUpdatePayload = Partial<BackendPortfolioCreatePayload>;

export type BackendPortfolioYouTubePayload = {
  youtube_url: string;
  retention_percent?: number | null;
  user_role_in_project?: string | null;
  status?: "now" | "past";
  is_public?: boolean;
};

export type BackendPortfolioYouTubePreviewResponse = {
  source_type: "youtube";
  source_url: string;
  video_id: string;
  title: string;
  description?: string | null;
  description_snippet?: string | null;
  thumbnail_url?: string | null;
  thumbnail_options?: Array<Record<string, unknown>>;
  channel_name?: string | null;
  channel_id?: string | null;
  published_at?: string | null;
  view_count?: number | null;
  like_count?: number | null;
  comment_count?: number | null;
  duration_iso?: string | null;
  duration_label?: string | null;
  public_metrics: Record<string, unknown>;
  verification_status: "youtube_metadata_verified";
};

export type BackendPortfolioLinkPreviewSourceType =
  | "youtube"
  | "vimeo"
  | "drive"
  | "google_docs"
  | "notion"
  | "behance"
  | "instagram"
  | "tiktok"
  | "website"
  | "external_link"
  | "unknown";

export type BackendPortfolioLinkPreviewResponse = {
  source_type: BackendPortfolioLinkPreviewSourceType;
  source_url: string;
  canonical_url: string;
  title: string;
  description: string;
  thumbnail_url: string;
  provider_name: string;
  author_name: string;
  published_at?: string | null;
  embed_html?: string | null;
  public_metrics: {
    views?: number | null;
    likes?: number | null;
    comments?: number | null;
    duration?: string | null;
  };
  confidence: "high" | "medium" | "low";
  status: "ok" | "partial" | "manual_required";
  manual_required_fields: string[];
};

export type BackendPublicJobItem = {
  id: string;
  title: string;
  category?: string | null;
  primary_role_name_snapshot?: string | null;
  role_specialization?: string | null;
  location?: string | null;
  status: string;
  created_at: string;
  channel_name?: string | null;
};

export type BackendPublicTalentListingItem = {
  id: string;
  title: string;
  primary_role?: string | null;
  location?: string | null;
  timezone?: string | null;
  status: string;
  is_featured: boolean;
  created_at: string;
};

export type BackendPublicYouTubeBadge = {
  channel_id: string;
  title: string;
  thumbnail_url?: string | null;
};

export type BackendPublicProfileResponse = {
  username: string;
  display_name: string;
  headline?: string | null;
  bio?: string | null;
  avatar_url?: string | null;
  avatar_mode: "generic" | "youtube_channel";
  banner_url?: string | null;
  skills: string[];
  public_links: string[];
  experience?: BackendProfileExperienceItem[];
  availability_status?: "available" | "selective" | "unavailable";
  location?: string | null;
  timezone?: string | null;
  social_connections: BackendSocialConnections;
  stats: BackendProfileStats;
  reviews: BackendReviewsSummary;
  review_items?: BackendProfileReviewItem[];
  reviews_by_mode?: BackendReviewsByMode;
  collaboration_preferences: BackendCollaborationPreferences;
  hiring_info?: BackendHiringInfo | null;
  creator_platforms?: string[] | null;
  roles: BackendRole[];
  role_answers_summary: BackendRoleAnswerSummary[];
  content_style: BackendContentStyle;
  youtube_badge?: BackendPublicYouTubeBadge | null;
  represented_channels?: BackendRepresentedChannel[];
  jobs_active: BackendPublicJobItem[];
  jobs_past: BackendPublicJobItem[];
  portfolio_now: BackendPortfolioItem[];
  portfolio_past: BackendPortfolioItem[];
  jobs_preview: BackendPublicJobItem[];
  portfolio_preview: BackendPortfolioItem[];
  talent_listings_active?: BackendPublicTalentListingItem[];
  talent_listings_preview?: BackendPublicTalentListingItem[];
  moved_to_username?: string | null;
};

export type BackendPublicJobsListResponse = {
  username: string;
  tab: "active" | "past";
  items: BackendPublicJobItem[];
};

export type BackendPublicPortfolioListResponse = {
  username: string;
  tab: "now" | "past";
  items: BackendPortfolioItem[];
};

export type BackendSavedJob = {
  id: string;
  user_id: string;
  job_id: string;
  note?: string | null;
  job_snapshot?: Record<string, unknown>;
  created_at: string;
};

export type BackendJobApplication = {
  id: string;
  job_id: string;
  applicant_user_id: string;
  job_owner_user_id?: string | null;
  cover_note?: string | null;
  portfolio_item_ids: string[];
  first_message_answers?: Record<string, unknown>;
  applicant_snapshot: Record<string, unknown>;
  /**
   * `under_consideration` appears only on a *sender-facing* read: the backend
   * translates the legacy stored `shortlisted` into it before serialising to
   * the applicant (`_participant_facing_status`). It was missing from this union,
   * so the display mapping had no branch for it and legacy records reached the
   * workspace with no status at all.
   */
  status:
    | "new" | "reviewing" | "shortlisted" | "under_consideration" | "interviewing"
    | "hired" | "rejected" | "archived" | "withdrawn";
  status_version: number;
  participant_status:
    | "new" | "reviewing" | "shortlisted" | "under_consideration" | "interviewing"
    | "hired" | "rejected" | "archived" | "withdrawn";
  legacy_archive_resolution_required?: boolean;
  archived_at?: string | null;
  /** Job owner's private pipeline note. The backend blanks it on sender-facing reads. */
  manager_note?: string | null;
  created_at: string;
  updated_at: string;
  engagement?: BackendEngagementSummary | null;
  status_history?: BackendInteractionStatusEvent[];
};

export type BackendInteractionStatusEvent = {
  id: string;
  previous_status?: string | null;
  new_status: string;
  status_version: number;
  event_kind: string;
  audience: "manager_only" | "participants";
  created_at: string;
};

export type BackendTalentListing = {
  id: string;
  owner_user_id: string;
  owner_display_name?: string | null;
  owner_username?: string | null;
  owner_avatar_url?: string | null;
  title: string;
  primary_role?: string | null;
  /** Legacy experience range/level string (e.g. "2–4 years"). Retained for backward compatibility. */
  experience_level?: string | null;
  /** Canonical talent experience: exact whole years of self-declared experience. */
  experience_years?: number | null;
  roles: string[];
  niche?: string | null;
  content_niches?: string[];
  content_genres?: string[];
  formats: string[];
  platforms: string[];
  tools: string[];
  languages?: string[];
  work_mode?: string | null;
  location?: string | null;
  timezone?: string | null;
  availability_status: "available" | "selective" | "unavailable";
  rate_min?: number | null;
  rate_max?: number | null;
  rate_currency?: string | null;
  rate_note?: string | null;
  open_slots?: number | null;
  turnaround?: string | null;
  description?: string | null;
  portfolio_item_ids: string[];
  first_message_requirements?: string[];
  first_message_custom_instruction?: string | null;
  status: "draft" | "published" | "paused" | "closed" | "archived" | "featured";
  is_featured: boolean;
  featured_until?: string | null;
  paused_at?: string | null;
  closed_at?: string | null;
  views: number;
  saves: number;
  response_rate?: number | null;
  created_at: string;
  updated_at: string;
};

export type BackendTalentListingPayload = {
  title: string;
  primary_role?: string | null;
  experience_level?: string | null;
  experience_years?: number | null;
  roles?: string[];
  niche?: string | null;
  content_niches?: string[];
  content_genres?: string[];
  formats?: string[];
  platforms?: string[];
  tools?: string[];
  languages?: string[];
  work_mode?: string | null;
  location?: string | null;
  timezone?: string | null;
  availability_status?: "available" | "selective" | "unavailable";
  rate_min?: number | null;
  rate_max?: number | null;
  rate_currency?: string | null;
  rate_note?: string | null;
  open_slots?: number | null;
  turnaround?: string | null;
  description?: string | null;
  portfolio_item_ids?: string[];
  first_message_requirements?: string[];
  first_message_custom_instruction?: string | null;
  status?: "draft" | "published" | "paused" | "closed" | "archived" | "featured";
  is_featured?: boolean;
  featured_until?: string | null;
  paused_at?: string | null;
  closed_at?: string | null;
};

export type BackendTalentListingListResponse = {
  items: BackendTalentListing[];
  total: number;
  limit: number;
  offset: number;
};

export type BackendSavedTalentListing = {
  id: string;
  user_id: string;
  talent_listing_id: string;
  note?: string | null;
  talent_snapshot?: Record<string, unknown>;
  created_at: string;
};

export type BackendSavedSummaryResponse = {
  jobs: Array<{ saved: BackendSavedJob; job?: BackendJob | null }>;
  talent: Array<{ saved: BackendSavedTalentListing; talent?: BackendTalentListing | null }>;
};

export type BackendTalentInterest = {
  id: string;
  talent_listing_id: string;
  recruiter_user_id: string;
  recruiter_display_name?: string | null;
  recruiter_username?: string | null;
  recruiter_avatar_url?: string | null;
  job_id?: string | null;
  owner_user_id: string;
  note?: string | null;
  first_message_answers?: Record<string, unknown>;
  status: "new" | "reviewing" | "accepted" | "declined" | "archived" | "withdrawn";
  status_version: number;
  participant_status: "new" | "reviewing" | "accepted" | "declined" | "archived" | "withdrawn";
  legacy_archive_resolution_required?: boolean;
  archived_at?: string | null;
  /** Talent's (listing owner's) private pipeline note. Blanked on sender-facing reads. */
  manager_note?: string | null;
  created_at: string;
  updated_at: string;
  engagement?: BackendEngagementSummary | null;
  status_history?: BackendInteractionStatusEvent[];
};

export type BackendInteractionPrivateNote = {
  id: string;
  application_id?: string | null;
  talent_interest_id?: string | null;
  body: string;
  created_at: string;
};

export type BackendEngagementStatus =
  | "ready_to_start"
  | "start_pending"
  | "active"
  | "completion_pending"
  | "completed"
  | "ended_after_start"
  | "cancelled_before_start";

export type BackendEngagementAction =
  | "request_start"
  | "confirm_start"
  | "decline_start"
  | "cancel_before_start"
  | "request_completion"
  | "confirm_completion"
  | "flag_completion_issue"
  | "write_review"
  | "edit_review";

export type BackendReviewState = "not_eligible" | "available" | "submitted" | "published" | "expired";

export type BackendEngagementSummary = {
  id: string;
  source_type: "job_application" | "talent_interest";
  source_record_id: string;
  status: BackendEngagementStatus;
  context_label: string;
  counterpart_name: string;
  started_at?: string | null;
  response_due_at?: string | null;
  finalized_at?: string | null;
  review_window_ends_at?: string | null;
  available_actions: BackendEngagementAction[];
  review_state: BackendReviewState;
  /**
   * Payment, reported separately from `status`. Absent or null means nothing
   * has been asserted — which is not the same claim as "not_applicable" — and
   * nothing in the application lifecycle reads this.
   */
  payment_state?: BackendPaymentState | null;
  payment_state_updated_at?: string | null;
  payment_note?: string | null;
};

/** Bounded payment vocabulary. Wholly separate from any lifecycle status. */
export type BackendPaymentState =
  | "not_applicable"
  | "setup_pending"
  | "funding_pending"
  | "funded"
  | "work_in_progress"
  | "release_requested"
  | "released"
  | "disputed"
  | "refunded"
  | "expired";

export type BackendMyReview = {
  id: string;
  engagement_id: string;
  direction: "recruiter_to_talent" | "talent_to_recruiter";
  overall_rating: number;
  dimension_ratings: Record<string, number>;
  public_feedback?: string | null;
  status: "submitted" | "published" | "hidden";
  submitted_at: string;
  published_at?: string | null;
  editable: boolean;
};

export type BackendReviewOpportunity = {
  engagement: BackendEngagementSummary;
  direction: "recruiter_to_talent" | "talent_to_recruiter";
  my_review?: BackendMyReview | null;
};

export type BackendReviewWorkspace = {
  mode: "talent" | "hiring";
  received: BackendProfileReviewCollection;
  opportunities: BackendReviewOpportunity[];
  written: BackendReviewOpportunity[];
};

export type BackendActivitySummaryResponse = {
  my_jobs: BackendJob[];
  my_talent_listings: BackendTalentListing[];
  sent_applications: BackendJobApplication[];
  received_applications: BackendJobApplication[];
  received_interests: BackendTalentInterest[];
  sent_interests: BackendTalentInterest[];
  related_jobs: BackendJob[];
  related_talent_listings: BackendTalentListing[];
};

export type SavedSummary = {
  jobs: Array<{ saved: BackendSavedJob; job: Job | null }>;
  talent: Array<{ saved: BackendSavedTalentListing; talent: BackendTalentListing | null }>;
};

export type ActivitySummary = {
  myJobs: Job[];
  myTalentListings: BackendTalentListing[];
  sentApplications: BackendJobApplication[];
  receivedApplications: BackendJobApplication[];
  receivedInterests: BackendTalentInterest[];
  sentInterests: BackendTalentInterest[];
  relatedJobs: Job[];
  relatedTalentListings: BackendTalentListing[];
};

export type BackendNotification = {
  id: string;
  user_id: string;
  type: string;
  category?: string;
  title: string;
  body?: string | null;
  resource_type?: string | null;
  resource_id?: string | null;
  action_url?: string | null;
  read_at?: string | null;
  created_at: string;
};

export type BackendNotificationListResponse = {
  items: BackendNotification[];
  unread_count: number;
};

export type BackendReport = {
  id: string;
  reporter_user_id?: string | null;
  target_type: "job" | "talent_listing" | "profile" | "message" | "review";
  target_id: string;
  category: string;
  note?: string | null;
  status: "open" | "dismissed" | "action_taken";
  admin_note?: string | null;
  resolved_by_user_id?: string | null;
  resolved_at?: string | null;
  action?: string | null;
  created_at: string;
  updated_at: string;
};

export type BackendEntitlement = {
  id: string;
  user_id: string;
  kind: "job_post" | "talent_listing" | "featured_job" | "featured_talent_listing";
  target_type?: string | null;
  target_id?: string | null;
  source: "free_launch" | string;
  status: string;
  metadata_json: Record<string, unknown>;
  expires_at?: string | null;
  checkout_intent_id?: string | null;
  created_at: string;
};

export type BackendOAuthUpsertPayload = {
  provider_account_id: string;
  access_token?: string | null;
  refresh_token?: string | null;
  expires_at?: number | null;
  scope?: string | null;
};

export type BackendYouTubeChannelsResponse = {
  channels: BackendMeYouTubeChannel[];
};

export type BackendYouTubeRefreshResponse = {
  status: string;
  channels: BackendMeYouTubeChannel[];
};

export type ListJobsParams = {
  q?: string;
  role?: string | string[];
  platform?: string | string[];
  format?: string | string[];
  work_mode?: string | string[];
  engagement_type?: string | string[];
  budget_unit?: string | string[];
  language?: string | string[];
  location?: string;
  start_timeframe?: string;
  status?: string;
  limit?: number;
  offset?: number;
};

export type ListJobsResult = {
  items: Job[];
  total: number;
  limit: number;
  offset: number;
  backendUrl: string;
};

const normalizeLegacyCategory = (value?: string | null): string | null => value?.trim() || null;

const ensureStartTimeframe = (value?: string | null): StartTimeframe => {
  // The legacy frontend type predates nullable start timing. Keep its wire shape
  // without presenting an uncaptured value as an explicit "Flexible" choice.
  if (!value) return "" as StartTimeframe;
  if (START_VALUES.includes(value as StartTimeframe)) {
    return value as StartTimeframe;
  }
  return "" as StartTimeframe;
};

const formatPostedShort = (createdAt?: string) => {
  if (!createdAt) return "";
  const timestamp = Date.parse(createdAt);
  if (Number.isNaN(timestamp)) return "";
  const diffMs = Math.max(0, Date.now() - timestamp);
  const mins = Math.max(1, Math.round(diffMs / 60000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  return `${days}d`;
};

const asString = (value: unknown): string | undefined => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
};

const asNumber = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
};

const asBoolean = (value: unknown): boolean | undefined => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (["true", "1", "yes", "on"].includes(value.toLowerCase())) return true;
    if (["false", "0", "no", "off"].includes(value.toLowerCase())) return false;
  }
  return undefined;
};

const asStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => asString(entry)).filter((entry): entry is string => Boolean(entry));
};

const asNullableStringArray = (value: unknown): string[] | null =>
  value == null ? null : asStringArray(value);

const asNullableObjectArray = <T>(value: unknown): T[] | null =>
  value == null
    ? null
    : Array.isArray(value)
      ? (value.filter((entry) => entry !== null && typeof entry === "object") as T[])
      : [];

const asReferenceVideos = (value: unknown): ReferenceVideo[] => {
  if (!Array.isArray(value)) return [];

  return value
    .map((entry) => normalizeReferenceVideo(entry))
    .filter((entry): entry is ReferenceVideo => Boolean(entry));
};

const formatBudget = ({
  amount,
  maxAmount,
  note,
  currency,
  unit,
}: {
  amount?: number;
  maxAmount?: number;
  note?: string;
  currency?: string;
  unit?: string;
}) => {
  const normalizedNote = note?.trim();
  if (normalizedNote) return normalizedNote;
  if (amount === undefined) return "Compensation not specified";
  const normalizedCurrency = currency?.toUpperCase() || "";
  const normalizedUnit = unit?.trim() || "";
  const symbol = normalizedCurrency === "INR" ? "₹" : normalizedCurrency ? `${normalizedCurrency} ` : "";
  if (maxAmount !== undefined && maxAmount >= amount && maxAmount !== amount) {
    return `${symbol}${amount.toLocaleString("en-US")} - ${symbol}${maxAmount.toLocaleString(
      "en-US"
    )}${normalizedUnit ? ` ${normalizedUnit}` : ""}`;
  }
  return `${symbol}${amount.toLocaleString("en-US")}${normalizedUnit ? ` ${normalizedUnit}` : ""}`;
};

/**
 * Exported for the Backend/Mock parity suite.
 *
 * Every activity-summary reader goes through this — `getActivitySummary` maps
 * both `my_jobs` and `related_jobs` through it before the workspace ever sees
 * them. A parity test that fed the raw snake_case payload straight to the mapper
 * would be testing a path no user has, and would report the client's own
 * normalisation as missing backend fields. It did exactly that.
 */
export const toFrontendJob = (job: BackendJob): Job => {
  const budgetAmount =
    asNumber(job.budget_amount) ??
    asNumber(job.budget_min);
  const budgetMax = asNumber(job.budget_max);
  const budgetNote = asString(job.budget_note) ?? asString(job.budgetNote);
  const budgetCurrency = asString(job.budget_currency);
  const budgetUnit = asString(job.budget_unit);
  const experience =
    asString(job.experience_level) ??
    asString(job.experienceLevel) ??
    "";
  const startTimeframe =
    asString(job.start_timeframe) ??
    asString(job.startTimeframe);
  const createdAt = asString(job.created_at) ?? asString(job.createdAt);
  const updatedAt = asString(job.updated_at) ?? asString(job.updatedAt);
  const platforms = asStringArray(job.platforms);
  const rawPlatform = platforms[0] || asString(job.platform);
  const channelName = asString(job.channel_name) ?? asString(job.channelName) ?? "";
  const channelLogo =
    asString(job.channel_logo_url) ??
    asString(job.channel_avatar_url) ??
    asString(job.channelAvatarUrl) ??
    "";
  const channelSubscribers =
    asNumber(job.channel_subscribers) ??
    asNumber(job.subscriber_count) ??
    asNumber(job.subscriberCount) ??
    null;
  const responseRate =
    asNumber(job.response_rate) ??
    asNumber(job.match_percentage) ??
    asNumber(job.matchPercentage) ??
    0;
  const legacyCategory = normalizeLegacyCategory(asString(job.category));
  const primaryRoleName = asString(job.primary_role_name_snapshot);

  return {
    id: asString(job.id) || "",
    title: asString(job.title) || "Untitled job",
    category: (legacyCategory || "Uncategorized") as JobCategory,
    legacyCategory,
    listingSchemaVersion: asNumber(job.listing_schema_version),
    primaryRoleId: asString(job.primary_role_id),
    primaryRoleName,
    roleSpecialization: asString(job.role_specialization),
    budget: formatBudget({
      amount: budgetAmount,
      maxAmount: budgetMax,
      note: budgetNote,
      currency: budgetCurrency,
      unit: budgetUnit,
    }),
    experience,
    location: asString(job.location) || "",
    postedShort: formatPostedShort(createdAt),
    views: asNumber(job.views) ?? 0,
    applicants: asNumber(job.applicants) ?? 0,
    responseRate,
    channel: {
      name: channelName,
      logoUrl: channelLogo,
      subscribers: channelSubscribers,
      verified: Boolean(asBoolean(job.is_verified)),
    },
    tags: asStringArray(job.tags),
    tools: asStringArray(job.tools),
    requiredToolKeys: asNullableStringArray(job.required_tool_keys),
    otherRequiredTools: asNullableStringArray(job.other_required_tools),
    deliverables: asNullableObjectArray(job.deliverables),
    requiredSkillKeys: asNullableStringArray(job.required_skill_keys),
    preferredSkillKeys: asNullableStringArray(job.preferred_skill_keys),
    otherRequiredSkills: asNullableStringArray(job.other_required_skills),
    otherPreferredSkills: asNullableStringArray(job.other_preferred_skills),
    requiredSkillsNote: asString(job.required_skills_note),
    preferredSkillsNote: asString(job.preferred_skills_note),
    revisionPolicy: asString(job.revision_policy) as Job["revisionPolicy"],
    revisionRounds: asNumber(job.revision_rounds),
    revisionNotes: asString(job.revision_notes),
    sourceInputs: asNullableObjectArray(job.source_inputs),
    sourceInputsNotes: asString(job.source_inputs_notes),
    creativeAutonomy: asString(job.creative_autonomy) as Job["creativeAutonomy"],
    creativeAutonomyNotes: asString(job.creative_autonomy_notes),
    languageRequirements: asNullableObjectArray(job.language_requirements),
    trialStatus: asString(job.trial_status) as Job["trialStatus"],
    trialScope: asString(job.trial_scope),
    trialEffortValue: asNumber(job.trial_effort_value),
    trialEffortUnit: asString(job.trial_effort_unit) as Job["trialEffortUnit"],
    trialCompensationAmount: asNumber(job.trial_compensation_amount),
    trialCompensationCurrency: asString(job.trial_compensation_currency),
    trialCompensationBasis: asString(job.trial_compensation_basis) as Job["trialCompensationBasis"],
    trialWorkUsage: asString(job.trial_work_usage) as Job["trialWorkUsage"],
    trialPortfolioPermission: asString(job.trial_portfolio_permission) as Job["trialPortfolioPermission"],
    trialAttribution: asString(job.trial_attribution) as Job["trialAttribution"],
    unpaidTrialConfirmed: asBoolean(job.unpaid_trial_confirmed),
    trialNotes: asString(job.trial_notes),
    startTiming: asString(job.start_timing) as Job["startTiming"],
    startDate: asString(job.start_date),
    durationType: asString(job.duration_type) as Job["durationType"],
    durationValue: asNumber(job.duration_value),
    durationUnit: asString(job.duration_unit) as Job["durationUnit"],
    engagementEndDate: asString(job.engagement_end_date),
    hiringProcess: asNullableObjectArray(job.hiring_process),
    hiringProcessNotes: asString(job.hiring_process_notes),
    screeningQuestions: asNullableObjectArray(job.screening_questions),
    employerContextType: asString(job.employer_context_type) as Job["employerContextType"],
    languages: asStringArray(job.languages),
    contentNiches: asStringArray(job.content_niches ?? job.contentNiches),
    contentGenres: asStringArray(job.content_genres ?? job.contentGenres),
    formatsHiredFor: asStringArray(job.formats_hired_for ?? job.formatsHiredFor),
    startTimeframe: ensureStartTimeframe(startTimeframe),
    workMode: asString(job.work_mode),
    engagementType: asString(job.engagement_type),
    compensationMode: asString(job.compensation_mode),
    budgetAmount,
    budgetMax,
    budgetCurrency,
    budgetUnit,
    budgetUnitCustom: asString(job.budget_unit_custom),
    budgetNote,
    contractType: asString(job.contract_type),
    timezoneOverlap: asString(job.timezone_overlap),
    weeklyHours: asString(job.weekly_hours),
    expectedWeeklyHoursMin: asNumber(job.expected_weekly_hours_min),
    expectedWeeklyHoursMax: asNumber(job.expected_weekly_hours_max),
    turnaroundValue: asNumber(job.turnaround_value),
    turnaroundUnit: asString(job.turnaround_unit),
    turnaroundBasis: asString(job.turnaround_basis),
    applicationMode: asString(job.application_mode),
    externalApplyUrl: asString(job.external_apply_url),
    deadlineAt: asString(job.deadline_at),
    platform: rawPlatform || "",
    platforms,
    referenceVideos: asReferenceVideos(job.reference_videos ?? job.referenceVideos),
    about: asString(job.about_channel) ?? asString(job.aboutChannel) ?? "",
    responsibilities: asStringArray(job.responsibilities).join("\n"),
    requirements: asStringArray(job.requirements).join("\n"),
    applicationRequirements: asStringArray(job.application_requirements),
    howToApply: asString(job.how_to_apply) ?? asString(job.howToApply) ?? "",
    channelProfileSlug: asString(job.channel_profile_slug),
    channelExternalUrl: asString(job.hiring_external_url_snapshot),
    postedByAgency: Boolean(asBoolean(job.posted_by_agency)),
    agencyProfileSlug: asString(job.agency_profile_slug),
    postedPlatform: asString(job.posted_platform),
    postedYoutubeChannelId: asString(job.posted_youtube_channel_id),
    postedByUserId: asString(job.posted_by_user_id),
    hiringIdentityId: asString(job.hiring_identity_id),
    hiringDisplayName: asString(job.hiring_display_name_snapshot),
    hiringPlatform: asString(job.hiring_platform_snapshot),
    hiringVerificationStatus: asString(job.hiring_verification_status_snapshot),
    managedByAgencyName: asString(job.managed_by_agency_name_snapshot),
    status: asString(job.status),
    featuredUntil: asString(job.featured_until),
    pausedAt: asString(job.paused_at),
    closedAt: asString(job.closed_at),
    createdAt,
    updatedAt,
    draftCompletion: {
      hasTitle: Boolean(asString(job.title)?.trim()),
      hasBudget: budgetAmount !== undefined || budgetMax !== undefined,
      hasPlatform: Boolean(rawPlatform),
      hasWorkMode: Boolean(asString(job.work_mode)?.trim()),
      hasChannel: Boolean(
        asString(job.hiring_identity_id)?.trim() ||
          asString(job.hiring_display_name_snapshot)?.trim() ||
          asString(job.channel_name)?.trim()
      ),
      hasExperience: Boolean(experience && experience.trim() && experience.trim().toLowerCase() !== "any"),
      hasTimeline: Boolean(
        asString(job.weekly_hours)?.trim() ||
          asNumber(job.expected_weekly_hours_min) !== undefined ||
          asNumber(job.turnaround_value) !== undefined ||
          (startTimeframe && startTimeframe.trim().toLowerCase() !== "flexible")
      ),
    },
  };
};

const normalizeBackendListPayload = (
  payload: unknown
): {
  items: BackendJob[];
  total: number;
  limit: number;
  offset: number;
} => {
  if (Array.isArray(payload)) {
    return {
      items: payload as BackendJob[],
      total: payload.length,
      limit: payload.length,
      offset: 0,
    };
  }

  if (!payload || typeof payload !== "object") {
    return { items: [], total: 0, limit: 0, offset: 0 };
  }

  const parsed = payload as BackendListResponse;
  const rawItems = Array.isArray(parsed.items)
    ? parsed.items
    : Array.isArray(parsed.results)
      ? parsed.results
      : Array.isArray(parsed.data)
        ? parsed.data
        : [];

  const total = asNumber(parsed.total) ?? rawItems.length;
  const limit = asNumber(parsed.limit) ?? rawItems.length;
  const offset = asNumber(parsed.offset) ?? 0;

  return {
    items: rawItems as BackendJob[],
    total,
    limit,
    offset,
  };
};

const getBackendErrorMessage = (status: number, text: string) => {
  try {
    const parsed = JSON.parse(text) as BackendErrorShape;
    const directDetail =
      typeof parsed.detail === "string" && parsed.detail.trim() ? parsed.detail : undefined;
    if (directDetail) return directDetail;
    const structuredDetail =
      typeof parsed.detail === "object" &&
      parsed.detail !== null &&
      typeof parsed.detail.message === "string" &&
      parsed.detail.message.trim()
        ? parsed.detail.message
        : undefined;
    if (structuredDetail) return structuredDetail;
    const nestedMessage =
      typeof parsed.error?.message === "string" && parsed.error.message.trim()
        ? parsed.error.message
        : undefined;
    if (nestedMessage) return nestedMessage;
  } catch {
    // Non-JSON backend responses fall back to the raw body text.
  }
  return text || `Backend request failed (${status})`;
};

type RequestJsonOptions = RequestInit & {
  accessToken?: string;
  timeoutMs?: number;
};

const parseTimeoutMs = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

// Keep writes generous, but fail fast for local read-only page loads when a
// stale backend process is holding the port without serving the API.
const BACKEND_REQUEST_TIMEOUT_MS = parseTimeoutMs(
  process.env.NEXT_PUBLIC_BACKEND_REQUEST_TIMEOUT_MS,
  8000
);
const LOCAL_BACKEND_READ_TIMEOUT_MS = parseTimeoutMs(
  process.env.NEXT_PUBLIC_BACKEND_READ_TIMEOUT_MS,
  2500
);

const getRequestTimeoutMs = (init?: RequestJsonOptions) => {
  if (init?.timeoutMs) return init.timeoutMs;
  const method = (init?.method || "GET").toUpperCase();
  const isRead = method === "GET" || method === "HEAD";
  if (process.env.NODE_ENV === "development" && isLocalBackendUrl() && isRead) {
    return Math.min(BACKEND_REQUEST_TIMEOUT_MS, LOCAL_BACKEND_READ_TIMEOUT_MS);
  }
  return BACKEND_REQUEST_TIMEOUT_MS;
};

export class BackendRequestError extends Error {
  status: number;
  fieldErrors?: Record<string, string[]>;
  code?: string;
  details?: unknown;
  requestId?: string;

  constructor(
    status: number,
    message: string,
    fieldErrors?: Record<string, string[]>,
    metadata?: { code?: string; details?: unknown; requestId?: string }
  ) {
    super(message);
    this.name = "BackendRequestError";
    this.status = status;
    this.fieldErrors = fieldErrors;
    this.code = metadata?.code;
    this.details = metadata?.details;
    this.requestId = metadata?.requestId;
  }
}

export const isBackendAuthError = (error: unknown) => {
  if (error instanceof BackendRequestError) {
    return error.status === 401;
  }
  if (!(error instanceof Error)) {
    return false;
  }
  const normalized = error.message.toLowerCase();
  return (
    normalized.includes("invalid or expired token") ||
    normalized.includes("not authenticated") ||
    normalized.includes("could not validate credentials") ||
    normalized.includes("credentials")
  );
};

/** True when the failure is the backend being unreachable (down/CORS/timeout). */
export const isBackendUnreachableError = (error: unknown) =>
  error instanceof BackendRequestError && error.status === 0;

/**
 * Turns a caught client-action error into a clear, user-facing message instead
 * of a generic "try again". Surfaces the real backend reason (the message
 * already carries the parsed `detail`/`error.message`), with friendlier copy for
 * the two cases users actually hit: backend offline and expired session.
 */
export const describeActionError = (error: unknown, fallback = "Something went wrong. Try again."): string => {
  if (isBackendUnreachableError(error)) {
    return "Can’t reach the backend right now. Make sure it’s running (npm run dev:all), then reload and try again.";
  }
  if (isBackendAuthError(error)) {
    return "Your session has expired. Please sign in again.";
  }
  if (error instanceof BackendRequestError && error.message) {
    return error.message;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
};

/** Shared authenticated JSON transport for typed, non-UI API contract modules. */
export async function requestJson<T>(path: string, init?: RequestJsonOptions): Promise<T> {
  const headers = new Headers(init?.headers);
  const hasBody = typeof init?.body !== "undefined";
  if (hasBody && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (init?.accessToken) {
    headers.set("Authorization", `Bearer ${init.accessToken}`);
  }

  let response: Response;
  const controller = new AbortController();
  const timeoutMs = getRequestTimeoutMs(init);
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const externalSignal = init?.signal;
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener("abort", () => controller.abort(), { once: true });
    }
  }

  const fetchInit: RequestInit = { ...(init || {}) };
  delete (fetchInit as RequestJsonOptions).accessToken;
  delete (fetchInit as RequestJsonOptions).timeoutMs;
  delete fetchInit.signal;
  try {
    response = await fetch(`${getBackendBaseUrl()}${path}`, {
      cache: "no-store",
      ...fetchInit,
      headers,
      signal: controller.signal,
    });
  } catch (error) {
    const reason =
      error instanceof Error && error.name === "AbortError"
        ? `Request timed out after ${timeoutMs}ms`
        : error instanceof Error && error.message
          ? error.message
          : "Network request failed";
    throw new BackendRequestError(
      0,
      `Could not reach backend (${getBackendBaseUrl()}). ${reason}. Start backend and verify NEXT_PUBLIC_BACKEND_URL.`
    );
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const text = await response.text();
    let fieldErrors: Record<string, string[]> | undefined;
    let errorMetadata:
      | { code?: string; details?: unknown; requestId?: string }
      | undefined;
    try {
      const parsed = JSON.parse(text) as BackendErrorShape;
      fieldErrors = normalizeBackendFieldErrors(parsed);
      const wrappedDetails = parsed.error?.details;
      errorMetadata = {
        code:
          parsed.error?.code ||
          (typeof parsed.detail === "object" && parsed.detail !== null
            ? parsed.detail.code
            : undefined),
        details:
          wrappedDetails &&
          !Array.isArray(wrappedDetails) &&
          Object.prototype.hasOwnProperty.call(wrappedDetails, "details")
            ? wrappedDetails.details
            : wrappedDetails,
        requestId: parsed.error?.request_id,
      };
    } catch {
      // The message parser below handles non-JSON responses.
    }
    throw new BackendRequestError(
      response.status,
      getBackendErrorMessage(response.status, text),
      fieldErrors,
      errorMetadata
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export async function listJobsWithMeta(params: ListJobsParams = {}): Promise<ListJobsResult> {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    query.set(key, Array.isArray(value) ? value.join(",") : String(value));
  });
  if (!query.has("limit")) query.set("limit", "100");
  if (!query.has("offset")) query.set("offset", "0");

  const payload = await requestJson<unknown>(`/jobs?${query.toString()}`);
  const normalized = normalizeBackendListPayload(payload);

  return {
    items: normalized.items.map(toFrontendJob),
    total: normalized.total,
    limit: normalized.limit,
    offset: normalized.offset,
    backendUrl: getBackendBaseUrl(),
  };
}

export async function listJobsFromBackend(): Promise<Job[]> {
  const payload = await listJobsWithMeta({ limit: 100, offset: 0 });
  return payload.items;
}

export async function getJobByIdFromBackend(id: string): Promise<Job | null> {
  try {
    const payload = await requestJson<BackendJob>(`/jobs/${encodeURIComponent(id)}`);
    return toFrontendJob(payload);
  } catch {
    return null;
  }
}

export async function createJobInBackend(
  payload: BackendCreateJobPayload,
  options: { accessToken?: string } = {}
): Promise<Job> {
  const writablePayload = { ...payload };
  delete writablePayload.hiring_external_url_snapshot;
  delete writablePayload.posted_by_agency;
  delete writablePayload.agency_profile_slug;
  const response = await requestJson<BackendJob>("/jobs", {
    method: "POST",
    body: JSON.stringify(writablePayload),
    accessToken: options.accessToken,
  });
  return toFrontendJob(response);
}

export async function listJobs(params: ListJobsParams = {}): Promise<Job[]> {
  const payload = await listJobsWithMeta(params);
  return payload.items;
}

export async function getJobById(id: string): Promise<Job | null> {
  return getJobByIdFromBackend(id);
}

export async function createJob(
  payload: BackendCreateJobPayload,
  options: { accessToken?: string } = {}
): Promise<Job> {
  return createJobInBackend(payload, options);
}

export async function updateJob(
  accessToken: string,
  jobId: string,
  payload: Partial<BackendCreateJobPayload>
): Promise<Job> {
  const writablePayload = { ...payload };
  delete writablePayload.hiring_external_url_snapshot;
  delete writablePayload.posted_by_agency;
  delete writablePayload.agency_profile_slug;
  const response = await requestJson<BackendJob>(`/jobs/${encodeURIComponent(jobId)}`, {
    method: "PATCH",
    body: JSON.stringify(writablePayload),
    accessToken,
  });
  return toFrontendJob(response);
}

export async function deleteJob(accessToken: string, jobId: string): Promise<Job> {
  const response = await requestJson<BackendJob>(`/jobs/${encodeURIComponent(jobId)}`, {
    method: "DELETE",
    accessToken,
  });
  return toFrontendJob(response);
}

export async function registerWithEmail(
  email: string,
  password: string,
  username: string
): Promise<BackendAuthStatusResponse> {
  return requestJson<BackendAuthStatusResponse>("/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password, username }),
  });
}

export async function verifyEmailToken(token: string): Promise<BackendAuthStatusResponse> {
  return requestJson<BackendAuthStatusResponse>("/auth/verify-email", {
    method: "POST",
    body: JSON.stringify({ token }),
  });
}

export async function resendVerification(
  email: string
): Promise<BackendResendVerificationResponse> {
  return requestJson<BackendResendVerificationResponse>("/auth/resend-verification", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export async function requestPasswordReset(email: string): Promise<BackendPasswordResetResponse> {
  return requestJson<BackendPasswordResetResponse>("/auth/password-reset/request", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export async function confirmPasswordReset(
  token: string,
  password: string
): Promise<BackendPasswordResetResponse> {
  return requestJson<BackendPasswordResetResponse>("/auth/password-reset/confirm", {
    method: "POST",
    body: JSON.stringify({ token, password }),
  });
}

export async function exchangeGoogleOAuthForBackend(
  payload: BackendOAuthGoogleExchangePayload
): Promise<BackendLoginExchangeResponse> {
  return requestJson<BackendLoginExchangeResponse>("/auth/oauth/google", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function getMe(accessToken: string): Promise<BackendMeResponse> {
  return requestJson<BackendMeResponse>("/me", { accessToken });
}

export async function updateMyAccountType(
  accessToken: string,
  accountType: BackendPublicAccountType
): Promise<BackendMeResponse> {
  return requestJson<BackendMeResponse>("/me/account-type", {
    method: "PATCH",
    body: JSON.stringify({ account_type: accountType }),
    accessToken,
  });
}

export async function updateMyOnboardingIntent(
  accessToken: string,
  onboardingIntent: BackendOnboardingIntent
): Promise<BackendMeResponse> {
  return requestJson<BackendMeResponse>("/me/onboarding-intent", {
    method: "PATCH",
    body: JSON.stringify({ onboarding_intent: onboardingIntent }),
    accessToken,
  });
}

export async function upsertGoogleOAuthForMe(
  accessToken: string,
  payload: BackendOAuthUpsertPayload
): Promise<BackendAuthStatusResponse> {
  return requestJson<BackendAuthStatusResponse>("/me/oauth/google/upsert", {
    method: "POST",
    body: JSON.stringify(payload),
    accessToken,
  });
}

export async function refreshMyYouTubeChannels(
  accessToken: string
): Promise<BackendYouTubeRefreshResponse> {
  return requestJson<BackendYouTubeRefreshResponse>("/me/youtube/refresh", {
    method: "POST",
    accessToken,
  });
}

export async function listMyYouTubeChannels(
  accessToken: string
): Promise<BackendYouTubeChannelsResponse> {
  return requestJson<BackendYouTubeChannelsResponse>("/me/youtube/channels", {
    accessToken,
  });
}

export async function getMyProfile(accessToken: string): Promise<BackendProfileResponse> {
  return requestJson<BackendProfileResponse>("/me/profile", { accessToken });
}

export async function updateMyProfile(
  accessToken: string,
  payload: BackendProfileUpdatePayload
): Promise<BackendProfileResponse> {
  return requestJson<BackendProfileResponse>("/me/profile", {
    method: "PATCH",
    body: JSON.stringify(payload),
    accessToken,
  });
}

export async function uploadMyAvatar(
  accessToken: string,
  payload: BackendAvatarUploadPayload
): Promise<BackendProfileResponse> {
  return requestJson<BackendProfileResponse>("/me/avatar", {
    method: "POST",
    body: JSON.stringify(payload),
    accessToken,
  });
}

export async function uploadMyBanner(
  accessToken: string,
  payload: BackendAvatarUploadPayload
): Promise<BackendProfileResponse> {
  return requestJson<BackendProfileResponse>("/me/banner", {
    method: "POST",
    body: JSON.stringify(payload),
    accessToken,
  });
}

export async function updateMyPrivacy(
  accessToken: string,
  payload: BackendPrivacyUpdatePayload
): Promise<BackendProfileResponse> {
  return requestJson<BackendProfileResponse>("/me/privacy", {
    method: "PATCH",
    body: JSON.stringify(payload),
    accessToken,
  });
}

export async function listMyHiringIdentities(
  accessToken: string
): Promise<BackendHiringIdentitiesResponse> {
  return requestJson<BackendHiringIdentitiesResponse>("/me/hiring-identities", { accessToken });
}

export async function createMyHiringIdentity(
  accessToken: string,
  payload: BackendHiringIdentityPayload
): Promise<BackendHiringIdentity> {
  return requestJson<BackendHiringIdentity>("/me/hiring-identities", {
    method: "POST",
    body: JSON.stringify(payload),
    accessToken,
  });
}

export async function updateMyHiringIdentity(
  accessToken: string,
  identityId: string,
  payload: BackendHiringIdentityUpdatePayload
): Promise<BackendHiringIdentity> {
  return requestJson<BackendHiringIdentity>(
    `/me/hiring-identities/${encodeURIComponent(identityId)}`,
    {
      method: "PATCH",
      body: JSON.stringify(payload),
      accessToken,
    }
  );
}

export async function deleteMyHiringIdentity(
  accessToken: string,
  identityId: string
): Promise<void> {
  await requestJson<unknown>(`/me/hiring-identities/${encodeURIComponent(identityId)}`, {
    method: "DELETE",
    accessToken,
  });
}

export async function requestMyHiringIdentityVerification(
  accessToken: string,
  identityId: string,
  proofUrl?: string | null
): Promise<BackendHiringIdentityVerificationResponse> {
  return requestJson<BackendHiringIdentityVerificationResponse>(
    `/me/hiring-identities/${encodeURIComponent(identityId)}/request-verification`,
    {
      method: "POST",
      body: JSON.stringify({ proof_url: proofUrl || null }),
      accessToken,
    }
  );
}

export async function checkMyHiringIdentityVerification(
  accessToken: string,
  identityId: string
): Promise<BackendHiringIdentityVerificationResponse> {
  return requestJson<BackendHiringIdentityVerificationResponse>(
    `/me/hiring-identities/${encodeURIComponent(identityId)}/check-verification`,
    {
      method: "POST",
      body: JSON.stringify({}),
      accessToken,
    }
  );
}

export async function listMyPortfolio(accessToken: string): Promise<BackendPortfolioListResponse> {
  return requestJson<BackendPortfolioListResponse>("/portfolio/items?user_id=me", { accessToken });
}

export async function createMyPortfolioItem(
  accessToken: string,
  payload: BackendPortfolioCreatePayload
): Promise<BackendPortfolioItem> {
  return requestJson<BackendPortfolioItem>("/portfolio/items", {
    method: "POST",
    body: JSON.stringify(payload),
    accessToken,
  });
}

export async function updateMyPortfolioItem(
  accessToken: string,
  itemId: string,
  payload: BackendPortfolioUpdatePayload
): Promise<BackendPortfolioItem> {
  return requestJson<BackendPortfolioItem>(`/portfolio/items/${encodeURIComponent(itemId)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
    accessToken,
  });
}

export async function deleteMyPortfolioItem(
  accessToken: string,
  itemId: string
): Promise<BackendAuthStatusResponse> {
  return requestJson<BackendAuthStatusResponse>(`/portfolio/items/${encodeURIComponent(itemId)}`, {
    method: "DELETE",
    accessToken,
  });
}

export async function listRoles(): Promise<BackendRoleListResponse> {
  return requestJson<BackendRoleListResponse>("/roles");
}

export async function getRoleQuestions(roleId: string): Promise<BackendRoleQuestionsResponse> {
  return requestJson<BackendRoleQuestionsResponse>(`/roles/${encodeURIComponent(roleId)}/questions`);
}

export async function getMyRoles(accessToken: string): Promise<BackendUserRolesResponse> {
  return requestJson<BackendUserRolesResponse>("/user/roles", { accessToken });
}

export async function upsertMyRoles(
  accessToken: string,
  roleIds: string[]
): Promise<BackendUserRolesResponse> {
  return requestJson<BackendUserRolesResponse>("/user/roles", {
    method: "POST",
    body: JSON.stringify({ role_ids: roleIds }),
    accessToken,
  });
}

export async function upsertMyRolesByName(
  accessToken: string,
  roleNames: string[]
): Promise<BackendUserRolesResponse> {
  return requestJson<BackendUserRolesResponse>("/user/roles", {
    method: "POST",
    body: JSON.stringify({ role_names: roleNames }),
    accessToken,
  });
}

export async function getMyRoleAnswers(accessToken: string): Promise<BackendUserRoleAnswersResponse> {
  return requestJson<BackendUserRoleAnswersResponse>("/user/role-answers", { accessToken });
}

export async function upsertMyRoleAnswers(
  accessToken: string,
  answers: BackendUserRoleAnswer[]
): Promise<BackendUserRoleAnswersResponse> {
  return requestJson<BackendUserRoleAnswersResponse>("/user/role-answers", {
    method: "POST",
    body: JSON.stringify({ answers }),
    accessToken,
  });
}

export async function listContentStyleNiches(): Promise<BackendContentStyleNichesResponse> {
  return requestJson<BackendContentStyleNichesResponse>("/content-style/niches");
}

export async function getMyContentStyle(accessToken: string): Promise<BackendContentStyle> {
  return requestJson<BackendContentStyle>("/user/content-style", { accessToken });
}

export async function upsertMyContentStyle(
  accessToken: string,
  payload: BackendContentStyle
): Promise<BackendContentStyle> {
  return requestJson<BackendContentStyle>("/user/content-style", {
    method: "POST",
    body: JSON.stringify(payload),
    accessToken,
  });
}

export async function getMyProfileCompletion(
  accessToken: string
): Promise<BackendProfileCompletionResponse> {
  return requestJson<BackendProfileCompletionResponse>("/profile/completion", { accessToken });
}

export async function createPortfolioFromYouTube(
  accessToken: string,
  payload: BackendPortfolioYouTubePayload
): Promise<BackendPortfolioItem> {
  return requestJson<BackendPortfolioItem>("/portfolio/youtube", {
    method: "POST",
    body: JSON.stringify(payload),
    accessToken,
  });
}

export async function previewPortfolioYouTube(
  accessToken: string,
  url: string
): Promise<BackendPortfolioYouTubePreviewResponse> {
  return requestJson<BackendPortfolioYouTubePreviewResponse>("/portfolio/youtube/preview", {
    method: "POST",
    body: JSON.stringify({ url }),
    accessToken,
  });
}

export async function previewPortfolioLink(
  accessToken: string,
  url: string
): Promise<BackendPortfolioLinkPreviewResponse> {
  return requestJson<BackendPortfolioLinkPreviewResponse>("/portfolio/link-preview", {
    method: "POST",
    body: JSON.stringify({ url }),
    accessToken,
  });
}

export async function listPortfolioByUserId(
  userId: string,
  options: { accessToken?: string } = {}
): Promise<BackendPortfolioListResponse> {
  return requestJson<BackendPortfolioListResponse>(`/portfolio/${encodeURIComponent(userId)}`, {
    accessToken: options.accessToken,
  });
}

export async function getPublicProfile(
  username: string
): Promise<BackendPublicProfileResponse> {
  return requestJson<BackendPublicProfileResponse>(
    `/users/${encodeURIComponent(username)}/public-profile`
  );
}

export async function getPublicProfileJobs(
  username: string,
  tab: "active" | "past" = "active"
): Promise<BackendPublicJobsListResponse> {
  return requestJson<BackendPublicJobsListResponse>(
    `/users/${encodeURIComponent(username)}/jobs?tab=${encodeURIComponent(tab)}`
  );
}

export async function getPublicProfilePortfolio(
  username: string,
  tab: "now" | "past" = "now"
): Promise<BackendPublicPortfolioListResponse> {
  return requestJson<BackendPublicPortfolioListResponse>(
    `/users/${encodeURIComponent(username)}/portfolio?tab=${encodeURIComponent(tab)}`
  );
}

export async function saveJob(accessToken: string, jobId: string, note?: string | null): Promise<BackendSavedJob> {
  return requestJson<BackendSavedJob>(`/jobs/${encodeURIComponent(jobId)}/save`, {
    method: "POST",
    body: JSON.stringify({ note: note || null }),
    accessToken,
  });
}

export async function unsaveJob(accessToken: string, jobId: string): Promise<BackendAuthStatusResponse> {
  return requestJson<BackendAuthStatusResponse>(`/jobs/${encodeURIComponent(jobId)}/save`, {
    method: "DELETE",
    accessToken,
  });
}

export async function listMySavedJobs(accessToken: string): Promise<BackendSavedJob[]> {
  return requestJson<BackendSavedJob[]>("/me/saved-jobs", { accessToken });
}

export async function getSavedSummary(accessToken: string): Promise<SavedSummary> {
  const response = await requestJson<BackendSavedSummaryResponse>("/me/saved/summary", { accessToken });
  return {
    jobs: response.jobs.map((item) => ({
      saved: item.saved,
      job: item.job ? toFrontendJob(item.job) : null,
    })),
    talent: response.talent.map((item) => ({
      saved: item.saved,
      talent: item.talent || null,
    })),
  };
}

export async function listMyJobs(accessToken: string): Promise<Job[]> {
  const rows = await requestJson<BackendJob[]>("/me/jobs", { accessToken });
  return rows.map(toFrontendJob);
}

export async function listMyBackendJobs(accessToken: string): Promise<BackendJob[]> {
  return requestJson<BackendJob[]>("/me/jobs", { accessToken });
}

export async function applyToJob(
  accessToken: string,
  jobId: string,
  payload: {
    cover_note?: string | null;
    portfolio_item_ids?: string[];
    first_message_answers?: Record<string, unknown>;
  } = {}
): Promise<BackendJobApplication> {
  return requestJson<BackendJobApplication>(`/jobs/${encodeURIComponent(jobId)}/applications`, {
    method: "POST",
    body: JSON.stringify({
      cover_note: payload.cover_note || null,
      portfolio_item_ids: payload.portfolio_item_ids || [],
      first_message_answers: payload.first_message_answers || {},
    }),
    accessToken,
  });
}

export async function getMyApplicationForJob(
  accessToken: string,
  jobId: string
): Promise<BackendJobApplication | null> {
  return requestJson<BackendJobApplication | null>(
    `/jobs/${encodeURIComponent(jobId)}/application`,
    { accessToken }
  );
}

export async function listMySentApplications(accessToken: string): Promise<BackendJobApplication[]> {
  return requestJson<BackendJobApplication[]>("/me/applications/sent", { accessToken });
}

export async function listMyReceivedApplications(accessToken: string): Promise<BackendJobApplication[]> {
  return requestJson<BackendJobApplication[]>("/me/applications/received", { accessToken });
}

export type BackendInteractionTransitionResponse<T> = {
  outcome: "transitioned" | "already_in_state";
  current_status: string;
  status_version: number;
  application?: T;
  interest?: T;
};

export async function transitionApplicationStatus(
  accessToken: string,
  applicationId: string,
  statusValue: BackendJobApplication["status"],
  expectedVersion: number,
  idempotencyKey: string
): Promise<BackendInteractionTransitionResponse<BackendJobApplication>> {
  return requestJson<BackendInteractionTransitionResponse<BackendJobApplication>>(
    `/applications/${encodeURIComponent(applicationId)}/transition`,
    {
      method: "POST",
      body: JSON.stringify({
        status: statusValue,
        expected_version: expectedVersion,
        idempotency_key: idempotencyKey,
      }),
      accessToken,
    }
  );
}

export async function setApplicationArchived(
  accessToken: string,
  applicationId: string,
  archived: boolean
): Promise<BackendJobApplication> {
  return requestJson<BackendJobApplication>(
    `/applications/${encodeURIComponent(applicationId)}/archive`,
    {
      method: "POST",
      body: JSON.stringify({ archived }),
      accessToken,
    }
  );
}

/**
 * Share a previously-private application decision with the applicant. The
 * optional `note` travels inside this request so the explanation is persisted
 * in the same transaction as the decision it explains — never as a separate
 * message that could land without it.
 */
export async function communicateApplicationStatus(
  accessToken: string,
  applicationId: string,
  statusValue: BackendJobApplication["status"],
  expectedVersion: number,
  idempotencyKey: string,
  note?: string
): Promise<BackendInteractionTransitionResponse<BackendJobApplication>> {
  return requestJson<BackendInteractionTransitionResponse<BackendJobApplication>>(
    `/applications/${encodeURIComponent(applicationId)}/status-communication`,
    {
      method: "POST",
      body: JSON.stringify({
        status: statusValue,
        expected_version: expectedVersion,
        idempotency_key: idempotencyKey,
        ...(note ? { note } : {}),
      }),
      accessToken,
    }
  );
}

/** Move several received applications to one pipeline stage (job owner only). */
export async function bulkUpdateApplicationStatus(
  accessToken: string,
  applicationIds: string[],
  statusValue: BackendJobApplication["status"]
): Promise<BackendJobApplication[]> {
  return requestJson<BackendJobApplication[]>("/applications/bulk-status", {
    method: "POST",
    body: JSON.stringify({ ids: applicationIds, status: statusValue }),
    accessToken,
  });
}

export async function listApplicationPrivateNotes(
  accessToken: string,
  applicationId: string
): Promise<BackendInteractionPrivateNote[]> {
  return requestJson<BackendInteractionPrivateNote[]>(
    `/applications/${encodeURIComponent(applicationId)}/notes`,
    { accessToken }
  );
}

export async function createApplicationPrivateNote(
  accessToken: string,
  applicationId: string,
  body: string
): Promise<BackendInteractionPrivateNote> {
  return requestJson<BackendInteractionPrivateNote>(
    `/applications/${encodeURIComponent(applicationId)}/notes`,
    { method: "POST", body: JSON.stringify({ body }), accessToken }
  );
}

export async function deleteApplicationPrivateNote(
  accessToken: string,
  applicationId: string,
  noteId: string
): Promise<void> {
  return requestJson<void>(
    `/applications/${encodeURIComponent(applicationId)}/notes/${encodeURIComponent(noteId)}`,
    { method: "DELETE", accessToken }
  );
}

// Sender-only: the applicant withdraws their own application. Backend sets the
// status to "withdrawn" and notifies the job owner.
export async function withdrawApplication(
  accessToken: string,
  applicationId: string
): Promise<BackendJobApplication> {
  return requestJson<BackendJobApplication>(`/applications/${encodeURIComponent(applicationId)}/withdraw`, {
    method: "POST",
    accessToken,
  });
}

export async function listTalentListings(params: {
  q?: string;
  role?: string;
  location?: string;
  platform?: string;
  availability?: string;
  status?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<BackendTalentListingListResponse> {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    query.set(key, String(value));
  });
  if (!query.has("limit")) query.set("limit", "100");
  if (!query.has("offset")) query.set("offset", "0");
  return requestJson<BackendTalentListingListResponse>(`/talent-listings?${query.toString()}`);
}

export async function getTalentListing(listingId: string): Promise<BackendTalentListing> {
  return requestJson<BackendTalentListing>(`/talent-listings/${encodeURIComponent(listingId)}`);
}

export async function listMyTalentListings(accessToken: string): Promise<BackendTalentListing[]> {
  return requestJson<BackendTalentListing[]>("/me/talent-listings", { accessToken });
}

export async function createTalentListing(
  accessToken: string,
  payload: BackendTalentListingPayload
): Promise<BackendTalentListing> {
  return requestJson<BackendTalentListing>("/talent-listings", {
    method: "POST",
    body: JSON.stringify(payload),
    accessToken,
  });
}

export async function updateTalentListing(
  accessToken: string,
  listingId: string,
  payload: Partial<BackendTalentListingPayload>
): Promise<BackendTalentListing> {
  return requestJson<BackendTalentListing>(`/talent-listings/${encodeURIComponent(listingId)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
    accessToken,
  });
}

export async function deleteTalentListing(
  accessToken: string,
  listingId: string
): Promise<BackendAuthStatusResponse> {
  return requestJson<BackendAuthStatusResponse>(`/talent-listings/${encodeURIComponent(listingId)}`, {
    method: "DELETE",
    accessToken,
  });
}

export async function saveTalentListing(
  accessToken: string,
  listingId: string,
  note?: string | null
): Promise<BackendSavedTalentListing> {
  return requestJson<BackendSavedTalentListing>(`/talent-listings/${encodeURIComponent(listingId)}/save`, {
    method: "POST",
    body: JSON.stringify({ note: note || null }),
    accessToken,
  });
}

export async function unsaveTalentListing(
  accessToken: string,
  listingId: string
): Promise<BackendAuthStatusResponse> {
  return requestJson<BackendAuthStatusResponse>(`/talent-listings/${encodeURIComponent(listingId)}/save`, {
    method: "DELETE",
    accessToken,
  });
}

export async function sendTalentInterest(
  accessToken: string,
  listingId: string,
  note?: string | null,
  jobId?: string | null,
  firstMessageAnswers?: Record<string, unknown>
): Promise<BackendTalentInterest> {
  return requestJson<BackendTalentInterest>(`/talent-listings/${encodeURIComponent(listingId)}/interest`, {
    method: "POST",
    body: JSON.stringify({
      note: note || null,
      job_id: jobId || null,
      first_message_answers: firstMessageAnswers || {},
    }),
    accessToken,
  });
}

export async function getMyTalentInterestForListing(
  accessToken: string,
  listingId: string
): Promise<BackendTalentInterest | null> {
  return requestJson<BackendTalentInterest | null>(
    `/talent-listings/${encodeURIComponent(listingId)}/interest`,
    { accessToken }
  );
}

export async function listMySavedTalent(accessToken: string): Promise<BackendSavedTalentListing[]> {
  return requestJson<BackendSavedTalentListing[]>("/me/saved-talent", { accessToken });
}

export async function listMyTalentInterests(accessToken: string): Promise<BackendTalentInterest[]> {
  return requestJson<BackendTalentInterest[]>("/me/talent-interests", { accessToken });
}

export async function listMySentTalentInterests(accessToken: string): Promise<BackendTalentInterest[]> {
  return requestJson<BackendTalentInterest[]>("/me/talent-interests/sent", { accessToken });
}

export async function getActivitySummary(accessToken: string): Promise<ActivitySummary> {
  const response = await requestJson<BackendActivitySummaryResponse>("/me/activity/summary", { accessToken });
  return {
    myJobs: response.my_jobs.map(toFrontendJob),
    myTalentListings: response.my_talent_listings,
    sentApplications: response.sent_applications,
    receivedApplications: response.received_applications,
    receivedInterests: response.received_interests,
    sentInterests: response.sent_interests,
    relatedJobs: response.related_jobs.map(toFrontendJob),
    relatedTalentListings: response.related_talent_listings,
  };
}

/**
 * Move a hiring request to a new status. Accepted and declined are shared with
 * the recruiter the moment they are recorded, so this is the only opportunity
 * to attach the optional `note` — it commits with the decision or not at all.
 */
export async function transitionTalentInterestStatus(
  accessToken: string,
  interestId: string,
  statusValue: BackendTalentInterest["status"],
  expectedVersion: number,
  idempotencyKey: string,
  note?: string
): Promise<BackendInteractionTransitionResponse<BackendTalentInterest>> {
  return requestJson<BackendInteractionTransitionResponse<BackendTalentInterest>>(
    `/talent-interests/${encodeURIComponent(interestId)}/transition`,
    {
      method: "POST",
      body: JSON.stringify({
        status: statusValue,
        expected_version: expectedVersion,
        idempotency_key: idempotencyKey,
        ...(note ? { note } : {}),
      }),
      accessToken,
    }
  );
}

export async function setTalentInterestArchived(
  accessToken: string,
  interestId: string,
  archived: boolean
): Promise<BackendTalentInterest> {
  return requestJson<BackendTalentInterest>(
    `/talent-interests/${encodeURIComponent(interestId)}/archive`,
    {
      method: "POST",
      body: JSON.stringify({ archived }),
      accessToken,
    }
  );
}

/** Move several received hiring requests to one stage (listing owner only). */
export async function bulkUpdateTalentInterestStatus(
  accessToken: string,
  interestIds: string[],
  statusValue: BackendTalentInterest["status"]
): Promise<BackendTalentInterest[]> {
  return requestJson<BackendTalentInterest[]>("/talent-interests/bulk-status", {
    method: "POST",
    body: JSON.stringify({ ids: interestIds, status: statusValue }),
    accessToken,
  });
}

export async function listTalentInterestPrivateNotes(
  accessToken: string,
  interestId: string
): Promise<BackendInteractionPrivateNote[]> {
  return requestJson<BackendInteractionPrivateNote[]>(
    `/talent-interests/${encodeURIComponent(interestId)}/notes`,
    { accessToken }
  );
}

export async function createTalentInterestPrivateNote(
  accessToken: string,
  interestId: string,
  body: string
): Promise<BackendInteractionPrivateNote> {
  return requestJson<BackendInteractionPrivateNote>(
    `/talent-interests/${encodeURIComponent(interestId)}/notes`,
    { method: "POST", body: JSON.stringify({ body }), accessToken }
  );
}

export async function deleteTalentInterestPrivateNote(
  accessToken: string,
  interestId: string,
  noteId: string
): Promise<void> {
  return requestJson<void>(
    `/talent-interests/${encodeURIComponent(interestId)}/notes/${encodeURIComponent(noteId)}`,
    { method: "DELETE", accessToken }
  );
}

// Sender-only: the recruiter withdraws their own hiring request. Backend sets the
// status to "withdrawn" and notifies the talent (listing owner).
export async function withdrawTalentInterest(
  accessToken: string,
  interestId: string
): Promise<BackendTalentInterest> {
  return requestJson<BackendTalentInterest>(`/talent-interests/${encodeURIComponent(interestId)}/withdraw`, {
    method: "POST",
    accessToken,
  });
}

export async function listNotifications(accessToken: string): Promise<BackendNotificationListResponse> {
  return requestJson<BackendNotificationListResponse>("/notifications", { accessToken });
}

export async function markNotificationRead(
  accessToken: string,
  notificationId: string
): Promise<BackendNotification> {
  return requestJson<BackendNotification>(`/notifications/${encodeURIComponent(notificationId)}/read`, {
    method: "PATCH",
    accessToken,
  });
}

export async function markAllNotificationsRead(accessToken: string): Promise<BackendAuthStatusResponse> {
  return requestJson<BackendAuthStatusResponse>("/notifications/mark-all-read", {
    method: "POST",
    accessToken,
  });
}

// --- Messaging (real conversations attached to applications / hiring requests) ---

export type BackendMessage = {
  id: string;
  conversation_id: string;
  sender_user_id: string;
  from_me: boolean;
  sender_name?: string | null;
  body: string;
  /** "status_update" for platform-generated pipeline updates; absent for user text. */
  kind?: string | null;
  /** Optional composer intent the sender chose; absent for freeform messages. */
  intent?: string | null;
  /** True when that intent genuinely asked the other side for something. */
  response_expected?: boolean;
  created_at?: string | null;
  read_by_recipient?: boolean;
};

export type BackendConversation = {
  id: string;
  context_type: string;
  application_id?: string | null;
  talent_interest_id?: string | null;
  thread_id: string;
  last_message_at?: string | null;
  unread_count: number;
  viewer_last_read_at?: string | null;
  counterparty_last_read_at?: string | null;
  interaction_blocked?: boolean;
  blocked_by_me?: boolean;
  is_closed?: boolean;
};

export type BackendConversationDetail = {
  conversation: BackendConversation;
  messages: BackendMessage[];
  engagement?: BackendEngagementSummary | null;
  /** The arranged interview, if there is one. See {@link BackendInterview}. */
  interview?: BackendInterview | null;
};

export async function listConversations(accessToken: string): Promise<BackendConversation[]> {
  return requestJson<BackendConversation[]>("/me/conversations", { accessToken });
}

export async function getApplicationConversation(
  accessToken: string,
  applicationId: string
): Promise<BackendConversationDetail> {
  return requestJson<BackendConversationDetail>(
    `/me/applications/${encodeURIComponent(applicationId)}/conversation`,
    { accessToken }
  );
}

export async function getInterestConversation(
  accessToken: string,
  interestId: string
): Promise<BackendConversationDetail> {
  return requestJson<BackendConversationDetail>(
    `/me/talent-interests/${encodeURIComponent(interestId)}/conversation`,
    { accessToken }
  );
}

/**
 * Every live engagement the caller takes part in.
 *
 * List-wide because "whose start is still unconfirmed?" is a question about the
 * whole inbox — answering it by opening each thread in turn would make the
 * highest-priority queue unreachable in practice.
 */
export async function listLiveEngagements(
  accessToken: string
): Promise<BackendEngagementSummary[]> {
  return requestJson<BackendEngagementSummary[]>("/me/engagements", { accessToken });
}

export async function requestEngagementStart(
  accessToken: string,
  sourceType: BackendEngagementSummary["source_type"],
  sourceRecordId: string
): Promise<BackendEngagementSummary> {
  const sourcePath = sourceType === "job_application" ? "applications" : "talent-interests";
  return requestJson<BackendEngagementSummary>(
    `/me/${sourcePath}/${encodeURIComponent(sourceRecordId)}/engagement/start-request`,
    { method: "POST", accessToken }
  );
}

export async function respondToEngagementStart(
  accessToken: string,
  engagementId: string,
  decision: "confirm" | "not_started"
): Promise<BackendEngagementSummary> {
  return requestJson<BackendEngagementSummary>(
    `/me/engagements/${encodeURIComponent(engagementId)}/start-response`,
    { method: "POST", body: JSON.stringify({ decision }), accessToken }
  );
}

export async function cancelEngagementBeforeStart(
  accessToken: string,
  engagementId: string
): Promise<BackendEngagementSummary> {
  return requestJson<BackendEngagementSummary>(
    `/me/engagements/${encodeURIComponent(engagementId)}/cancel`,
    { method: "POST", accessToken }
  );
}

export async function requestEngagementCompletion(
  accessToken: string,
  engagementId: string,
  outcome: "completed" | "ended_after_start",
  note?: string | null
): Promise<BackendEngagementSummary> {
  return requestJson<BackendEngagementSummary>(
    `/me/engagements/${encodeURIComponent(engagementId)}/completion-request`,
    { method: "POST", body: JSON.stringify({ outcome, note: note || null }), accessToken }
  );
}

export async function respondToEngagementCompletion(
  accessToken: string,
  engagementId: string,
  decision: "confirm" | "needs_attention",
  note?: string | null
): Promise<BackendEngagementSummary> {
  return requestJson<BackendEngagementSummary>(
    `/me/engagements/${encodeURIComponent(engagementId)}/completion-response`,
    { method: "POST", body: JSON.stringify({ decision, note: note || null }), accessToken }
  );
}

export async function saveEngagementReview(
  accessToken: string,
  engagementId: string,
  payload: {
    overall_rating: number;
    dimension_ratings: Record<string, number>;
    public_feedback?: string | null;
  }
): Promise<BackendMyReview> {
  return requestJson<BackendMyReview>(
    `/me/engagements/${encodeURIComponent(engagementId)}/review`,
    { method: "PUT", body: JSON.stringify(payload), accessToken }
  );
}

export async function getMyReviewWorkspace(
  accessToken: string,
  mode: "talent" | "hiring"
): Promise<BackendReviewWorkspace> {
  return requestJson<BackendReviewWorkspace>(`/me/reviews?mode=${encodeURIComponent(mode)}`, { accessToken });
}

/**
 * Send a message. `intent` is optional and purely an accelerator — it records
 * that the sender was asking for something so the other side's workspace can be
 * precise about what is outstanding. It never changes status; consequential
 * outcomes go through the transition endpoints.
 */
export async function sendConversationMessage(
  accessToken: string,
  conversationId: string,
  body: string,
  clientMessageId?: string,
  intent?: string
): Promise<BackendMessage> {
  return requestJson<BackendMessage>(
    `/me/conversations/${encodeURIComponent(conversationId)}/messages`,
    {
      method: "POST",
      body: JSON.stringify({
        body,
        ...(clientMessageId ? { client_message_id: clientMessageId } : {}),
        ...(intent ? { intent } : {}),
      }),
      accessToken,
    }
  );
}

/**
 * A participant's private organisation of one conversation. Owner-scoped: the
 * counterparty can never read these, and nothing here is lifecycle state.
 */
export type BackendInteractionPreference = {
  conversation_id: string;
  starred: boolean;
  starred_at?: string | null;
  snoozed_until?: string | null;
  queue_dismissed: boolean;
  decision_prompt_dismissed: boolean;
  decision_prompt_trigger_version?: number | null;
};

/** Every preference the signed-in user owns, in one request. */
export async function listInteractionPreferences(
  accessToken: string
): Promise<BackendInteractionPreference[]> {
  return requestJson<BackendInteractionPreference[]>("/me/interaction-preferences", { accessToken });
}

export async function setConversationStarred(
  accessToken: string,
  conversationId: string,
  starred: boolean
): Promise<BackendInteractionPreference> {
  return requestJson<BackendInteractionPreference>(
    `/me/conversations/${encodeURIComponent(conversationId)}/preferences/star`,
    { method: "PUT", body: JSON.stringify({ starred }), accessToken }
  );
}

/** `until` of null clears the snooze. */
export async function setConversationSnooze(
  accessToken: string,
  conversationId: string,
  until: string | null
): Promise<BackendInteractionPreference> {
  return requestJson<BackendInteractionPreference>(
    `/me/conversations/${encodeURIComponent(conversationId)}/preferences/snooze`,
    { method: "PUT", body: JSON.stringify({ until }), accessToken }
  );
}

/** "No reply needed" — corrects a queue recommendation, never the status. */
export async function setConversationQueueDismissed(
  accessToken: string,
  conversationId: string,
  dismissed: boolean
): Promise<BackendInteractionPreference> {
  return requestJson<BackendInteractionPreference>(
    `/me/conversations/${encodeURIComponent(conversationId)}/preferences/queue-dismissal`,
    { method: "PUT", body: JSON.stringify({ dismissed }), accessToken }
  );
}

export async function setConversationDecisionPromptDismissed(
  accessToken: string,
  conversationId: string,
  dismissed: boolean,
  triggerVersion?: number
): Promise<BackendInteractionPreference> {
  return requestJson<BackendInteractionPreference>(
    `/me/conversations/${encodeURIComponent(conversationId)}/preferences/decision-prompt`,
    {
      method: "PUT",
      body: JSON.stringify({ dismissed, trigger_version: triggerVersion ?? null }),
      accessToken,
    }
  );
}

/* -------------------------------------------------------------------------
 * Interview coordination
 *
 * Both participants may read the arrangement — every field was deliberately
 * communicated. Only the managing side may write, which the server enforces
 * regardless of what `can_manage` tells the client.
 * ---------------------------------------------------------------------- */

export type BackendInterview = {
  id: string;
  conversation_id: string;
  status: "proposed" | "confirmed" | "completed" | "cancelled";
  scheduled_at?: string | null;
  timezone: string;
  duration_minutes?: number | null;
  meeting_method: "video_call" | "phone" | "in_person" | "other";
  meeting_detail?: string | null;
  schedule_label: string;
  previous_scheduled_at?: string | null;
  reschedule_count: number;
  round_number: number;
  confirmed_at?: string | null;
  confirmed_by_me: boolean;
  completed_at?: string | null;
  cancelled_at?: string | null;
  version: number;
  can_manage: boolean;
  follow_up_due: boolean;
};

export type ProposeInterviewInput = {
  scheduledAt: string;
  timezone: string;
  meetingMethod: BackendInterview["meeting_method"];
  meetingDetail?: string | null;
  durationMinutes?: number | null;
  note?: string | null;
  /** 0 for a first invitation, the current version for a reschedule. */
  expectedVersion: number;
  /** Required for a first invitation on an application, which also moves the stage. */
  applicationExpectedVersion?: number | null;
  idempotencyKey: string;
};

/** Every interview on a conversation the caller takes part in, in one request. */
export async function listInterviews(accessToken: string): Promise<BackendInterview[]> {
  return requestJson<BackendInterview[]>("/me/interviews", { accessToken });
}

/** Invite, or move an arrangement. Which one happens is decided server-side. */
export async function proposeInterview(
  accessToken: string,
  conversationId: string,
  input: ProposeInterviewInput
): Promise<BackendInterview> {
  return requestJson<BackendInterview>(
    `/me/conversations/${encodeURIComponent(conversationId)}/interview`,
    {
      method: "PUT",
      accessToken,
      body: JSON.stringify({
        scheduled_at: input.scheduledAt,
        timezone: input.timezone,
        meeting_method: input.meetingMethod,
        meeting_detail: input.meetingDetail ?? null,
        duration_minutes: input.durationMinutes ?? null,
        note: input.note ?? null,
        expected_version: input.expectedVersion,
        application_expected_version: input.applicationExpectedVersion ?? null,
        idempotency_key: input.idempotencyKey,
      }),
    }
  );
}

async function interviewAction(
  accessToken: string,
  conversationId: string,
  action: "confirm" | "complete" | "cancel",
  body: Record<string, unknown>
): Promise<BackendInterview> {
  return requestJson<BackendInterview>(
    `/me/conversations/${encodeURIComponent(conversationId)}/interview/${action}`,
    { method: "POST", accessToken, body: JSON.stringify(body) }
  );
}

export async function confirmInterview(
  accessToken: string,
  conversationId: string,
  expectedVersion: number,
  idempotencyKey: string
): Promise<BackendInterview> {
  return interviewAction(accessToken, conversationId, "confirm", {
    expected_version: expectedVersion,
    idempotency_key: idempotencyKey,
  });
}

/** Private bookkeeping: sends nothing, decides nothing. */
export async function completeInterview(
  accessToken: string,
  conversationId: string,
  expectedVersion: number,
  idempotencyKey: string
): Promise<BackendInterview> {
  return interviewAction(accessToken, conversationId, "complete", {
    expected_version: expectedVersion,
    idempotency_key: idempotencyKey,
  });
}

export async function cancelInterview(
  accessToken: string,
  conversationId: string,
  expectedVersion: number,
  idempotencyKey: string,
  reason?: string | null
): Promise<BackendInterview> {
  return interviewAction(accessToken, conversationId, "cancel", {
    expected_version: expectedVersion,
    idempotency_key: idempotencyKey,
    reason: reason ?? null,
  });
}

export type BackendReviewStarted = {
  changed: boolean;
  current_status: string;
  status_version: number;
};

/**
 * Record a deliberate open. Private and owner-only: it never messages or
 * notifies the other participant.
 */
export async function markInteractionReviewStarted(
  accessToken: string,
  kind: "application" | "hiring_request",
  interactionId: string
): Promise<BackendReviewStarted> {
  const base = kind === "application" ? "applications" : "talent-interests";
  return requestJson<BackendReviewStarted>(
    `/${base}/${encodeURIComponent(interactionId)}/review-started`,
    { method: "POST", accessToken }
  );
}

export async function markConversationRead(
  accessToken: string,
  conversationId: string
): Promise<BackendConversation> {
  return requestJson<BackendConversation>(
    `/me/conversations/${encodeURIComponent(conversationId)}/read`,
    { method: "POST", accessToken }
  );
}

export type BackendBlockMutation = {
  interaction_blocked: boolean;
  blocked_by_me: boolean;
};

export async function blockUser(accessToken: string, userId: string): Promise<BackendBlockMutation> {
  return requestJson<BackendBlockMutation>(`/me/blocks/${encodeURIComponent(userId)}`, {
    method: "POST",
    accessToken,
  });
}

export async function unblockUser(accessToken: string, userId: string): Promise<BackendBlockMutation> {
  return requestJson<BackendBlockMutation>(`/me/blocks/${encodeURIComponent(userId)}`, {
    method: "DELETE",
    accessToken,
  });
}

/** User-facing report reasons, matching the backend `ReportCategory` enum. */
export type ReportCategory =
  | "spam"
  | "scam_or_fraud"
  | "harassment"
  | "impersonation"
  | "off_platform_payment"
  | "inappropriate_content"
  | "suspicious_or_inaccurate"
  | "other";

export async function createReport(
  payload: {
    target_type: "job" | "talent_listing" | "profile" | "message" | "review";
    target_id: string;
    category: ReportCategory;
    note?: string | null;
  },
  accessToken?: string
): Promise<BackendReport> {
  return requestJson<BackendReport>("/reports", {
    method: "POST",
    body: JSON.stringify(payload),
    accessToken,
  });
}

// --- Admin panel API (backend/app/api/v1/routers/admin.py) -------------------
// Every call requires an ADMIN session; non-admins receive 403 from the backend
// regardless of what the UI shows.

export type AdminUserRef = {
  id: string;
  display_name?: string | null;
  username?: string | null;
  email?: string | null;
};

export type AdminPageMeta = { total: number; limit: number; offset: number };

export type AdminOverview = {
  env: string;
  email_mode: string;
  email_delivery_enabled: boolean;
  users_total: number;
  users_new_7d: number;
  users_suspended: number;
  jobs_by_status: Record<string, number>;
  jobs_deleted: number;
  talent_by_status: Record<string, number>;
  talent_deleted: number;
  applications_total: number;
  applications_new_7d: number;
  interests_total: number;
  interests_new_7d: number;
  messages_total: number;
  reports_open: number;
  verifications_pending: number;
  entitlements_active: number;
};

export type AdminUserItem = {
  id: string;
  email: string;
  username?: string | null;
  display_name?: string | null;
  avatar_url?: string | null;
  account_type: string;
  email_verified: boolean;
  suspended_at?: string | null;
  suspension_reason?: string | null;
  last_active_at?: string | null;
  created_at: string;
  jobs_count: number;
  talent_listings_count: number;
  applications_sent_count: number;
  profile_reports_count: number;
};

export type AdminIdentitySummary = {
  id: string;
  type: string;
  platform: string;
  display_name: string;
  handle?: string | null;
  url?: string | null;
  proof_url?: string | null;
  verification_status: string;
  verification_method: string;
  verification_attempt_count: number;
  verification_last_error?: string | null;
  verified_at?: string | null;
  created_at: string;
};

export type AdminIdentityItem = AdminIdentitySummary & {
  owner?: AdminUserRef | null;
  jobs_count: number;
};

export type AdminEntitlementItem = {
  id: string;
  user_id: string;
  kind: string;
  target_type?: string | null;
  target_id?: string | null;
  source: string;
  status: string;
  expires_at?: string | null;
  created_at: string;
};

export type AdminReportItem = {
  id: string;
  target_type: "job" | "talent_listing" | "profile" | "message" | "review";
  target_id: string;
  category: string;
  note?: string | null;
  status: "open" | "dismissed" | "action_taken";
  action?: string | null;
  admin_note?: string | null;
  resolved_at?: string | null;
  created_at: string;
  reporter?: AdminUserRef | null;
  target_label?: string | null;
  target_status?: string | null;
  target_owner?: AdminUserRef | null;
  sibling_count: number;
};

export type AdminReportAction =
  | "dismiss"
  | "no_action"
  | "pause_listing"
  | "hide_listing"
  | "hide_review"
  | "restore_review"
  | "warn_user"
  | "suspend_user"
  | "reopen";

export type AdminAuditLogItem = {
  id: string;
  actor?: AdminUserRef | null;
  action: string;
  target_type: string;
  target_id: string;
  target_label?: string | null;
  before_json?: Record<string, unknown> | null;
  after_json?: Record<string, unknown> | null;
  justification?: string | null;
  report_id?: string | null;
  created_at: string;
};

export type AdminUserDetail = {
  user: AdminUserItem;
  hiring_verification_status?: string | null;
  onboarding_intent?: string | null;
  interests_sent_count: number;
  applications_received_count: number;
  portfolio_items_count: number;
  identities: AdminIdentitySummary[];
  entitlements: AdminEntitlementItem[];
  reports_about: AdminReportItem[];
  recent_audit: AdminAuditLogItem[];
};

export type AdminJobItem = {
  id: string;
  title: string;
  status: string;
  is_verified: boolean;
  channel_name?: string | null;
  category?: string | null;
  location?: string | null;
  deleted_at?: string | null;
  created_at: string;
  owner?: AdminUserRef | null;
  applications_count: number;
  reports_count: number;
};

export type AdminTalentListingItem = {
  id: string;
  title: string;
  status: string;
  primary_role?: string | null;
  location?: string | null;
  deleted_at?: string | null;
  created_at: string;
  owner?: AdminUserRef | null;
  interests_count: number;
  reports_count: number;
};

export type AdminListingStateAction = "pause" | "unpause" | "hide" | "unhide" | "close";

export type AdminApplicationItem = {
  id: string;
  status: string;
  created_at: string;
  updated_at: string;
  job_id?: string | null;
  job_title?: string | null;
  applicant?: AdminUserRef | null;
  owner?: AdminUserRef | null;
};

export type AdminInterestItem = {
  id: string;
  status: string;
  created_at: string;
  updated_at: string;
  listing_id?: string | null;
  listing_title?: string | null;
  recruiter?: AdminUserRef | null;
  owner?: AdminUserRef | null;
};

export type AdminAbuseSignals = {
  days: number;
  top_interest_senders: Array<{ user: AdminUserRef; count: number }>;
  top_applicants: Array<{ user: AdminUserRef; count: number }>;
};

export type AdminConversationMessage = {
  id: string;
  sender?: AdminUserRef | null;
  body: string;
  kind?: string | null;
  hidden: boolean;
  created_at: string;
};

export type AdminReportedConversation = {
  report_id: string;
  conversation_id: string;
  context_type: string;
  participants: AdminUserRef[];
  reported_message_id?: string | null;
  messages: AdminConversationMessage[];
};

export type AdminRegistryEvent = {
  key: string;
  category: string;
  recipient: string;
  priority: string;
  default_channels: string[];
  wired: boolean;
  notes?: string | null;
};

export type AdminOutboxItem = {
  id: string;
  to_email: string;
  event_key: string;
  subject: string;
  preview?: string | null;
  status: string;
  error?: string | null;
  created_at: string;
  processed_at?: string | null;
};

function adminQuery(params: Record<string, string | number | boolean | undefined | null>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") query.set(key, String(value));
  }
  const text = query.toString();
  return text ? `?${text}` : "";
}

export async function getAdminOverview(accessToken: string): Promise<AdminOverview> {
  return requestJson<AdminOverview>("/admin/overview", { accessToken });
}

export async function listAdminUsers(
  accessToken: string,
  params: { q?: string; suspended?: boolean; verified?: boolean; limit?: number; offset?: number } = {}
): Promise<AdminPageMeta & { items: AdminUserItem[] }> {
  return requestJson(`/admin/users${adminQuery(params)}`, { accessToken });
}

export async function getAdminUserDetail(accessToken: string, userId: string): Promise<AdminUserDetail> {
  return requestJson<AdminUserDetail>(`/admin/users/${encodeURIComponent(userId)}`, { accessToken });
}

export async function suspendAdminUser(
  accessToken: string,
  userId: string,
  reason: string
): Promise<AdminUserItem> {
  return requestJson<AdminUserItem>(`/admin/users/${encodeURIComponent(userId)}/suspend`, {
    method: "POST",
    body: JSON.stringify({ reason }),
    accessToken,
  });
}

export async function unsuspendAdminUser(
  accessToken: string,
  userId: string,
  reason?: string | null
): Promise<AdminUserItem> {
  return requestJson<AdminUserItem>(`/admin/users/${encodeURIComponent(userId)}/unsuspend`, {
    method: "POST",
    body: JSON.stringify({ reason: reason || null }),
    accessToken,
  });
}

export async function warnAdminUser(
  accessToken: string,
  userId: string,
  payload: { title?: string; body: string; action_url?: string | null }
): Promise<{ ok: boolean }> {
  return requestJson(`/admin/users/${encodeURIComponent(userId)}/warn`, {
    method: "POST",
    body: JSON.stringify(payload),
    accessToken,
  });
}

export async function listAdminJobs(
  accessToken: string,
  params: {
    q?: string;
    status?: string;
    include_deleted?: boolean;
    reported?: boolean;
    limit?: number;
    offset?: number;
  } = {}
): Promise<AdminPageMeta & { items: AdminJobItem[] }> {
  return requestJson(`/admin/jobs${adminQuery(params)}`, { accessToken });
}

export async function setAdminJobState(
  accessToken: string,
  jobId: string,
  action: AdminListingStateAction,
  reason: string
): Promise<AdminJobItem> {
  return requestJson<AdminJobItem>(`/admin/jobs/${encodeURIComponent(jobId)}/state`, {
    method: "PATCH",
    body: JSON.stringify({ action, reason }),
    accessToken,
  });
}

export async function listAdminTalentListings(
  accessToken: string,
  params: { q?: string; status?: string; include_deleted?: boolean; limit?: number; offset?: number } = {}
): Promise<AdminPageMeta & { items: AdminTalentListingItem[] }> {
  return requestJson(`/admin/talent-listings${adminQuery(params)}`, { accessToken });
}

export async function setAdminTalentListingState(
  accessToken: string,
  listingId: string,
  action: AdminListingStateAction,
  reason: string
): Promise<AdminTalentListingItem> {
  return requestJson<AdminTalentListingItem>(
    `/admin/talent-listings/${encodeURIComponent(listingId)}/state`,
    { method: "PATCH", body: JSON.stringify({ action, reason }), accessToken }
  );
}

export async function listAdminReports(
  accessToken: string,
  params: { status?: string; target_type?: string; category?: string; limit?: number; offset?: number } = {}
): Promise<AdminPageMeta & { items: AdminReportItem[] }> {
  return requestJson(`/admin/reports${adminQuery(params)}`, { accessToken });
}

export async function resolveAdminReport(
  accessToken: string,
  reportId: string,
  payload: { action: AdminReportAction; admin_note?: string | null; user_note?: string | null }
): Promise<AdminReportItem> {
  return requestJson<AdminReportItem>(`/admin/reports/${encodeURIComponent(reportId)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
    accessToken,
  });
}

export async function getAdminReportedConversation(
  accessToken: string,
  reportId: string
): Promise<AdminReportedConversation> {
  return requestJson<AdminReportedConversation>(
    `/admin/reports/${encodeURIComponent(reportId)}/conversation`,
    { accessToken }
  );
}

export async function hideAdminMessage(
  accessToken: string,
  messageId: string,
  payload: { reason: string; report_id?: string | null }
): Promise<{ ok: boolean }> {
  return requestJson(`/admin/messages/${encodeURIComponent(messageId)}/hide`, {
    method: "POST",
    body: JSON.stringify(payload),
    accessToken,
  });
}

export async function unhideAdminMessage(
  accessToken: string,
  messageId: string,
  payload: { reason: string; report_id?: string | null }
): Promise<{ ok: boolean }> {
  return requestJson(`/admin/messages/${encodeURIComponent(messageId)}/unhide`, {
    method: "POST",
    body: JSON.stringify(payload),
    accessToken,
  });
}

export async function listAdminHiringIdentities(
  accessToken: string,
  params: { status?: string; limit?: number; offset?: number } = {}
): Promise<AdminPageMeta & { items: AdminIdentityItem[] }> {
  return requestJson(`/admin/hiring-identities${adminQuery(params)}`, { accessToken });
}

export async function decideAdminHiringIdentity(
  accessToken: string,
  identityId: string,
  payload: { decision: "approve" | "reject" | "revoke"; reason?: string | null }
): Promise<AdminIdentityItem> {
  return requestJson<AdminIdentityItem>(`/admin/hiring-identities/${encodeURIComponent(identityId)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
    accessToken,
  });
}

export async function listAdminApplications(
  accessToken: string,
  params: { user_id?: string; days?: number; limit?: number; offset?: number } = {}
): Promise<AdminPageMeta & { items: AdminApplicationItem[] }> {
  return requestJson(`/admin/applications${adminQuery(params)}`, { accessToken });
}

export async function listAdminTalentInterests(
  accessToken: string,
  params: { user_id?: string; days?: number; limit?: number; offset?: number } = {}
): Promise<AdminPageMeta & { items: AdminInterestItem[] }> {
  return requestJson(`/admin/talent-interests${adminQuery(params)}`, { accessToken });
}

export async function getAdminAbuseSignals(accessToken: string, days = 7): Promise<AdminAbuseSignals> {
  return requestJson<AdminAbuseSignals>(`/admin/abuse-signals${adminQuery({ days })}`, { accessToken });
}

export async function listAdminEntitlements(
  accessToken: string,
  params: { kind?: string; status?: string; limit?: number; offset?: number } = {}
): Promise<AdminPageMeta & { items: AdminEntitlementItem[] }> {
  return requestJson(`/admin/entitlements${adminQuery(params)}`, { accessToken });
}

export async function revokeAdminEntitlement(
  accessToken: string,
  entitlementId: string,
  reason: string
): Promise<AdminEntitlementItem> {
  return requestJson<AdminEntitlementItem>(
    `/admin/entitlements/${encodeURIComponent(entitlementId)}/revoke`,
    { method: "POST", body: JSON.stringify({ reason }), accessToken }
  );
}

export async function sendAdminNotices(
  accessToken: string,
  payload: { user_ids: string[]; title: string; body: string; action_url?: string | null }
): Promise<{ delivered: number }> {
  return requestJson(`/admin/notices`, { method: "POST", body: JSON.stringify(payload), accessToken });
}

export async function getAdminNotificationRegistry(accessToken: string): Promise<AdminRegistryEvent[]> {
  return requestJson<AdminRegistryEvent[]>("/admin/notifications/registry", { accessToken });
}

export async function getAdminEmailOutbox(
  accessToken: string,
  params: { status?: string; limit?: number } = {}
): Promise<AdminOutboxItem[]> {
  return requestJson<AdminOutboxItem[]>(`/admin/email-outbox${adminQuery(params)}`, { accessToken });
}

export async function getAdminAuditLog(
  accessToken: string,
  params: { action?: string; target_type?: string; actor_user_id?: string; limit?: number; offset?: number } = {}
): Promise<AdminPageMeta & { items: AdminAuditLogItem[] }> {
  return requestJson(`/admin/audit-log${adminQuery(params)}`, { accessToken });
}

export async function completeLaunchFreeCheckout(
  accessToken: string,
  payload: {
    kind: BackendEntitlement["kind"];
    target_type?: string | null;
    target_id?: string | null;
    checkout_intent_id?: string | null;
  }
): Promise<BackendEntitlement> {
  return requestJson<BackendEntitlement>("/checkout/launch-free", {
    method: "POST",
    body: JSON.stringify(payload),
    accessToken,
  });
}

export async function listMyEntitlements(accessToken: string): Promise<BackendEntitlement[]> {
  return requestJson<BackendEntitlement[]>("/me/entitlements", { accessToken });
}
