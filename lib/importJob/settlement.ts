/**
 * What the import screen must do about a draft's status, decided by state.
 *
 * An import screen has exactly one job while work is running: notice that the
 * work stopped. It used to do that inside the timer that polled for it —
 *
 *     if (phase !== "processing" || draft.processing_status !== "processing") return;
 *     setTimeout(() => { …if terminal, open the draft… }, 1200);
 *
 * — which reads as a poll and behaves as a trap. The moment any *other* reader
 * delivered the finished status, the guard stopped being true, the effect
 * unmounted its timer, and the branch that opens the draft went with it. The
 * screen kept the spinner it had, and there was nothing left running to take it
 * away. A second reader existed the whole time: a four-second heartbeat that
 * refreshes the same draft. It won that race more often than not, and every time
 * it did, a finished import presented as a hung one.
 *
 * That is the shape of the bug worth naming, because it is not a missing case.
 * The transition was handled; it was handled *in a place that only existed while
 * the transition had not happened yet*. Deciding from status instead of from
 * whoever happened to fetch it removes the race rather than reordering it.
 *
 * So settlement is a pure function of (phase, status) and lives here, where it
 * can be enumerated. The exhaustiveness check at the bottom is the point: a
 * status added to the backend literal fails the build here rather than becoming
 * another silent spinner.
 */

/** Every status the backend's `JobImportProcessingStatus` literal can hold. */
export const IMPORT_PROCESSING_STATUSES = [
  "awaiting_processing",
  "processing",
  "processing_failed",
  "awaiting_recruiter_review",
  "partially_reviewed",
  "ready_to_apply",
  "applied_to_native_draft",
  "discarded",
  "superseded",
] as const;

export type ImportProcessingStatus = (typeof IMPORT_PROCESSING_STATUSES)[number];

/** The screen's own phases, in the order a recruiter meets them. */
export const IMPORT_PHASES = [
  "entry",
  "creating",
  "processing",
  "failure",
  "applying",
] as const;

export type ImportPhase = (typeof IMPORT_PHASES)[number];

/**
 * What the screen should do next.
 *
 * ``keep_waiting`` is the only non-settling answer, and it is returned only
 * while the backend itself reports work in progress. Everything else names a
 * destination, which is what makes "indefinitely processing" unrepresentable
 * rather than merely unlikely.
 */
export type Settlement =
  | "keep_waiting"
  | "open_draft"
  | "show_failure"
  | "start_over"
  | "idle";

/** Statuses that mean a draft exists and can be opened. */
export const OPENABLE_STATUSES: readonly ImportProcessingStatus[] = [
  "awaiting_recruiter_review",
  "partially_reviewed",
  "ready_to_apply",
  "applied_to_native_draft",
];

/**
 * Decide what a screen showing `phase` should do about a draft in `status`.
 *
 * Only the phases that are actually waiting on backend work consult the status.
 * A recruiter who has already been shown a failure is not moved off it by a late
 * poll, and a screen at `entry` has nothing to settle.
 */
export function settlementFor(
  phase: ImportPhase,
  status: ImportProcessingStatus
): Settlement {
  if (phase !== "processing") {
    // `applying` is a handoff already under way and owns its own completion;
    // `failure` and `entry` are settled states a background read must not move.
    return "idle";
  }

  switch (status) {
    case "awaiting_processing":
    case "processing":
      // The backend says it is still working. This is the one legitimate wait.
      return "keep_waiting";
    case "awaiting_recruiter_review":
    case "partially_reviewed":
    case "ready_to_apply":
    case "applied_to_native_draft":
      return "open_draft";
    case "processing_failed":
      return "show_failure";
    case "discarded":
    case "superseded":
      // The draft the screen is waiting on is gone — deleted elsewhere, or
      // replaced by a newer import of the same source. Waiting for it to finish
      // is waiting for something that will never report again, so the recruiter
      // is returned to a screen they can act on instead.
      return "start_over";
    default: {
      // A status the backend gained and this module was never taught. Failing
      // the build here is deliberate: the alternative is a spinner nobody
      // notices until a recruiter reports it.
      const unreachable: never = status;
      return unreachable;
    }
  }
}

/** Whether a status means the backend has stopped working on this draft. */
export function backendHasSettled(status: ImportProcessingStatus): boolean {
  return status !== "awaiting_processing" && status !== "processing";
}
