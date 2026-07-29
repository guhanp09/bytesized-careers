import test from "node:test";
import assert from "node:assert/strict";

import {
  COMFORT_MARGIN_RATIO,
  MOVE_HIGHLIGHT_MS,
  centeringDelta,
  comfortablyVisible,
  describeMove,
} from "../lib/moveConfirmation.ts";

/**
 * Where the card went, and whether we needed to move the viewport to say so.
 *
 * The board used to accept a drop and show nothing. On a funnel with offscreen
 * stages the destination is usually not on screen, so the move read as the card
 * disappearing — the one thing a board must never do. These hold the two
 * decisions that make the confirmation useful rather than annoying: scroll only
 * when the answer is genuinely out of view, and centre rather than merely
 * reveal.
 */

const span = (start, end) => ({ start, end });

/* ---- is it already visible? --------------------------------------------- */

test("a card in the middle needs no scrolling", () => {
  assert.equal(comfortablyVisible(span(400, 500), span(0, 1000)), true);
});

test("a card outside the container is not visible", () => {
  assert.equal(comfortablyVisible(span(1200, 1300), span(0, 1000)), false);
  assert.equal(comfortablyVisible(span(-300, -200), span(0, 1000)), false);
});

test("a card touching the edge is technically visible and practically not", () => {
  // It has no context around it and is the first thing to leave on any reflow.
  assert.equal(comfortablyVisible(span(0, 90), span(0, 1000)), false);
  assert.equal(comfortablyVisible(span(920, 1000), span(0, 1000)), false);
  // Just inside the margin is enough.
  const margin = 1000 * COMFORT_MARGIN_RATIO;
  assert.equal(comfortablyVisible(span(margin, margin + 80), span(0, 1000)), true);
});

test("a card taller than its container counts as visible while it covers the middle", () => {
  // Otherwise the rule would demand a scroll that cannot satisfy it.
  assert.equal(comfortablyVisible(span(-50, 1200), span(0, 1000)), true);
  assert.equal(comfortablyVisible(span(600, 1800), span(0, 1000)), false);
});

test("a container with no height never demands a scroll", () => {
  assert.equal(comfortablyVisible(span(0, 10), span(0, 0)), true);
});

/* ---- centring ------------------------------------------------------------ */

test("centring moves the card to the middle of the container", () => {
  // Card at 700–800 in a 0–1000 viewport: its centre is 750, the container's is
  // 500, so the container must scroll 250 further on.
  const delta = centeringDelta(span(700, 800), span(0, 1000), { offset: 0, max: 5000 });
  assert.equal(delta, 250);
});

test("centring works backwards too", () => {
  const delta = centeringDelta(span(-400, -300), span(0, 1000), { offset: 1000, max: 5000 });
  assert.equal(delta, -850);
});

test("it never scrolls past either end", () => {
  // The last card in a stage settles at the bottom rather than leaving a band
  // of empty space beneath it.
  const past = centeringDelta(span(900, 1000), span(0, 1000), { offset: 4900, max: 5000 });
  assert.equal(past, 100);
  const before = centeringDelta(span(-900, -800), span(0, 1000), { offset: 50, max: 5000 });
  assert.equal(before, -50);
});

test("a container that cannot scroll asks for no movement", () => {
  assert.equal(centeringDelta(span(700, 800), span(0, 1000), { offset: 0, max: 0 }), 0);
  assert.equal(centeringDelta(span(700, 800), span(0, 0), { offset: 0, max: 500 }), 0);
});

/* ---- what it says -------------------------------------------------------- */

test("the announcement names the destination", () => {
  // "Moved" without a destination is the same non-confirmation the visual fix
  // exists to replace.
  assert.equal(describeMove(1, "Interviewing"), "Moved to Interviewing.");
});

test("a bulk move is announced once, with its size", () => {
  assert.equal(describeMove(12, "Not selected"), "12 moved to Not selected.");
});

test("moving nothing says nothing", () => {
  assert.equal(describeMove(0, "Hired"), "");
});

test("the emphasis is brief", () => {
  // Long enough to find, short enough that it is not a second board state.
  assert.ok(MOVE_HIGHLIGHT_MS >= 800 && MOVE_HIGHLIGHT_MS <= 2000);
});
