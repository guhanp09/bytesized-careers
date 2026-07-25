import test from "node:test";
import assert from "node:assert/strict";

import {
  DURATION_CHOICES,
  FOLLOW_UP_GRACE_MINUTES,
  MEETING_METHODS,
  initialScheduleDraft,
  interviewFollowUpDue,
  interviewIsUpcoming,
  interviewNextStep,
  interviewStatusLine,
  meetingMethodLabel,
  toDateInput,
  toInterview,
  toTimeInput,
  validateScheduleDraft,
} from "../lib/interviewScheduling.ts";
import { deriveWorkState, nextBestActionFor } from "../lib/applicationPipeline.ts";
import { deriveWorkQueue } from "../lib/workQueues.ts";

const NOW = Date.parse("2026-03-10T09:00:00.000Z");

const interview = (overrides = {}) => ({
  id: "iv1",
  conversationId: "c1",
  status: "confirmed",
  scheduledAt: "2026-03-12T05:30:00.000Z",
  timezone: "Asia/Kolkata",
  durationMinutes: 30,
  meetingMethod: "video_call",
  meetingDetail: null,
  scheduleLabel: "Thu 12 Mar, 11:00 AM (Asia/Kolkata) · Video call · 30 min",
  previousScheduledAt: null,
  rescheduleCount: 0,
  roundNumber: 1,
  confirmedAt: "2026-03-10T08:00:00.000Z",
  confirmedByMe: false,
  completedAt: null,
  cancelledAt: null,
  version: 2,
  canManage: true,
  followUpDue: false,
  ...overrides,
});

const application = (overrides = {}) => ({
  id: "a1",
  mode: "hiring",
  direction: "received",
  kind: "application",
  status: "interviewing",
  backendStatus: "interviewing",
  participantBackendStatus: "interviewing",
  title: "Thumbnail designer",
  counterpartyName: "Priya Raman",
  createdAtLabel: "2 days ago",
  updatedAtLabel: "2 days ago",
  message: "Sharing a few samples.",
  timeline: [],
  ...overrides,
});

/* --- the follow-up rule ------------------------------------------------- */

test("an interview still ahead of us owes nothing", () => {
  const upcoming = interview();
  assert.equal(interviewFollowUpDue(upcoming, NOW), false);
  assert.equal(interviewIsUpcoming(upcoming, NOW), true);
});

test("a time that has passed the grace period becomes follow-up", () => {
  const past = interview({ scheduledAt: "2026-03-10T07:00:00.000Z" });
  assert.equal(interviewFollowUpDue(past, NOW), true);
  assert.equal(interviewIsUpcoming(past, NOW), false);
});

test("the grace period keeps the queue quiet while the call is happening", () => {
  const justStarted = interview({
    scheduledAt: new Date(NOW - (FOLLOW_UP_GRACE_MINUTES - 5) * 60 * 1000).toISOString(),
  });
  assert.equal(interviewFollowUpDue(justStarted, NOW), false);
});

test("a completed interview is always awaiting a decision", () => {
  assert.equal(
    interviewFollowUpDue(interview({ status: "completed", scheduledAt: "2026-04-01T00:00:00.000Z" }), NOW),
    true
  );
});

test("a cancelled interview owes nothing, however long ago it was", () => {
  const cancelled = interview({ status: "cancelled", scheduledAt: "2026-01-01T00:00:00.000Z" });
  assert.equal(interviewFollowUpDue(cancelled, NOW), false);
  assert.equal(interviewIsUpcoming(cancelled, NOW), false);
});

test("no interview at all is never a follow-up", () => {
  assert.equal(interviewFollowUpDue(null, NOW), false);
  assert.equal(interviewIsUpcoming(null, NOW), false);
});

/* --- what the reader is told -------------------------------------------- */

test("each side is told what it is waiting for, in its own words", () => {
  assert.equal(interviewStatusLine(interview({ status: "proposed", canManage: true })), "Waiting for them to confirm");
  assert.equal(interviewStatusLine(interview({ status: "proposed", canManage: false })), "Confirm if this works");
  assert.equal(interviewStatusLine(interview({ status: "confirmed" })), "Confirmed");
  assert.equal(interviewStatusLine(interview({ status: "completed" })), "Interview done");
  assert.equal(interviewStatusLine(interview({ status: "cancelled" })), "Cancelled");
});

test("a confirmed time that has passed says so rather than claiming it is upcoming", () => {
  assert.equal(interviewStatusLine(interview({ status: "confirmed", followUpDue: true })), "This time has passed");
});

test("the invited participant is asked to confirm; the organiser is not", () => {
  assert.deepEqual(interviewNextStep(interview({ status: "proposed", canManage: false })), {
    key: "confirm",
    label: "Confirm this time",
  });
  assert.equal(interviewNextStep(interview({ status: "proposed", canManage: true })), null);
});

test("the organiser is asked to close out only once the time has passed", () => {
  assert.equal(interviewNextStep(interview({ followUpDue: false })), null);
  assert.deepEqual(interviewNextStep(interview({ followUpDue: true })), {
    key: "mark-complete",
    label: "Mark interview done",
  });
});

test("a completed interview asks for the decision, never makes it", () => {
  assert.deepEqual(interviewNextStep(interview({ status: "completed" })), {
    key: "record-decision",
    label: "Record decision",
  });
});

test("a cancelled interview proposes nothing", () => {
  assert.equal(interviewNextStep(interview({ status: "cancelled" })), null);
  assert.equal(interviewNextStep(null), null);
});

/* --- the schedule form --------------------------------------------------- */

test("a blank or past time is refused with a reason, not a silent no-op", () => {
  assert.deepEqual(validateScheduleDraft({ date: "", time: "10:00" }, NOW), {
    ok: false,
    reason: "Pick a date.",
  });
  assert.deepEqual(validateScheduleDraft({ date: "2026-03-12", time: "" }, NOW), {
    ok: false,
    reason: "Pick a time.",
  });
  const past = validateScheduleDraft({ date: "2020-01-01", time: "10:00" }, NOW);
  assert.equal(past.ok, false);
  assert.match(past.reason, /already passed/);
});

test("a valid draft becomes one absolute instant", () => {
  const result = validateScheduleDraft({ date: "2099-03-12", time: "11:00" }, NOW);
  assert.equal(result.ok, true);
  assert.equal(new Date(result.scheduledAt).getHours(), 11);
});

test("rescheduling opens on the time already arranged, not on a fresh guess", () => {
  const draft = initialScheduleDraft(interview({ meetingMethod: "phone", meetingDetail: "+91 90000 00000" }));
  const expected = new Date("2026-03-12T05:30:00.000Z");
  assert.equal(draft.date, toDateInput(expected));
  assert.equal(draft.time, toTimeInput(expected));
  assert.equal(draft.method, "phone");
  assert.equal(draft.detail, "+91 90000 00000");
});

test("a first invitation opens on tomorrow, not on today's date at midnight", () => {
  const draft = initialScheduleDraft(null, new Date("2026-03-10T09:00:00.000Z"));
  assert.equal(draft.method, "video_call");
  assert.equal(draft.durationMinutes, 30);
  assert.notEqual(draft.date, toDateInput(new Date("2026-03-10T09:00:00.000Z")));
});

test("every meeting method has a label and its own field copy", () => {
  assert.equal(MEETING_METHODS.length, 4);
  for (const entry of MEETING_METHODS) {
    assert.ok(entry.label.length > 0);
    assert.ok(entry.detailLabel.length > 0);
    assert.equal(meetingMethodLabel(entry.key), entry.label);
  }
  assert.equal(meetingMethodLabel("nonsense"), "Details in the message");
  assert.deepEqual([...DURATION_CHOICES], [15, 30, 45, 60]);
});

test("the wire shape maps across without losing anything the UI needs", () => {
  const mapped = toInterview({
    id: "iv1",
    conversation_id: "c1",
    status: "proposed",
    scheduled_at: "2026-03-12T05:30:00.000Z",
    timezone: "Asia/Kolkata",
    duration_minutes: 45,
    meeting_method: "in_person",
    meeting_detail: "Indiranagar",
    schedule_label: "Thu 12 Mar",
    previous_scheduled_at: null,
    reschedule_count: 2,
    round_number: 1,
    confirmed_at: null,
    confirmed_by_me: false,
    completed_at: null,
    cancelled_at: null,
    version: 3,
    can_manage: true,
    follow_up_due: false,
  });
  assert.equal(mapped.meetingMethod, "in_person");
  assert.equal(mapped.rescheduleCount, 2);
  assert.equal(mapped.canManage, true);
  assert.equal(toInterview(null), null);
});

/* --- how the arrangement changes the recommendation ---------------------- */

test("an interview still ahead stops the workspace demanding a decision", () => {
  const item = application();
  const signals = { interviewScheduled: true, interviewFollowUpDue: false, unreadCount: 0 };
  assert.equal(nextBestActionFor(item, signals), null);
  assert.equal(deriveWorkState(item, signals), null);
  assert.equal(deriveWorkQueue(item, signals), null);
});

test("an unread message before the interview still deserves a reply", () => {
  const action = nextBestActionFor(application(), {
    interviewScheduled: true,
    interviewFollowUpDue: false,
    unreadCount: 1,
  });
  assert.equal(action.key, "reply");
});

test("once the arranged time has passed, the decision is the outstanding thing", () => {
  const item = application();
  const signals = { interviewScheduled: false, interviewFollowUpDue: true };
  assert.equal(nextBestActionFor(item, signals).key, "record-decision");
  assert.equal(deriveWorkState(item, signals).key, "interview_follow_up");
  assert.equal(deriveWorkQueue(item, signals), "interview_follow_up");
});

test("the follow-up state is high confidence — the date was agreed and has passed", () => {
  const state = deriveWorkState(application(), { interviewFollowUpDue: true });
  assert.equal(state.highConfidence, true);
  assert.equal(state.label, "Interview follow-up");
});

test("interviewing with no arrangement keeps the old behaviour", () => {
  assert.equal(nextBestActionFor(application(), {}).key, "record-decision");
});

test("a follow-up never overrides a closed conversation", () => {
  const rejected = application({
    status: "rejected",
    backendStatus: "rejected",
    participantBackendStatus: "rejected",
  });
  assert.equal(deriveWorkState(rejected, { interviewFollowUpDue: true }), null);
});

test("ambiguous inbound traffic is a decision to make, never a promised reply", () => {
  const item = application({ status: "reviewing", backendStatus: "reviewing" });
  assert.equal(deriveWorkQueue(item, { unreadCount: 1 }), "decision_needed");
  assert.equal(deriveWorkQueue(item, { unreadCount: 1, responseExpected: true }), "needs_your_reply");
});
