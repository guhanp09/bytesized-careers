import {
  CUSTOM_INSTRUCTION_REQUIREMENT_KEY,
  isCurrencyAnswer,
  isPortfolioAnswer,
  isTurnaroundAnswer,
  summarizeAnswers,
  type RequirementContext,
  type RequirementIcon,
  type RequirementSummaryItem,
} from "./firstMessageRequirements.ts";
import { isArchivedInteraction } from "./ownerInteractions.ts";
import type {
  InteractionDirection,
  InteractionKind,
  InteractionStatus,
  OwnerInteraction,
} from "./ownerInteractions";

/**
 * Pipeline domain for the applications workspace.
 *
 * The pipeline speaks the *backend* status vocabulary (job applications:
 * new/reviewing/shortlisted/interviewing/hired/rejected/archived/withdrawn;
 * hiring requests: new/reviewing/accepted/declined/archived/withdrawn) so a
 * stage move maps 1:1 onto the status endpoints. The inbox's display statuses
 * (`InteractionStatus`) are a lossy presentation layer on top; a reverse map
 * keeps demo/mock items usable in the pipeline too.
 */

/**
 * How informing the other side works for a stage the owner moved someone into.
 *
 * Statuses without a policy are internal-only: they exist for the owner's own
 * tracking and never message the counterparty. Optional policies ask before
 * publishing; automatic policies are relationship outcomes that the backend
 * publishes atomically with the stage move.
 */
export type StageNotifyPolicy = {
  /** Whether the workspace should lead with "send" (true) or stay neutral. */
  recommended: boolean;
  /** Shared outcomes are published by the backend as part of the stage move. */
  automatic?: boolean;
  /** The platform-voice chat update, e.g. `Shortlisted for “Thumbnail Designer”.` */
  notice: (context: { contextLabel: string | null }) => string;
};

export type PipelineStage = {
  /** Backend status value this stage represents. */
  key: string;
  /** Stage label from the viewer's point of view. */
  label: string;
  /** Tailwind classes for the stage dot. */
  dot: string;
  /** Terminal stages group at the end and don't read as active funnel steps. */
  terminal?: boolean;
  /** Present only on externally meaningful stages of manageable (received) boards. */
  notify?: StageNotifyPolicy;
};

const quoted = (label: string | null) => (label ? ` for “${label}”` : "");

/**
 * Stage taxonomy for received applications (the recruiter managing applicants).
 *
 * - new         — arrival state; set by the system; internal; reversible n/a.
 * - reviewing   — owner is reading; internal-only (never notifies); reversible.
 * Shortlisted is retired: what it usually meant — "keep this one in mind" — is
 * now a private Star, which is orthogonal to stage. Legacy records keep working
 * (see APPLICATION_TRANSITIONS) but nothing enters it any more.
 * - interviewing— externally meaningful; notifying recommended (the applicant
 *                 has to take part); reversible.
 * - hired       — shared outcome; terminal in the pipeline because engagement
 *                 controls own the relationship from that point onward.
 * - rejected    — outcome; notifying recommended (closure); terminal.
 * - withdrawn   — sender-only; the owner can never set it.
 * - archived    — tidy-up; internal-only; terminal.
 */
const APPLICATION_RECEIVED_STAGES: PipelineStage[] = [
  { key: "new", label: "New", dot: "bg-white" },
  { key: "reviewing", label: "Reviewing", dot: "bg-sky-300" },
  {
    key: "interviewing",
    label: "Interviewing",
    dot: "bg-amber-300",
    notify: {
      recommended: true,
      automatic: true,
      notice: ({ contextLabel }) => `Invited to interview${quoted(contextLabel)}.`,
    },
  },
  {
    key: "hired",
    label: "Hired",
    dot: "bg-emerald-300",
    notify: {
      recommended: true,
      automatic: true,
      notice: ({ contextLabel }) => `Hired${quoted(contextLabel)}.`,
    },
  },
  {
    key: "rejected",
    label: "Rejected",
    dot: "bg-rose-300/80",
    terminal: true,
    notify: {
      recommended: true,
      notice: ({ contextLabel }) => `Not moving forward${quoted(contextLabel)}.`,
    },
  },
  { key: "withdrawn", label: "Withdrawn", dot: "bg-white/35", terminal: true },
  { key: "archived", label: "Archived", dot: "bg-white/35", terminal: true },
];

const APPLICATION_SENT_STAGES: PipelineStage[] = [
  { key: "new", label: "Pending", dot: "bg-white" },
  { key: "reviewing", label: "Viewed", dot: "bg-sky-300" },
  // Legacy only: applicants who were genuinely told keep an honest label.
  { key: "shortlisted", label: "Under consideration", dot: "bg-violet-300", terminal: false },
  { key: "under_consideration", label: "Under consideration", dot: "bg-violet-300" },
  { key: "interviewing", label: "Interviewing", dot: "bg-amber-300" },
  { key: "hired", label: "Hired", dot: "bg-emerald-300" },
  { key: "rejected", label: "Not selected", dot: "bg-rose-300/80", terminal: true },
  { key: "withdrawn", label: "Withdrawn", dot: "bg-white/35", terminal: true },
  { key: "archived", label: "Archived", dot: "bg-white/35", terminal: true },
];

/**
 * Stage taxonomy for received hiring requests (the talent managing recruiters).
 *
 * - new       — arrival state; internal.
 * - reviewing — internal-only tracking; reversible.
 * - accepted  — externally meaningful; notifying
 *               recommended (the recruiter is waiting on an answer); reversible.
 * - declined  — outcome; notifying recommended (closure); terminal.
 * - withdrawn — sender-only (the recruiter pulled the request).
 * - archived  — tidy-up; internal-only; terminal.
 */
const INTEREST_RECEIVED_STAGES: PipelineStage[] = [
  { key: "new", label: "New", dot: "bg-white" },
  { key: "reviewing", label: "Reviewing", dot: "bg-sky-300" },
  {
    key: "accepted",
    label: "Accepted",
    dot: "bg-emerald-300",
    notify: { recommended: true, automatic: true, notice: () => "Hiring request accepted." },
  },
  {
    key: "declined",
    label: "Declined",
    dot: "bg-rose-300/80",
    terminal: true,
    notify: { recommended: true, automatic: true, notice: () => "Hiring request declined." },
  },
  { key: "withdrawn", label: "Withdrawn", dot: "bg-white/35", terminal: true },
  { key: "archived", label: "Archived", dot: "bg-white/35", terminal: true },
];

const INTEREST_SENT_STAGES: PipelineStage[] = [
  { key: "new", label: "Pending", dot: "bg-white" },
  { key: "reviewing", label: "Viewed", dot: "bg-sky-300" },
  { key: "accepted", label: "Accepted", dot: "bg-emerald-300" },
  { key: "declined", label: "Declined", dot: "bg-rose-300/80", terminal: true },
  { key: "withdrawn", label: "Withdrawn", dot: "bg-white/35", terminal: true },
  { key: "archived", label: "Archived", dot: "bg-white/35", terminal: true },
];

export function pipelineStagesFor(kind: InteractionKind, direction: InteractionDirection): PipelineStage[] {
  if (kind === "application") {
    return direction === "received" ? APPLICATION_RECEIVED_STAGES : APPLICATION_SENT_STAGES;
  }
  return direction === "received" ? INTEREST_RECEIVED_STAGES : INTEREST_SENT_STAGES;
}

/**
 * Stages a manager may move a received item into. "new" is the arrival state
 * and "withdrawn" is sender-only, so neither is a manager target.
 */
export function stageTargetsFor(kind: InteractionKind): PipelineStage[] {
  if (kind === "application") {
    return APPLICATION_RECEIVED_STAGES.filter((stage) => stage.key !== "new" && stage.key !== "withdrawn");
  }
  return INTEREST_RECEIVED_STAGES.filter((stage) => stage.key !== "new" && stage.key !== "withdrawn");
}

const LEGACY_APPLICATION_RESOLUTION_KEYS = new Set([
  "new",
  "reviewing",
  "shortlisted",
  "interviewing",
  "hired",
  "rejected",
]);
const LEGACY_INTEREST_RESOLUTION_KEYS = new Set([
  "new",
  "reviewing",
  "accepted",
  "declined",
]);

/** Explicit one-time choices for an archive whose historical stage is unknown. */
export function legacyResolutionTargetsFor(kind: InteractionKind): PipelineStage[] {
  const stages = kind === "application" ? APPLICATION_RECEIVED_STAGES : INTEREST_RECEIVED_STAGES;
  const allowed = kind === "application"
    ? LEGACY_APPLICATION_RESOLUTION_KEYS
    : LEGACY_INTEREST_RESOLUTION_KEYS;
  return stages.filter((stage) => allowed.has(stage.key));
}

/** Consequential shared outcomes are always confirmed one relationship at a time. */
export function bulkStageTargetsFor(kind: InteractionKind): PipelineStage[] {
  const permitted = kind === "application"
    ? new Set(["reviewing", "rejected", "archived"])
    : new Set(["reviewing", "archived"]);
  return stageTargetsFor(kind).filter((stage) => permitted.has(stage.key));
}

const APPLICATION_TRANSITIONS: Record<string, ReadonlySet<string>> = {
  new: new Set(["reviewing", "interviewing", "hired", "rejected"]),
  reviewing: new Set(["interviewing", "hired", "rejected"]),
  shortlisted: new Set(["reviewing", "interviewing", "hired", "rejected"]),
  interviewing: new Set(["hired", "rejected"]),
  rejected: new Set(["reviewing", "interviewing", "hired"]),
  withdrawn: new Set(),
  hired: new Set(),
  archived: new Set(),
};

const INTEREST_TRANSITIONS: Record<string, ReadonlySet<string>> = {
  new: new Set(["reviewing", "accepted", "declined"]),
  reviewing: new Set(["accepted", "declined"]),
  declined: new Set(),
  withdrawn: new Set(),
  accepted: new Set(),
  archived: new Set(),
};

/** Manager actions valid from the record's current backend state. */
export function validStageTargetsFor(
  kind: InteractionKind,
  currentStatus: string,
  participantStatus?: string | null,
  legacyArchiveResolutionRequired = false
): PipelineStage[] {
  if (
    kind === "application" &&
    ["hired", "rejected", "withdrawn"].includes(participantStatus ?? "")
  ) {
    return [];
  }
  if (
    kind === "hiring_request" &&
    ["accepted", "declined", "withdrawn"].includes(participantStatus ?? "")
  ) {
    return [];
  }
  if (legacyArchiveResolutionRequired) {
    return legacyResolutionTargetsFor(kind);
  }
  const allowed = (kind === "application" ? APPLICATION_TRANSITIONS : INTEREST_TRANSITIONS)[
    currentStatus
  ] ?? new Set<string>();
  return stageTargetsFor(kind).filter((stage) => allowed.has(stage.key));
}

/**
 * The notify policy for moving a received item into a stage, or null when the
 * stage is internal-only (reviewing, archived) and must never message anyone.
 */
export function stageNotifyPolicyOf(kind: InteractionKind, stageKey: string): StageNotifyPolicy | null {
  const stages = kind === "application" ? APPLICATION_RECEIVED_STAGES : INTEREST_RECEIVED_STAGES;
  return stages.find((stage) => stage.key === stageKey)?.notify ?? null;
}

export type WorkspaceModeKey = "talent" | "hiring";

/**
 * Workflow names for the two directions of a mode. "Received"/"Sent" are
 * technically right but mentally vague; within one mode each direction is one
 * uniform kind, so it can be named after the thing being managed.
 */
export function directionLabelsFor(mode: WorkspaceModeKey): { received: string; sent: string } {
  return mode === "hiring"
    ? { received: "Applicants", sent: "Outreach" }
    : { received: "Hiring requests", sent: "Applications" };
}

const PIPELINE_NOUNS: Record<WorkspaceModeKey, Record<InteractionDirection, [string, string]>> = {
  hiring: { received: ["applicant", "applicants"], sent: ["outreach request", "outreach requests"] },
  talent: { received: ["hiring request", "hiring requests"], sent: ["application", "applications"] },
};

/**
 * Compact at-a-glance summary of a pipeline, e.g. "6 applicants · 2 new ·
 * 1 interviewing": the total, how many just arrived, and the furthest-along
 * active stage that has people in it. Null when the board is empty.
 */
export function pipelineSummaryOf(
  items: Array<Pick<OwnerInteraction, "kind" | "status" | "backendStatus" | "archivedAt">>,
  kind: InteractionKind,
  direction: InteractionDirection,
  mode: WorkspaceModeKey
): string | null {
  if (items.length === 0) return null;
  const stages = pipelineStagesFor(kind, direction);
  const grouped = groupByStage(items, stages);
  const [singular, plural] = PIPELINE_NOUNS[mode][direction];
  const parts = [`${items.length} ${items.length === 1 ? singular : plural}`];
  const newStage = stages.find((stage) => stage.key === "new");
  const newCount = grouped.get("new")?.length ?? 0;
  if (newCount > 0 && newStage) parts.push(`${newCount} ${newStage.label.toLowerCase()}`);
  // The most advanced active stage with people in it tells the user where the
  // funnel currently reaches without listing every count.
  const active = stages.filter((stage) => !stage.terminal && stage.key !== "new");
  for (let index = active.length - 1; index >= 0; index -= 1) {
    const count = grouped.get(active[index].key)?.length ?? 0;
    if (count > 0) {
      parts.push(`${count} ${active[index].label.toLowerCase()}`);
      break;
    }
  }
  return parts.join(" · ");
}

const APPLICATION_DISPLAY_TO_BACKEND: Record<InteractionStatus, string> = {
  new: "new",
  pending: "new",
  viewed: "reviewing",
  responded: "interviewing",
  shortlisted: "shortlisted",
  accepted: "hired",
  hired: "hired",
  declined: "rejected",
  withdrawn: "withdrawn",
  closed: "archived",
};

const INTEREST_DISPLAY_TO_BACKEND: Record<InteractionStatus, string> = {
  new: "new",
  pending: "new",
  viewed: "reviewing",
  responded: "accepted",
  shortlisted: "reviewing",
  accepted: "accepted",
  hired: "accepted",
  declined: "declined",
  withdrawn: "withdrawn",
  closed: "archived",
};

/**
 * Resolve an interaction to backend status vocabulary. Live items carry the raw
 * value; demo/mock items fall back to a reverse map of their display status.
 */
export function backendStatusOf(
  item: Pick<OwnerInteraction, "kind" | "status" | "backendStatus" | "archivedAt">
): string {
  if (item.archivedAt || item.backendStatus === "archived") return "archived";
  if (item.backendStatus) return item.backendStatus;
  const map = item.kind === "application" ? APPLICATION_DISPLAY_TO_BACKEND : INTEREST_DISPLAY_TO_BACKEND;
  return map[item.status] ?? "new";
}

/** Group interactions under the given stages, preserving item order. */
export function groupByStage<
  T extends Pick<OwnerInteraction, "kind" | "status" | "backendStatus" | "archivedAt">
>(
  items: T[],
  stages: PipelineStage[]
): Map<string, T[]> {
  const groups = new Map<string, T[]>(stages.map((stage) => [stage.key, []]));
  for (const item of items) {
    const key = backendStatusOf(item);
    const bucket = groups.get(key);
    if (bucket) {
      bucket.push(item);
    } else {
      // Unknown status: keep the item visible rather than silently dropping it.
      groups.set(key, [item]);
    }
  }
  return groups;
}

/** Case-insensitive match on the people/context fields a manager scans for. */
export function pipelineSearchMatch(
  item: Pick<OwnerInteraction, "title" | "counterpartyName" | "contextLabel" | "job" | "sourceListingTitle">,
  query: string
): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const haystack = [
    item.title,
    item.counterpartyName,
    item.contextLabel,
    item.job?.title,
    item.sourceListingTitle,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(needle);
}

/** Distinct job/listing context labels present in the items, for the context filter. */
export function pipelineContextOptions(
  items: Array<Pick<OwnerInteraction, "job" | "sourceListingTitle" | "contextLabel">>
): string[] {
  const seen = new Set<string>();
  const options: string[] = [];
  for (const item of items) {
    const label = item.job?.title || item.sourceListingTitle || item.contextLabel || null;
    if (label && !seen.has(label)) {
      seen.add(label);
      options.push(label);
    }
  }
  return options;
}

export function pipelineContextLabelOf(
  item: Pick<OwnerInteraction, "job" | "sourceListingTitle" | "contextLabel">
): string | null {
  return item.job?.title || item.sourceListingTitle || item.contextLabel || null;
}

/**
 * Public profile of the person on the other side of the interaction. Mirrors
 * the inbox header's link logic: hiring requests point at the recruiter (or,
 * for sent ones, the talent who owns the listing); applications point at the
 * applicant (or, for sent ones, the hiring channel).
 */
export function pipelineProfileHrefOf(
  item: Pick<OwnerInteraction, "kind" | "job" | "talent" | "recruiter">
): string | null {
  const talentHref = item.talent?.profileSlug ? `/u/${item.talent.profileSlug}?view=talent` : null;
  const recruiterHref = item.recruiter?.profileSlug ? `/u/${item.recruiter.profileSlug}?view=hiring` : null;
  const channelHref = item.job?.channelProfileSlug ? `/u/${item.job.channelProfileSlug}?view=hiring` : null;
  return item.kind === "hiring_request" ? recruiterHref || talentHref : talentHref || channelHref;
}

const TURNAROUND_UNIT_SINGULAR: Record<string, string> = {
  hours: "hour",
  days: "day",
  weeks: "week",
};

export type PipelineCardFact = {
  /** Icon name signalling the fact type at a glance (rate, turnaround, start). */
  icon: "cash" | "clock" | "calendar";
  text: string;
};

/**
 * The short decision-making facts a manager scans on a pipeline card: proposed
 * terms first (they usually carry rate + turnaround already), otherwise the
 * structured first-message answers (rate, turnaround, start). Each fact carries
 * a type icon so the eye can find "the rate" without reading. Capped at two so
 * the card stays calm.
 */
export function pipelineCardFacts(
  item: Pick<OwnerInteraction, "proposedTerms" | "firstMessageAnswers">
): PipelineCardFact[] {
  if (item.proposedTerms?.trim()) return [{ icon: "cash", text: item.proposedTerms.trim() }];
  const answers = item.firstMessageAnswers || {};
  const facts: PipelineCardFact[] = [];
  const rate = answers["expected_rate"] ?? answers["project_budget"];
  if (isCurrencyAnswer(rate) && String(rate.amount).trim()) {
    facts.push({ icon: "cash", text: `₹${rate.amount} ${rate.unit}`.trim() });
  }
  const turnaround = answers["turnaround"];
  if (isTurnaroundAnswer(turnaround) && String(turnaround.value).trim()) {
    const unit = TURNAROUND_UNIT_SINGULAR[turnaround.unit] ?? turnaround.unit;
    facts.push({ icon: "clock", text: `${turnaround.value}-${unit} turnaround` });
  }
  const start = answers["start_availability"];
  if (typeof start === "string" && start.trim()) {
    facts.push({ icon: "calendar", text: start.trim() });
  }
  return facts.slice(0, 2);
}

/** Number of portfolio items attached to the first message (or legacy attachments). */
export function pipelinePortfolioCountOf(
  item: Pick<OwnerInteraction, "firstMessageAnswers" | "attachments">
): number {
  const portfolio = item.firstMessageAnswers?.["relevant_portfolio"];
  if (isPortfolioAnswer(portfolio) && portfolio.length > 0) return portfolio.length;
  return item.attachments?.length ?? 0;
}

/**
 * The card's first-message teaser. In the newer model the free-text message is
 * optional (only a system notification is sent by default) and the real "first
 * message" is the listing owner's structured requirements — so once those exist
 * the teaser is the fit note (the applicant's own words on fit), never the raw
 * message. Only a legacy interaction with no structured answers falls back to the
 * written message. Returns null when there's no single line to preview (the card
 * then shows a "First message" affordance for the requirements).
 */
export function pipelineSnippetOf(
  item: Pick<OwnerInteraction, "message" | "firstMessageAnswers">
): string | null {
  const answers = item.firstMessageAnswers;
  if (answers && Object.keys(answers).length > 0) {
    const fitNote = answers["fit_note"];
    return typeof fitNote === "string" && fitNote.trim() ? fitNote.trim() : null;
  }
  return item.message?.trim() || null;
}

/** The first-message context implied by the interaction kind. */
export function pipelineFirstMessageContext(item: Pick<OwnerInteraction, "kind">): RequirementContext {
  return item.kind === "application" ? "job" : "talent";
}

/** One condensed requirement line for the pipeline card's first-message tooltip. */
export type PipelineFirstMessageLine = {
  icon: RequirementIcon;
  label: string;
  value: string;
};

function firstMessageLineValue(entry: RequirementSummaryItem): string {
  if (entry.text?.trim()) return entry.text.trim();
  if (entry.links?.length) {
    const count = entry.links.length;
    const noun = entry.key === "relevant_portfolio" ? "item" : "link";
    return `${count} ${count === 1 ? noun : `${noun}s`}`;
  }
  return "";
}

/**
 * The listing owner's first-message requirements as the applicant answered them,
 * condensed to icon·label·value lines for the pipeline card tooltip. In the newer
 * model the free-text message is optional and the "first message" is really these
 * structured requirements — so the card surfaces them instead of assuming a
 * written cover note. Empty when the interaction carries no structured answers.
 */
export function pipelineFirstMessageLines(
  item: Pick<OwnerInteraction, "kind" | "firstMessageAnswers">
): PipelineFirstMessageLine[] {
  const answers = item.firstMessageAnswers;
  if (!answers || Object.keys(answers).length === 0) return [];
  return summarizeAnswers(Object.keys(answers), pipelineFirstMessageContext(item), answers)
    .map((entry) => ({
      icon: entry.icon,
      label: entry.key === CUSTOM_INSTRUCTION_REQUIREMENT_KEY ? "Screener" : entry.label,
      value: firstMessageLineValue(entry),
    }))
    .filter((line) => line.value);
}

/* ------------------------------------------------------------------ *
 * Derived work state and the next-best-action ladder.
 *
 * Both are pure and shared by the Inbox and the Pipeline, so the two views can
 * never disagree about what a record needs. Neither ever mutates lifecycle
 * state: they are presentation over authoritative data.
 * ------------------------------------------------------------------ */

/**
 * Live evidence the workspace can supply that is not carried on the record
 * itself. Everything is optional so the functions stay pure and unit-testable;
 * absent evidence simply lowers confidence rather than inventing a state.
 */
export type WorkSignals = {
  /** Unread messages from the counterparty in this thread. */
  unreadCount?: number;
  /**
   * True only when the last message is known to expect an answer — an explicit
   * composer intent or a scheduling proposal. Phase A never sets this, so
   * "Needs your reply" is never asserted on weak evidence; the composer-intent
   * work in Phase B is what will populate it.
   */
  responseExpected?: boolean;
  /** A hire/acceptance produced an engagement whose start is unconfirmed. */
  engagementUnconfirmed?: boolean;
  /**
   * An interview is arranged and its time is still ahead. The next event is the
   * date itself, so nothing is owed yet — this exists to stop the workspace
   * nagging for a decision about a conversation that has not happened.
   */
  interviewScheduled?: boolean;
  /**
   * An arranged interview's time has passed, or the organiser marked it
   * complete. Authoritative — the date was agreed and it is now behind us — and
   * only ever supplied to the side that manages the arrangement.
   */
  interviewFollowUpDue?: boolean;
  /**
   * An interview has been proposed and *this viewer* is the one who has not
   * agreed to the time yet. Supplied only to the invited participant — the
   * organiser is waiting, not acting.
   */
  interviewAwaitingMyConfirmation?: boolean;
};

export type WorkStateKey =
  | "needs_review"
  | "decision_not_shared"
  | "start_confirmation_pending"
  | "interview_confirmation"
  | "interview_follow_up"
  | "needs_reply"
  | "review_latest";

export type WorkState = {
  key: WorkStateKey;
  /** Short, human label. Never asserts more certainty than the evidence. */
  label: string;
  /**
   * High-confidence states are backed by authoritative record state. Low
   * confidence means "something arrived", so the label stays descriptive
   * ("Review latest message") rather than prescriptive ("Needs your reply").
   */
  highConfidence: boolean;
};

/**
 * Outcomes that end the conversation. These mirror the backend's closure policy
 * (`messaging_service.CLOSED_*_STATUSES`): nobody owes anything afterwards.
 */
const CLOSED_BACKEND_STATUSES = new Set(["rejected", "declined", "withdrawn"]);

/**
 * Agreed outcomes. The funnel is finished — no stage decision is owed — but the
 * thread stays open while the work happens, so an unread message there still
 * deserves a reply.
 */
const AGREED_BACKEND_STATUSES = new Set(["hired", "accepted"]);

/** Optional-shared decisions: recorded privately, communicated only on purpose. */
const OPTIONAL_SHARED_STATUSES = new Set(["shortlisted", "rejected"]);

/**
 * Does this record carry a decision the manager saved privately and has not yet
 * told the other side about? That is authoritative and actionable, so it is the
 * one "unfinished business" signal Phase A can assert with confidence.
 */
function hasUnsharedDecision(
  item: Pick<OwnerInteraction, "kind" | "direction" | "participantBackendStatus" | "status" | "backendStatus" | "archivedAt">
): boolean {
  if (item.direction !== "received" || item.kind !== "application") return false;
  const stage = backendStatusOf(item);
  if (!OPTIONAL_SHARED_STATUSES.has(stage)) return false;
  return (item.participantBackendStatus ?? null) !== stage;
}

/**
 * What this record needs from the viewer right now, or null when it needs
 * nothing. Presentation only — it never changes stored state.
 *
 * Deliberate exclusions: archived records (personal organisation, out of the
 * queue), terminal outcomes with nothing outstanding, and anything where the
 * *other* participant is the one expected to act.
 */
export function deriveWorkState(
  item: OwnerInteraction,
  signals: WorkSignals = {}
): WorkState | null {
  if (isArchivedInteraction(item)) return null;

  const stage = backendStatusOf(item);
  const unread = signals.unreadCount ?? (item.unread ? 1 : 0);

  // A hire or acceptance still owes a start confirmation. Authoritative.
  if (signals.engagementUnconfirmed && (stage === "hired" || stage === "accepted")) {
    /*
      A *state*, phrased statively. The recommended action for this same record
      is "Confirm start" — an imperative — and when both read identically the
      pill beside the button looked like a second button. A status describes;
      an action instructs.
    */
    return { key: "start_confirmation_pending", label: "Awaiting start confirmation", highConfidence: true };
  }

  // A closed conversation owes nothing, unless a private decision was never
  // communicated — that is still unfinished business for the manager.
  if (CLOSED_BACKEND_STATUSES.has(stage) && !hasUnsharedDecision(item)) return null;

  // Someone proposed a time and this viewer has not answered. Authoritative:
  // the invitation exists, and the confirmation is recorded or it is not.
  if (signals.interviewAwaitingMyConfirmation) {
    return { key: "interview_confirmation", label: "Confirm the time", highConfidence: true };
  }

  // An interview that has already happened. The date was agreed by both sides
  // and it is now in the past, which is as authoritative as this system gets.
  if (signals.interviewFollowUpDue) {
    return { key: "interview_follow_up", label: "Interview follow-up", highConfidence: true };
  }

  if (item.direction === "received" && !AGREED_BACKEND_STATUSES.has(stage)) {
    // Nothing has been looked at yet — the strongest signal available.
    if (stage === "new") {
      return { key: "needs_review", label: "Needs review", highConfidence: true };
    }
    // A decision exists privately but the other side has not been told.
    if (hasUnsharedDecision(item)) {
      return { key: "decision_not_shared", label: "Decision not shared", highConfidence: true };
    }
  }

  // Only an explicit response expectation may assert that a reply is owed.
  if (signals.responseExpected && unread > 0) {
    return { key: "needs_reply", label: "Needs your reply", highConfidence: true };
  }

  // Something arrived, but nothing proves it needs an answer: stay descriptive.
  if (unread > 0) {
    return { key: "review_latest", label: "Review latest message", highConfidence: false };
  }

  return null;
}

export type NextActionKey =
  | "resolve-legacy-stage"
  | "confirm-interview"
  | "confirm-start"
  | "share-decision"
  | "record-decision"
  | "reply"
  | "choose-next-step";

export type NextBestAction = {
  key: NextActionKey;
  /** The button label. Uses the counterparty's first name where it reads better. */
  label: string;
  /**
   * True when the ladder matched a specific, well-evidenced action. False for
   * the neutral fallback, which opens the decision surface instead of guessing.
   */
  highConfidence: boolean;
};

const firstName = (name: string) => (name || "").trim().split(/\s+/)[0] || "them";

/**
 * The single recommended action for a record, or null when nothing is
 * recommended (the other side owes the next move).
 *
 * A strict first-match ladder — deterministic, testable, and identical for the
 * Inbox and the Pipeline. When no rule matches with confidence it returns
 * "Choose next step", which opens the decision surface rather than guessing that
 * a new applicant should be interviewed, rejected, or messaged.
 */
/**
 * Which recommendations earn a place in the conversation header, and how loudly.
 *
 * The header used to render whichever action the ladder returned, in one filled
 * white button. That gave the same weight to "someone is holding an interview
 * slot open for your answer" and to "the composer is 600px below you", and the
 * second is by far the most common — so the loudest control in the workspace
 * spent most of its life duplicating a control already on screen.
 *
 * The rule that replaces it is one sentence: **filled means somebody else is
 * waiting.**
 *
 * | Action | Duplicate route | Unique value | Placement | Why |
 * |---|---|---|---|---|
 * | `confirm-interview` | Interview card, further up a long thread | Reaches and focuses the confirm control; a held slot expires | **Filled** | Another person is holding time open |
 * | `confirm-start` | Engagement row, below the thread | Reaches the start controls; work cannot begin until it happens | **Filled** | An agreed engagement is stalled on it |
 * | `share-decision` | Overflow → Share decision | Opens the notify prompt: preview of what they will see, an optional note on the same operation, exactly-once | **Filled** | A decision was made and never told; the applicant is waiting on an answer that already exists |
 * | `resolve-legacy-stage` | Overflow → stage list | The one-time compatibility choice that unblocks ordinary management | **Filled** | Nothing else works until it is made |
 * | `record-decision` | Decision surface (auto-opens), Pipeline stage menu | Re-opens a surface that may have been dismissed | **Secondary** | Real, but nobody is waiting on a particular moment |
 * | `reply` | The composer, pinned and visible, placeholder naming the person | None inside the detail — it focuses a control already on screen | **Removed** | The row keeps a quiet icon, which does open *and* focus; in the header it is the same click twice |
 * | `choose-next-step` | — | — | **Removed earlier** | Named an action it could not describe |
 */
export const HEADER_FILLED_ACTIONS: ReadonlySet<string> = new Set([
  "confirm-interview",
  "confirm-start",
  "share-decision",
  "resolve-legacy-stage",
]);

/** Real, but not urgent enough to be the loudest thing on the panel. */
export const HEADER_SECONDARY_ACTIONS: ReadonlySet<string> = new Set(["record-decision"]);

/** Whether a recommendation belongs in the header at all, and at which weight. */
export function headerActionWeight(key: string): "filled" | "secondary" | null {
  if (HEADER_FILLED_ACTIONS.has(key)) return "filled";
  if (HEADER_SECONDARY_ACTIONS.has(key)) return "secondary";
  return null;
}

export function nextBestActionFor(
  item: OwnerInteraction,
  signals: WorkSignals = {}
): NextBestAction | null {
  // Archived records are out of the workflow, except for the one-time legacy
  // stage choice, which genuinely still needs a decision.
  if (item.legacyArchiveResolutionRequired) {
    return { key: "resolve-legacy-stage", label: "Choose current stage", highConfidence: true };
  }
  if (isArchivedInteraction(item)) return null;

  const stage = backendStatusOf(item);
  const unread = signals.unreadCount ?? (item.unread ? 1 : 0);
  const name = firstName(item.counterpartyName);

  // 1. A proposed time this viewer has not agreed to. Ahead of everything else
  //    because the other person is holding a slot open waiting for the answer.
  if (signals.interviewAwaitingMyConfirmation) {
    return { key: "confirm-interview", label: "Confirm this time", highConfidence: true };
  }

  // 2. An agreed engagement is waiting on a start confirmation.
  if (signals.engagementUnconfirmed && (stage === "hired" || stage === "accepted")) {
    return { key: "confirm-start", label: "Confirm start", highConfidence: true };
  }

  // 3. A decision was saved privately and never communicated.
  if (hasUnsharedDecision(item)) {
    return { key: "share-decision", label: `Tell ${name}`, highConfidence: true };
  }

  // 4. A closed conversation has nothing outstanding.
  if (CLOSED_BACKEND_STATUSES.has(stage)) return null;

  // 5. Agreed outcomes owe no stage decision, but the thread stays open while
  //    the work happens, so an unread message there still deserves a reply.
  if (AGREED_BACKEND_STATUSES.has(stage)) {
    return unread > 0
      ? { key: "reply", label: `Reply to ${name}`, highConfidence: true }
      : null;
  }

  if (item.direction === "received") {
    // 6. An interview is arranged and still ahead. The next event is the meeting
    //    itself, so no decision is owed — but an unread message still is.
    if (stage === "interviewing" && signals.interviewScheduled && !signals.interviewFollowUpDue) {
      return unread > 0
        ? { key: "reply", label: `Reply to ${name}`, highConfidence: true }
        : null;
    }
    // 7. The interview has happened, or none was ever arranged. Either way the
    //    outstanding thing is the decision.
    if (stage === "interviewing") {
      return { key: "record-decision", label: "Record decision", highConfidence: true };
    }
    // 8. They wrote and it is unread — reading and replying comes first.
    if (unread > 0) {
      return { key: "reply", label: `Reply to ${name}`, highConfidence: true };
    }
    // 9. New or under review with no stronger signal. Do not guess an outcome.
    if (stage === "new" || stage === "reviewing") {
      return { key: "choose-next-step", label: "Choose next step", highConfidence: false };
    }
    return null;
  }

  // Sender side: the only thing owed is a reply to an unread message.
  if (unread > 0) {
    return { key: "reply", label: `Reply to ${name}`, highConfidence: true };
  }
  return null;
}
