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

export const isExternalBackendEnabled = () => !isLocalMocksEnabled();

const getBackendBaseUrl = () => {
  const raw = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000/api/v1";
  const normalized = raw.replace(/\/+$/, "");
  return normalized.endsWith("/api/v1") ? normalized : `${normalized}/api/v1`;
};

export const getBackendApiBaseUrl = () => getBackendBaseUrl();

type BackendJob = {
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
  about_channel?: string | null;
  aboutChannel?: string | null;
  responsibilities?: string[] | null;
  requirements?: string[] | null;
  how_to_apply?: string | null;
  howToApply?: string | null;
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
  views?: number | null;
  applicants?: number | null;
  response_rate?: number | null;
  match_percentage?: number | null;
  matchPercentage?: number | null;
  status?: string | null;
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
  detail?: string;
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
  about_channel?: string | null;
  responsibilities?: string[];
  requirements?: string[];
  how_to_apply?: string | null;
  reference_videos?: Array<string | { title?: string | null; url: string }>;
  tags?: string[];
  youtube_channel_id?: string | null;
  is_verified?: boolean;
  channel_name?: string | null;
  channel_logo_url?: string | null;
  channel_subscribers?: number | null;
  channel_profile_slug?: string | null;
  posted_by_agency?: boolean;
  agency_profile_slug?: string | null;
  posted_platform?: string | null;
  posted_youtube_channel_id?: string | null;
  views?: number;
  applicants?: number;
  response_rate?: number;
  status?: "draft" | "published" | "archived";
};

export type BackendAuthStatusResponse = {
  status: string;
  message?: string;
  verification_url?: string | null;
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
  user: {
    id: string;
    email: string;
    username?: string | null;
    display_name?: string | null;
  };
};

export type BackendResendVerificationResponse = {
  ok: boolean;
  message: string;
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

export type BackendCollaborationPreferences = {
  project_type_preference?: "oneOff" | "retainer" | "either" | null;
  turnaround?: string | null;
  revisions?: string | null;
  working_hours?: string | null;
  tools?: string | null;
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
  username?: string | null;
  username_change_count: number;
  username_last_changed_at?: string | null;
  display_name?: string | null;
  headline?: string | null;
  bio?: string | null;
  skills: string[];
  public_links: string[];
  availability_status?: "available" | "selective" | "unavailable";
  availability?: string | null;
  location?: string | null;
  timezone?: string | null;
  avatar_mode: "generic" | "youtube_channel";
  avatar_url?: string | null;
  avatar_youtube_channel_id?: string | null;
  social_connections: BackendSocialConnections;
  stats: BackendProfileStats;
  reviews: BackendReviewsSummary;
  collaboration_preferences: BackendCollaborationPreferences;
  roles: BackendRole[];
  role_answers_summary: BackendRoleAnswerSummary[];
  content_style: BackendContentStyle;
  privacy_settings: BackendPrivacySettings;
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
  availability_status?: "available" | "selective" | "unavailable";
  availability?: string;
  location?: string;
  timezone?: string;
  avatar_mode?: "generic" | "youtube_channel";
  avatar_youtube_channel_id?: string | null;
  avatar_url?: string;
  instagram_handle?: string;
  instagram_url?: string;
  project_type_preference?: "oneOff" | "retainer" | "either";
  collaboration_turnaround?: string;
  collaboration_revisions?: string;
  collaboration_working_hours?: string;
  collaboration_tools?: string;
};

export type BackendPrivacyUpdatePayload = Partial<BackendPrivacySettings>;

export type BackendPortfolioItem = {
  id: string;
  user_id: string;
  title: string;
  role?: string | null;
  user_role_in_project?: string | null;
  description?: string | null;
  timeframe?: "now" | "past";
  media_url?: string | null;
  metrics?: string | null;
  youtube_url?: string | null;
  thumbnail_url?: string | null;
  channel_name?: string | null;
  views?: number | null;
  published_date?: string | null;
  duration?: string | null;
  retention_percent?: number | null;
  links: string[];
  tags: string[];
  tools: string[];
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
  role?: string;
  user_role_in_project?: string;
  description?: string;
  timeframe?: "now" | "past";
  links?: string[];
  tags?: string[];
  tools?: string[];
  media_url?: string;
  metrics?: string;
  youtube_url?: string;
  thumbnail_url?: string;
  channel_name?: string;
  views?: number;
  published_date?: string;
  duration?: string;
  retention_percent?: number;
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

export type BackendPublicJobItem = {
  id: string;
  title: string;
  category: string;
  location?: string | null;
  status: string;
  created_at: string;
  channel_name?: string | null;
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
  avatar_url?: string | null;
  avatar_mode: "generic" | "youtube_channel";
  bio?: string | null;
  skills: string[];
  public_links: string[];
  availability_status?: "available" | "selective" | "unavailable";
  availability?: string | null;
  location?: string | null;
  timezone?: string | null;
  social_connections: BackendSocialConnections;
  stats: BackendProfileStats;
  reviews: BackendReviewsSummary;
  collaboration_preferences: BackendCollaborationPreferences;
  roles: BackendRole[];
  role_answers_summary: BackendRoleAnswerSummary[];
  content_style: BackendContentStyle;
  youtube_badge?: BackendPublicYouTubeBadge | null;
  jobs_active: BackendPublicJobItem[];
  jobs_past: BackendPublicJobItem[];
  portfolio_now: BackendPortfolioItem[];
  portfolio_past: BackendPortfolioItem[];
  jobs_preview: BackendPublicJobItem[];
  portfolio_preview: BackendPortfolioItem[];
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
  const channelName = asString(job.channel_name) ?? asString(job.channelName) ?? "Creator";
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
    startTimeframe: ensureStartTimeframe(startTimeframe),
    platform: platforms[0] || asString(job.platform) || "youtube",
    referenceVideos: asReferenceVideos(job.reference_videos ?? job.referenceVideos),
    about: asString(job.about_channel) ?? asString(job.aboutChannel) ?? "",
    responsibilities: asStringArray(job.responsibilities).join("\n"),
    requirements: asStringArray(job.requirements).join("\n"),
    howToApply: asString(job.how_to_apply) ?? asString(job.howToApply) ?? "",
    channelProfileSlug: asString(job.channel_profile_slug),
    postedByAgency: Boolean(asBoolean(job.posted_by_agency)),
    agencyProfileSlug: asString(job.agency_profile_slug),
    postedPlatform: asString(job.posted_platform),
    postedYoutubeChannelId: asString(job.posted_youtube_channel_id),
    postedByUserId: asString(job.posted_by_user_id),
    status: asString(job.status),
    createdAt,
    updatedAt,
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
  try {
    response = await fetch(`${getBackendBaseUrl()}${path}`, {
      cache: "no-store",
      ...init,
      headers,
    });
  } catch (error) {
    const reason = error instanceof Error && error.message ? error.message : "Network request failed";
    throw new BackendRequestError(
      0,
      `Could not reach backend (${getBackendBaseUrl()}). ${reason}. Start backend and verify NEXT_PUBLIC_BACKEND_URL.`
    );
  }

  if (!response.ok) {
    const text = await response.text();
    throw new BackendRequestError(response.status, getBackendErrorMessage(response.status, text));
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

export async function listMyPortfolio(accessToken: string): Promise<BackendPortfolioListResponse> {
  return requestJson<BackendPortfolioListResponse>("/me/portfolio", { accessToken });
}

export async function createMyPortfolioItem(
  accessToken: string,
  payload: BackendPortfolioCreatePayload
): Promise<BackendPortfolioItem> {
  return requestJson<BackendPortfolioItem>("/me/portfolio", {
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
  return requestJson<BackendPortfolioItem>(`/me/portfolio/${encodeURIComponent(itemId)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
    accessToken,
  });
}

export async function deleteMyPortfolioItem(
  accessToken: string,
  itemId: string
): Promise<BackendAuthStatusResponse> {
  return requestJson<BackendAuthStatusResponse>(`/me/portfolio/${encodeURIComponent(itemId)}`, {
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
