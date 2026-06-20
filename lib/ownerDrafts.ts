import type { BackendCreateJobPayload, BackendTalentListing, BackendTalentListingPayload } from "./backendClient";
import { getJobDraftCompletion, getTalentDraftCompletion, isFallbackDraftTitle, type DraftCompletion } from "./draftCompletion";
import type { Job } from "./types";

export type DraftKind = "job" | "talent";
export type DraftStatusKind = "draft" | "incomplete" | "waiting" | "failed";
export type DraftFilter = "all" | "job" | "talent" | "needs_access" | "publish_issues";

export type DraftItem = {
  id: string;
  kind: DraftKind;
  title: string;
  untitled: boolean;
  statusLabel: string;
  statusKind: DraftStatusKind;
  /** Hiring channel/page for job drafts (e.g. "Instagram · @examplechannel"). */
  channelName: string | null;
  /** Short chips shown in the summary: category, budget/rate, location, role, etc. */
  meta: string[];
  /** Required fields the user still needs to fill in before publishing. */
  missingFields?: string[];
  /** Access/verification state for job drafts tied to a hiring identity. */
  verificationLabel?: string | null;
  /** Why a verification/publish attempt failed, when applicable. */
  failureReason?: string | null;
  /** Plain-language guidance shown in the detail pane. */
  nextStep: string;
  /** Resume target that restores the in-progress create flow. */
  resumeHref: string;
  /** Publish readiness + listing strength model powering the completion workspace. */
  completion: DraftCompletion;
  sourceJob?: Partial<Job>;
  sourceTalent?: Partial<BackendTalentListing>;
  updatedAtIso?: string;
  sortKey: number;
};

export function draftSortKey(iso?: string | null): number {
  if (!iso) return 0;
  const t = Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(iso) ? iso : `${iso}Z`);
  return Number.isFinite(t) ? t : 0;
}

const splitLines = (value?: string | null) =>
  (value || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

const parseBudgetNumbers = (value?: string | null) => {
  const numbers = (value || "").match(/\d[\d,]*/g)?.map((part) => Number(part.replace(/,/g, ""))) || [];
  return {
    min: Number.isFinite(numbers[0]) ? numbers[0] : null,
    max: Number.isFinite(numbers[1]) ? numbers[1] : null,
  };
};

const duplicateTitle = (item: DraftItem) => {
  if (item.untitled || isFallbackDraftTitle(item.title)) {
    return item.kind === "job" ? "Untitled job draft copy" : "Untitled talent draft copy";
  }
  return `Copy of ${item.title}`;
};

export function buildDuplicateJobPayload(item: DraftItem): BackendCreateJobPayload | null {
  const job = item.sourceJob;
  if (!job) return null;
  const budget = parseBudgetNumbers(job.budget);
  const budgetUnit = (job.budget || "").toLowerCase().includes("month") ? "per month" : "per project";
  return {
    title: duplicateTitle(item),
    category: job.category || "Editing",
    location: job.location || null,
    budget_amount: budget.min,
    budget_max: budget.max,
    budget_currency: "INR",
    budget_unit: budgetUnit,
    experience_level: job.experience && job.experience.toLowerCase() !== "any" ? job.experience : null,
    platforms: job.platform ? [job.platform] : [],
    start_timeframe: job.startTimeframe || null,
    work_mode: job.workMode || null,
    contract_type: job.contractType || (budgetUnit === "per month" ? "Monthly" : "Project-based"),
    timezone_overlap: job.timezoneOverlap || null,
    weekly_hours: job.weeklyHours || null,
    application_mode: job.applicationMode === "external" ? "external" : "internal",
    external_apply_url: job.externalApplyUrl || null,
    deadline_at: job.deadlineAt || null,
    about_channel: job.about || null,
    responsibilities: splitLines(job.responsibilities),
    requirements: splitLines(job.requirements),
    how_to_apply: job.howToApply || null,
    tools: job.tools || [],
    reference_videos: (job.referenceVideos || []).map((video) => ({
      title: video.title || null,
      url: video.url,
    })),
    tags: job.tags || [],
    channel_name: job.channel?.name || job.hiringDisplayName || null,
    channel_logo_url: job.channel?.logoUrl || null,
    channel_subscribers: job.channel?.subscribers ?? null,
    channel_profile_slug: job.channelProfileSlug || null,
    hiring_external_url_snapshot: job.channelExternalUrl || null,
    posted_by_agency: Boolean(job.postedByAgency),
    agency_profile_slug: job.agencyProfileSlug || null,
    posted_platform: job.postedPlatform || job.platform || null,
    posted_youtube_channel_id: job.postedYoutubeChannelId || null,
    hiring_identity_id: job.hiringIdentityId || null,
    status: "draft",
  };
}

export function buildDuplicateTalentPayload(item: DraftItem): BackendTalentListingPayload | null {
  const listing = item.sourceTalent;
  if (!listing) return null;
  return {
    title: duplicateTitle(item),
    primary_role: listing.primary_role || listing.roles?.[0] || null,
    experience_level: listing.experience_level || null,
    roles: listing.roles || [],
    niche: listing.niche || null,
    formats: listing.formats || [],
    platforms: listing.platforms || [],
    tools: listing.tools || [],
    work_mode: listing.work_mode || null,
    location: listing.location || null,
    timezone: listing.timezone || null,
    availability_status: listing.availability_status || "selective",
    rate_min: listing.rate_min ?? null,
    rate_max: listing.rate_max ?? null,
    rate_currency: listing.rate_currency || "INR",
    rate_note: listing.rate_note || null,
    open_slots: listing.open_slots ?? null,
    turnaround: listing.turnaround || null,
    description: listing.description || null,
    portfolio_item_ids: listing.portfolio_item_ids || [],
    status: "draft",
    is_featured: false,
    featured_until: null,
    paused_at: null,
    closed_at: null,
  };
}

export function duplicateLocalDraft(item: DraftItem): DraftItem {
  const now = new Date().toISOString();
  const id = `${item.id}-copy-${Date.now()}`;
  if (item.kind === "job") {
    const sourceJob = { ...(item.sourceJob || {}), id, title: duplicateTitle(item), status: "draft", createdAt: now, updatedAt: now };
    return {
      ...item,
      id,
      title: sourceJob.title || "Untitled job draft copy",
      untitled: isFallbackDraftTitle(sourceJob.title),
      statusLabel: "Draft",
      statusKind: "draft",
      failureReason: null,
      verificationLabel: null,
      resumeHref: `/post-job?draftId=${encodeURIComponent(id)}`,
      completion: getJobDraftCompletion(sourceJob),
      sourceJob,
      updatedAtIso: now,
      sortKey: draftSortKey(now),
    };
  }
  const sourceTalent = {
    ...(item.sourceTalent || {}),
    id,
    title: duplicateTitle(item),
    status: "draft" as const,
    is_featured: false,
    featured_until: null,
    paused_at: null,
    closed_at: null,
    created_at: now,
    updated_at: now,
  };
  return {
    ...item,
    id,
    title: sourceTalent.title || "Untitled talent draft copy",
    untitled: isFallbackDraftTitle(sourceTalent.title),
    statusLabel: "Draft",
    statusKind: "draft",
    failureReason: null,
    resumeHref: `/post-talent?draftId=${encodeURIComponent(id)}`,
    completion: getTalentDraftCompletion(sourceTalent),
    sourceTalent,
    updatedAtIso: now,
    sortKey: draftSortKey(now),
  };
}

/** Maps a backend job listing with status "draft" into the unified draft model. */
export function jobToDraft(job: Job): DraftItem {
  const title = job.title?.trim() || "";
  const isFallbackTitle = isFallbackDraftTitle(title);
  const actualTitle = isFallbackTitle ? "" : title;
  const verification = (job.hiringVerificationStatus || "").toUpperCase();

  let verificationLabel: string | null = null;
  if (job.hiringIdentityId) {
    if (verification === "VERIFIED") verificationLabel = "Confirmed";
    else if (verification === "REJECTED") verificationLabel = "Failed";
    else if (verification) verificationLabel = "Pending";
  }

  const hasBudgetMeta =
    job.draftCompletion?.hasBudget === true ||
    (job.draftCompletion?.hasBudget !== false && Boolean(job.budget && job.budget.trim().toLowerCase() !== "flexible"));
  const hasLocationMeta = job.draftCompletion?.hasWorkMode !== false && Boolean(job.location);
  const missingFields: string[] = [];
  if (!actualTitle) missingFields.push("Title");
  if (!hasBudgetMeta) missingFields.push("Budget");
  if (!job.about || job.about.trim().length < 20) missingFields.push("About the brand");
  if (!job.tools || job.tools.length === 0) missingFields.push("Tools");

  let statusKind: DraftStatusKind = "draft";
  let statusLabel = "Draft";
  let failureReason: string | null = null;
  let nextStep = "This listing is saved as a draft. Resume to keep editing and publish when you’re ready.";
  if (!actualTitle) {
    statusKind = "incomplete";
    statusLabel = "Incomplete";
    nextStep = "Finish the required fields to publish.";
  } else if (job.hiringIdentityId && verification === "REJECTED") {
    statusKind = "failed";
    statusLabel = "Verification failed";
    failureReason = "Channel access couldn’t be confirmed.";
    nextStep = "Channel access couldn’t be confirmed. Resume to try again or choose a different channel.";
  } else if (job.hiringIdentityId && verification && verification !== "VERIFIED") {
    statusKind = "waiting";
    statusLabel = "Waiting for access";
    nextStep = "Access to this channel/page must be confirmed before publishing. Resume to finish confirming access.";
  }

  return {
    id: String(job.id),
    kind: "job",
    title: actualTitle || "Untitled job draft",
    untitled: !actualTitle,
    statusLabel,
    statusKind,
    channelName: job.channel?.name || job.hiringDisplayName || null,
    meta: [hasBudgetMeta ? job.budget : null, job.category, hasLocationMeta ? job.location : null].filter(
      (v): v is string => Boolean(v)
    ),
    missingFields,
    verificationLabel,
    failureReason,
    nextStep,
    resumeHref: `/post-job?draftId=${encodeURIComponent(String(job.id))}`,
    completion: getJobDraftCompletion(job),
    sourceJob: job,
    updatedAtIso: job.updatedAt || job.createdAt,
    sortKey: draftSortKey(job.updatedAt || job.createdAt),
  };
}

/** Maps a backend talent listing with status "draft" into the unified draft model. */
export function talentToDraft(listing: BackendTalentListing): DraftItem {
  const title = listing.title?.trim() || "";
  const untitled = !title || isFallbackDraftTitle(title);
  const role = listing.primary_role || listing.roles?.[0] || null;

  const missingFields: string[] = [];
  if (untitled) missingFields.push("Title");
  if (listing.rate_min == null && listing.rate_max == null) missingFields.push("Rate");
  if (!listing.portfolio_item_ids || listing.portfolio_item_ids.length === 0) missingFields.push("Portfolio sample");
  if (!listing.description) missingFields.push("Description");

  return {
    id: listing.id,
    kind: "talent",
    title: untitled ? "Untitled talent draft" : title,
    untitled,
    statusLabel: untitled ? "Incomplete" : "Draft",
    statusKind: untitled ? "incomplete" : "draft",
    channelName: null,
    meta: [role, listing.niche].filter((v): v is string => Boolean(v)),
    missingFields,
    nextStep: untitled
      ? "Finish the required fields to publish."
      : "This talent listing is saved as a draft. Resume to keep editing and publish when you’re ready.",
    resumeHref: `/post-talent?draftId=${encodeURIComponent(listing.id)}`,
    completion: getTalentDraftCompletion(listing),
    sourceTalent: listing,
    updatedAtIso: listing.updated_at || listing.created_at,
    sortKey: draftSortKey(listing.updated_at || listing.created_at),
  };
}

// ---- Demo/mock drafts ----
// Rendered only when the workspace is not in live mode (no backend token, or
// local mocks enabled), exactly like MOCK_OWNER_INTERACTIONS. Lets every Drafts
// state be inspected without seeding the backend, and never leaks to a real
// authenticated session.

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const isoAgo = (ms: number) => new Date(Date.now() - ms).toISOString();

// Each spec carries a synthesized source (Partial<Job> / Partial<BackendTalentListing>)
// so the completion model — the same one used for live drafts — computes realistic
// readiness/strength for the demo set instead of duplicating the logic.
type MockSpec = Omit<DraftItem, "completion"> & {
  jobSource?: Partial<Job>;
  talentSource?: Partial<BackendTalentListing>;
};

const MOCK_SPECS: MockSpec[] = [
  // ---- Job listing drafts ----
  {
    id: "mock-job-draft-incomplete",
    kind: "job",
    title: "Video editor for weekly finance explainers",
    untitled: false,
    statusLabel: "Incomplete",
    statusKind: "incomplete",
    channelName: null,
    meta: ["Editing", "Remote"],
    missingFields: ["Budget", "About the brand", "Tools"],
    nextStep: "Add a budget, brand context, and the tools you expect, then publish.",
    resumeHref: "/post-job?draftId=mock-job-draft-incomplete",
    updatedAtIso: isoAgo(3 * HOUR_MS),
    sortKey: draftSortKey(isoAgo(3 * HOUR_MS)),
    jobSource: { title: "Video editor for weekly finance explainers", platform: "youtube", workMode: "remote" },
  },
  {
    id: "mock-job-draft-waiting",
    kind: "job",
    title: "Thumbnail designer for Instagram reels",
    untitled: false,
    statusLabel: "Waiting for access",
    statusKind: "waiting",
    channelName: "Instagram · @examplechannel",
    meta: ["Thumbnails", "₹800–₹1,200 per month", "Remote"],
    missingFields: [],
    verificationLabel: "Pending",
    nextStep:
      "Access to @examplechannel on Instagram is still being confirmed. Resume to finish confirming access, then publish.",
    resumeHref: "/post-job?draftId=mock-job-draft-waiting",
    updatedAtIso: isoAgo(DAY_MS),
    sortKey: draftSortKey(isoAgo(DAY_MS)),
    jobSource: {
      title: "Thumbnail designer for Instagram reels",
      platform: "instagram",
      hiringDisplayName: "@examplechannel",
      hiringIdentityId: "mock-waiting-identity",
      hiringVerificationStatus: "PENDING",
      workMode: "remote",
      budget: "₹800–₹1,200 per month",
      tools: ["Photoshop"],
      tags: ["thumbnails"],
    },
  },
  {
    id: "mock-job-draft-verification-failed",
    kind: "job",
    title: "Channel manager for YouTube uploads",
    untitled: false,
    statusLabel: "Verification failed",
    statusKind: "failed",
    channelName: "YouTube · @examplechannel",
    meta: ["Channel Manager", "₹2,000–₹3,000 per month", "Remote"],
    missingFields: [],
    verificationLabel: "Failed",
    failureReason: "Verification code wasn’t found on the channel — access couldn’t be confirmed.",
    nextStep:
      "We couldn’t confirm access to @examplechannel. Resume to retry verification or choose a different hiring channel.",
    resumeHref: "/post-job?draftId=mock-job-draft-verification-failed",
    updatedAtIso: isoAgo(2 * DAY_MS),
    sortKey: draftSortKey(isoAgo(2 * DAY_MS)),
    jobSource: {
      title: "Channel manager for YouTube uploads",
      platform: "youtube",
      hiringDisplayName: "@examplechannel",
      hiringIdentityId: "mock-failed-identity",
      hiringVerificationStatus: "REJECTED",
      workMode: "remote",
      budget: "₹2,000–₹3,000 per month",
    },
  },
  {
    id: "mock-job-draft-publish-failed",
    kind: "job",
    title: "Script writer for documentary-style videos",
    untitled: false,
    statusLabel: "Publish failed",
    statusKind: "failed",
    channelName: "YouTube · @historydeepdives",
    meta: ["Writing", "₹1,500 per script", "Remote"],
    missingFields: [],
    verificationLabel: "Confirmed",
    failureReason: "Publishing failed because of a network error. Your draft is safe.",
    nextStep: "Publishing didn’t go through last time. Resume to try publishing again.",
    resumeHref: "/post-job?draftId=mock-job-draft-publish-failed",
    updatedAtIso: isoAgo(3 * DAY_MS),
    sortKey: draftSortKey(isoAgo(3 * DAY_MS)),
    jobSource: {
      title: "Script writer for documentary-style videos",
      platform: "youtube",
      hiringDisplayName: "@historydeepdives",
      hiringIdentityId: "mock-publish-failed-identity",
      hiringVerificationStatus: "VERIFIED",
      workMode: "remote",
      budget: "₹1,500 per script",
      tools: ["Notion"],
      responsibilities: "Research and write documentary-style scripts.",
    },
  },
  {
    id: "mock-job-draft-ready",
    kind: "job",
    title: "Motion graphics editor for explainer channel",
    untitled: false,
    statusLabel: "Draft",
    statusKind: "draft",
    channelName: "YouTube · @explainlab",
    meta: ["Motion Graphics", "₹3,000 per video", "Remote"],
    missingFields: [],
    verificationLabel: "Confirmed",
    nextStep: "Everything required is filled in. Resume for a final review, then publish.",
    resumeHref: "/post-job?draftId=mock-job-draft-ready",
    updatedAtIso: isoAgo(5 * DAY_MS),
    sortKey: draftSortKey(isoAgo(5 * DAY_MS)),
    jobSource: {
      title: "Motion graphics editor for explainer channel",
      platform: "youtube",
      hiringDisplayName: "@explainlab",
      hiringIdentityId: "mock-ready-identity",
      hiringVerificationStatus: "VERIFIED",
      workMode: "remote",
      budget: "₹3,000 per video",
      about: "Explainer videos for a creator-led education channel.",
      tools: ["After Effects"],
      tags: ["motion-graphics"],
      responsibilities: "Animate explainer segments and lower-thirds.",
      requirements: "2+ years of motion design experience.",
      referenceVideos: [{ url: "https://www.youtube.com/watch?v=example" }],
    },
  },

  // ---- Talent listing drafts ----
  {
    id: "mock-talent-draft-incomplete",
    kind: "talent",
    title: "Retention editor for YouTube channels",
    untitled: false,
    statusLabel: "Incomplete",
    statusKind: "incomplete",
    channelName: null,
    meta: ["Video Editor", "Education"],
    missingFields: ["Rate", "Portfolio sample"],
    nextStep: "Add your rate and at least one portfolio sample to publish.",
    resumeHref: "/post-talent?draftId=mock-talent-draft-incomplete",
    updatedAtIso: isoAgo(6 * HOUR_MS),
    sortKey: draftSortKey(isoAgo(6 * HOUR_MS)),
    talentSource: {
      title: "Retention editor for YouTube channels",
      primary_role: "Video Editor",
      work_mode: "remote",
      niche: "Education",
      tools: ["Premiere Pro"],
    },
  },
  {
    id: "mock-talent-draft-ready",
    kind: "talent",
    title: "Thumbnail designer for tech and finance channels",
    untitled: false,
    statusLabel: "Draft",
    statusKind: "draft",
    channelName: null,
    meta: ["Thumbnail Designer", "Tech", "₹1,000 per month"],
    missingFields: [],
    nextStep: "Most fields are done. Resume for a final pass, then publish your listing.",
    resumeHref: "/post-talent?draftId=mock-talent-draft-ready",
    updatedAtIso: isoAgo(2 * DAY_MS),
    sortKey: draftSortKey(isoAgo(2 * DAY_MS)),
    talentSource: {
      title: "Thumbnail designer for tech and finance channels",
      primary_role: "Thumbnail Designer",
      work_mode: "remote",
      rate_min: 1000,
      rate_currency: "INR",
      niche: "Tech",
      tools: ["Photoshop", "Figma"],
      description: "Bold, high-CTR thumbnails for tech and finance creators.",
      experience_level: "3",
      portfolio_item_ids: ["mock-portfolio-1", "mock-portfolio-2"],
    },
  },
  {
    id: "mock-talent-draft-publish-failed",
    kind: "talent",
    title: "Shorts editor for daily faceless channels",
    untitled: false,
    statusLabel: "Publish failed",
    statusKind: "failed",
    channelName: null,
    meta: ["Shorts Editor", "Shorts", "₹1,200 per month"],
    missingFields: [],
    failureReason: "Couldn’t publish your listing — please try again.",
    nextStep: "Publishing didn’t go through. Resume to try again.",
    resumeHref: "/post-talent?draftId=mock-talent-draft-publish-failed",
    updatedAtIso: isoAgo(4 * DAY_MS),
    sortKey: draftSortKey(isoAgo(4 * DAY_MS)),
    talentSource: {
      title: "Shorts editor for daily faceless channels",
      primary_role: "Shorts Editor",
      work_mode: "remote",
      rate_min: 1200,
      rate_currency: "INR",
      niche: "Shorts",
    },
  },
  {
    id: "mock-talent-draft-untitled",
    kind: "talent",
    title: "Untitled talent draft",
    untitled: true,
    statusLabel: "Incomplete",
    statusKind: "incomplete",
    channelName: null,
    meta: ["Voice Over"],
    missingFields: ["Title", "Rate", "Skills", "Description"],
    nextStep: "You’ve picked a role. Add a title and the remaining details to publish.",
    resumeHref: "/post-talent?draftId=mock-talent-draft-untitled",
    updatedAtIso: isoAgo(8 * DAY_MS),
    sortKey: draftSortKey(isoAgo(8 * DAY_MS)),
    talentSource: { primary_role: "Voice Over" },
  },
];

const MOCK_DRAFTS: DraftItem[] = MOCK_SPECS.map(({ jobSource, talentSource, ...item }) => ({
  ...item,
  completion: item.kind === "job" ? getJobDraftCompletion(jobSource ?? {}) : getTalentDraftCompletion(talentSource ?? {}),
  sourceJob: item.kind === "job" ? jobSource : undefined,
  sourceTalent: item.kind === "talent" ? talentSource : undefined,
}));

export const MOCK_OWNER_DRAFTS: DraftItem[] = [...MOCK_DRAFTS].sort((a, b) => b.sortKey - a.sortKey);
