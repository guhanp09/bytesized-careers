import { Job, JobCategory, ReferenceVideo, StartTimeframe } from "./types";

const CATEGORY_VALUES: JobCategory[] = [
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
];

const START_VALUES: StartTimeframe[] = ["ASAP", "<1mo", "<2mo", "<3mo", "Flexible"];

const parseBool = (value?: string) => {
  if (!value) return false;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
};

export const isLocalMocksEnabled = () =>
  parseBool(process.env.NEXT_PUBLIC_USE_LOCAL_MOCKS);

export const isProductionRuntime = () =>
  process.env.APP_ENV === "production" ||
  process.env.NEXT_PUBLIC_APP_ENV === "production" ||
  process.env.VERCEL_ENV === "production";

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
  location?: string | null;
  budget_amount?: string | number | null;
  budget_min?: string | number | null;
  budget_max?: string | number | null;
  budget_currency?: string | null;
  budget_unit?: string | null;
  experience_level?: string | null;
  experienceLevel?: string | null;
  platforms?: string[] | null;
  platform?: string | null;
  start_timeframe?: string | null;
  startTimeframe?: string | null;
  work_mode?: string | null;
  contract_type?: string | null;
  timezone_overlap?: string | null;
  weekly_hours?: string | null;
  application_mode?: "internal" | "external" | string | null;
  external_apply_url?: string | null;
  deadline_at?: string | null;
  about_channel?: string | null;
  aboutChannel?: string | null;
  responsibilities?: string[] | null;
  requirements?: string[] | null;
  how_to_apply?: string | null;
  howToApply?: string | null;
  tools?: string[] | null;
  reference_videos?: unknown;
  referenceVideos?: unknown;
  tags?: string[] | null;
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
  detail?: string | { message?: string; code?: string };
  error?: {
    message?: string;
  };
};

export type BackendCreateJobPayload = {
  title: string;
  category: string;
  location?: string | null;
  budget_amount?: number | null;
  budget_max?: number | null;
  budget_currency?: string | null;
  budget_unit?: "per project" | "per month";
  experience_level?: string | null;
  platforms?: string[];
  start_timeframe?: string | null;
  work_mode?: string | null;
  contract_type?: string | null;
  timezone_overlap?: string | null;
  weekly_hours?: string | null;
  application_mode?: "internal" | "external";
  external_apply_url?: string | null;
  deadline_at?: string | null;
  about_channel?: string | null;
  responsibilities?: string[];
  requirements?: string[];
  how_to_apply?: string | null;
  tools?: string[];
  reference_videos?: Array<string | { title?: string | null; url: string }>;
  tags?: string[];
  youtube_channel_id?: string | null;
  is_verified?: boolean;
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
  views?: number;
  applicants?: number;
  response_rate?: number;
  status?: "draft" | "published" | "paused" | "closed" | "archived";
  featured_until?: string | null;
  paused_at?: string | null;
  closed_at?: string | null;
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
  collaboration_preferences: BackendCollaborationPreferences;
  hiring_info: BackendHiringInfo;
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
  hiring_type?: BackendHiringType | null;
  hiring_website_or_social_url?: string | null;
  hiring_primary_platform?: BackendHiringPrimaryPlatform | null;
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
  timeframe?: "now" | "past";
  links?: string[];
  tags?: string[];
  contribution_tags?: string[];
  tools?: string[];
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
  category: string;
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
  collaboration_preferences: BackendCollaborationPreferences;
  hiring_info?: BackendHiringInfo | null;
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
  applicant_snapshot: Record<string, unknown>;
  status: "new" | "reviewing" | "shortlisted" | "interviewing" | "hired" | "rejected" | "archived";
  created_at: string;
  updated_at: string;
};

export type BackendTalentListing = {
  id: string;
  owner_user_id: string;
  owner_display_name?: string | null;
  owner_username?: string | null;
  owner_avatar_url?: string | null;
  title: string;
  primary_role?: string | null;
  experience_level?: string | null;
  roles: string[];
  niche?: string | null;
  formats: string[];
  platforms: string[];
  tools: string[];
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
  status: "draft" | "published" | "paused" | "closed" | "archived" | "featured";
  is_featured: boolean;
  featured_until?: string | null;
  paused_at?: string | null;
  closed_at?: string | null;
  views: number;
  saves: number;
  created_at: string;
  updated_at: string;
};

export type BackendTalentListingPayload = {
  title: string;
  primary_role?: string | null;
  experience_level?: string | null;
  roles?: string[];
  niche?: string | null;
  formats?: string[];
  platforms?: string[];
  tools?: string[];
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
  job_id?: string | null;
  owner_user_id: string;
  note?: string | null;
  status: "new" | "reviewing" | "contacted" | "declined" | "archived";
  created_at: string;
  updated_at: string;
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
  target_type: "job" | "talent_listing" | "profile";
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
  platform?: string;
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

const ensureCategory = (value?: string | null): JobCategory => {
  if (!value) return "Editing";
  if (CATEGORY_VALUES.includes(value as JobCategory)) {
    return value as JobCategory;
  }
  return "Editing";
};

const ensureStartTimeframe = (value?: string | null): StartTimeframe => {
  if (!value) return "Flexible";
  if (START_VALUES.includes(value as StartTimeframe)) {
    return value as StartTimeframe;
  }
  return "Flexible";
};

const formatPostedShort = (createdAt?: string) => {
  if (!createdAt) return "now";
  const timestamp = Date.parse(createdAt);
  if (Number.isNaN(timestamp)) return "now";
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

const asReferenceVideos = (value: unknown): ReferenceVideo[] => {
  if (!Array.isArray(value)) return [];

  return value
    .map((entry) => {
      if (typeof entry === "string") {
        const url = asString(entry);
        return url ? { url } : null;
      }

      if (!entry || typeof entry !== "object") {
        return null;
      }

      const record = entry as { title?: unknown; url?: unknown; href?: unknown };
      const url = asString(record.url) ?? asString(record.href);
      if (!url) {
        return null;
      }

      const title = asString(record.title);
      return title ? { title, url } : { url };
    })
    .filter((entry): entry is ReferenceVideo => Boolean(entry));
};

const formatBudget = ({
  amount,
  maxAmount,
  currency,
  unit,
}: {
  amount?: number;
  maxAmount?: number;
  currency?: string;
  unit?: string;
}) => {
  if (amount === undefined) return "Flexible";
  const normalizedCurrency = (currency || "INR").toUpperCase();
  const normalizedUnit = unit === "per month" ? "per month" : "per project";
  const symbol = normalizedCurrency === "INR" ? "₹" : normalizedCurrency;
  if (maxAmount !== undefined && maxAmount >= amount && maxAmount !== amount) {
    return `${symbol}${amount.toLocaleString("en-US")} - ${symbol}${maxAmount.toLocaleString(
      "en-US"
    )} ${normalizedUnit}`;
  }
  return `${symbol}${amount.toLocaleString("en-US")} ${normalizedUnit}`;
};

const toFrontendJob = (job: BackendJob): Job => {
  const budgetAmount =
    asNumber(job.budget_amount) ??
    asNumber(job.budget_min);
  const budgetMax = asNumber(job.budget_max);
  const budgetCurrency = asString(job.budget_currency);
  const budgetUnit = asString(job.budget_unit);
  const experience =
    asString(job.experience_level) ??
    asString(job.experienceLevel) ??
    "Any";
  const startTimeframe =
    asString(job.start_timeframe) ??
    asString(job.startTimeframe);
  const createdAt = asString(job.created_at) ?? asString(job.createdAt);
  const updatedAt = asString(job.updated_at) ?? asString(job.updatedAt);
  const platforms = asStringArray(job.platforms);
  const rawPlatform = platforms[0] || asString(job.platform);
  const channelName = asString(job.channel_name) ?? asString(job.channelName) ?? "Content creator";
  const channelLogo =
    asString(job.channel_logo_url) ??
    asString(job.channel_avatar_url) ??
    asString(job.channelAvatarUrl) ??
    "https://picsum.photos/seed/new/96/96";
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

  return {
    id: asString(job.id) || "",
    title: asString(job.title) || "Untitled job",
    category: ensureCategory(job.category),
    budget: formatBudget({
      amount: budgetAmount,
      maxAmount: budgetMax,
      currency: budgetCurrency,
      unit: budgetUnit,
    }),
    experience,
    location: asString(job.location) || "Remote",
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
    startTimeframe: ensureStartTimeframe(startTimeframe),
    workMode: asString(job.work_mode),
    contractType: asString(job.contract_type),
    timezoneOverlap: asString(job.timezone_overlap),
    weeklyHours: asString(job.weekly_hours),
    applicationMode: asString(job.application_mode),
    externalApplyUrl: asString(job.external_apply_url),
    deadlineAt: asString(job.deadline_at),
    platform: rawPlatform || "youtube",
    referenceVideos: asReferenceVideos(job.reference_videos ?? job.referenceVideos),
    about: asString(job.about_channel) ?? asString(job.aboutChannel) ?? "",
    responsibilities: asStringArray(job.responsibilities).join("\n"),
    requirements: asStringArray(job.requirements).join("\n"),
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

  constructor(status: number, message: string) {
    super(message);
    this.name = "BackendRequestError";
    this.status = status;
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

async function requestJson<T>(path: string, init?: RequestJsonOptions): Promise<T> {
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
    throw new BackendRequestError(response.status, getBackendErrorMessage(response.status, text));
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
    query.set(key, String(value));
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
  const response = await requestJson<BackendJob>("/jobs", {
    method: "POST",
    body: JSON.stringify(payload),
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
  const response = await requestJson<BackendJob>(`/jobs/${encodeURIComponent(jobId)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
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
  payload: { cover_note?: string | null; portfolio_item_ids?: string[] } = {}
): Promise<BackendJobApplication> {
  return requestJson<BackendJobApplication>(`/jobs/${encodeURIComponent(jobId)}/applications`, {
    method: "POST",
    body: JSON.stringify({
      cover_note: payload.cover_note || null,
      portfolio_item_ids: payload.portfolio_item_ids || [],
    }),
    accessToken,
  });
}

export async function listMySentApplications(accessToken: string): Promise<BackendJobApplication[]> {
  return requestJson<BackendJobApplication[]>("/me/applications/sent", { accessToken });
}

export async function listMyReceivedApplications(accessToken: string): Promise<BackendJobApplication[]> {
  return requestJson<BackendJobApplication[]>("/me/applications/received", { accessToken });
}

export async function updateApplicationStatus(
  accessToken: string,
  applicationId: string,
  statusValue: BackendJobApplication["status"]
): Promise<BackendJobApplication> {
  return requestJson<BackendJobApplication>(`/applications/${encodeURIComponent(applicationId)}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status: statusValue }),
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
  jobId?: string | null
): Promise<BackendTalentInterest> {
  return requestJson<BackendTalentInterest>(`/talent-listings/${encodeURIComponent(listingId)}/interest`, {
    method: "POST",
    body: JSON.stringify({ note: note || null, job_id: jobId || null }),
    accessToken,
  });
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

export async function updateTalentInterestStatus(
  accessToken: string,
  interestId: string,
  statusValue: BackendTalentInterest["status"]
): Promise<BackendTalentInterest> {
  return requestJson<BackendTalentInterest>(`/talent-interests/${encodeURIComponent(interestId)}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status: statusValue }),
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

export async function createReport(
  payload: { target_type: "job" | "talent_listing" | "profile"; target_id: string; category: string; note?: string | null },
  accessToken?: string
): Promise<BackendReport> {
  return requestJson<BackendReport>("/reports", {
    method: "POST",
    body: JSON.stringify(payload),
    accessToken,
  });
}

export async function listAdminReports(
  accessToken: string,
  statusValue?: string
): Promise<BackendReport[]> {
  const query = new URLSearchParams();
  if (statusValue) query.set("status", statusValue);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return requestJson<BackendReport[]>(`/admin/reports${suffix}`, { accessToken });
}

export async function updateAdminReport(
  accessToken: string,
  reportId: string,
  payload: { status?: BackendReport["status"]; action: string; admin_note?: string | null }
): Promise<BackendReport> {
  return requestJson<BackendReport>(`/admin/reports/${encodeURIComponent(reportId)}`, {
    method: "PATCH",
    body: JSON.stringify({
      status: payload.status || "action_taken",
      action: payload.action,
      admin_note: payload.admin_note || null,
    }),
    accessToken,
  });
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
