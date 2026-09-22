import type { BackendCreateJobPayload, BackendTalentListing, BackendTalentListingPayload } from "./backendClient";
import { getJobDraftCompletion, getTalentDraftCompletion, isFallbackDraftTitle, type DraftCompletion } from "./draftCompletion";
import { compensationForJob } from "./jobPresentation";
import { serializeReferenceVideo } from "./referenceVideos";
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

// Title validation + title-rename recompute live with the completion model
// (which already owns isFallbackDraftTitle) so they stay testable in isolation.
export {
  DRAFT_TITLE_MIN_LENGTH,
  DRAFT_TITLE_MAX_LENGTH,
  validateDraftTitle,
  applyDraftTitle,
  type DraftTitleValidation,
} from "./draftCompletion";

const splitLines = (value?: string | null) =>
  (value || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

const duplicateTitle = (item: DraftItem) => {
  if (item.untitled || isFallbackDraftTitle(item.title)) {
    return item.kind === "job" ? "Untitled job draft copy" : "Untitled talent draft copy";
  }
  return `Copy of ${item.title}`;
};

export function buildDuplicateJobPayload(item: DraftItem): BackendCreateJobPayload | null {
  const job = item.sourceJob;
  if (!job) return null;
  return {
    title: duplicateTitle(item),
    category: job.category || "Editing",
    location: job.location || null,
    budget_amount: job.budgetAmount ?? null,
    budget_max: job.budgetMax ?? null,
    budget_currency: job.budgetCurrency || null,
    budget_unit: (job.budgetUnit as BackendCreateJobPayload["budget_unit"]) || null,
    budget_unit_custom: job.budgetUnitCustom || null,
    budget_note: job.budgetNote || null,
    compensation_mode: (job.compensationMode as BackendCreateJobPayload["compensation_mode"]) || null,
    experience_level: job.experience && job.experience.toLowerCase() !== "any" ? job.experience : null,
    platforms: job.platform ? [job.platform] : [],
    start_timeframe: job.startTimeframe || null,
    work_mode: job.workMode || null,
    contract_type: job.contractType || null,
    engagement_type: (job.engagementType as BackendCreateJobPayload["engagement_type"]) || null,
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
    content_niches: job.contentNiches || [],
    content_genres: job.contentGenres || [],
    formats_hired_for: job.formatsHiredFor || [],
    reference_videos: (job.referenceVideos || []).map(serializeReferenceVideo),
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
    experience_years: listing.experience_years ?? null,
    roles: listing.roles || [],
    niche: listing.niche || null,
    content_niches: listing.content_niches || [],
    content_genres: listing.content_genres || [],
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

  const compensation = compensationForJob(job);
  const compensationLabel =
    compensation.headline === "Compensation not specified" && compensation.note
      ? compensation.note
      : compensation.headline;
  const hasBudgetMeta =
    job.draftCompletion?.hasBudget === true ||
    (job.draftCompletion?.hasBudget !== false && compensation.disclosed);
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
    meta: [hasBudgetMeta ? compensationLabel : null, job.category, hasLocationMeta ? job.location : null].filter(
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
  if (listing.rate_min == null && listing.rate_max == null && !listing.rate_note?.trim()) missingFields.push("Rate");
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
    meta: [role, listing.content_niches?.[0] || listing.niche].filter((v): v is string => Boolean(v)),
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
