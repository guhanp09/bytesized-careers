import test from "node:test";
import assert from "node:assert/strict";

import {
  EDGE_BAND_PX,
  INTENT_DELAY_MS,
  MAX_SPEED_PX_PER_SECOND,
  axisVelocity,
  edgeVelocity,
  startAutoscroll,
} from "../lib/dragAutoscroll.ts";

/**
 * The rules that decide whether autoscroll is helpful or infuriating.
 *
 * Scrolling while dragging is easy; scrolling only when the user meant it is the
 * hard part. These cover the three things that make the difference — a bounded
 * band, a dwell before the first pixel moves, and a ramp that is gentle where
 * people are merely passing through.
 */

test("outside the band nothing moves", () => {
  assert.equal(edgeVelocity(EDGE_BAND_PX), 0);
  assert.equal(edgeVelocity(EDGE_BAND_PX + 200), 0);
});

test("speed ramps with depth and is capped at the edge", () => {
  const shallow = edgeVelocity(EDGE_BAND_PX - 1);
  const middle = edgeVelocity(EDGE_BAND_PX / 2);
  const edge = edgeVelocity(0);
  assert.ok(shallow < middle, "deeper must be faster");
  assert.ok(middle < edge);
  assert.equal(edge, MAX_SPEED_PX_PER_SECOND);
  // Squared, so brushing the band is far slower than pressing into it — that is
  // what stops a diagonal flick past a corner from yanking the board.
  assert.ok(middle <= MAX_SPEED_PX_PER_SECOND / 4 + 1);
});

test("the middle of a container is quiet", () => {
  assert.equal(axisVelocity(500, 0, 1000, false, false), 0);
});

test("direction follows the edge", () => {
  assert.ok(axisVelocity(10, 0, 1000, false, false) < 0, "near the start scrolls back");
  assert.ok(axisVelocity(990, 0, 1000, false, false) > 0, "near the end scrolls on");
});

test("pushing against an end that is already reached does nothing", () => {
  // Otherwise the board feels stuck rather than finished.
  assert.equal(axisVelocity(10, 0, 1000, true, false), 0);
  assert.equal(axisVelocity(990, 0, 1000, false, true), 0);
});

test("a container too small to have a middle never autoscrolls", () => {
  // Two bands would overlap, so every pointer position would be "at an edge".
  assert.equal(axisVelocity(50, 0, EDGE_BAND_PX, false, false), 0);
});

/* ---- the loop ----------------------------------------------------------- */

function harness({ scrollHeight = 2000, clientHeight = 500, top = 0 } = {}) {
  const container = {
    scrollTop: 0,
    scrollLeft: 0,
    scrollHeight,
    clientHeight,
    scrollWidth: 500,
    clientWidth: 500,
    getBoundingClientRect: () => ({
      top,
      bottom: top + clientHeight,
      left: 0,
      right: 500,
    }),
    parentElement: null,
  };
  const styles = { overflowY: "auto", overflowX: "visible" };
  globalThis.getComputedStyle = () => styles;

  let time = 0;
  const frames = [];
  return {
    container,
    controller: startAutoscroll({
      elementFromPoint: () => container,
      requestFrame: (cb) => {
        frames.push(cb);
        return frames.length;
      },
      cancelFrame: () => {},
    }),
    /** Run one frame at the given timestamp. */
    tick(at) {
      time = at;
      const next = frames.shift();
      if (next) next(at);
    },
    pending: () => frames.length,
  };
}

test("nothing scrolls until the pointer has held the band", () => {
  const h = harness();
  h.controller.update(250, 495); // deep in the bottom band
  h.tick(0);
  assert.equal(h.container.scrollTop, 0, "the very first frame must not move");
  h.tick(INTENT_DELAY_MS - 20);
  assert.equal(h.container.scrollTop, 0, "still inside the dwell");
  h.tick(INTENT_DELAY_MS + 40);
  assert.ok(h.container.scrollTop > 0, "after the dwell it should travel");
});

test("leaving the band resets the dwell, so a passing pointer never accumulates", () => {
  const h = harness();
  h.controller.update(250, 495);
  h.tick(0);
  h.controller.update(250, 250); // back to the middle
  h.tick(40);
  assert.equal(h.container.scrollTop, 0);
  h.controller.update(250, 495);
  h.tick(80);
  // The dwell restarted at 80, so this frame is still inside it.
  h.tick(80 + INTENT_DELAY_MS - 20);
  assert.equal(h.container.scrollTop, 0, "the dwell must start again, not resume");
});

test("scrolling stops when the drag ends", () => {
  const h = harness();
  h.controller.update(250, 495);
  h.tick(0);
  h.tick(INTENT_DELAY_MS + 40);
  const travelled = h.container.scrollTop;
  assert.ok(travelled > 0);

  h.controller.stop();
  h.tick(INTENT_DELAY_MS + 200);
  assert.equal(h.container.scrollTop, travelled, "no movement after stop");
  assert.equal(h.pending(), 0, "the frame loop must be released");
});

test("dragging up scrolls back", () => {
  const h = harness();
  h.container.scrollTop = 800;
  h.controller.update(250, 5); // in the top band
  h.tick(0);
  h.tick(INTENT_DELAY_MS + 40);
  assert.ok(h.container.scrollTop < 800, "should have travelled back up");
});

test("a frame gap is clamped, so a backgrounded tab does not jump on return", () => {
  const h = harness();
  h.controller.update(250, 495);
  h.tick(0);
  h.tick(INTENT_DELAY_MS);
  const before = h.container.scrollTop;
  h.tick(INTENT_DELAY_MS + 5000); // tab was away for five seconds
  const jump = h.container.scrollTop - before;
  // 64ms is the clamp, so at most one slow frame's worth of travel.
  assert.ok(jump <= (MAX_SPEED_PX_PER_SECOND * 64) / 1000 + 1, `jumped ${jump}px`);
});
