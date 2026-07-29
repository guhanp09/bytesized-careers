/**
 * Three questions, asked separately.
 *
 * The applicant menu used to be one flat list — *Decision needed*, *New to
 * review*, *Up to date* — whose parts added up to the whole and still left the
 * reader unsure what they were looking at. The arithmetic was never the
 * problem. The problem is that those three names answer three different
 * questions:
 *
 * - **have I looked at this yet?** — a fact about the reader;
 * - **where is it in the hiring process?** — a fact about the record;
 * - **does anyone need to do something?** — a fact about the moment.
 *
 * Flattened into one list they compete: an application can be opened *and*
 * interviewing *and* waiting on the applicant, and a single list has to pick
 * one and silently drop the other two. That is why "Decision needed" grew until
 * it meant "we could not think of anything else", and why the reader could not
 * predict which bucket a record would land in.
 *
 * So there are three planes, labelled, each exhaustive over the same active
 * population. A record has exactly one answer in each. They combine; they do
 * not add to one another, and the menu says so.
 *
 * ATS convention supports the split: pipeline stage and reviewer progress are
 * separate columns in every serious applicant tracker, and inbox products keep
 * "unread" apart from "needs action" for the same reason — one is about you and
 * the other is about the work.
 */

import type { OwnerInteraction } from "./ownerInteractions.ts";
import { backendStatusOf, deriveWorkState } from "./applicationPipeline.ts";
import { isArchivedInteraction } from "./ownerInteractions.ts";
import type { QueueSignals, WorkQueuePreferences } from "./workQueues.ts";
import { NO_QUEUE_PREFERENCES } from "./workQueues.ts";

/* ---- the population ------------------------------------------------------ */

/**
 * Which records the planes describe.
 *
 * Archived is a scope of its own — a place things are put deliberately — so
 * counting archived records inside "everything" would make the total disagree
 * with the tab beside it.
 */
export function isActiveRecord(item: OwnerInteraction): boolean {
  return !isArchivedInteraction(item);
}

/* ---- plane A: review progress -------------------------------------------- */

export type ReviewProgressKey = "unopened" | "opened";

/**
 * Has anyone looked at this yet?
 *
 * `new` is the only stage that means "arrived, untouched": the workspace moves
 * a deliberately-opened record to `reviewing` privately, so the stage *is* the
 * durable record of having looked. That keeps the answer the same after a
 * reload, on another device, and for a second recruiter on the same job —
 * which a local "seen" flag could never manage.
 *
 * A record the viewer sent is never unopened. There is nothing for them to
 * open; whether the other side has looked is the other side's business.
 */
export function reviewProgressOf(item: OwnerInteraction): ReviewProgressKey {
  if (item.direction !== "received") return "opened";
  return backendStatusOf(item) === "new" ? "unopened" : "opened";
}

/* ---- plane B: workflow status -------------------------------------------- */

export type OpenedStatusKey = "reviewing" | "interviewing" | "hired" | "closed";

const CLOSED_STAGES = new Set(["rejected", "declined", "withdrawn", "not_selected", "expired"]);
const HIRED_STAGES = new Set(["hired", "accepted"]);

/**
 * Where an opened record sits in the process.
 *
 * Only defined for records that have been opened — an untouched application has
 * no management position yet, and inventing one would be the product asserting
 * a judgement nobody made. Legacy `shortlisted` and `under_consideration` fold
 * into Reviewing, which is what they always meant.
 */
export function openedStatusOf(item: OwnerInteraction): OpenedStatusKey | null {
  if (reviewProgressOf(item) === "unopened") return null;
  const stage = backendStatusOf(item);
  if (CLOSED_STAGES.has(stage)) return "closed";
  if (HIRED_STAGES.has(stage)) return "hired";
  if (stage === "interviewing") return "interviewing";
  return "reviewing";
}

/* ---- plane C: attention -------------------------------------------------- */

export type AttentionKey =
  | "needs_your_reply"
  | "unread_activity"
  | "ready_for_decision"
  | "decision_not_sent"
  | "interview_to_confirm"
  | "start_to_confirm"
  | "waiting_on_them"
  | "snoozed"
  | "no_action_needed";

/**
 * Does anyone need to do something, and who?
 *
 * Built on the existing deterministic work-state engine rather than beside it,
 * so a record's attention category and the chip on its row can never tell
 * different stories.
 *
 * The important change is what *left*. "Decision needed" used to absorb both a
 * decision saved and never sent — objective — and any inbound message whose
 * intent was unclear, which is not a decision at all but an unread thing. It
 * claimed the system knew the recruiter "had everything they needed", on the
 * evidence that nothing else had matched. Those are now two honest categories,
 * and neither of them claims to know that.
 */
export function attentionOf(
  item: OwnerInteraction,
  signals: QueueSignals = {},
  preferences: WorkQueuePreferences = NO_QUEUE_PREFERENCES
): AttentionKey {
  const snoozed = preferences.snoozedUntil(item.id);
  if (snoozed !== null && snoozed > Date.now()) return "snoozed";
  if (preferences.isDismissed(item.id)) return "no_action_needed";

  const state = deriveWorkState(item, signals);
  switch (state?.key) {
    case "start_confirmation_pending":
      return "start_to_confirm";
    case "interview_confirmation":
      return "interview_to_confirm";
    case "interview_follow_up":
      // The one objective decision signal there is: the meeting happened and no
      // outcome was recorded.
      return "ready_for_decision";
    case "decision_not_shared":
      return "decision_not_sent";
    case "needs_reply":
      return "needs_your_reply";
    case "needs_review":
    case "review_latest":
      // Something arrived and nothing proves what it needs. That is a thing to
      // read, not a decision the product can claim is ready to make.
      return "unread_activity";
    default:
      break;
  }

  // Nothing outstanding on this side. Whether the other side owes a move is the
  // remaining useful distinction, and both answers are deterministic.
  if (item.direction === "sent") return "waiting_on_them";
  if (signals.interviewScheduled && !signals.interviewFollowUpDue) return "waiting_on_them";
  return "no_action_needed";
}

/* ---- the menu ------------------------------------------------------------ */

export type PlaneOption = { key: string; label: string; description: string };
export type ClassificationPlane = {
  key: "review" | "status" | "attention";
  label: string;
  /** What the section's counts add up to. Stated, because unstated it is a guess. */
  denominator: string;
  options: PlaneOption[];
};

export const CLASSIFICATION_PLANES: ClassificationPlane[] = [
  {
    key: "review",
    label: "Review progress",
    denominator: "everything",
    options: [
      { key: "unopened", label: "Not opened yet", description: "Arrived and nobody has looked." },
      { key: "opened", label: "Opened", description: "You have looked at least once." },
    ],
  },
  {
    key: "status",
    label: "Where it stands",
    denominator: "opened",
    options: [
      { key: "reviewing", label: "Reviewing", description: "Opened, and no later step taken yet." },
      { key: "interviewing", label: "Interviewing", description: "An interview is arranged or has happened." },
      { key: "hired", label: "Hired / starting", description: "Agreed, and the work is beginning." },
      { key: "closed", label: "Closed", description: "Declined, withdrawn, or otherwise finished." },
    ],
  },
  {
    key: "attention",
    label: "Needs attention",
    denominator: "everything",
    options: [
      { key: "needs_your_reply", label: "Needs your reply", description: "They asked something that expects an answer." },
      { key: "unread_activity", label: "New to read", description: "Something arrived that you have not read." },
      { key: "ready_for_decision", label: "Ready for decision", description: "The interview happened and no outcome was recorded." },
      { key: "decision_not_sent", label: "Decision not sent", description: "You decided privately and they have not been told." },
      { key: "interview_to_confirm", label: "Interview to confirm", description: "A time was proposed and nobody confirmed it." },
      { key: "start_to_confirm", label: "Start to confirm", description: "Agreed, and the start has not been confirmed." },
      { key: "waiting_on_them", label: "Waiting on them", description: "The next move belongs to the other side." },
      { key: "snoozed", label: "Snoozed", description: "Hidden until you asked to see it again. Its status is unchanged." },
      { key: "no_action_needed", label: "No action needed", description: "Nothing outstanding on either side." },
    ],
  },
];

export type ClassificationOf = {
  review: ReviewProgressKey;
  status: OpenedStatusKey | null;
  attention: AttentionKey;
};

export function classify(
  item: OwnerInteraction,
  signals: QueueSignals = {},
  preferences: WorkQueuePreferences = NO_QUEUE_PREFERENCES
): ClassificationOf {
  return {
    review: reviewProgressOf(item),
    status: openedStatusOf(item),
    attention: attentionOf(item, signals, preferences),
  };
}

export type ClassificationCounts = {
  /** Active records in scope — what "Review progress" and "Needs attention" add up to. */
  total: number;
  /** Opened records — what "Where it stands" adds up to. */
  opened: number;
  review: Map<ReviewProgressKey, number>;
  status: Map<OpenedStatusKey, number>;
  attention: Map<AttentionKey, number>;
};

/**
 * Count every plane in one pass.
 *
 * Each plane is a partition of its own denominator, so `review` and `attention`
 * each sum to `total` and `status` sums to `opened`. Those are the invariants
 * the tests hold, and the menu prints the denominators so a reader never has to
 * guess which numbers are supposed to agree.
 */
export function classificationCounts(
  items: OwnerInteraction[],
  signalsFor: (item: OwnerInteraction) => QueueSignals = () => ({}),
  preferences: WorkQueuePreferences = NO_QUEUE_PREFERENCES
): ClassificationCounts {
  const review = new Map<ReviewProgressKey, number>();
  const status = new Map<OpenedStatusKey, number>();
  const attention = new Map<AttentionKey, number>();
  let total = 0;
  let opened = 0;

  for (const item of items) {
    if (!isActiveRecord(item)) continue;
    total += 1;
    const seen = classify(item, signalsFor(item), preferences);
    review.set(seen.review, (review.get(seen.review) ?? 0) + 1);
    attention.set(seen.attention, (attention.get(seen.attention) ?? 0) + 1);
    if (seen.status) {
      opened += 1;
      status.set(seen.status, (status.get(seen.status) ?? 0) + 1);
    }
  }
  return { total, opened, review, status, attention };
}

/** One selection per plane. Absent means "no filter on this plane". */
export type ClassificationFilter = {
  review?: ReviewProgressKey;
  status?: OpenedStatusKey;
  attention?: AttentionKey;
  /** Personal organisation, which cuts across all three rather than being one. */
  starred?: boolean;
};

export const EMPTY_CLASSIFICATION_FILTER: ClassificationFilter = {};

export function isFilterActive(filter: ClassificationFilter): boolean {
  return Boolean(filter.review || filter.status || filter.attention || filter.starred);
}

export function countActiveFilters(filter: ClassificationFilter): number {
  return [filter.review, filter.status, filter.attention, filter.starred ? "starred" : undefined].filter(
    Boolean
  ).length;
}

/**
 * Apply the selection.
 *
 * Combining planes narrows, because they answer different questions: "opened"
 * and "waiting on them" together is a real thing to ask for, and a flat list
 * could never express it.
 */
export function matchesFilter(
  item: OwnerInteraction,
  filter: ClassificationFilter,
  signals: QueueSignals = {},
  preferences: WorkQueuePreferences = NO_QUEUE_PREFERENCES,
  isStarred: (item: OwnerInteraction) => boolean = () => false
): boolean {
  if (!isActiveRecord(item)) return false;
  if (filter.starred && !isStarred(item)) return false;
  const seen = classify(item, signals, preferences);
  if (filter.review && seen.review !== filter.review) return false;
  if (filter.status && seen.status !== filter.status) return false;
  if (filter.attention && seen.attention !== filter.attention) return false;
  return true;
}

/** The active selection in words, for the chip and for a screen reader. */
export function describeFilter(filter: ClassificationFilter): string[] {
  const parts: string[] = [];
  for (const plane of CLASSIFICATION_PLANES) {
    const selected = filter[plane.key];
    if (!selected) continue;
    const option = plane.options.find((entry) => entry.key === selected);
    if (option) parts.push(option.label);
  }
  if (filter.starred) parts.push("Starred");
  return parts;
}

/**
 * The old queue vocabulary, translated into the attention plane.
 *
 * Two surfaces still speak it — the per-job summary counts and the reminder
 * strip — and both are asking the same question the attention plane answers, so
 * they route through it rather than keeping a parallel filter alive.
 */
export function queueToAttention(queue: string): AttentionKey {
  switch (queue) {
    case "start_confirmation_pending":
      return "start_to_confirm";
    case "interview_confirmation":
      return "interview_to_confirm";
    case "interview_follow_up":
      return "ready_for_decision";
    case "needs_your_reply":
      return "needs_your_reply";
    case "new_to_review":
      return "unread_activity";
    case "decision_needed":
      return "decision_not_sent";
    case "waiting_for_them":
      return "waiting_on_them";
    case "snoozed":
      return "snoozed";
    default:
      return "no_action_needed";
  }
}
