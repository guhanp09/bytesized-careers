/**
 * Provider-neutral analytics for the applications workspace.
 *
 * The repository has no analytics vendor, and this feature must not introduce
 * one. Events are emitted through a sink that defaults to a no-op, so nothing is
 * transmitted anywhere until a sink is deliberately installed. That keeps the
 * measurement design reviewable now and the vendor choice free later.
 *
 * Privacy rule, enforced by construction: payloads carry only enums, counts, and
 * durations. Message bodies, private notes, names, emails, and application
 * content must never be passed here — the `WorkspaceEventPayload` type has no
 * field that would accept free text.
 */

export type WorkspaceEventName =
  /** A recommended primary action was rendered for the user to see. */
  | "workspace.next_action.impression"
  /** The recommended primary action was activated. */
  | "workspace.next_action.activate"
  /** The neutral low-confidence fallback was activated. */
  | "workspace.choose_next_step.activate"
  /** The first-open decision strip was rendered. */
  | "workspace.decision_strip.impression"
  /** The strip was dismissed without taking one of its actions. */
  | "workspace.decision_strip.dismiss"
  /** An action was taken from within the strip. */
  | "workspace.decision_strip.action"
  /** The user messaged directly instead of using the strip. */
  | "workspace.decision_strip.bypass"
  /** A status action was reached through the overflow menu. */
  | "workspace.overflow.use"
  /** Time from opening an interaction to its first meaningful action. */
  | "workspace.interaction.time_to_action"
  /** An interaction was opened and closed with no meaningful action. */
  | "workspace.interaction.abandoned"
  /** An ordinary message was sent. */
  | "workspace.message.sent";

export type WorkspaceSurface = "inbox" | "pipeline" | "dock";
export type WorkspaceViewport = "desktop" | "mobile";

/**
 * Strictly non-identifying. Every field is an enum, a boolean, a count, or a
 * duration — there is deliberately no free-text field.
 */
export type WorkspaceEventPayload = {
  /** Which surface emitted the event. */
  surface?: WorkspaceSurface;
  /** Viewport class, for mobile-vs-desktop completion comparisons. */
  viewport?: WorkspaceViewport;
  /** Interaction kind: "application" | "hiring_request". */
  interactionKind?: string;
  /** "sent" | "received". */
  direction?: string;
  /** Canonical backend stage, e.g. "new" | "reviewing" — never a label. */
  stage?: string;
  /** Recommended-action key, e.g. "choose-next-step" | "stage-hired". */
  actionKey?: string;
  /** Derived work-state key, e.g. "needs_review". */
  workState?: string;
  /** Whether the recommendation was high-confidence. */
  highConfidence?: boolean;
  /** Milliseconds, for time-to-action. */
  durationMs?: number;
  /** Which flags were active, so cohorts can be compared. */
  flagCohort?: string;
};

export type WorkspaceEvent = {
  name: WorkspaceEventName;
  payload: WorkspaceEventPayload;
  /** Epoch milliseconds, set at emit time. */
  at: number;
};

export type WorkspaceAnalyticsSink = (event: WorkspaceEvent) => void;

const noopSink: WorkspaceAnalyticsSink = () => {};

let sink: WorkspaceAnalyticsSink = noopSink;

/** Install a sink (a vendor adapter, a logger, or a test spy). */
export function setWorkspaceAnalyticsSink(next: WorkspaceAnalyticsSink | null): void {
  sink = next ?? noopSink;
}

/**
 * Emit an event. Never throws: analytics must not be able to break a hiring
 * workflow, so a failing sink is swallowed.
 */
export function trackWorkspaceEvent(
  name: WorkspaceEventName,
  payload: WorkspaceEventPayload = {}
): void {
  try {
    sink({ name, payload, at: Date.now() });
  } catch {
    // Intentionally ignored — see above.
  }
}

/** Compact, stable cohort label for comparing flag combinations. */
export function flagCohortLabel(flags: {
  nextAction: boolean;
  decisionStrip: boolean;
  workState: boolean;
}): string {
  const parts = [
    flags.nextAction ? "na" : "-",
    flags.decisionStrip ? "ds" : "-",
    flags.workState ? "ws" : "-",
  ];
  return parts.join("|");
}
