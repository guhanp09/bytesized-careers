/**
 * Telling someone where their card went.
 *
 * A board that accepts a drop and then shows nothing has not confirmed
 * anything: the card leaves the stage it was in, and whether it arrived is left
 * to the user to go and check. On a funnel tall enough to have offscreen stages
 * — the same funnel that made drag autoscroll necessary — the destination is
 * usually not on screen at all, so the move reads as the card vanishing.
 *
 * The rules here are the whole of it:
 *
 * - **only scroll when scrolling is needed.** A destination already comfortably
 *   in view is confirmed by the highlight alone; moving the viewport underneath
 *   someone who can already see the answer is the distraction, not the fix;
 * - **centre rather than merely reveal.** `scrollIntoView` with the default
 *   alignment parks the card against whichever edge it entered from, which
 *   reads as "it only just fits" and hides its neighbours;
 * - **never scroll past the ends.** Clamping means the last card in a stage
 *   settles at the bottom instead of leaving a band of empty space;
 * - **one short emphasis, then nothing.** A permanent marker on the most
 *   recently moved card is a second, competing state on a board that already
 *   has stages;
 * - **say it as well as show it**, because none of the above reaches a screen
 *   reader.
 *
 * Kept out of the component because none of it is React: it is two rectangles
 * and a scroll offset.
 */

/** How long the destination stays emphasised. Long enough to find, short enough not to linger. */
export const MOVE_HIGHLIGHT_MS = 1400;

/**
 * How much of the container's own size counts as "comfortably visible".
 *
 * A card touching the very edge is technically on screen and practically not:
 * it has no context above or below it, and it is the first thing to leave when
 * anything reflows. A tenth of the container on each side is the margin that
 * makes "I can see it" true rather than technically true.
 */
export const COMFORT_MARGIN_RATIO = 0.1;

export type Span = { start: number; end: number };

/**
 * Is the card comfortably inside the container on this axis?
 *
 * Deliberately not "does it intersect". A card whose top edge is above the
 * container, or that only overlaps by a sliver, is one the reader has to hunt
 * for — which is the thing this exists to prevent.
 */
export function comfortablyVisible(card: Span, container: Span, ratio = COMFORT_MARGIN_RATIO): boolean {
  const size = container.end - container.start;
  if (size <= 0) return true;
  // A card taller than its container can never sit inside the margins; it is
  // comfortable as long as it covers the middle.
  if (card.end - card.start >= size) {
    return card.start <= container.start && card.end >= container.end;
  }
  const margin = size * ratio;
  return card.start >= container.start + margin && card.end <= container.end - margin;
}

/**
 * The scroll delta that centres the card, clamped to the scrollable range.
 *
 * Returns 0 when the container cannot scroll on this axis, so a caller can
 * treat "no movement needed" and "movement impossible" the same way.
 */
export function centeringDelta(
  card: Span,
  container: Span,
  scroll: { offset: number; max: number }
): number {
  const size = container.end - container.start;
  if (size <= 0 || scroll.max <= 0) return 0;
  const cardCentre = (card.start + card.end) / 2;
  const containerCentre = (container.start + container.end) / 2;
  const wanted = scroll.offset + (cardCentre - containerCentre);
  const clamped = Math.max(0, Math.min(scroll.max, wanted));
  return clamped - scroll.offset;
}

/**
 * What the live region says.
 *
 * Names the stage, because "moved" without a destination is the same
 * non-confirmation the visual fix exists to replace. Counts the group for a
 * bulk move rather than announcing each card, which would be the same sentence
 * two hundred times.
 */
export function describeMove(count: number, stageLabel: string): string {
  if (count <= 0) return "";
  if (count === 1) return `Moved to ${stageLabel}.`;
  return `${count} moved to ${stageLabel}.`;
}

/** Whether the viewer has asked for less movement. Safe on the server. */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
