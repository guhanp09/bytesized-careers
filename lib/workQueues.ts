/**
 * Derived work queues.
 *
 * Queues are **recommendations, never lifecycle**. Nothing here writes state:
 * entering or leaving a queue changes no status, and dismissing or snoozing a
 * recommendation must never mutate a record. They exist so the user can see what
 * actually needs them, which is the payoff for keeping status current.
 *
 * The derivation is deterministic and shared by the Inbox and the Pipeline, so
 * the two views can never disagree about what is outstanding.
 */

import { deriveWorkState, type WorkSignals, type WorkState } from "./applicationPipeline.ts";
import type { OwnerInteraction } from "./ownerInteractions.ts";

export type WorkQueueKey =
  | "start_confirmation_pending"
  | "interview_follow_up"
  | "needs_your_reply"
  | "decision_needed"
  | "new_to_review"
  | "waiting_for_them"
  | "stale";

export type WorkQueue = {
  key: WorkQueueKey;
  label: string;
  /** Longest-standing first inside a queue, so nothing quietly rots. */
  order: number;
};

/**
 * Precedence, highest first. A record belongs to exactly one queue — the most
 * urgent one it qualifies for — so the counts never double-count and two
 * contradictory labels can never appear at once.
 */
export const WORK_QUEUE_ORDER: WorkQueue[] = [
  { key: "start_confirmation_pending", label: "Start confirmation pending", order: 0 },
  { key: "interview_follow_up", label: "Interview follow-up", order: 1 },
  { key: "needs_your_reply", label: "Needs your reply", order: 2 },
  { key: "decision_needed", label: "Decision needed", order: 3 },
  { key: "new_to_review", label: "New to review", order: 4 },
  { key: "waiting_for_them", label: "Waiting for them", order: 5 },
  { key: "stale", label: "Stale", order: 6 },
];

export function workQueueByKey(key: WorkQueueKey): WorkQueue {
  return WORK_QUEUE_ORDER.find((queue) => queue.key === key) ?? WORK_QUEUE_ORDER[0];
}

/**
 * Durable per-user queue preferences — dismissals ("No reply needed") and
 * snoozes.
 *
 * **Interface seam, intentionally unimplemented in this slice.** These belong in
 * the per-user `interaction_user_preferences` model from B1, so that a dismissal
 * is durable and follows the user across devices. Deliberately *not* backed by
 * local storage here: a temporary local-only implementation would have to be
 * migrated and reconciled the moment B1 lands, and would silently disagree
 * between devices in the meantime.
 *
 * Supply an implementation in B1; until then the queues simply show everything
 * that qualifies.
 */
export type WorkQueuePreferences = {
  /** True when the user has said this record needs no reply from them. */
  isDismissed: (interactionId: string) => boolean;
  /** Epoch ms until which the record should be hidden from queues. */
  snoozedUntil: (interactionId: string) => number | null;
};

/** Everything visible: the behaviour until B1 supplies durable preferences. */
export const NO_QUEUE_PREFERENCES: WorkQueuePreferences = {
  isDismissed: () => false,
  snoozedUntil: () => null,
};

export type QueueSignals = WorkSignals & {
  /** Age of the last activity, in days. Drives the stale queue only. */
  idleDays?: number;
};

/** Records idle beyond this, with nothing else outstanding, read as stale. */
export const STALE_AFTER_DAYS = 7;

/**
 * The single queue a record belongs to, or null when it needs nothing.
 *
 * Built on `deriveWorkState` rather than beside it, so a record's queue and its
 * row label can never tell different stories. System messages, archived records,
 * closed conversations, and "the other side owes the move" are already excluded
 * there and stay excluded here.
 */
export function deriveWorkQueue(
  item: OwnerInteraction,
  signals: QueueSignals = {},
  preferences: WorkQueuePreferences = NO_QUEUE_PREFERENCES
): WorkQueueKey | null {
  // A dismissal or snooze hides the recommendation. It changes no status.
  if (preferences.isDismissed(item.id)) return null;
  const snoozed = preferences.snoozedUntil(item.id);
  if (snoozed !== null && snoozed > Date.now()) return null;

  const state: WorkState | null = deriveWorkState(item, signals);
  if (!state) {
    // Nothing outstanding. Only long-idle *active* records read as stale.
    const idle = signals.idleDays ?? 0;
    return idle >= STALE_AFTER_DAYS && item.direction === "received" ? "stale" : null;
  }

  switch (state.key) {
    case "start_confirmation_pending":
      return "start_confirmation_pending";
    case "interview_follow_up":
      return "interview_follow_up";
    case "needs_reply":
      // Only an explicit response expectation reaches this state, so the queue
      // inherits that precision rather than asserting it on weak evidence.
      return "needs_your_reply";
    case "needs_review":
      return "new_to_review";
    case "decision_not_shared":
      return "decision_needed";
    case "review_latest":
      // Ambiguous inbound activity — something arrived and nothing proves what
      // it needs. It is a decision the viewer owes, not a reply we can promise.
      return "decision_needed";
  }
}

/** Group records into queues, preserving precedence and dropping empties. */
export function groupByWorkQueue(
  items: OwnerInteraction[],
  signalsFor: (item: OwnerInteraction) => QueueSignals,
  preferences: WorkQueuePreferences = NO_QUEUE_PREFERENCES
): Array<{ queue: WorkQueue; items: OwnerInteraction[] }> {
  const buckets = new Map<WorkQueueKey, OwnerInteraction[]>();
  for (const item of items) {
    const key = deriveWorkQueue(item, signalsFor(item), preferences);
    if (!key) continue;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(item);
    else buckets.set(key, [item]);
  }
  return WORK_QUEUE_ORDER.filter((queue) => buckets.has(queue.key)).map((queue) => ({
    queue,
    items: buckets.get(queue.key) as OwnerInteraction[],
  }));
}

/** True when nothing at all is outstanding — the "all caught up" moment. */
export function isAllCaughtUp(
  items: OwnerInteraction[],
  signalsFor: (item: OwnerInteraction) => QueueSignals,
  preferences: WorkQueuePreferences = NO_QUEUE_PREFERENCES
): boolean {
  return items.every((item) => deriveWorkQueue(item, signalsFor(item), preferences) === null);
}
