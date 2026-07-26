import type {
  ActivitySummary,
  BackendJobApplication,
  BackendTalentInterest,
  BackendTalentListing,
} from "./backendClient";
import type { FirstMessageAnswers } from "./firstMessageRequirements";
import type { PortfolioInput } from "./creatorProjection";
import { formatTalentListingExperience, formatTalentRate } from "./talentListing.ts";
import { displayPersonName, timelineEventLabel } from "./interactionLabels.ts";
import { formatInteractionTime } from "./interactionTime.ts";
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
  /** ISO instant. Formatted where it is drawn, never stored preformatted. */
  occurredAt: string;
  /**
   * A private decision that a later shared outcome contradicts. Kept in the
   * record — it happened — but rendered struck rather than as current truth.
   */
  superseded?: boolean;
};

export type InteractionThreadMessage = {
  from: string;
  body: string;
  /** ISO instant. Formatted where it is drawn, never stored preformatted. */
  sentAt: string;
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
  /**
   * Creator-specific facts, carried structurally rather than flattened.
   *
   * `budget` above is a display string, which is why the workspace could only
   * ever render a generic job: an amount with no unit, no platform, no format,
   * no niche and no turnaround. The canonical `Job` has all of it, so the
   * snapshot now carries it through in the shape the projection expects.
   *
   * Every field is optional. A fixture or a manifest that supplies none of it
   * renders exactly as it did before.
   */
  creator?: InteractionCreatorFacts | null;
};

/** Raw creator facts. Normalised for display by `lib/creatorProjection.ts`. */
export type InteractionCreatorFacts = {
  platforms?: string[] | null;
  formats?: string[] | null;
  niches?: string[] | null;
  turnaround?: { value?: number | null; unit?: string | null; basis?: string | null } | null;
  /** The structured commercial model, not a rendered string. */
  compensation?: {
    mode?: string | null;
    minimum?: number | string | null;
    maximum?: number | string | null;
    currency?: string | null;
    unit?: string | null;
    customUnit?: string | null;
    note?: string | null;
    trialStatus?: string | null;
    trialAmount?: number | string | null;
    trialCurrency?: string | null;
    trialBasis?: string | null;
  } | null;
  channelHandle?: string | null;
  employerKind?: string | null;
  subscribers?: number | null;
  /** Free-form, e.g. "2 videos/week". Shown only when a record carries it. */
  cadence?: string | null;
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
  /**
   * Authoritative instants, ISO-8601.
   *
   * These were `createdAtLabel` / `updatedAtLabel` and held display strings —
   * hand-typed in the fixture, and produced by calling the formatter at *map*
   * time on the backend path, which froze the label and discarded the instant.
   * `createdAtLabel` held a display string and had zero readers; it is replaced
   * by `createdAt`, which the conversation builder genuinely needs to date the
   * opening message.
   */
  createdAt: string;
  updatedAt: string;
    unread?: boolean;
  message: string;
  /**
   * Structured answers the requester gave to the owner's first-message
   * requirements. Context is implied by {@link kind}: an "application" carries
   * job-context answers; a "hiring_request" carries talent-context answers.
   * Absent/empty for legacy interactions, so the inbox stays backward compatible.
   */
  firstMessageAnswers?: FirstMessageAnswers | null;
  /**
   * Portfolio evidence shared with this interaction.
   *
   * Loose by design: an application's `relevant_portfolio` answer carries only
   * `{ id, title, url }`, which is what a recruiter actually receives, while a
   * profile item carries far more. Both normalise through
   * `toCreatorPortfolio`, so the thin shape renders rather than showing an
   * empty portfolio for every real application.
   */
  portfolio?: PortfolioInput[] | null;
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

/**
 * Deprecated in favour of `formatInteractionTime`.
 *
 * Retained because Drafts still calls it directly, but delegating means there is
 * exactly one rule: the old body stopped at `Nw ago` and always printed the
 * year, neither of which matches the product's date rule.
 */
export function relativeTimeLabel(iso?: string | null): string {
  return formatInteractionTime(iso);
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
    // What the applicant's own read returns for a legacy shortlisted record.
    // Without this branch the switch fell through and the record arrived with
    // `status: undefined` — a row in the applicant's inbox showing no state.
    case "under_consideration":
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
    { id: `${id}-created`, label: createdLabel, occurredAt: createdAt },
  ];
  /*
    One normalized projection.

    Two things went wrong before. Events were pushed in array order, so a
    timeline could read `Interviewing → Not selected saved privately → Hired`
    for the same person — three states presented as equally current truth. And
    the stage name came from an inline map with a `?? event.new_status`
    fallback, which is how raw enums reached the UI.

    Now: labels come from the shared projection, entries are sorted by their
    authoritative instant, and a *private* decision that a later shared outcome
    contradicts is marked superseded rather than deleted. Deleting it would lose
    real history a manager may need; presenting it as current would be a lie.
  */
  const persisted = history
    .filter((event) => event.event_kind !== "integrity_issue")
    .map((event) => ({
      id: event.id,
      label: timelineEventLabel({
        status: event.new_status,
        communicated: event.event_kind === "communicated",
        managerOnly: event.audience === "manager_only",
      }),
      occurredAt: event.created_at,
      status: event.new_status,
      shared: event.event_kind === "communicated" || event.audience !== "manager_only",
    }));
  events.push(...persisted.map(({ status, shared, ...entry }) => ({
    ...entry,
    superseded: isSupersededDecision({ status, shared, at: entry.occurredAt }, persisted, status),
  })));
  const settledStatuses: InteractionStatus[] = ["new", "pending"];
  if (persisted.length === 0 && !settledStatuses.includes(status) && updatedAt && updatedAt !== createdAt) {
    events.push({ id: `${id}-status`, label: interactionStatusLabel(status), occurredAt: updatedAt });
  }
  return events.sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
}


/** Outcomes that settle a relationship. A later one supersedes an earlier. */
const TERMINAL_STAGES = new Set(["hired", "rejected", "accepted", "declined", "withdrawn"]);

/**
 * Is this entry a private decision that a later, shared outcome contradicts?
 *
 * Only private ones can be superseded this way: a decision the other side was
 * actually told is part of the record regardless of what followed, and striking
 * it would misrepresent what they were sent.
 */
function isSupersededDecision(
  entry: { status: string; shared: boolean; at: string },
  all: Array<{ status: string; shared: boolean; occurredAt: string }>,
  status: string
): boolean {
  if (entry.shared) return false;
  if (!TERMINAL_STAGES.has(status)) return false;
  const at = Date.parse(entry.at);
  return all.some(
    (other) =>
      other.status !== status &&
      TERMINAL_STAGES.has(other.status) &&
      Date.parse(other.occurredAt) > at
  );
}

/**
 * Listing status as a person would say it, not as the column stores it.
 *
 * Only states with a distinct meaning to someone reading their inbox appear
 * here; anything else stays null rather than leaking a raw enum into the UI.
 */
const LISTING_STATUS_LABELS: Record<string, string> = {
  published: "Open",
  closed: "Closed",
  paused: "Paused",
  draft: "Draft",
};

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
    // Carried, not hardcoded null. A closed listing with applications still in
    // it is a real state the workspace is meant to show — "this job is no longer
    // open, and these people are still waiting" — and Backend mode could not
    // distinguish it from an open one.
    listingStatus: LISTING_STATUS_LABELS[String(job.status ?? "")] ?? null,
    // Carried through structurally. These are the canonical fields the job
    // already has; nothing here is derived, defaulted or invented.
    creator: {
      platforms: job.platforms?.length ? job.platforms : job.platform ? [job.platform] : null,
      formats: job.formatsHiredFor?.length ? job.formatsHiredFor : null,
      niches: job.contentNiches?.length ? job.contentNiches : null,
      turnaround: job.turnaroundValue
        ? { value: job.turnaroundValue, unit: job.turnaroundUnit, basis: job.turnaroundBasis }
        : null,
      compensation: {
        mode: job.compensationMode,
        minimum: job.budgetAmount,
        maximum: job.budgetMax,
        currency: job.budgetCurrency,
        unit: job.budgetUnit,
        customUnit: job.budgetUnitCustom,
        note: job.budgetNote,
        // The legacy display string stays the fallback, so a job posted before
        // the structured model still shows its rate.
        trialStatus: job.trialStatus,
        trialAmount: job.trialCompensationAmount,
        trialCurrency: job.trialCompensationCurrency,
        trialBasis: job.trialCompensationBasis,
      },
      channelHandle: job.channelProfileSlug || null,
      employerKind: job.employerContextType || null,
      subscribers: job.channel?.subscribers ?? null,
      cadence: null,
    },
  };
}

const AVAILABILITY_LABELS: Record<BackendTalentListing["availability_status"], string> = {
  available: "Available",
  selective: "Selective",
  unavailable: "Unavailable",
};

/**
 * Exported so the scenario adapter can build its talent context card with this
 * function rather than a second one. The card's rate and experience come from
 * `formatTalentRate` / `formatTalentListingExperience`; a Mock-only copy would
 * be free to format them differently, which is the drift this phase removes.
 */
export function talentSnapshotFromListing(listing: BackendTalentListing): InteractionTalentSnapshot {
  return {
    profileSlug: listing.owner_username || null,
    name: displayPersonName({
      displayName: listing.owner_display_name,
      username: listing.owner_username,
      identity: listing.owner_user_id || listing.id,
      role: "applicant",
    }),
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
    // The same rule the received side already uses. A bare `|| "Recruiter"`
    // gave every recruiter in the list one shared name, so an applicant with
    // six applications out saw six identical rows and could not tell which was
    // which — the exact defect Phase 1 fixed for "Applicant", still alive here.
    const recruiterName = displayPersonName({
      displayName: job?.channel?.name,
      username: job?.channelProfileSlug,
      identity: application.job_owner_user_id || application.id,
      role: "recruiter",
    });
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
        counterpartyName: recruiterName,
        counterpartyUserId: application.job_owner_user_id || null,
        counterpartyAvatarUrl: job?.channel?.logoUrl || null,
        createdAt: application.created_at,
        updatedAt: application.updated_at || application.created_at,
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
    const applicantName = displayPersonName({
      displayName: asSnapshotString(snapshot["display_name"]),
      username: asSnapshotString(snapshot["username"]),
      identity: asSnapshotString(snapshot["user_id"]) || application.applicant_user_id || application.id,
      role: "applicant",
    });
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
        createdAt: application.created_at,
        updatedAt: application.updated_at || application.created_at,
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
    const talentName = displayPersonName({
      displayName: listing?.owner_display_name,
      username: listing?.owner_username,
      identity: interest.owner_user_id || interest.id,
      role: "applicant",
    });
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
        createdAt: interest.created_at,
        updatedAt: interest.updated_at || interest.created_at,
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
    const recruiterName = displayPersonName({
      displayName: interest.recruiter_display_name || relatedJob?.channel?.name,
      username: interest.recruiter_username,
      identity: interest.recruiter_user_id || interest.id,
      role: "recruiter",
    });
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
        createdAt: interest.created_at,
        updatedAt: interest.updated_at || interest.created_at,
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
