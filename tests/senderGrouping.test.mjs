import test from "node:test";
import assert from "node:assert/strict";

import { SENDER_GROUP_WINDOW_MS, groupConversation } from "../lib/systemEventGrouping.ts";

/**
 * Consecutive messages from one person are one thing they said.
 *
 * The thread used to stamp a name and a timestamp above every bubble, which in a
 * two-person conversation tells the reader, ten times a screen, something they
 * established on the first line — and buries the only repetition that matters,
 * which is where the other person started talking.
 *
 * These hold the rules that decide where a run begins and ends. They are the
 * whole design: get the boundaries wrong and grouping either merges two
 * conversations or produces a group of one, which costs a name, an avatar and a
 * timestamp to say nothing.
 */

const at = (minutes) => new Date(Date.UTC(2026, 6, 20, 10, minutes, 0)).toISOString();

const from = (id, senderName, minutes, extra = {}) => ({
  id,
  senderName,
  fromMe: senderName === "You",
  body: `${id} body`,
  createdAt: at(minutes),
  ...extra,
});

const sys = (id, minutes, body = "Invited to interview.") => ({
  id,
  kind: "status",
  senderName: "",
  body,
  createdAt: at(minutes),
});

const shape = (entries) =>
  entries.map((entry) =>
    entry.type === "message-group"
      ? `${entry.fromMe ? "me" : entry.senderName}:${entry.messages.length}`
      : entry.type
  );

test("consecutive messages from one person become one group", () => {
  const entries = groupConversation([
    from("a", "Ishaan", 0),
    from("b", "Ishaan", 1),
    from("c", "Ishaan", 2),
  ]);
  assert.deepEqual(shape(entries), ["Ishaan:3"]);
});

test("a change of sender starts a new group", () => {
  const entries = groupConversation([
    from("a", "Ishaan", 0),
    from("b", "You", 1),
    from("c", "Ishaan", 2),
  ]);
  assert.deepEqual(shape(entries), ["Ishaan:1", "me:1", "Ishaan:1"]);
});

test("a long enough silence starts a new group", () => {
  const window = SENDER_GROUP_WINDOW_MS / 60_000;
  const together = groupConversation([from("a", "Ishaan", 0), from("b", "Ishaan", window - 1)]);
  assert.deepEqual(shape(together), ["Ishaan:2"], "inside the window they are one thought");

  const apart = groupConversation([from("a", "Ishaan", 0), from("b", "Ishaan", window + 1)]);
  assert.deepEqual(shape(apart), ["Ishaan:1", "Ishaan:1"], "past it the time is worth restating");
});

test("the window is wider than a chat app's, on purpose", () => {
  // Hiring conversations are asynchronous. The conventional five minutes splits
  // one thought being finished into two groups.
  assert.ok(SENDER_GROUP_WINDOW_MS > 5 * 60 * 1000);
});

test("a system event breaks a run rather than joining it", () => {
  const entries = groupConversation([
    from("a", "Ishaan", 0),
    sys("s1", 1),
    from("b", "Ishaan", 2),
  ]);
  assert.deepEqual(shape(entries), ["Ishaan:1", "status", "Ishaan:1"]);
});

test("a run of system events collapses and still breaks the human run", () => {
  const entries = groupConversation([
    from("a", "Ishaan", 0),
    sys("s1", 1, "Application received."),
    sys("s2", 2, "Reviewing."),
    from("b", "Ishaan", 3),
  ]);
  assert.deepEqual(shape(entries), ["Ishaan:1", "system-group", "Ishaan:1"]);
});

test("a status line is never attributed to a sender", () => {
  const [entry] = groupConversation([sys("s1", 0)]);
  assert.equal(entry.type, "status");
  assert.equal(entry.message.id, "s1");
});

test("structured content stands alone", () => {
  // Screening answers and first-message summaries render as cards, not as
  // sentences somebody wrote. Folding one into a run would put a person's name
  // over a block they did not write.
  const entries = groupConversation([
    from("a", "Ishaan", 0),
    from("card", "Ishaan", 1, { kind: "screening" }),
    from("b", "Ishaan", 2),
  ]);
  assert.deepEqual(shape(entries), ["Ishaan:1", "Ishaan:1", "Ishaan:1"]);
});

test("a first-message summary also stands alone", () => {
  const entries = groupConversation([
    from("intro", "Ishaan", 0, {
      firstMessageAnswers: { fit_note: "yes" },
      firstMessageContext: "job",
    }),
    from("b", "Ishaan", 1),
  ]);
  assert.deepEqual(shape(entries), ["Ishaan:1", "Ishaan:1"]);
});

test("every message survives grouping, in order", () => {
  const messages = [
    from("a", "Ishaan", 0),
    from("b", "Ishaan", 1),
    sys("s1", 2),
    from("c", "You", 3),
    from("d", "You", 4),
    from("e", "Ishaan", 30),
  ];
  const seen = groupConversation(messages).flatMap((entry) => {
    if (entry.type === "message-group") return entry.messages.map((message) => message.id);
    if (entry.type === "status") return [entry.message.id];
    return entry.events.map((event) => event.id);
  });
  assert.deepEqual(seen, messages.map((message) => message.id));
});

test("a group carries the instant of its most recent message", () => {
  const [entry] = groupConversation([
    from("a", "Ishaan", 0),
    from("b", "Ishaan", 3),
    from("c", "Ishaan", 1),
  ]);
  assert.equal(entry.latestAt, at(3));
});

test("undated messages group rather than fragmenting", () => {
  // Local demo replies are composed without an instant. Treating a missing
  // timestamp as an infinite gap would put every one of them in its own group.
  const entries = groupConversation([
    { id: "a", senderName: "You", fromMe: true, body: "one" },
    { id: "b", senderName: "You", fromMe: true, body: "two" },
  ]);
  assert.deepEqual(shape(entries), ["me:2"]);
});

test("two people with the same display name are still two senders", () => {
  const entries = groupConversation([
    from("a", "Priya Nair", 0),
    { id: "b", senderName: "Priya Nair", fromMe: true, body: "mine", createdAt: at(1) },
  ]);
  assert.deepEqual(shape(entries), ["Priya Nair:1", "me:1"]);
});

test("an empty conversation produces no entries", () => {
  assert.deepEqual(groupConversation([]), []);
});

test("a long alternating thread produces one group per turn, not one per bubble", () => {
  const messages = [];
  for (let index = 0; index < 44; index += 1) {
    messages.push(from(`m${index}`, index % 2 === 0 ? "Ishaan" : "You", index));
  }
  const entries = groupConversation(messages);
  assert.equal(entries.length, 44, "strict alternation cannot be grouped");
  // …but the moment a turn carries two messages, it collapses.
  const withRuns = groupConversation([
    from("a", "Ishaan", 0),
    from("b", "Ishaan", 1),
    from("c", "You", 2),
    from("d", "You", 3),
    from("e", "You", 4),
  ]);
  assert.deepEqual(shape(withRuns), ["Ishaan:2", "me:3"]);
});
