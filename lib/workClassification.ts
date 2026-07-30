/**
 * One partition, and some flags.
 *
 * The menu this replaces was a single flat list of eleven categories, of which
 * three were ever visible at once, and the largest of those three meant
 * nothing. On a real inbox of 190 records it read:
 *
 *     Decision needed   24   "You have everything you need to move this
 *                             forward or close it — including messages whose
 *                             intent is unclear…"
 *     New to review     33   "Arrived and not yet opened."
 *     Up to date       133   "Nothing outstanding on either side."
 *
 * Three faults, and they are the same fault three times.
 *
 * **The residual.** `up_to_date` held 133 of 190 — 70%. A row that means
 * "nothing matched" is not a category; it is the absence of one, and putting
 * seven tenths of somebody's work into it tells them nothing at all.
 *
 * **The grab-bag.** `decision_needed` absorbed two unrelated things: a decision
 * saved and never sent, which is objective, and any inbound message whose
 * intent was unclear, which is not a decision but an unread thing. Its own copy
 * admitted it — "including messages whose intent is unclear" — and it claimed
 * the reader "had everything they needed" on the evidence that nothing else had
 * matched. That is not evidence.
 *
 * **One list, three questions.** *New to review* answers "have I looked at
 * this"; *Up to date* answers "does anyone owe a move"; *Decision needed*
 * answers neither. A record can be opened *and* interviewing *and* waiting on
 * the applicant — a flat list has to pick one of those and silently drop the
 * rest, which is why nobody could predict where a record would land.
 *
 * What the category actually does, and what this follows:
 *
 * - **Linear** has exactly one status workflow and its documentation says
 *   outright not to replicate statuses as labels.
 * - **Greenhouse's** visual pipeline colour-codes candidates by *what action is
 *   awaiting someone* and leaves the rest unmarked. There is no "everything
 *   else" column anywhere in it.
 * - Inbox-triage practice puts it plainest: the useful question is not "what
 *   category is this" but "does this need a response from me".
 *
 * So there is exactly one partition — **Stage**, in the Pipeline board's own
 * vocabulary, over every active record — and everything else is a **flag** that
 * covers nothing in particular. A record needing nobody carries no flag, and
 * the section heading counts the ones that do rather than offering a row that
 * means "nothing matched".
 */

import type { OwnerInteraction } from "./ownerInteractions.ts";
import { isArchivedInteraction } from "./ownerInteractions.ts";
import { backendStatusOf, deriveWorkState } from "./applicationPipeline.ts";
import type { QueueSignals, WorkQueuePreferences } from "./workQueues.ts";
import { NO_QUEUE_PREFERENCES } from "./workQueues.ts";

/* ---- the population ------------------------------------------------------ */

/**
 * Which records the menu describes.
 *
 * Archived is a scope of its own — a place things are put deliberately — so
 * counting archived records inside "everything" would make the total disagree
 * with the tab beside it.
 */
export function isActiveRecord(item: OwnerInteraction): boolean {
  return !isArchivedInteraction(item);
}

/* ---- the one partition: stage -------------------------------------------- */

export type StageKey = "new" | "reviewing" | "interviewing" | "hired" | "closed";

const CLOSED_STAGES = new Set(["rejected", "declined", "withdrawn", "not_selected", "expired"]);
const HIRED_STAGES = new Set(["hired", "accepted"]);

/**
 * Where a record sits in the process — over *every* active record.
 *
 * Deliberately the board's own vocabulary, including `New`. A state that reads
 * "Interviewing" on the Pipeline board must not read as something else in the
 * menu beside it, and the board's first column has to be reachable from here.
 *
 * Legacy `shortlisted` and `under_consideration` fold into Reviewing, which is
 * what they always meant. `closed` is the one deliberate summary: it stands for
 * the board's terminal columns, and its description says which.
 */
export function stageOf(item: OwnerInteraction): StageKey {
  const stage = backendStatusOf(item);
  if (CLOSED_STAGES.has(stage)) return "closed";
  if (HIRED_STAGES.has(stage)) return "hired";
  if (stage === "interviewing") return "interviewing";
  if (stage === "new" && item.direction === "received") return "new";
  return "reviewing";
}

/** Has anyone actually looked at this? Read from the stage, so it survives a reload. */
export function isUnopened(item: OwnerInteraction): boolean {
  return item.direction === "received" && backendStatusOf(item) === "new";
}

/* ---- the flags ----------------------------------------------------------- */

export type AttentionKey =
  | "not_opened"
  | "needs_your_reply"
  | "unread_activity"
  | "ready_for_decision"
  | "decision_not_sent"
  | "interview_to_confirm"
  | "start_to_confirm"
  | "waiting_on_them"
  | "snoozed";

/**
 * Does anyone need to do something, and who — or `null` for neither.
 *
 * **`null` is the whole design.** The model this replaces returned
 * `up_to_date`, which made the set exhaustive and put 133 of 190 records in a
 * row that said "nothing outstanding on either side". Seventy per cent of a
 * menu meaning nothing is not information. A record that needs no one now
 * simply carries no flag, and the heading counts the ones that do.
 *
 * Built on the same deterministic work-state engine the row chips read, so a
 * record's flag and its chip can never tell different stories.
 *
 * `not_opened` is checked before the work state, deliberately. A record nobody
 * has looked at derives a `needs_review` state by construction, so without this
 * it surfaces as *New to read* — the same records the *Not opened yet* flag is
 * already showing, under a second name. Checking it first leaves *New to read*
 * meaning what it says: you have seen this before and something new arrived.
 */
export function attentionOf(
  item: OwnerInteraction,
  signals: QueueSignals = {},
  preferences: WorkQueuePreferences = NO_QUEUE_PREFERENCES
): AttentionKey | null {
  const snoozed = preferences.snoozedUntil(item.id);
  if (snoozed !== null && snoozed > Date.now()) return "snoozed";
  if (preferences.isDismissed(item.id)) return null;

  if (isUnopened(item)) return "not_opened";

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
      // read, not a decision the product can claim is ready to be made.
      return "unread_activity";
    default:
      break;
  }

  // Nothing outstanding on this side. Whether the other side owes a move is
  // still worth saying and is deterministic; everything else is quiet and gets
  // no flag at all.
  if (item.direction === "sent") return "waiting_on_them";
  if (signals.interviewScheduled && !signals.interviewFollowUpDue) return "waiting_on_them";
  return null;
}

/** The flags that mean the next move is yours. Drives the section heading. */
export const NEEDS_YOU: ReadonlySet<AttentionKey> = new Set<AttentionKey>([
  "not_opened",
  "unread_activity",
  "needs_your_reply",
  "ready_for_decision",
  "decision_not_sent",
  "interview_to_confirm",
  "start_to_confirm",
]);

/* ---- the menu ------------------------------------------------------------ */

export type SectionOption = { key: string; label: string; description: string };

export type ClassificationSectionSpec = {
  key: "stage" | "attention" | "waiting";
  label: string;
  /**
   * How this section's numbers relate. A `partition` sums to its denominator
   * and says so. `flags` do not sum to anything — they may overlap, a record
   * may carry none — so the heading reports how many records carry any rather
   * than pretending to a total.
   */
  kind: "partition" | "flags";
  options: SectionOption[];
};

export const CLASSIFICATION_SECTIONS: ClassificationSectionSpec[] = [
  {
    key: "stage",
    label: "Stage",
    kind: "partition",
    options: [
      { key: "new", label: "New", description: "Arrived, and no step taken yet." },
      { key: "reviewing", label: "Reviewing", description: "Opened, and no later step taken yet." },
      { key: "interviewing", label: "Interviewing", description: "An interview is arranged or has happened." },
      { key: "hired", label: "Hired / starting", description: "Agreed, and the work is beginning." },
      { key: "closed", label: "Closed", description: "Declined, withdrawn, or otherwise finished." },
    ],
  },
  {
    key: "attention",
    label: "Needs you",
    kind: "flags",
    options: [
      { key: "not_opened", label: "Not opened yet", description: "Nobody has looked at it." },
      { key: "unread_activity", label: "New to read", description: "You have seen this before and something new arrived." },
      { key: "needs_your_reply", label: "Needs your reply", description: "They asked something that expects an answer." },
      { key: "ready_for_decision", label: "Ready for decision", description: "The interview happened and no outcome was recorded." },
      { key: "decision_not_sent", label: "Decision not sent", description: "You decided privately and they have not been told." },
      { key: "interview_to_confirm", label: "Interview to confirm", description: "A time was proposed and nobody confirmed it." },
      { key: "start_to_confirm", label: "Start to confirm", description: "Agreed, and the start has not been confirmed." },
    ],
  },
  {
    key: "waiting",
    label: "Not your move",
    kind: "flags",
    options: [
      { key: "waiting_on_them", label: "Waiting on them", description: "The next move belongs to the other side." },
      { key: "snoozed", label: "Snoozed", description: "Hidden until you asked to see it again. Its status is unchanged." },
    ],
  },
];

/** Which section a flag is rendered under. */
export function sectionForAttention(key: AttentionKey): "attention" | "waiting" {
  return NEEDS_YOU.has(key) ? "attention" : "waiting";
}

export type ClassificationOf = {
  stage: StageKey;
  /** Null when nothing and nobody is outstanding. */
  attention: AttentionKey | null;
};

export function classify(
  item: OwnerInteraction,
  signals: QueueSignals = {},
  preferences: WorkQueuePreferences = NO_QUEUE_PREFERENCES
): ClassificationOf {
  return { stage: stageOf(item), attention: attentionOf(item, signals, preferences) };
}

export type ClassificationCounts = {
  /** Active records in scope — what Stage adds up to. */
  total: number;
  stage: Map<StageKey, number>;
  attention: Map<AttentionKey, number>;
  /** How many carry a flag meaning the next move is yours. */
  needsYou: number;
  /** Personal, and outside the arithmetic entirely. */
  starred: number;
};

/**
 * Count the partition and the flags in one pass.
 *
 * `stage` sums to `total` and the menu says so. `attention` deliberately does
 * not: a record can carry no flag, which is the change that removed a row
 * holding seven tenths of the inbox and meaning nothing.
 */
export function classificationCounts(
  items: OwnerInteraction[],
  signalsFor: (item: OwnerInteraction) => QueueSignals = () => ({}),
  preferences: WorkQueuePreferences = NO_QUEUE_PREFERENCES,
  isStarred: (item: OwnerInteraction) => boolean = () => false
): ClassificationCounts {
  const stage = new Map<StageKey, number>();
  const attention = new Map<AttentionKey, number>();
  let total = 0;
  let needsYou = 0;
  let starred = 0;

  for (const item of items) {
    if (!isActiveRecord(item)) continue;
    total += 1;
    if (isStarred(item)) starred += 1;
    const seen = classify(item, signalsFor(item), preferences);
    stage.set(seen.stage, (stage.get(seen.stage) ?? 0) + 1);
    if (seen.attention) {
      attention.set(seen.attention, (attention.get(seen.attention) ?? 0) + 1);
      if (NEEDS_YOU.has(seen.attention)) needsYou += 1;
    }
  }
  return { total, stage, attention, needsYou, starred };
}

/* ---- the selection ------------------------------------------------------- */

/** One selection per section. Absent means "no filter from this section". */
export type ClassificationFilter = {
  stage?: StageKey;
  attention?: AttentionKey;
  /** Personal organisation, cutting across both rather than being one of them. */
  starred?: boolean;
};

export const EMPTY_CLASSIFICATION_FILTER: ClassificationFilter = {};

export function isFilterActive(filter: ClassificationFilter): boolean {
  return Boolean(filter.stage || filter.attention || filter.starred);
}

export function countActiveFilters(filter: ClassificationFilter): number {
  return [filter.stage, filter.attention, filter.starred ? "starred" : undefined].filter(Boolean).length;
}

/**
 * Apply the selection.
 *
 * A stage and a flag combine to narrow, because they answer different
 * questions: "Interviewing" and "Ready for decision" together is a real thing
 * to ask for, and the flat list could never express it.
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
  if (filter.stage && seen.stage !== filter.stage) return false;
  if (filter.attention && seen.attention !== filter.attention) return false;
  return true;
}

/** The active selection in words, for the trigger and for a screen reader. */
export function describeFilter(filter: ClassificationFilter): string[] {
  const parts: string[] = [];
  for (const section of CLASSIFICATION_SECTIONS) {
    const selected = section.key === "stage" ? filter.stage : filter.attention;
    if (!selected) continue;
    const option = section.options.find((entry) => entry.key === selected);
    if (option && !parts.includes(option.label)) parts.push(option.label);
  }
  if (filter.starred) parts.push("Starred");
  return parts;
}

/**
 * The old queue vocabulary, translated.
 *
 * Two surfaces still speak it — the per-job summary counts and the reminder
 * strip — and both ask the question the flags answer, so they route through
 * here rather than keeping a parallel filter alive. A queue that meant
 * "nothing outstanding" now maps to `null`: there is no row for it any more,
 * so selecting one would be selecting something that is not there.
 */
export function queueToAttention(queue: string): AttentionKey | null {
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
      return "not_opened";
    case "decision_needed":
      return "decision_not_sent";
    case "waiting_for_them":
      return "waiting_on_them";
    case "snoozed":
      return "snoozed";
    default:
      return null;
  }
}
