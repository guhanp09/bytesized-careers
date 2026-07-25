import test from "node:test";
import assert from "node:assert/strict";

import {
  describeInteractionTime,
  formatAbsoluteTime,
  formatInteractionTime,
  nextRefreshDelay,
  parseInstant,
  toDateTimeAttribute,
} from "../lib/interactionTime.ts";

/**
 * Every case here passes an explicit reference time. A formatter that can only
 * be tested against "now" cannot be tested at its boundaries at all, which is
 * how a column ends up mixing four formats without anyone noticing.
 */
const NOW = Date.parse("2026-07-26T12:00:00.000Z");
const ago = (ms) => new Date(NOW - ms).toISOString();
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/* --- the relative window ------------------------------------------------- */

test("under a minute reads as Just now, not as 0m", () => {
  assert.equal(formatInteractionTime(ago(0), NOW), "Just now");
  assert.equal(formatInteractionTime(ago(30_000), NOW), "Just now");
});

test("minutes and hours count up honestly", () => {
  assert.equal(formatInteractionTime(ago(MINUTE), NOW), "1m ago");
  assert.equal(formatInteractionTime(ago(59 * MINUTE), NOW), "59m ago");
  assert.equal(formatInteractionTime(ago(HOUR), NOW), "1h ago");
  assert.equal(formatInteractionTime(ago(23 * HOUR), NOW), "23h ago");
});

test("yesterday and the days after it stay relative", () => {
  assert.equal(formatInteractionTime(ago(DAY), NOW), "1d ago");
  assert.equal(formatInteractionTime(ago(6 * DAY), NOW), "6d ago");
});

test("exactly seven days is where relative stops and the date begins", () => {
  // The boundary is the whole point of the rule; off-by-one here is what
  // produced "6d ago" sitting beside "6 Jan 2026" in one column.
  assert.equal(formatInteractionTime(ago(7 * DAY - 1), NOW), "6d ago");
  assert.equal(formatInteractionTime(ago(7 * DAY), NOW), "19 Jul");
});

/* --- absolute dates ------------------------------------------------------ */

test("a date in the current year omits the year", () => {
  assert.equal(formatInteractionTime("2026-03-12T09:00:00Z", NOW), "12 Mar");
});

test("a date outside the current year carries it", () => {
  assert.equal(formatInteractionTime("2025-03-12T09:00:00Z", NOW), "12 Mar 2025");
});

test("eighteen months back is still readable, not an interval", () => {
  assert.equal(formatInteractionTime("2025-01-20T09:00:00Z", NOW), "20 Jan 2025");
});

/* --- the future ---------------------------------------------------------- */

test("a scheduled interview reads forward, never as 0m ago", () => {
  assert.equal(formatInteractionTime(new Date(NOW + 2 * DAY).toISOString(), NOW), "in 2d");
  assert.equal(formatInteractionTime(new Date(NOW + 3 * HOUR).toISOString(), NOW), "in 3h");
  assert.equal(formatInteractionTime(new Date(NOW + 20 * MINUTE).toISOString(), NOW), "in 20m");
});

test("a distant future date falls back to the absolute form", () => {
  assert.equal(formatInteractionTime("2026-12-01T09:00:00Z", NOW), "1 Dec");
});

/* --- parsing ------------------------------------------------------------- */

test("a UTC timestamp missing its Z is still read as UTC", () => {
  // Backend rows arrive both ways. Parsed as local time, every label would be
  // wrong by the reader's offset — silently, and only for some users.
  assert.equal(parseInstant("2026-07-26T11:00:00"), parseInstant("2026-07-26T11:00:00Z"));
  assert.equal(formatInteractionTime("2026-07-26T11:00:00", NOW), "1h ago");
});

test("a half-hour offset zone resolves to the same instant", () => {
  // Asia/Kolkata is +05:30 — a whole-hour assumption would be 30 minutes out.
  assert.equal(parseInstant("2026-07-26T17:30:00+05:30"), NOW);
  assert.equal(formatInteractionTime("2026-07-26T17:30:00+05:30", NOW), "Just now");
});

test("epochs and Date objects are accepted alongside strings", () => {
  assert.equal(parseInstant(NOW), NOW);
  assert.equal(parseInstant(new Date(NOW)), NOW);
});

test("missing and invalid values yield nothing rather than Invalid Date", () => {
  for (const bad of [null, undefined, "", "not a date", Number.NaN, new Date("x")]) {
    assert.equal(parseInstant(bad), null, `expected null for ${String(bad)}`);
    assert.equal(formatInteractionTime(bad, NOW), "");
    assert.equal(formatAbsoluteTime(bad), "");
    assert.equal(toDateTimeAttribute(bad), undefined);
    assert.equal(describeInteractionTime(bad, NOW), "");
  }
});

/* --- the accessible and machine-readable forms --------------------------- */

test("the machine-readable attribute is a real ISO instant", () => {
  assert.equal(toDateTimeAttribute("2026-07-26T11:00:00"), "2026-07-26T11:00:00.000Z");
});

test("the announced text carries both the concise reading and the full instant", () => {
  const described = describeInteractionTime(ago(2 * HOUR), NOW);
  assert.match(described, /^2h ago — /);
  assert.match(described, /2026/);
  // Whatever a sighted user sees must be the first thing announced.
  assert.ok(described.startsWith(formatInteractionTime(ago(2 * HOUR), NOW)));
});

test("the absolute form names a weekday, a date and a time", () => {
  const absolute = formatAbsoluteTime("2026-03-12T09:30:00Z");
  assert.match(absolute, /Mar/);
  assert.match(absolute, /2026/);
  assert.match(absolute, /\d{1,2}:\d{2}/);
});

/* --- refresh scheduling -------------------------------------------------- */

test("only labels that can still change schedule any refresh", () => {
  // A month-old thread never needs re-rendering, so a full inbox of them costs
  // the shared ticker nothing.
  assert.equal(nextRefreshDelay(ago(30 * DAY), NOW), null);
  assert.equal(nextRefreshDelay(ago(30 * MINUTE), NOW), MINUTE);
  assert.equal(nextRefreshDelay(ago(5 * HOUR), NOW), HOUR);
  assert.equal(nextRefreshDelay(ago(3 * DAY), NOW), DAY);
  assert.equal(nextRefreshDelay(null, NOW), null);
});
