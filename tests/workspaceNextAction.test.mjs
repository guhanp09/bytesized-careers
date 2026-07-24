import test from "node:test";
import assert from "node:assert/strict";

import { deriveWorkState, nextBestActionFor } from "../lib/applicationPipeline.ts";
import {
  isDecisionStripEnabled,
  isNextActionEnabled,
  isWorkStateEnabled,
} from "../lib/workspaceFlags.ts";
import {
  flagCohortLabel,
  setWorkspaceAnalyticsSink,
  trackWorkspaceEvent,
} from "../lib/workspaceAnalytics.ts";

/** Minimal received application; override per case. */
const received = (overrides = {}) => ({
  id: "a1",
  mode: "hiring",
  direction: "received",
  kind: "application",
  status: "new",
  backendStatus: "new",
  title: "Long-form video editor",
  counterpartyName: "Priya Nair",
  createdAtLabel: "2d",
  updatedAtLabel: "2d",
  message: "",
  timeline: [],
  ...overrides,
});

const sent = (overrides = {}) => received({ direction: "sent", mode: "talent", ...overrides });

/* ------------------------- next-best-action ladder ------------------------ */

test("a brand-new applicant gets the neutral fallback, never a guessed outcome", () => {
  const action = nextBestActionFor(received({ backendStatus: "new" }));
  assert.equal(action.key, "choose-next-step");
  assert.equal(action.label, "Choose next step");
  // The whole point: we must not assume interview/reject/message.
  assert.equal(action.highConfidence, false);
});

test("an under-review applicant with no new signal still gets the neutral fallback", () => {
  const action = nextBestActionFor(received({ backendStatus: "reviewing" }));
  assert.equal(action.key, "choose-next-step");
});

test("an unread message outranks the neutral fallback", () => {
  const action = nextBestActionFor(received({ backendStatus: "reviewing" }), { unreadCount: 2 });
  assert.equal(action.key, "reply");
  assert.equal(action.label, "Reply to Priya");
  assert.equal(action.highConfidence, true);
});

test("interviewing asks for the decision rather than another message", () => {
  const action = nextBestActionFor(received({ backendStatus: "interviewing" }), { unreadCount: 1 });
  assert.equal(action.key, "record-decision");
});

test("an unshared private decision outranks everything except a start confirmation", () => {
  const action = nextBestActionFor(
    received({ backendStatus: "rejected", participantBackendStatus: "reviewing" }),
    { unreadCount: 3 }
  );
  assert.equal(action.key, "share-decision");
  assert.equal(action.label, "Tell Priya");
});

test("a shared decision is finished and recommends nothing", () => {
  const action = nextBestActionFor(
    received({ backendStatus: "rejected", participantBackendStatus: "rejected" })
  );
  assert.equal(action, null);
});

test("an unconfirmed engagement wins the ladder outright", () => {
  const action = nextBestActionFor(received({ backendStatus: "hired" }), {
    engagementUnconfirmed: true,
    unreadCount: 5,
  });
  assert.equal(action.key, "confirm-start");
});

test("a legacy archive still asks for its one deliberate stage choice", () => {
  const action = nextBestActionFor(
    received({ backendStatus: "archived", legacyArchiveResolutionRequired: true })
  );
  assert.equal(action.key, "resolve-legacy-stage");
});

test("an ordinary archived record recommends nothing", () => {
  assert.equal(nextBestActionFor(received({ archivedAt: "2026-01-01T00:00:00Z" })), null);
});

test("the sender side only ever owes a reply", () => {
  assert.equal(nextBestActionFor(sent({ backendStatus: "reviewing" })), null);
  assert.equal(nextBestActionFor(sent({ backendStatus: "reviewing" }), { unreadCount: 1 }).key, "reply");
});

test("the ladder is deterministic — identical input yields an identical result", () => {
  const item = received({ backendStatus: "reviewing" });
  const a = nextBestActionFor(item, { unreadCount: 1 });
  const b = nextBestActionFor(item, { unreadCount: 1 });
  assert.deepEqual(a, b);
});

/* --------------------------- derived work state --------------------------- */

test("a new received application needs review", () => {
  const state = deriveWorkState(received({ backendStatus: "new" }));
  assert.equal(state.key, "needs_review");
  assert.equal(state.highConfidence, true);
});

test("an incoming message alone never asserts that a reply is owed", () => {
  const state = deriveWorkState(received({ backendStatus: "reviewing" }), { unreadCount: 1 });
  assert.equal(state.key, "review_latest");
  assert.equal(state.label, "Review latest message");
  assert.equal(state.highConfidence, false);
});

test("only an explicit response expectation may claim 'Needs your reply'", () => {
  const state = deriveWorkState(received({ backendStatus: "reviewing" }), {
    unreadCount: 1,
    responseExpected: true,
  });
  assert.equal(state.key, "needs_reply");
  assert.equal(state.highConfidence, true);
});

test("an unshared decision surfaces as unfinished business", () => {
  const state = deriveWorkState(
    received({ backendStatus: "shortlisted", participantBackendStatus: "reviewing" })
  );
  assert.equal(state.key, "decision_not_shared");
});

test("archived records are excluded from work state entirely", () => {
  assert.equal(deriveWorkState(received({ archivedAt: "2026-01-01T00:00:00Z" })), null);
  assert.equal(
    deriveWorkState(received({ backendStatus: "new", archivedAt: "2026-01-01T00:00:00Z" })),
    null
  );
});

test("terminal outcomes owe nothing once the decision is shared", () => {
  for (const stage of ["hired", "rejected", "withdrawn"]) {
    const state = deriveWorkState(
      received({ backendStatus: stage, participantBackendStatus: stage })
    );
    assert.equal(state, null, `${stage} should owe nothing`);
  }
});

test("a quiet thread where the other side owes the move has no work state", () => {
  assert.equal(deriveWorkState(sent({ backendStatus: "reviewing" })), null);
});

test("an unconfirmed engagement asks for the start confirmation", () => {
  const state = deriveWorkState(received({ backendStatus: "hired" }), {
    engagementUnconfirmed: true,
  });
  assert.equal(state.key, "start_confirmation_pending");
});

/* -------------------------------- flags ---------------------------------- */

test("workspace flags default on locally and off in production", () => {
  const local = {};
  assert.equal(isNextActionEnabled(local), true);
  assert.equal(isDecisionStripEnabled(local), true);
  assert.equal(isWorkStateEnabled(local), true);

  const prod = { NEXT_PUBLIC_APP_ENV: "production" };
  assert.equal(isNextActionEnabled(prod), false);
  assert.equal(isDecisionStripEnabled(prod), false);
  assert.equal(isWorkStateEnabled(prod), false);
});

test("each workspace flag is independently controllable", () => {
  const env = {
    NEXT_PUBLIC_APP_ENV: "production",
    NEXT_PUBLIC_ENABLE_WORK_STATE: "true",
  };
  // Turning one on must not turn the others on.
  assert.equal(isWorkStateEnabled(env), true);
  assert.equal(isNextActionEnabled(env), false);
  assert.equal(isDecisionStripEnabled(env), false);
});

/* ------------------------------- analytics -------------------------------- */

test("analytics events reach an installed sink and stop when removed", () => {
  const seen = [];
  setWorkspaceAnalyticsSink((event) => seen.push(event));
  trackWorkspaceEvent("workspace.next_action.activate", { actionKey: "reply" });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].name, "workspace.next_action.activate");
  assert.equal(seen[0].payload.actionKey, "reply");
  assert.equal(typeof seen[0].at, "number");

  setWorkspaceAnalyticsSink(null);
  trackWorkspaceEvent("workspace.next_action.activate", {});
  assert.equal(seen.length, 1, "no events after the sink is removed");
});

test("a failing sink can never break a hiring workflow", () => {
  setWorkspaceAnalyticsSink(() => {
    throw new Error("sink exploded");
  });
  assert.doesNotThrow(() => trackWorkspaceEvent("workspace.message.sent", {}));
  setWorkspaceAnalyticsSink(null);
});

test("flag cohort labels are stable and comparable", () => {
  assert.equal(
    flagCohortLabel({ nextAction: true, decisionStrip: false, workState: true }),
    "na|-|ws"
  );
});

/* ------------------ agreed outcomes keep the thread alive ------------------ */

test("a hired record owes no stage decision but still deserves a reply", () => {
  const quiet = received({ backendStatus: "hired", participantBackendStatus: "hired" });
  assert.equal(nextBestActionFor(quiet), null);

  // Hired conversations stay open while the work happens, so an unread message
  // must not be swallowed by treating "hired" as terminal.
  const withUnread = nextBestActionFor(quiet, { unreadCount: 2 });
  assert.equal(withUnread.key, "reply");
  assert.equal(deriveWorkState(quiet, { unreadCount: 2 }).key, "review_latest");
});

test("a closed conversation owes nothing even with an unread message", () => {
  for (const stage of ["rejected", "declined", "withdrawn"]) {
    const item = received({ backendStatus: stage, participantBackendStatus: stage });
    assert.equal(nextBestActionFor(item, { unreadCount: 3 }), null, `${stage} action`);
    assert.equal(deriveWorkState(item, { unreadCount: 3 }), null, `${stage} work state`);
  }
});
