/**
 * Empty and caught-up states.
 *
 * The distinction that matters: **is the system empty, or is your filter
 * empty?** Telling someone "no applications" when they have forty and a chip
 * selected is the difference between a calm product and one you stop trusting.
 *
 * No celebration. Finishing your queue is a normal Tuesday, not an achievement,
 * and confetti for clearing an inbox is the gamification this product refuses.
 */

export type EmptyStateReason =
  | "no_interactions"
  | "no_received"
  | "no_sent"
  | "no_archived"
  | "all_caught_up"
  | "queue_empty"
  | "snoozed_only"
  | "search_empty"
  | "filter_empty";

export type EmptyState = {
  reason: EmptyStateReason;
  /** What this means, in one line. Never "Nothing here!". */
  title: string;
  /** Why it is empty, and what would change it. Optional. */
  body?: string;
  /**
   * One thing worth doing, or null when the honest answer is "nothing — wait".
   * Offering an action where none exists is how empty states become dishonest.
   */
  action?: { label: string; kind: "clear-filter" | "clear-search" | "clear-queue" | "browse" };
};

export type EmptyStateInput = {
  mode: "talent" | "hiring";
  /** Every record in the current mode, before any filtering. */
  totalInMode: number;
  /** Records surviving the direction/archive filter, before search and queue. */
  filteredCount: number;
  /** Records surviving everything, i.e. what the list would render. */
  visibleCount: number;
  filter: "all" | "sent" | "received" | "archived";
  searchTerm: string;
  activeQueue: string | null;
  /** True when nothing in the whole mode is outstanding. */
  allCaughtUp: boolean;
  /** How many records are snoozed right now. */
  snoozedCount: number;
};

/**
 * The state to render when the list is empty, or null when it is not.
 *
 * Ordered narrowest-cause-first: a search that matched nothing is a more useful
 * explanation than "you have no applications", even when both are true.
 */
export function emptyStateFor(input: EmptyStateInput): EmptyState | null {
  if (input.visibleCount > 0) return null;

  if (input.searchTerm.trim()) {
    return {
      reason: "search_empty",
      title: `Nothing matches “${input.searchTerm.trim()}”.`,
      body: "Try a shorter search, or clear it to see everything again.",
      action: { label: "Clear search", kind: "clear-search" },
    };
  }

  if (input.activeQueue) {
    // The queue chips only appear when they hold work, so an empty queue here
    // means the work was just finished — say that, rather than implying a bug.
    return {
      reason: "queue_empty",
      title: "Nothing left in this view.",
      body: "You've handled everything here. Other work may be waiting elsewhere.",
      action: { label: "Show everything", kind: "clear-queue" },
    };
  }

  if (input.totalInMode === 0) {
    return input.mode === "hiring"
      ? {
          reason: "no_interactions",
          title: "No applications yet.",
          body: "When someone applies to one of your jobs, the conversation starts here.",
        }
      : {
          reason: "no_interactions",
          title: "Nothing here yet.",
          body: "Applications you send and hiring requests you receive both land in this inbox.",
          action: { label: "Browse jobs", kind: "browse" },
        };
  }

  if (input.filter === "archived") {
    return {
      reason: "no_archived",
      title: "Nothing archived.",
      body: "Archiving tidies a conversation away without changing its status.",
      action: { label: "Show everything", kind: "clear-filter" },
    };
  }

  if (input.filter === "received") {
    return {
      reason: "no_received",
      title: input.mode === "hiring" ? "No applicants yet." : "No hiring requests yet.",
      body:
        input.mode === "hiring"
          ? "Applications to your jobs appear here as they arrive."
          : "Recruiters who want to work with you appear here.",
      action: { label: "Show everything", kind: "clear-filter" },
    };
  }

  if (input.filter === "sent") {
    return {
      reason: "no_sent",
      title: input.mode === "hiring" ? "You haven't reached out yet." : "You haven't applied yet.",
      body:
        input.mode === "hiring"
          ? "Hiring requests you send appear here."
          : "Jobs you apply to appear here, with the whole conversation.",
      action: { label: "Browse jobs", kind: "browse" },
    };
  }

  if (input.snoozedCount > 0 && input.snoozedCount === input.filteredCount) {
    return {
      reason: "snoozed_only",
      title: "Everything here is snoozed.",
      body: "Snoozed conversations stay fully open — only the suggestions are quiet.",
      action: { label: "Show everything", kind: "clear-filter" },
    };
  }

  return {
    reason: "filter_empty",
    title: "Nothing matches these filters.",
    action: { label: "Show everything", kind: "clear-filter" },
  };
}

/**
 * The caught-up line, shown *above a non-empty list* when nothing is
 * outstanding. Distinct from an empty state: the conversations are all still
 * there, there is simply nothing they need.
 */
export function caughtUpLine(input: {
  mode: "talent" | "hiring";
  allCaughtUp: boolean;
  totalInMode: number;
  waitingOnOthers: number;
}): string | null {
  if (!input.allCaughtUp || input.totalInMode === 0) return null;
  if (input.waitingOnOthers > 0) {
    return input.waitingOnOthers === 1
      ? "Nothing needs you. 1 conversation is waiting on the other side."
      : `Nothing needs you. ${input.waitingOnOthers} conversations are waiting on the other side.`;
  }
  return "Nothing needs you right now.";
}
