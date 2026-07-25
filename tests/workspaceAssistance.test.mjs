import test from "node:test";
import assert from "node:assert/strict";

import {
  DECISION_WAITING_DAYS,
  STALE_STARRED_DAYS,
  consolidatedReminder,
} from "../lib/workReminders.ts";
import {
  jobWorkloadSummaries,
  shouldShowJobSummaries,
} from "../lib/jobWorkloadSummary.ts";
import { caughtUpLine, emptyStateFor } from "../lib/workspaceEmptyStates.ts";

const item = (overrides = {}) => ({
  id: "a1",
  mode: "hiring",
  direction: "received",
  kind: "application",
  status: "new",
  backendStatus: "new",
  participantBackendStatus: "new",
  title: "Priya Raman",
  contextLabel: "Thumbnail designer",
  counterpartyName: "Priya Raman",
  createdAtLabel: "2 days ago",
  updatedAtLabel: "2 days ago",
  message: "Sharing a few samples.",
  timeline: [],
  ...overrides,
});

/* --- reminders ----------------------------------------------------------- */

test("a workspace being kept up to date says nothing at all", () => {
  const items = [item({ id: "a1", backendStatus: "reviewing", status: "reviewing" })];
  assert.equal(consolidatedReminder(items, () => ({})), null);
});

test("decisions are only mentioned once they have actually been sitting", () => {
  const items = [
    item({ id: "a1", backendStatus: "reviewing", status: "reviewing" }),
    item({ id: "a2", backendStatus: "reviewing", status: "reviewing" }),
  ];
  const fresh = consolidatedReminder(items, () => ({ unreadCount: 1, ageDays: 1 }));
  assert.equal(fresh, null);

  const aged = consolidatedReminder(items, () => ({
    unreadCount: 1,
    ageDays: DECISION_WAITING_DAYS,
  }));
  assert.equal(aged.key, "decision_waiting");
  assert.equal(aged.count, 2);
  assert.match(aged.text, /2 applications have been waiting for a decision/);
  assert.equal(aged.queue, "decision_needed");
});

test("counts of one read as English, not as a template", () => {
  const one = consolidatedReminder([item({ backendStatus: "reviewing", status: "reviewing" })], () => ({
    unreadCount: 1,
    ageDays: 9,
  }));
  assert.match(one.text, /^1 application has been waiting/);
});

test("the copy is factual and never urgent or punitive", () => {
  const reminder = consolidatedReminder([item()], () => ({ ageDays: 3 }));
  assert.equal(reminder.key, "new_to_review");
  for (const banned of ["!", "Urgent", "urgent", "behind", "overdue", "failing"]) {
    assert.equal(reminder.text.includes(banned), false, `copy must not contain "${banned}"`);
  }
});

test("start confirmation outranks everything else", () => {
  const items = [
    item({ id: "a1" }),
    item({
      id: "a2",
      status: "hired",
      backendStatus: "hired",
      participantBackendStatus: "hired",
    }),
  ];
  const reminder = consolidatedReminder(items, (entry) =>
    entry.id === "a2" ? { engagementUnconfirmed: true } : { ageDays: 4 }
  );
  assert.equal(reminder.key, "start_confirmation");
  assert.equal(reminder.queue, "start_confirmation_pending");
});

test("only an explicit question is described as an unanswered question", () => {
  const items = [item({ backendStatus: "reviewing", status: "reviewing" })];
  const ambiguous = consolidatedReminder(items, () => ({ unreadCount: 1, ageDays: 30 }));
  assert.equal(ambiguous.key, "decision_waiting");

  const explicit = consolidatedReminder(items, () => ({
    unreadCount: 1,
    responseExpected: true,
    ageDays: 30,
  }));
  assert.equal(explicit.key, "unanswered_question");
  assert.match(explicit.text, /asked you something/);
});

test("nothing is ever mentioned while the other participant owes the move", () => {
  const sent = item({ id: "s1", direction: "sent", backendStatus: "reviewing", status: "reviewing" });
  assert.equal(consolidatedReminder([sent], () => ({ ageDays: 90 })), null);
});

test("a snooze or a dismissal silences the reminder, not just the row", () => {
  const items = [item({ backendStatus: "reviewing", status: "reviewing" })];
  const signals = () => ({ unreadCount: 1, ageDays: 30 });
  assert.equal(consolidatedReminder(items, signals).key, "decision_waiting");

  const dismissed = consolidatedReminder(items, signals, {
    isDismissed: () => true,
    snoozedUntil: () => null,
  });
  assert.equal(dismissed, null);

  const snoozed = consolidatedReminder(items, signals, {
    isDismissed: () => false,
    snoozedUntil: () => Date.now() + 60_000,
  });
  assert.equal(snoozed, null);
});

test("archived and closed records are never mentioned", () => {
  const archived = item({ archivedAt: "2026-01-01T00:00:00Z" });
  const rejected = item({
    id: "a2",
    status: "rejected",
    backendStatus: "rejected",
    participantBackendStatus: "rejected",
  });
  assert.equal(consolidatedReminder([archived, rejected], () => ({ ageDays: 60 })), null);
});

test("a saved person nobody moved on is worth a quiet mention", () => {
  const items = [item({ backendStatus: "reviewing", status: "reviewing" })];
  const reminder = consolidatedReminder(
    items,
    () => ({ starredDays: STALE_STARRED_DAYS }),
    undefined,
    () => true
  );
  assert.equal(reminder.key, "stale_starred");
  assert.equal(reminder.queue, "starred");
  assert.match(reminder.text, /hasn't moved in two weeks/);
});

/* --- per-job summaries --------------------------------------------------- */

test("summaries group by job and lead with the one holding the most work", () => {
  const items = [
    item({ id: "a1", contextLabel: "Thumbnail designer" }),
    item({ id: "a2", contextLabel: "Thumbnail designer" }),
    item({ id: "a3", contextLabel: "Shorts editor", backendStatus: "reviewing", status: "reviewing" }),
  ];
  const summaries = jobWorkloadSummaries(items, () => ({}));
  assert.equal(summaries.length, 2);
  assert.equal(summaries[0].title, "Thumbnail designer");
  assert.equal(summaries[0].activeCount, 2);
  assert.equal(summaries[0].outstandingCount, 2);
  assert.equal(summaries[1].outstandingCount, 0);
});

test("every count leads somewhere, and zero counts are never shown", () => {
  const items = [
    item({ id: "a1" }),
    item({ id: "a2", backendStatus: "interviewing", status: "interviewing" }),
  ];
  const [summary] = jobWorkloadSummaries(items, () => ({}));
  assert.ok(summary.counts.length > 0);
  for (const entry of summary.counts) {
    assert.ok(entry.count > 0, "a zero count must not be rendered");
    assert.ok(entry.target, "a count that leads nowhere is decoration");
  }
  assert.equal(
    summary.counts.some((entry) => entry.key === "hired"),
    false
  );
});

test("no percentage or completion figure is ever produced", () => {
  const [summary] = jobWorkloadSummaries([item()], () => ({}));
  const serialized = JSON.stringify(summary);
  assert.equal(serialized.includes("%"), false);
  assert.equal(serialized.includes("percent"), false);
  assert.equal(serialized.includes("progress"), false);
});

test("archived records and the sent side are out of the workload", () => {
  const items = [
    item({ id: "a1", archivedAt: "2026-01-01T00:00:00Z" }),
    item({ id: "a2", direction: "sent" }),
  ];
  assert.deepEqual(jobWorkloadSummaries(items, () => ({})), []);
});

test("one job is just the inbox with a heading", () => {
  const one = jobWorkloadSummaries([item()], () => ({}));
  assert.equal(shouldShowJobSummaries(one), false);
  const two = jobWorkloadSummaries(
    [item({ id: "a1" }), item({ id: "a2", contextLabel: "Shorts editor" })],
    () => ({})
  );
  assert.equal(shouldShowJobSummaries(two), true);
});

/* --- empty and caught-up states ------------------------------------------ */

const emptyInput = (overrides = {}) => ({
  mode: "hiring",
  totalInMode: 0,
  filteredCount: 0,
  visibleCount: 0,
  filter: "all",
  searchTerm: "",
  activeQueue: null,
  allCaughtUp: true,
  snoozedCount: 0,
  ...overrides,
});

test("a list with rows in it has no empty state", () => {
  assert.equal(emptyStateFor(emptyInput({ visibleCount: 3 })), null);
});

test("a genuinely empty system is distinguished from an empty filter", () => {
  const empty = emptyStateFor(emptyInput());
  assert.equal(empty.reason, "no_interactions");
  assert.match(empty.title, /No applications yet/);

  const filtered = emptyStateFor(emptyInput({ totalInMode: 12, filter: "archived" }));
  assert.equal(filtered.reason, "no_archived");
  assert.equal(filtered.action.kind, "clear-filter");
});

test("a search that matched nothing explains itself before anything else", () => {
  const state = emptyStateFor(
    emptyInput({ totalInMode: 12, searchTerm: " priya ", activeQueue: "decision_needed" })
  );
  assert.equal(state.reason, "search_empty");
  assert.match(state.title, /priya/);
  assert.equal(state.action.kind, "clear-search");
});

test("an emptied queue reads as finished work, not as a broken filter", () => {
  const state = emptyStateFor(emptyInput({ totalInMode: 12, activeQueue: "new_to_review" }));
  assert.equal(state.reason, "queue_empty");
  assert.equal(state.action.kind, "clear-queue");
});

test("a fully snoozed list says so rather than looking broken", () => {
  const state = emptyStateFor(emptyInput({ totalInMode: 4, filteredCount: 4, snoozedCount: 4 }));
  assert.equal(state.reason, "snoozed_only");
  assert.match(state.body, /stay fully open/);
});

test("no empty state celebrates, congratulates, or exclaims", () => {
  const states = [
    emptyStateFor(emptyInput()),
    emptyStateFor(emptyInput({ mode: "talent" })),
    emptyStateFor(emptyInput({ totalInMode: 3, activeQueue: "decision_needed" })),
    emptyStateFor(emptyInput({ totalInMode: 3, filter: "sent" })),
    emptyStateFor(emptyInput({ totalInMode: 3, filter: "received" })),
  ];
  for (const state of states) {
    const text = `${state.title} ${state.body ?? ""}`;
    for (const banned of ["!", "🎉", "Congrat", "Well done", "Nice work", "Great job"]) {
      assert.equal(text.includes(banned), false, `"${banned}" must not appear in "${text}"`);
    }
  }
});

test("the caught-up line is honest about who is holding things up", () => {
  assert.equal(
    caughtUpLine({ mode: "hiring", allCaughtUp: true, totalInMode: 5, waitingOnOthers: 0 }),
    "Nothing needs you right now."
  );
  assert.equal(
    caughtUpLine({ mode: "hiring", allCaughtUp: true, totalInMode: 5, waitingOnOthers: 1 }),
    "Nothing needs you. 1 conversation is waiting on the other side."
  );
  assert.match(
    caughtUpLine({ mode: "hiring", allCaughtUp: true, totalInMode: 5, waitingOnOthers: 3 }),
    /3 conversations are waiting/
  );
});

test("an empty system is never told it is caught up", () => {
  assert.equal(
    caughtUpLine({ mode: "hiring", allCaughtUp: true, totalInMode: 0, waitingOnOthers: 0 }),
    null
  );
  assert.equal(
    caughtUpLine({ mode: "hiring", allCaughtUp: false, totalInMode: 5, waitingOnOthers: 0 }),
    null
  );
});
