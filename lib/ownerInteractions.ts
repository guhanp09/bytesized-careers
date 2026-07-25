import type {
  ActivitySummary,
  BackendJobApplication,
  BackendTalentInterest,
  BackendTalentListing,
} from "./backendClient";
import type { FirstMessageAnswers } from "./firstMessageRequirements";
import { formatTalentListingExperience, formatTalentRate } from "./talentListing.ts";
import type { Job } from "./types";

export type InteractionMode = "talent" | "hiring";
export type InteractionDirection = "sent" | "received";
export type InteractionKind = "application" | "hiring_request";

export type InteractionStatus =
  | "new"
  | "pending"
  | "viewed"
  | "responded"
  | "shortlisted"
  | "accepted"
  | "hired"
  | "declined"
  | "withdrawn"
  | "closed";

export type InteractionTimelineEvent = {
  id: string;
  label: string;
  at: string;
};

export type InteractionThreadMessage = {
  from: string;
  body: string;
  atLabel: string;
  /** "status" marks a platform-generated stage update rendered apart from bubbles. */
  kind?: "status";
};

export type InteractionJobSnapshot = {
  jobId?: string | null;
  title: string;
  /** Omitted for the owner's own job listings, where repeating it is noise. */
  channelName?: string | null;
  channelLogoUrl?: string | null;
  channelProfileSlug?: string | null;
  budget: string;
  workMode: string;
  location?: string | null;
  experience?: string | null;
  tags: string[];
  listingStatus?: string | null;
};

export type InteractionTalentSnapshot = {
  profileSlug?: string | null;
  name: string;
  avatarUrl?: string | null;
  headline: string;
  /** Human rate label (e.g. "₹2,000–₹3,500 per video"); the talent mirror of a job's budget. */
  rate?: string | null;
  /** Talent experience as exact whole years (e.g. "3 years") — never a range or level label. */
  experience?: string | null;
  location?: string | null;
  availability?: string | null;
  bio?: string | null;
  tools: string[];
  niches: string[];
  experienceNote?: string | null;
  portfolioHighlights: Array<{ title: string; detail: string }>;
  /**
   * True when the snapshot is the viewer's *own* talent listing (a received hiring
   * request). The context card then genericises the identity to "Your listing" —
   * mirroring how the job card omits the channel for the owner's own job postings.
   */
  isOwnListing?: boolean;
};

export type InteractionRecruiterSnapshot = {
  profileSlug?: string | null;
  name: string;
  avatarUrl?: string | null;
  channelName?: string | null;
  audienceLabel?: string | null;
  platform?: string | null;
  hiringFor?: string | null;
};

export type OwnerInteraction = {
  id: string;
  mode: InteractionMode;
  direction: InteractionDirection;
  kind: InteractionKind;
  status: InteractionStatus;
  /**
   * Raw backend status (pipeline vocabulary). Present on live items; mock/demo
   * items derive it via applicationPipeline.backendStatusOf's reverse map.
   */
  backendStatus?: string | null;
  /** Optimistic-concurrency version supplied by the authoritative backend. */
  statusVersion?: number;
  /** Status already communicated to the counterparty. */
  participantBackendStatus?: string | null;
  /** Per-viewer organization state; independent from lifecycle status. */
  archivedAt?: string | null;
  /** Manager-only compatibility state for archives whose prior stage is unknown. */
  legacyArchiveResolutionRequired?: boolean;
  /** The manager's private note on a received item. Never present on sent items. */
  managerNote?: string | null;
  /**
   * Seed notes for the private-notes stack on a received item (demo/mock only).
   * The panel is local-first (localStorage per conversation); these seed it so the
   * stacked-note experience has believable history before the user adds their own.
   * Newest first.
   */
  privateNotes?: Array<{ id: string; body: string; createdAt: string }>;
  title: string;
  /** Short subject line for rows where the title is a person's name. */
  contextLabel?: string | null;
  counterpartyName: string;
  /** Real backend account id for participant-only actions such as blocking. */
  counterpartyUserId?: string | null;
  counterpartyAvatarUrl?: string | null;
  createdAtLabel: string;
  updatedAtLabel: string;
    unread?: boolean;
  message: string;
  /**
   * Structured answers the requester gave to the owner's first-message
   * requirements. Context is implied by {@link kind}: an "application" carries
   * job-context answers; a "hiring_request" carries talent-context answers.
   * Absent/empty for legacy interactions, so the inbox stays backward compatible.
   */
  firstMessageAnswers?: FirstMessageAnswers | null;
  proposedTerms?: string | null;
  attachments?: Array<{ label: string; url?: string | null }>;
  response?: InteractionThreadMessage | null;
  /** Local demo replies composed from the workspace; not persisted. */
  replies?: InteractionThreadMessage[];
  job?: InteractionJobSnapshot | null;
  talent?: InteractionTalentSnapshot | null;
  recruiter?: InteractionRecruiterSnapshot | null;
  sourceListingTitle?: string | null;
  timeline: InteractionTimelineEvent[];
};

export function isArchivedInteraction(item: OwnerInteraction): boolean {
  return Boolean(item.archivedAt) || item.backendStatus === "archived";
}

export function interactionStatusLabel(status: InteractionStatus): string {
  switch (status) {
    case "new":
      return "New";
    case "pending":
      return "Pending";
    case "viewed":
      return "Viewed";
    case "responded":
      return "Responded";
    case "shortlisted":
      // Legacy communicated value: honest to the applicant, and never offered
      // as a new stage (see migration 0047).
      return "Under consideration";
    case "accepted":
      return "Accepted";
    case "hired":
      return "Hired";
    case "declined":
      return "Declined";
    case "withdrawn":
      return "Withdrawn";
    case "closed":
      return "Closed";
  }
}

export function interactionKindLabel(item: Pick<OwnerInteraction, "direction" | "kind">): string {
  if (item.kind === "application") {
    return item.direction === "sent" ? "Sent application" : "Received application";
  }
  return item.direction === "sent" ? "Sent hiring request" : "Received hiring request";
}

// ---- Live backend mapping ----
// Maps the authenticated activity summary into the same OwnerInteraction shape
// the Applications workspace renders, using only fields the backend actually
// returns — no fabricated names, timestamps, or read states.

export function relativeTimeLabel(iso?: string | null): string {
  if (!iso) return "";
  // Backend timestamps are UTC but may arrive without a timezone designator;
  // parsing those as local time would shift every label by the UTC offset.
  const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(iso);
  const time = Date.parse(hasTimezone ? iso : `${iso}Z`);
  if (!Number.isFinite(time)) return "";
  const diffMs = Math.max(0, Date.now() - time);
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  return new Date(time).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function applicationStatusToInteraction(
  status: BackendJobApplication["status"],
  direction: InteractionDirection
): InteractionStatus {
  switch (status) {
    case "new":
      return direction === "sent" ? "pending" : "new";
    case "reviewing":
      return "viewed";
    case "shortlisted":
      return "shortlisted";
    case "interviewing":
      return "responded";
    case "hired":
      return "hired";
    case "rejected":
      return "declined";
    case "archived":
      return "closed";
    case "withdrawn":
      return "withdrawn";
  }
}

/**
 * Map a raw backend status to the inbox display vocabulary — used when a
 * pipeline stage move commits locally after the backend confirms.
 */
export function interactionStatusFromBackend(
  kind: InteractionKind,
  direction: InteractionDirection,
  backendStatus: string
): InteractionStatus {
  if (kind === "application") {
    return applicationStatusToInteraction(backendStatus as BackendJobApplication["status"], direction);
  }
  return interestStatusToInteraction(backendStatus as BackendTalentInterest["status"], direction);
}

function interestStatusToInteraction(
  status: BackendTalentInterest["status"],
  direction: InteractionDirection
): InteractionStatus {
  switch (status) {
    case "new":
      return direction === "sent" ? "pending" : "new";
    case "reviewing":
      return "viewed";
    case "accepted":
      return "accepted";
    case "declined":
      return "declined";
    case "archived":
      return "closed";
    case "withdrawn":
      return "withdrawn";
  }
}

function liveTimeline(
  id: string,
  createdLabel: string,
  createdAt: string,
  updatedAt: string,
  status: InteractionStatus,
  history: Array<{
    id: string;
    new_status: string;
    event_kind: string;
    audience: "manager_only" | "participants";
    created_at: string;
  }> = []
): InteractionTimelineEvent[] {
  const events: InteractionTimelineEvent[] = [
    { id: `${id}-created`, label: createdLabel, at: relativeTimeLabel(createdAt) },
  ];
  const persisted = history
    .filter((event) => event.event_kind !== "integrity_issue")
    .map((event) => {
      const display = ({
        reviewing: "Reviewing",
        shortlisted: "Shortlisted",
        interviewing: "Interviewing",
        hired: "Hired",
        rejected: "Not selected",
        accepted: "Accepted",
        declined: "Declined",
        withdrawn: "Withdrawn",
        archived: "Archived",
      } as Record<string, string>)[event.new_status] ?? event.new_status;
      const suffix = event.event_kind === "communicated"
        ? " shared"
        : event.audience === "manager_only"
          ? " saved privately"
          : "";
      return { id: event.id, label: `${display}${suffix}`, at: relativeTimeLabel(event.created_at) };
    });
  events.push(...persisted);
  const settledStatuses: InteractionStatus[] = ["new", "pending"];
  if (persisted.length === 0 && !settledStatuses.includes(status) && updatedAt && updatedAt !== createdAt) {
    events.push({ id: `${id}-status`, label: interactionStatusLabel(status), at: relativeTimeLabel(updatedAt) });
  }
  return events;
}

function jobSnapshotFromJob(job: Job): InteractionJobSnapshot {
  return {
    jobId: String(job.id),
    title: job.title,
    channelName: job.channel?.name || null,
    channelLogoUrl: job.channel?.logoUrl || null,
    channelProfileSlug: job.channelProfileSlug || null,
    budget: job.budget,
    workMode: [job.type, job.workMode].filter(Boolean).join(" · ") || "—",
    location: job.location || null,
    experience: job.experience || null,
    tags: job.tags || [],
    listingStatus: null,
  };
}

const AVAILABILITY_LABELS: Record<BackendTalentListing["availability_status"], string> = {
  available: "Available",
  selective: "Selective",
  unavailable: "Unavailable",
};

function talentSnapshotFromListing(listing: BackendTalentListing): InteractionTalentSnapshot {
  return {
    profileSlug: listing.owner_username || null,
    name: listing.owner_display_name || listing.owner_username || "Talent",
    avatarUrl: listing.owner_avatar_url || null,
    headline: listing.primary_role || listing.title,
    // Mirror the job card's metadata: rate → numeric experience → location/work mode.
    rate: formatTalentRate(listing) || null,
    experience: formatTalentListingExperience(listing) || null,
    // Location, or the work-mode equivalent when no place is set — same as the public talent card.
    location: listing.location || listing.work_mode || null,
    availability: AVAILABILITY_LABELS[listing.availability_status] || null,
    bio: listing.description || null,
    tools: listing.tools || [],
    niches: [listing.niche, ...(listing.formats || [])].filter((value): value is string => Boolean(value)),
    experienceNote: listing.experience_level || null,
    portfolioHighlights: [],
  };
}

function asSnapshotString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function asSnapshotStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/** Coerce a loosely-typed backend answers blob into structured answers, or null. */
function coerceAnswers(value: Record<string, unknown> | undefined | null): FirstMessageAnswers | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return Object.keys(value).length ? (value as FirstMessageAnswers) : null;
}

export function mapActivityToOwnerInteractions(summary: ActivitySummary): OwnerInteraction[] {
  const relatedJobsById = new Map(summary.relatedJobs.map((job) => [String(job.id), job]));
  const myJobsById = new Map(summary.myJobs.map((job) => [String(job.id), job]));
  const myListingsById = new Map(summary.myTalentListings.map((listing) => [listing.id, listing]));
  const relatedListingsById = new Map(summary.relatedTalentListings.map((listing) => [listing.id, listing]));

  const entries: Array<{ sortKey: number; item: OwnerInteraction }> = [];
  const sortKeyOf = (iso: string) => {
    const time = Date.parse(iso);
    return Number.isFinite(time) ? time : 0;
  };

  for (const application of summary.sentApplications) {
    const job = relatedJobsById.get(String(application.job_id)) || null;
    const status = applicationStatusToInteraction(application.status, "sent");
    entries.push({
      sortKey: sortKeyOf(application.updated_at || application.created_at),
      item: {
        id: application.id,
        mode: "talent",
        direction: "sent",
        kind: "application",
        status,
        backendStatus: application.status,
        statusVersion: application.status_version,
        participantBackendStatus: application.participant_status,
        archivedAt: application.archived_at,
        title: job?.title || "Job application",
        counterpartyName: job?.channel?.name || "Recruiter",
        counterpartyUserId: application.job_owner_user_id || null,
        counterpartyAvatarUrl: job?.channel?.logoUrl || null,
        createdAtLabel: relativeTimeLabel(application.created_at),
        updatedAtLabel: relativeTimeLabel(application.updated_at || application.created_at),
        message: application.cover_note || "",
        firstMessageAnswers: coerceAnswers(application.first_message_answers),
        job: job ? jobSnapshotFromJob(job) : null,
        timeline: liveTimeline(
          application.id,
          "Application sent",
          application.created_at,
          application.updated_at,
          status,
          application.status_history
        ),
      },
    });
  }

  for (const application of summary.receivedApplications) {
    const snapshot = application.applicant_snapshot || {};
    const applicantName =
      asSnapshotString(snapshot["display_name"]) || asSnapshotString(snapshot["username"]) || "Applicant";
    const username = asSnapshotString(snapshot["username"]);
    const job = myJobsById.get(String(application.job_id)) || null;
    const status = applicationStatusToInteraction(application.status, "received");
    entries.push({
      sortKey: sortKeyOf(application.updated_at || application.created_at),
      item: {
        id: application.id,
        mode: "hiring",
        direction: "received",
        kind: "application",
        status,
        backendStatus: application.status,
        statusVersion: application.status_version,
        participantBackendStatus: application.participant_status,
        archivedAt: application.archived_at,
        legacyArchiveResolutionRequired:
          application.legacy_archive_resolution_required === true,
        managerNote: application.manager_note || null,
        title: applicantName,
        counterpartyName: applicantName,
        counterpartyUserId: application.applicant_user_id,
        createdAtLabel: relativeTimeLabel(application.created_at),
        updatedAtLabel: relativeTimeLabel(application.updated_at || application.created_at),
        message: application.cover_note || "",
        firstMessageAnswers: coerceAnswers(application.first_message_answers),
        job: job ? { ...jobSnapshotFromJob(job), channelName: null, channelLogoUrl: null } : null,
        talent: {
          profileSlug: username,
          name: applicantName,
          headline: asSnapshotString(snapshot["headline"]) || "",
          location:
            [asSnapshotString(snapshot["location"]), asSnapshotString(snapshot["timezone"])]
              .filter(Boolean)
              .join(" · ") || null,
          availability: null,
          bio: null,
          tools: asSnapshotStringList(snapshot["skills"]),
          niches: [],
          experienceNote: null,
          portfolioHighlights: [],
        },
        timeline: liveTimeline(
          application.id,
          "Application received",
          application.created_at,
          application.updated_at,
          status,
          application.status_history
        ),
      },
    });
  }

  for (const interest of summary.sentInterests) {
    const listing = relatedListingsById.get(interest.talent_listing_id) || null;
    const talentName = listing?.owner_display_name || listing?.owner_username || "Talent";
    const status = interestStatusToInteraction(interest.status, "sent");
    entries.push({
      sortKey: sortKeyOf(interest.updated_at || interest.created_at),
      item: {
        id: interest.id,
        mode: "hiring",
        direction: "sent",
        kind: "hiring_request",
        status,
        backendStatus: interest.status,
        statusVersion: interest.status_version,
        participantBackendStatus: interest.participant_status,
        archivedAt: interest.archived_at,
        title: talentName,
        contextLabel: listing?.title || null,
        counterpartyName: talentName,
        counterpartyUserId: interest.owner_user_id,
        counterpartyAvatarUrl: listing?.owner_avatar_url || null,
        createdAtLabel: relativeTimeLabel(interest.created_at),
        updatedAtLabel: relativeTimeLabel(interest.updated_at || interest.created_at),
        message: interest.note || "",
        firstMessageAnswers: coerceAnswers(interest.first_message_answers),
        talent: listing ? talentSnapshotFromListing(listing) : null,
        timeline: liveTimeline(
          interest.id,
          "Request sent",
          interest.created_at,
          interest.updated_at,
          status,
          interest.status_history
        ),
      },
    });
  }

  for (const interest of summary.receivedInterests) {
    const listing = myListingsById.get(interest.talent_listing_id) || null;
    const relatedJob = interest.job_id ? relatedJobsById.get(String(interest.job_id)) || null : null;
    const recruiterName =
      interest.recruiter_display_name ||
      interest.recruiter_username ||
      relatedJob?.channel?.name ||
      "Recruiter";
    const status = interestStatusToInteraction(interest.status, "received");
    entries.push({
      sortKey: sortKeyOf(interest.updated_at || interest.created_at),
      item: {
        id: interest.id,
        mode: "talent",
        direction: "received",
        kind: "hiring_request",
        status,
        backendStatus: interest.status,
        statusVersion: interest.status_version,
        participantBackendStatus: interest.participant_status,
        archivedAt: interest.archived_at,
        legacyArchiveResolutionRequired:
          interest.legacy_archive_resolution_required === true,
        managerNote: interest.manager_note || null,
        title: relatedJob?.title || "Hiring request",
        counterpartyName: recruiterName,
        counterpartyUserId: interest.recruiter_user_id,
        counterpartyAvatarUrl: interest.recruiter_avatar_url || relatedJob?.channel?.logoUrl || null,
        createdAtLabel: relativeTimeLabel(interest.created_at),
        updatedAtLabel: relativeTimeLabel(interest.updated_at || interest.created_at),
        message: interest.note || "",
        firstMessageAnswers: coerceAnswers(interest.first_message_answers),
        recruiter: relatedJob || interest.recruiter_username
          ? {
              profileSlug: interest.recruiter_username || relatedJob?.channelProfileSlug || null,
              name: recruiterName,
              avatarUrl: interest.recruiter_avatar_url || relatedJob?.channel?.logoUrl || null,
              channelName: relatedJob?.channel?.name || null,
              audienceLabel: null,
              platform: relatedJob?.platform || null,
              hiringFor: relatedJob?.title || listing?.title || null,
            }
          : null,
        // The context card is the viewer's own listing the recruiter is interested in.
        talent: listing ? { ...talentSnapshotFromListing(listing), isOwnListing: true } : null,
        sourceListingTitle: listing?.title || null,
        timeline: liveTimeline(
          interest.id,
          "Request received",
          interest.created_at,
          interest.updated_at,
          status,
          interest.status_history
        ),
      },
    });
  }

  return entries.sort((a, b) => b.sortKey - a.sortKey).map((entry) => entry.item);
}
