import test from "node:test";
import assert from "node:assert/strict";

import {
  mapBackendMessage,
  conversationHasUnread,
  buildUnreadByThread,
  totalUnread,
  formatBadgeCount,
  isMessagingClosedStatus,
  shouldUseLiveApplicationsData,
} from "../lib/messaging.ts";
import {
  applicationRelationshipPresentation,
  talentInterestRelationshipPresentation,
} from "../lib/applicationRelationship.ts";

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

test("engagement lifecycle messages render as trusted centered status events", () => {
  const mapped = mapBackendMessage(
    { id: "event-1", from_me: false, body: "Work started.", kind: "engagement_update" },
    "Collaborator",
    fixedTime
  );
  assert.equal(mapped.kind, "status");
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

test("hired and accepted work threads remain open while terminal outcomes close", () => {
  assert.equal(isMessagingClosedStatus("hired"), false);
  assert.equal(isMessagingClosedStatus("accepted"), false);
  assert.equal(isMessagingClosedStatus("shortlisted"), false);
  assert.equal(isMessagingClosedStatus("declined"), true);
  assert.equal(isMessagingClosedStatus("withdrawn"), true);
  assert.equal(isMessagingClosedStatus("closed"), true);
});

test("authenticated application workspaces stay backend-backed unless demo is explicit", () => {
  assert.equal(shouldUseLiveApplicationsData("backend-token", false), true);
  assert.equal(shouldUseLiveApplicationsData("backend-token", true), false);
  assert.equal(shouldUseLiveApplicationsData(undefined, false), false);
});

test("persisted application states replace re-apply with the correct Inbox action", () => {
  assert.deepEqual(applicationRelationshipPresentation("new"), {
    closed: false,
    statusLabel: "Application submitted",
    actionLabel: "Open conversation",
  });
  assert.equal(applicationRelationshipPresentation("hired").actionLabel, "Open conversation");
  assert.equal(applicationRelationshipPresentation("withdrawn").actionLabel, "View application");
  assert.equal(applicationRelationshipPresentation("rejected").statusLabel, "Application not selected");
});

test("persisted hiring-request states replace repeat outreach with the existing thread", () => {
  assert.deepEqual(talentInterestRelationshipPresentation("new"), {
    closed: false,
    statusLabel: "Hiring request sent",
    actionLabel: "Open conversation",
  });
  assert.equal(talentInterestRelationshipPresentation("contacted").actionLabel, "Open conversation");
  assert.equal(talentInterestRelationshipPresentation("withdrawn").actionLabel, "View request");
  assert.equal(talentInterestRelationshipPresentation("declined").statusLabel, "Hiring request declined");
});
