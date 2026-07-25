import test from "node:test";
import assert from "node:assert/strict";

import { groupThreadEntries, summarizeSystemEvents } from "../lib/systemEventGrouping.ts";

const sys = (id, body, at = "2026-07-20T10:00:00Z") => ({ id, kind: "status", body, createdAt: at });
const human = (id, body = "Hi there", at = "2026-07-20T11:00:00Z") => ({ id, body, createdAt: at });

/* --- grouping ------------------------------------------------------------ */

test("a lone system event is not hidden behind a disclosure", () => {
  // Collapsing one line costs a click and reveals nothing that was not already
  // as compact as the control replacing it.
  const entries = groupThreadEntries([sys("s1", "Invited to interview.")]);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].type, "message");
});

test("consecutive system events collapse into one entry", () => {
  const entries = groupThreadEntries([
    sys("s1", "Application received."),
    sys("s2", "Reviewing."),
    sys("s3", "Invited to interview."),
  ]);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].type, "system-group");
  assert.equal(entries[0].events.length, 3);
});

test("a human message breaks the run", () => {
  // Merging across it would claim the events happened together when the
  // conversation says otherwise.
  const entries = groupThreadEntries([
    sys("s1", "Application received."),
    sys("s2", "Reviewing."),
    human("m1"),
    sys("s3", "Invited to interview."),
    sys("s4", "Interview confirmed."),
  ]);
  assert.deepEqual(entries.map((entry) => entry.type), ["system-group", "message", "system-group"]);
  assert.equal(entries[0].events.length, 2);
  assert.equal(entries[2].events.length, 2);
});

test("a run before the first human message keeps its position", () => {
  const entries = groupThreadEntries([sys("s1", "a"), sys("s2", "b"), human("m1")]);
  assert.equal(entries[0].type, "system-group");
  assert.equal(entries[1].type, "message");
});

test("a run after the most recent human message keeps its position", () => {
  const entries = groupThreadEntries([human("m1"), sys("s1", "a"), sys("s2", "b")]);
  assert.equal(entries[0].type, "message");
  assert.equal(entries[1].type, "system-group");
});

test("every event survives grouping — nothing is dropped", () => {
  const messages = [sys("s1", "a"), sys("s2", "b"), human("m1"), sys("s3", "c")];
  const entries = groupThreadEntries(messages);
  const seen = entries.flatMap((entry) =>
    entry.type === "system-group" ? entry.events.map((e) => e.id) : [entry.message.id]
  );
  assert.deepEqual(seen, messages.map((m) => m.id));
});

test("the group carries the newest instant in its run", () => {
  const entries = groupThreadEntries([
    sys("s1", "a", "2026-07-20T10:00:00Z"),
    sys("s2", "b", "2026-07-22T10:00:00Z"),
    sys("s3", "c", "2026-07-21T10:00:00Z"),
  ]);
  assert.equal(entries[0].latestAt, "2026-07-22T10:00:00Z");
});

test("an empty conversation produces no entries", () => {
  assert.deepEqual(groupThreadEntries([]), []);
});

/* --- summaries ----------------------------------------------------------- */

test("a single event shows its own text rather than a count", () => {
  assert.equal(summarizeSystemEvents([sys("s1", "Invited to interview.")]), "Invited to interview.");
});

test("a run of one kind is named by that kind", () => {
  assert.equal(
    summarizeSystemEvents([
      sys("s1", "Application received."),
      sys("s2", "Not selected · saved privately"),
      sys("s3", "Hired for “Shorts editor”."),
    ]),
    "3 application updates"
  );
});

test("interview and engagement runs are named, not counted generically", () => {
  assert.equal(
    summarizeSystemEvents([sys("s1", "Interview invitation."), sys("s2", "Interview confirmed.")]),
    "2 interview updates"
  );
  assert.equal(
    summarizeSystemEvents([
      sys("s1", "Work start confirmation requested."),
      sys("s2", "Engagement completed."),
    ]),
    "2 engagement updates"
  );
});

test("a payment run is recognised as its own plane", () => {
  assert.equal(
    summarizeSystemEvents([sys("s1", "Payment funded."), sys("s2", "Funds released.")]),
    "2 payment updates"
  );
});

test("a mixed run names the kinds involved", () => {
  const summary = summarizeSystemEvents([
    sys("s1", "Invited to interview."),
    sys("s2", "Hired for “Shorts editor”."),
  ]);
  assert.equal(summary, "Interview and application updated");
});

test("an unrecognised run counts plainly rather than inventing a description", () => {
  // The generic phrasing is the floor. It is reached only when the events give
  // nothing to describe, never as a default.
  assert.equal(summarizeSystemEvents([sys("s1", "Something happened."), sys("s2", "And again.")]), "2 updates");
});

test("legacy Under consideration is recognised as application activity", () => {
  assert.equal(
    summarizeSystemEvents([
      sys("s1", "Under consideration · saved privately"),
      sys("s2", "Under consideration · shared with them"),
    ]),
    "2 application updates"
  );
});

test("the summary never reads as the generic label when a topic is available", () => {
  const summary = summarizeSystemEvents([sys("s1", "Interview moved."), sys("s2", "Interview confirmed.")]);
  assert.doesNotMatch(summary, /system event/i);
});
