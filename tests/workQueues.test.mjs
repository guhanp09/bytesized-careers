import test from "node:test";
import assert from "node:assert/strict";

import {
  NO_QUEUE_PREFERENCES,
  STALE_AFTER_DAYS,
  WORK_QUEUE_ORDER,
  deriveWorkQueue,
  groupByWorkQueue,
  isAllCaughtUp,
} from "../lib/workQueues.ts";
import {
  ALL_MESSAGE_INTENTS,
  SENDABLE_INTENT_KEYS,
  intentExpectsResponse,
  intentsFor,
  messageIntentByKey,
} from "../lib/messageIntents.ts";

const received = (overrides = {}) => ({
  id: "a1",
  mode: "hiring",
  direction: "received",
  kind: "application",
  status: "new",
  backendStatus: "new",
  title: "Editor",
  counterpartyName: "Priya Nair",
  createdAtLabel: "2d",
  updatedAtLabel: "2d",
  message: "",
  timeline: [],
  ...overrides,
});

/* -------------------------------- intents -------------------------------- */

test("consequential outcomes are never sendable as a message", () => {
  for (const key of ["hire", "accept", "decline", "not_proceeding"]) {
    assert.equal(messageIntentByKey(key).kind, "decision");
    assert.ok(!SENDABLE_INTENT_KEYS.includes(key), `${key} must not be sendable`);
  }
});

test("only asking intents expect a response", () => {
  assert.equal(intentExpectsResponse("ask_question"), true);
  assert.equal(intentExpectsResponse("request_portfolio"), true);
  // Freeform, unknown, and decision intents never imply an expectation.
  assert.equal(intentExpectsResponse(null), false);
  assert.equal(intentExpectsResponse("made_up"), false);
  assert.equal(intentExpectsResponse("hire"), false);
});

test("decision intents are offered only when the transition rules allow them", () => {
  const offered = intentsFor({
    direction: "received",
    allowedStages: ["hired", "rejected"],
    messagingClosed: false,
  }).map((intent) => intent.key);
  assert.ok(offered.includes("hire"));
  assert.ok(offered.includes("not_proceeding"));
  assert.ok(!offered.includes("accept"), "accept is not a valid stage here");
  // Message intents are always available.
  assert.ok(offered.includes("ask_question"));
});

test("the sender side is never offered management decisions", () => {
  const offered = intentsFor({
    direction: "sent",
    allowedStages: ["hired"],
    messagingClosed: false,
  });
  assert.ok(offered.every((intent) => intent.kind === "message"));
});

test("a closed conversation offers no intents at all", () => {
  assert.deepEqual(
    intentsFor({ direction: "received", allowedStages: ["hired"], messagingClosed: true }),
    []
  );
});

test("every message intent carries an editable template field", () => {
  for (const intent of ALL_MESSAGE_INTENTS.filter((i) => i.kind === "message")) {
    assert.equal(typeof intent.template, "string", `${intent.key} needs a template`);
  }
});

/* --------------------------------- queues -------------------------------- */

test("a record lands in exactly one queue, the highest-priority one it qualifies for", () => {
  // Unconfirmed engagement outranks everything else that is also true here.
  const queue = deriveWorkQueue(received({ backendStatus: "hired" }), {
    engagementUnconfirmed: true,
    unreadCount: 4,
    responseExpected: true,
  });
  assert.equal(queue, "start_confirmation_pending");
});

test("queue precedence is the documented order", () => {
  assert.deepEqual(
    WORK_QUEUE_ORDER.map((queue) => queue.key),
    [
      "start_confirmation_pending",
      // A time someone is holding open for you outranks a follow-up you owe.
      "interview_confirmation",
      "interview_follow_up",
      "needs_your_reply",
      "decision_needed",
      "new_to_review",
      "waiting_for_them",
      "stale",
    ]
  );
});

test("a new application queues for review", () => {
  assert.equal(deriveWorkQueue(received({ backendStatus: "new" })), "new_to_review");
});

test("only an explicit response expectation reaches the reply queue", () => {
  const item = received({ backendStatus: "reviewing" });
  // Ambiguous inbound activity is a decision to look at, not an asserted reply.
  assert.equal(deriveWorkQueue(item, { unreadCount: 1 }), "decision_needed");
  assert.equal(
    deriveWorkQueue(item, { unreadCount: 1, responseExpected: true }),
    "needs_your_reply"
  );
});

test("a passed interview date routes ambiguous activity to follow-up", () => {
  const item = received({ backendStatus: "interviewing" });
  assert.equal(
    deriveWorkQueue(item, { unreadCount: 1, interviewFollowUpDue: true }),
    "interview_follow_up"
  );
});

test("archived, closed, and quiet records queue for nothing", () => {
  assert.equal(deriveWorkQueue(received({ archivedAt: "2026-01-01T00:00:00Z" })), null);
  assert.equal(
    deriveWorkQueue(received({ backendStatus: "rejected", participantBackendStatus: "rejected" })),
    null
  );
  assert.equal(deriveWorkQueue(received({ backendStatus: "reviewing" })), null);
});

test("only long-idle active records read as stale", () => {
  const item = received({ backendStatus: "reviewing" });
  assert.equal(deriveWorkQueue(item, { idleDays: STALE_AFTER_DAYS - 1 }), null);
  assert.equal(deriveWorkQueue(item, { idleDays: STALE_AFTER_DAYS }), "stale");
});

test("dismissal and snooze hide a recommendation without touching status", () => {
  const item = received({ backendStatus: "new" });
  assert.equal(deriveWorkQueue(item, {}, NO_QUEUE_PREFERENCES), "new_to_review");

  const dismissed = { isDismissed: () => true, snoozedUntil: () => null };
  assert.equal(deriveWorkQueue(item, {}, dismissed), null);

  const snoozed = { isDismissed: () => false, snoozedUntil: () => Date.now() + 60_000 };
  assert.equal(deriveWorkQueue(item, {}, snoozed), null);

  // An elapsed snooze stops hiding it.
  const expired = { isDismissed: () => false, snoozedUntil: () => Date.now() - 1 };
  assert.equal(deriveWorkQueue(item, {}, expired), "new_to_review");

  // The record itself is untouched by any of it.
  assert.equal(item.backendStatus, "new");
});

test("grouping preserves precedence and drops empty queues", () => {
  const items = [
    received({ id: "n1", backendStatus: "new" }),
    received({ id: "h1", backendStatus: "hired" }),
    received({ id: "q1", backendStatus: "reviewing" }),
  ];
  const groups = groupByWorkQueue(items, (item) =>
    item.id === "h1" ? { engagementUnconfirmed: true } : {}
  );
  assert.deepEqual(
    groups.map((group) => group.queue.key),
    ["start_confirmation_pending", "new_to_review"]
  );
  assert.equal(groups[0].items[0].id, "h1");
});

test("all caught up means literally nothing is outstanding", () => {
  const quiet = [received({ id: "q", backendStatus: "reviewing" })];
  assert.equal(isAllCaughtUp(quiet, () => ({})), true);
  assert.equal(isAllCaughtUp([...quiet, received({ id: "n", backendStatus: "new" })], () => ({})), false);
});
