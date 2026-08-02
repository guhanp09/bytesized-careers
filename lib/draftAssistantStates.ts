/**
 * The draft assistant's states and how each one is announced.
 *
 * Kept apart from the drawing so the announcements are ordinary testable data:
 * a new visual state cannot ship without someone deciding what a screen reader
 * hears, because the label map is exhaustive over the state union.
 */

export type DraftAssistantState =
  | "greeting"
  | "reading"
  | "scanning"
  | "thinking"
  | "asking"
  | "listening"
  | "confirming"
  | "celebrating"
  | "failed";

export const DRAFT_ASSISTANT_STATES: readonly DraftAssistantState[] = [
  "greeting",
  "reading",
  "scanning",
  "thinking",
  "asking",
  "listening",
  "confirming",
  "celebrating",
  "failed",
];

/**
 * What the assistant is doing, in words. This is what assistive technology gets;
 * the SVG itself is decorative and hidden.
 */
export const DRAFT_ASSISTANT_STATE_LABELS: Readonly<
  Record<DraftAssistantState, string>
> = {
  greeting: "Bea is getting started",
  reading: "Bea is reading the job details",
  scanning: "Bea is checking the details against CreatorJobs",
  thinking: "Bea is working out what still needs your decision",
  asking: "Bea has a question for you",
  listening: "Bea is waiting for your answer",
  confirming: "Bea saved your answer",
  celebrating: "Bea finished your draft",
  failed: "Bea could not finish preparing this draft",
};

/** States where work is genuinely in flight, so the beacon may pulse. */
export const DRAFT_ASSISTANT_WORKING_STATES: ReadonlySet<DraftAssistantState> =
  new Set(["reading", "scanning", "thinking"]);

/** States where a source is genuinely being read, so the visor may scan. */
export const DRAFT_ASSISTANT_SCANNING_STATES: ReadonlySet<DraftAssistantState> =
  new Set(["reading", "scanning"]);

/** Eyes curve upward when pleased; they go flat when stopped. */
export const DRAFT_ASSISTANT_HAPPY_STATES: ReadonlySet<DraftAssistantState> =
  new Set(["confirming", "celebrating"]);
