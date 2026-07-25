/**
 * Consolidated reminders.
 *
 * One quiet line telling you what has been sitting, derived from the queues the
 * workspace already computes. Nothing here schedules anything, stores anything,
 * or sends anything — a reminder is a *reading* of state, so it can never
 * disagree with the list it summarises and can never arrive twice.
 *
 * What this deliberately is not:
 *
 * - **Not a notification.** Quiet and in-product first. An email or a push for
 *   "you have three decisions waiting" would need a scheduler, a per-user
 *   cadence, an unsubscribe, and a quiet-hours policy; that is a separate
 *   reminder framework, which is exactly what was ruled out.
 * - **Not a score.** No response-time ranking, no red, no "you are behind".
 *   Every line is a count and a fact.
 * - **Not repeatable.** There is no delivery, so there is nothing to repeat.
 *   The line is present while the work is, and gone when it is not.
 *
 * Snoozes and "No reply needed" are honoured structurally: reminders are built
 * from `deriveWorkQueue`, which already drops both. Archived records, closed
 * conversations, and anything where the other participant owes the move are
 * excluded there too, and stay excluded here.
 */

import type { OwnerInteraction } from "./ownerInteractions.ts";
import {
  deriveWorkQueue,
  type QueueSignals,
  type WorkQueueKey,
  type WorkQueuePreferences,
  NO_QUEUE_PREFERENCES,
} from "./workQueues.ts";

/** A decision that has sat this long is worth mentioning. */
export const DECISION_WAITING_DAYS = 5;
/** A saved person nobody has moved on in this long is worth mentioning. */
export const STALE_STARRED_DAYS = 14;

export type ReminderKey =
  | "start_confirmation"
  | "interview_follow_up"
  | "unanswered_question"
  | "decision_waiting"
  | "new_to_review"
  | "stale_starred";

export type WorkReminder = {
  key: ReminderKey;
  /** The whole reminder, as one sentence. Plain, countable, never urgent. */
  text: string;
  /** How many records it covers. Always ≥ 1. */
  count: number;
  /** The queue this leads to, so the line is a route rather than a nag. */
  queue: WorkQueueKey | "starred";
};

export type ReminderSignals = QueueSignals & {
  /** Days since the last activity on this record. */
  ageDays?: number;
  /** Days since the viewer starred it, when they have. */
  starredDays?: number;
};

/**
 * Highest first. Only the first qualifying reminder is worth showing: two
 * summaries at once is a list, and a list of reminders is a to-do app.
 */
const ORDER: ReminderKey[] = [
  "start_confirmation",
  "interview_follow_up",
  "unanswered_question",
  "decision_waiting",
  "new_to_review",
  "stale_starred",
];

/**
 * Copy per category. Deliberately written out per count rather than assembled
 * from fragments: these are the sentences a person reads every day, and
 * "1 applications have been waiting" is the kind of seam that makes a product
 * feel unattended.
 */
const COPY: Record<ReminderKey, (count: number) => string> = {
  start_confirmation: (n) =>
    n === 1
      ? "1 start confirmation is waiting for you."
      : `${n} start confirmations are waiting for you.`,
  interview_follow_up: (n) =>
    n === 1
      ? "1 interview has happened and hasn't been followed up."
      : `${n} interviews have happened and haven't been followed up.`,
  unanswered_question: (n) =>
    n === 1
      ? "1 person asked you something and hasn't heard back."
      : `${n} people asked you something and haven't heard back.`,
  decision_waiting: (n) =>
    n === 1
      ? `1 application has been waiting for a decision for more than ${DECISION_WAITING_DAYS} days.`
      : `${n} applications have been waiting for a decision for more than ${DECISION_WAITING_DAYS} days.`,
  new_to_review: (n) =>
    n === 1 ? "1 application hasn't been looked at yet." : `${n} applications haven't been looked at yet.`,
  stale_starred: (n) =>
    n === 1
      ? "1 saved person hasn't moved in two weeks."
      : `${n} saved people haven't moved in two weeks.`,
};

/**
 * The one reminder worth showing, or null when nothing has been sitting.
 *
 * Returning null is the common and correct case: a workspace that is being kept
 * up to date should say nothing at all.
 */
export function consolidatedReminder(
  items: OwnerInteraction[],
  signalsFor: (item: OwnerInteraction) => ReminderSignals,
  preferences: WorkQueuePreferences = NO_QUEUE_PREFERENCES,
  isStarred: (item: OwnerInteraction) => boolean = () => false
): WorkReminder | null {
  const counts = new Map<ReminderKey, number>();
  const bump = (key: ReminderKey) => counts.set(key, (counts.get(key) ?? 0) + 1);

  for (const item of items) {
    const signals = signalsFor(item);
    const queue = deriveWorkQueue(item, signals, preferences);

    // Stale-starred is the one category that is not a queue: a saved person may
    // be perfectly up to date and still be quietly forgotten.
    if (
      isStarred(item) &&
      (signals.starredDays ?? 0) >= STALE_STARRED_DAYS &&
      queue !== "start_confirmation_pending" &&
      queue !== "interview_follow_up"
    ) {
      bump("stale_starred");
    }

    if (!queue) continue;
    switch (queue) {
      case "start_confirmation_pending":
        bump("start_confirmation");
        break;
      case "interview_follow_up":
        bump("interview_follow_up");
        break;
      case "needs_your_reply":
        // Only an explicit response expectation reaches this queue, so this is
        // the one category that can honestly say someone asked something.
        bump("unanswered_question");
        break;
      case "decision_needed":
        // Age is what makes a decision worth mentioning. A decision made
        // yesterday is not a reminder, it is just work.
        if ((signals.ageDays ?? 0) >= DECISION_WAITING_DAYS) bump("decision_waiting");
        break;
      case "new_to_review":
        if ((signals.ageDays ?? 0) >= 1) bump("new_to_review");
        break;
      // "waiting_for_them" is deliberately absent: the other participant owes
      // the move, and reminding someone about that is nagging by proxy.
      // "stale" is handled by the starred rule above rather than twice.
      default:
        break;
    }
  }

  for (const key of ORDER) {
    const count = counts.get(key) ?? 0;
    if (count > 0) return { key, text: COPY[key](count), count, queue: queueFor(key) };
  }
  return null;
}

function queueFor(key: ReminderKey): WorkQueueKey | "starred" {
  switch (key) {
    case "start_confirmation":
      return "start_confirmation_pending";
    case "interview_follow_up":
      return "interview_follow_up";
    case "unanswered_question":
      return "needs_your_reply";
    case "decision_waiting":
      return "decision_needed";
    case "new_to_review":
      return "new_to_review";
    case "stale_starred":
      return "starred";
  }
}
