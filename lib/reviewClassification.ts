/**
 * One partition, and some flags.
 *
 * The menu before this asked three questions as three exhaustive sections, and
 * measuring it showed why that was one too many:
 *
 * - **"No action needed" held 102 of 155 records.** The largest row in the menu
 *   meant *nothing*. That is the same disease as the flat list it replaced —
 *   *Decision needed* was the bucket for whatever had not matched — just
 *   inverted. A residual is not a category; it is the absence of one.
 * - **"New to read" and "Not opened yet" were the same 35 records**, named
 *   twice in two different sections, because a record at stage `new` derives a
 *   `needs_review` work state by construction.
 * - **"Where it stands" covered only opened records**, so 35 records had no
 *   position here while the Pipeline board put them in a **New** column. The
 *   same record had a stage on one screen and none on the other.
 *
 * Every product that does this well converges on the same shape. Greenhouse's
 * visual pipeline colour-codes candidates by *what action is awaiting someone*
 * and leaves the rest unmarked. Linear has exactly one status workflow and says
 * outright not to replicate it as labels. Inbox triage research puts it most
 * plainly: the useful question is not "what category is this" but "does this
 * need a response from me".
 *
 * So:
 *
 * - **Stage** is the one partition. Every active record has exactly one, and it
 *   uses the Pipeline board's own vocabulary — including `New` — so a state has
 *   the same name in both places you see it.
 * - **Attention** is a set of flags with **no residual**. A record that needs
 *   nothing appears in none of them, and the section heading counts how many
 *   need you rather than offering a row that means "nothing matched".
 * - **Starred** is personal organisation cutting across both.
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

/* ---- has anyone looked? -------------------------------------------------- */

export type ReviewProgressKey = "unopened" | "opened";

/**
 * Has anyone looked at this yet?
 *
 * No longer a section of its own — it is one attention flag, *Not opened yet* —
 * but it is still the cleanest way to ask the question, and the stage plane and
 * the flag list both need the answer.
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

/* ---- the one partition: stage -------------------------------------------- */

export type StageKey = "new" | "reviewing" | "interviewing" | "hired" | "closed";

/** Kept as an alias: the old name is still what several call sites read. */
export type OpenedStatusKey = StageKey;

const CLOSED_STAGES = new Set(["rejected", "declined", "withdrawn", "not_selected", "expired"]);
const HIRED_STAGES = new Set(["hired", "accepted"]);

/**
 * Where a record sits in the process — over *every* active record.
 *
 * This used to be defined only for opened records, on the reasoning that an
 * untouched application has no management position yet. That reasoning was
 * wrong in one specific way: the Pipeline board already gives it one. It sits
 * in the **New** column, because `new` is a real backend stage, not the absence
 * of a stage. Excluding it here meant the same record had a position on one
 * screen and none on the other, and the menu could not offer the board's own
 * first column at all.
 *
 * Legacy `shortlisted` and `under_consideration` fold into Reviewing, which is
 * what they always meant.
 */
export function stageOf(item: OwnerInteraction): StageKey {
  const stage = backendStatusOf(item);
  if (CLOSED_STAGES.has(stage)) return "closed";
  if (HIRED_STAGES.has(stage)) return "hired";
  if (stage === "interviewing") return "interviewing";
  if (stage === "new" && item.direction === "received") return "new";
  return "reviewing";
}

/**
 * The previous name, preserved because it reads correctly at call sites that
 * genuinely want "what position does this opened record hold".
 */
export const openedStatusOf = stageOf;

/* ---- the flags: does anyone need to do something? ------------------------ */

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
 * **`null` is the whole point.** This used to return `no_action_needed`, which
 * made the set exhaustive and put 102 of 155 records in a row that said
 * "nothing outstanding on either side". Two thirds of a menu meaning nothing is
 * not information. A record that needs no one now simply carries no flag, and
 * the section heading counts the ones that do.
 *
 * Built on the existing deterministic work-state engine rather than beside it,
 * so a record's flag and the chip on its row can never tell different stories.
 *
 * `not_opened` comes first deliberately. A record nobody has looked at derives
 * a `needs_review` work state by construction, so without this it surfaced as
 * *New to read* — the same 35 records the review section was already showing
 * under another name. Checking it first means *New to read* keeps its real
 * meaning: you have seen this record before and something new has arrived.
 */
export function attentionOf(
  item: OwnerInteraction,
  signals: QueueSignals = {},
  preferences: WorkQueuePreferences = NO_QUEUE_PREFERENCES
): AttentionKey | null {
  const snoozed = preferences.snoozedUntil(item.id);
  if (snoozed !== null && snoozed > Date.now()) return "snoozed";
  if (preferences.isDismissed(item.id)) return null;

  // Before the work state, so "nobody has looked" is not reported as "you have
  // not read the latest" — they were the same records under two names.
  if (reviewProgressOf(item) === "unopened") return "not_opened";

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

  // Nothing outstanding on this side. Whether the other side owes a move is
  // still worth saying, and it is deterministic; everything else is quiet and
  // gets no flag at all.
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

export type PlaneOption = { key: string; label: string; description: string };

export type ClassificationPlane = {
  key: "stage" | "attention" | "waiting";
  label: string;
  /**
   * How the section's numbers relate to each other.
   *
   * `partition` sums to the stated denominator and says so. `flags` do not sum
   * to anything — they overlap, a record can carry none, and the heading
   * reports how many carry any rather than pretending to a total.
   */
  kind: "partition" | "flags";
  /** What a partition's counts add up to. Unused for flags. */
  denominator: string;
  options: PlaneOption[];
};

export const CLASSIFICATION_PLANES: ClassificationPlane[] = [
  {
    key: "stage",
    label: "Stage",
    kind: "partition",
    denominator: "everything",
    options: [
      // The Pipeline board's own vocabulary, in its own order. A state that
      // reads "New" on the board must not read as something else here.
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
    denominator: "everything",
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
    denominator: "everything",
    options: [
      { key: "waiting_on_them", label: "Waiting on them", description: "The next move belongs to the other side." },
      { key: "snoozed", label: "Snoozed", description: "Hidden until you asked to see it again. Its status is unchanged." },
    ],
  },
];

/** Which section an attention flag is rendered under. */
export function planeForAttention(key: AttentionKey): "attention" | "waiting" {
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
  return {
    stage: stageOf(item),
    attention: attentionOf(item, signals, preferences),
  };
}

export type ClassificationCounts = {
  /** Active records in scope — what Stage adds up to. */
  total: number;
  stage: Map<StageKey, number>;
  attention: Map<AttentionKey, number>;
  /** How many carry a flag that means the next move is yours. */
  needsYou: number;
};

/**
 * Count the partition and the flags in one pass.
 *
 * `stage` sums to `total` and the menu says so. `attention` deliberately does
 * not: a record can carry no flag, which is the change that removed a row
 * holding two thirds of the inbox and meaning nothing.
 */
export function classificationCounts(
  items: OwnerInteraction[],
  signalsFor: (item: OwnerInteraction) => QueueSignals = () => ({}),
  preferences: WorkQueuePreferences = NO_QUEUE_PREFERENCES
): ClassificationCounts {
  const stage = new Map<StageKey, number>();
  const attention = new Map<AttentionKey, number>();
  let total = 0;
  let needsYou = 0;

  for (const item of items) {
    if (!isActiveRecord(item)) continue;
    total += 1;
    const seen = classify(item, signalsFor(item), preferences);
    stage.set(seen.stage, (stage.get(seen.stage) ?? 0) + 1);
    if (seen.attention) {
      attention.set(seen.attention, (attention.get(seen.attention) ?? 0) + 1);
      if (NEEDS_YOU.has(seen.attention)) needsYou += 1;
    }
  }
  return { total, stage, attention, needsYou };
}

/** One selection per section. Absent means "no filter from this section". */
export type ClassificationFilter = {
  stage?: StageKey;
  attention?: AttentionKey;
  /** Personal organisation, which cuts across both rather than being one. */
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
 * Stage and a flag combine to narrow, because they answer different questions:
 * "Interviewing" and "Ready for decision" together is a real thing to ask for,
 * and a flat list could never express it.
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

/** The active selection in words, for the chip and for a screen reader. */
export function describeFilter(filter: ClassificationFilter): string[] {
  const parts: string[] = [];
  for (const plane of CLASSIFICATION_PLANES) {
    const selected = plane.key === "stage" ? filter.stage : filter.attention;
    if (!selected) continue;
    const option = plane.options.find((entry) => entry.key === selected);
    if (option && !parts.includes(option.label)) parts.push(option.label);
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
      return "unread_activity";
    case "not_opened":
      return "not_opened";
    case "decision_needed":
      return "decision_not_sent";
    case "waiting_for_them":
      return "waiting_on_them";
    case "snoozed":
      return "snoozed";
    default:
      // No flag rather than a residual one: the queue said nothing is
      // outstanding, and there is no longer a row that means that.
      return null;
  }
}
