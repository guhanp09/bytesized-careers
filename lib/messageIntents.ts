/**
 * Optional composer intents.
 *
 * These are accelerators, never a classification step. Freeform typing stays the
 * fastest path and is always available; picking an intent only pre-fills an
 * editable draft and, where the intent genuinely expects an answer, records that
 * expectation on the sent message so the work-state derivation can be precise
 * instead of guessing.
 *
 * Two kinds, deliberately separated:
 *  - "message" intents send ordinary text and never change participant-visible
 *    state. No freeform text may ever produce a shared outcome.
 *  - "decision" intents do not send anything themselves; they hand off to the
 *    existing confirmed status actions, which are atomic and already carry the
 *    confirmation, the optional note, and the exactly-once guarantees.
 */

export type MessageIntentKind = "message" | "decision";

export type MessageIntent = {
  key: string;
  /** Chip label. Action-voice, so it reads as something you are doing. */
  label: string;
  kind: MessageIntentKind;
  /**
   * Draft text for "message" intents. Always editable — the user can rewrite it
   * entirely before sending.
   */
  template?: string;
  /**
   * True when the message genuinely asks the other side for something. This is
   * the only thing that may later justify a high-confidence "waiting"/"needs
   * reply" work state; everything else stays descriptive.
   */
  responseExpected?: boolean;
  /**
   * For "decision" intents: the backend stage the confirmed action moves to.
   * The workspace routes these through the existing confirmed flow.
   */
  stage?: string;
};

const MESSAGE_INTENTS: MessageIntent[] = [
  {
    key: "ask_question",
    label: "Ask a question",
    kind: "message",
    template: "",
    responseExpected: true,
  },
  {
    key: "request_portfolio",
    label: "Request portfolio",
    kind: "message",
    template: "Could you share one or two samples closest to this brief?",
    responseExpected: true,
  },
  {
    key: "check_availability",
    label: "Check availability",
    kind: "message",
    template: "What does your availability look like over the next two weeks?",
    responseExpected: true,
  },
  {
    key: "propose_interview",
    label: "Propose a time",
    kind: "message",
    // Proposing a time is a message, not a decision: the participant-visible
    // "Interviewing" outcome stays behind the explicit confirmed action.
    template: "Are you free for a short call this week? Let me know a couple of times that suit you.",
    responseExpected: true,
  },
  {
    key: "request_confirmation",
    label: "Request confirmation",
    kind: "message",
    template: "Could you confirm so we can lock this in?",
    responseExpected: true,
  },
];

const DECISION_INTENTS: MessageIntent[] = [
  { key: "not_proceeding", label: "Not proceeding", kind: "decision", stage: "rejected" },
  { key: "hire", label: "Hire", kind: "decision", stage: "hired" },
  { key: "accept", label: "Accept request", kind: "decision", stage: "accepted" },
  { key: "decline", label: "Decline request", kind: "decision", stage: "declined" },
];

export const ALL_MESSAGE_INTENTS: MessageIntent[] = [...MESSAGE_INTENTS, ...DECISION_INTENTS];

/** Keys the backend will accept on a send. Decision intents never send text. */
export const SENDABLE_INTENT_KEYS: string[] = MESSAGE_INTENTS.map((intent) => intent.key);

export function messageIntentByKey(key: string | null | undefined): MessageIntent | null {
  if (!key) return null;
  return ALL_MESSAGE_INTENTS.find((intent) => intent.key === key) ?? null;
}

/** Does a sent message with this intent justify a high-confidence waiting state? */
export function intentExpectsResponse(key: string | null | undefined): boolean {
  return Boolean(messageIntentByKey(key)?.responseExpected);
}

/**
 * Intents worth offering for a record, given what the viewer can actually do.
 * Decision intents are filtered to the stages the transition rules allow, so the
 * composer can never offer an outcome the backend would reject.
 */
export function intentsFor(options: {
  direction: "sent" | "received";
  allowedStages: string[];
  messagingClosed: boolean;
}): MessageIntent[] {
  if (options.messagingClosed) return [];
  const decisions = DECISION_INTENTS.filter(
    (intent) => intent.stage && options.allowedStages.includes(intent.stage)
  );
  // The sender side manages nothing, so it only ever gets message intents.
  if (options.direction === "sent") return MESSAGE_INTENTS;
  return [...MESSAGE_INTENTS, ...decisions];
}
