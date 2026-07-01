import test from "node:test";
import assert from "node:assert/strict";

import {
  mapBackendMessage,
  conversationHasUnread,
  buildUnreadByThread,
  totalUnread,
  formatBadgeCount,
} from "../lib/messaging.ts";

const fixedTime = () => "just now";

test("my own message renders on the 'You' side", () => {
  const mapped = mapBackendMessage(
    { id: "m1", from_me: true, sender_name: "Priya Nair", body: "Hi", created_at: null },
    "Finance Simplified",
    fixedTime
  );
  assert.equal(mapped.fromMe, true);
  assert.equal(mapped.senderName, "You");
  assert.equal(mapped.body, "Hi");
  assert.equal(mapped.atLabel, "just now");
});

test("the other participant's message uses their name (or the counterparty fallback)", () => {
  const named = mapBackendMessage(
    { id: "m2", from_me: false, sender_name: "Finance Simplified", body: "Welcome", created_at: null },
    "Fallback Name",
    fixedTime
  );
  assert.equal(named.fromMe, false);
  assert.equal(named.senderName, "Finance Simplified");

  const unnamed = mapBackendMessage(
    { id: "m3", from_me: false, sender_name: null, body: "Hello", created_at: null },
    "Fallback Name",
    fixedTime
  );
  assert.equal(unnamed.senderName, "Fallback Name");
});

test("unread detection reflects the backend count", () => {
  assert.equal(conversationHasUnread({ unread_count: 2 }), true);
  assert.equal(conversationHasUnread({ unread_count: 0 }), false);
  assert.equal(conversationHasUnread(null), false);
  assert.equal(conversationHasUnread(undefined), false);
});

test("buildUnreadByThread keeps only threads with unread messages", () => {
  const map = buildUnreadByThread([
    { thread_id: "a", unread_count: 3 },
    { thread_id: "b", unread_count: 0 },
    { thread_id: "c", unread_count: 1 },
  ]);
  assert.deepEqual(map, { a: 3, c: 1 });
  assert.equal("b" in map, false);
});

test("totalUnread sums the badge counts", () => {
  assert.equal(totalUnread({ a: 3, c: 1 }), 4);
  assert.equal(totalUnread({}), 0);
});

test("formatBadgeCount caps at 9+", () => {
  assert.equal(formatBadgeCount(1), "1");
  assert.equal(formatBadgeCount(9), "9");
  assert.equal(formatBadgeCount(10), "9+");
  assert.equal(formatBadgeCount(42), "9+");
});
