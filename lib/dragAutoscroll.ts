/**
 * Scrolling the board while a card is held.
 *
 * A native HTML5 drag does not scroll anything. On a funnel tall enough to have
 * offscreen stages that means the only reachable targets are the ones already in
 * view — the card can be picked up and has nowhere to go, which reads as the
 * board being broken rather than as a missing feature.
 *
 * The rules that keep it from being annoying are the whole design:
 *
 * - a **bounded** activation band at each edge, so crossing the edge on the way
 *   somewhere else does nothing;
 * - a short **dwell** before the first pixel moves, so a fast diagonal flick
 *   past a corner is not read as intent to scroll;
 * - speed that **ramps with depth** into the band and is capped, so approaching
 *   an edge nudges and pressing into it travels, and neither lurches;
 * - `requestAnimationFrame`, so the rate follows the display rather than a timer;
 * - and it stops on drop, cancel, escape, pointer loss or leaving the band.
 *
 * Kept out of the component because none of it is React: it is a pointer
 * position, a container, and a frame loop.
 */

/** How deep from an edge the band reaches. */
export const EDGE_BAND_PX = 72;

/** Pixels per second at the very edge. Approaching it is much slower. */
export const MAX_SPEED_PX_PER_SECOND = 900;

/** How long the pointer must stay in the band before anything moves. */
export const INTENT_DELAY_MS = 120;

export type Axis = "vertical" | "horizontal";

/**
 * How fast to scroll, given how far into the band the pointer is.
 *
 * Squared rather than linear: the shallow part of the band is where someone is
 * usually just travelling, and a linear ramp there feels like the board is
 * grabbing at the pointer. The last few pixels are where they mean it.
 */
export function edgeVelocity(distanceFromEdge: number, band = EDGE_BAND_PX): number {
  if (distanceFromEdge >= band) return 0;
  const depth = Math.min(1, Math.max(0, (band - distanceFromEdge) / band));
  return depth * depth * MAX_SPEED_PX_PER_SECOND;
}

/**
 * The signed speed for one axis, in pixels per second.
 *
 * Positive scrolls toward the end (down / right). Zero when the pointer is in
 * the middle, or when that end is already reached — pushing against a scrolled-
 * out edge should feel like nothing, not like a stall.
 */
export function axisVelocity(
  pointer: number,
  start: number,
  end: number,
  atStart: boolean,
  atEnd: boolean,
  band = EDGE_BAND_PX
): number {
  if (end - start < band * 2) return 0;
  const fromStart = pointer - start;
  const fromEnd = end - pointer;
  if (fromStart < band && !atStart) return -edgeVelocity(fromStart, band);
  if (fromEnd < band && !atEnd) return edgeVelocity(fromEnd, band);
  return 0;
}

/** The nearest ancestor that can actually scroll on the given axis. */
export function nearestScrollable(
  node: Element | null,
  axis: Axis,
  root: Element | null = null
): Element | null {
  let current: Element | null = node;
  while (current) {
    const style = getComputedStyle(current);
    const overflow = axis === "vertical" ? style.overflowY : style.overflowX;
    const scrollable = overflow === "auto" || overflow === "scroll" || overflow === "overlay";
    const extent =
      axis === "vertical"
        ? current.scrollHeight - current.clientHeight
        : current.scrollWidth - current.clientWidth;
    if (scrollable && extent > 1) return current;
    if (current === root) break;
    current = current.parentElement;
  }
  return null;
}

export type AutoscrollController = {
  /** Feed a pointer position, in viewport coordinates. */
  update: (clientX: number, clientY: number) => void;
  /** Stop immediately and release the frame loop. */
  stop: () => void;
};

/**
 * Start an autoscroller for a drag in progress.
 *
 * The container is resolved once per update from the element under the pointer,
 * so a board whose stages scroll independently still scrolls the right one.
 */
export function startAutoscroll(options: {
  /** Defaults to the real document lookup; injectable for tests. */
  elementFromPoint?: (x: number, y: number) => Element | null;
  requestFrame?: (cb: (time: number) => void) => number;
  cancelFrame?: (handle: number) => void;
  /** Outermost element the search may reach. */
  root?: Element | null;
}): AutoscrollController {
  const elementFromPoint =
    options.elementFromPoint ?? ((x: number, y: number) => document.elementFromPoint(x, y));
  const requestFrame = options.requestFrame ?? ((cb) => requestAnimationFrame(cb));
  const cancelFrame = options.cancelFrame ?? ((handle) => cancelAnimationFrame(handle));

  let pointer: { x: number; y: number } | null = null;
  let inBandSince: number | null = null;
  let frame: number | null = null;
  let lastTime: number | null = null;

  const step = (time: number) => {
    frame = null;
    if (!pointer) return;
    const elapsed = lastTime === null ? 0 : Math.min(64, time - lastTime);
    lastTime = time;

    const target = elementFromPoint(pointer.x, pointer.y);
    const vertical = nearestScrollable(target, "vertical", options.root);
    const horizontal = nearestScrollable(target, "horizontal", options.root);

    let moved = false;
    for (const [container, axis] of [
      [vertical, "vertical"],
      [horizontal, "horizontal"],
    ] as Array<[Element | null, Axis]>) {
      if (!container) continue;
      const box = container.getBoundingClientRect();
      const speed =
        axis === "vertical"
          ? axisVelocity(
              pointer.y,
              box.top,
              box.bottom,
              container.scrollTop <= 0,
              container.scrollTop + container.clientHeight >= container.scrollHeight - 1
            )
          : axisVelocity(
              pointer.x,
              box.left,
              box.right,
              container.scrollLeft <= 0,
              container.scrollLeft + container.clientWidth >= container.scrollWidth - 1
            );
      if (speed === 0) continue;
      moved = true;
      // Nothing moves until the pointer has held the band long enough to mean it.
      if (inBandSince === null) inBandSince = time;
      if (time - inBandSince < INTENT_DELAY_MS) continue;
      const delta = (speed * elapsed) / 1000;
      if (axis === "vertical") container.scrollTop += delta;
      else container.scrollLeft += delta;
    }
    if (!moved) inBandSince = null;

    frame = requestFrame(step);
  };

  return {
    update(clientX: number, clientY: number) {
      pointer = { x: clientX, y: clientY };
      if (frame === null) {
        lastTime = null;
        frame = requestFrame(step);
      }
    },
    stop() {
      pointer = null;
      inBandSince = null;
      lastTime = null;
      if (frame !== null) {
        cancelFrame(frame);
        frame = null;
      }
    },
  };
}
