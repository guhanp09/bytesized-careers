/**
 * Interview presentation and validation, kept pure so both the workspace and
 * its tests can reason about it without a browser or a server.
 *
 * The one rule everything here serves: **a missed interview is expensive**, so
 * the product never shows a bare time. It shows the reader's own time first,
 * because that is the one they will act on, and the organiser's stated zone
 * beside it, because that is what was actually promised.
 */

export type InterviewStatus = "proposed" | "confirmed" | "completed" | "cancelled";

export type InterviewMeetingMethod = "video_call" | "phone" | "in_person" | "other";

export type Interview = {
  id: string;
  conversationId: string;
  status: InterviewStatus;
  scheduledAt: string | null;
  timezone: string;
  durationMinutes?: number | null;
  meetingMethod: InterviewMeetingMethod;
  meetingDetail?: string | null;
  /** The organiser's stated time, pre-rendered server-side. */
  scheduleLabel: string;
  previousScheduledAt?: string | null;
  rescheduleCount: number;
  roundNumber: number;
  confirmedAt?: string | null;
  confirmedByMe: boolean;
  completedAt?: string | null;
  cancelledAt?: string | null;
  version: number;
  canManage: boolean;
  followUpDue: boolean;
};

/**
 * The wire shape, described structurally rather than imported, so these helpers
 * stay free of the backend client and can be unit-tested on their own.
 */
export type InterviewWire = {
  id: string;
  conversation_id: string;
  status: InterviewStatus;
  scheduled_at?: string | null;
  timezone: string;
  duration_minutes?: number | null;
  meeting_method: InterviewMeetingMethod;
  meeting_detail?: string | null;
  schedule_label: string;
  previous_scheduled_at?: string | null;
  reschedule_count: number;
  round_number: number;
  confirmed_at?: string | null;
  confirmed_by_me: boolean;
  completed_at?: string | null;
  cancelled_at?: string | null;
  version: number;
  can_manage: boolean;
  follow_up_due: boolean;
};

export function toInterview(row: InterviewWire | null | undefined): Interview | null {
  if (!row) return null;
  return {
    id: row.id,
    conversationId: row.conversation_id,
    status: row.status,
    scheduledAt: row.scheduled_at ?? null,
    timezone: row.timezone,
    durationMinutes: row.duration_minutes ?? null,
    meetingMethod: row.meeting_method,
    meetingDetail: row.meeting_detail ?? null,
    scheduleLabel: row.schedule_label,
    previousScheduledAt: row.previous_scheduled_at ?? null,
    rescheduleCount: row.reschedule_count,
    roundNumber: row.round_number,
    confirmedAt: row.confirmed_at ?? null,
    confirmedByMe: row.confirmed_by_me,
    completedAt: row.completed_at ?? null,
    cancelledAt: row.cancelled_at ?? null,
    version: row.version,
    canManage: row.can_manage,
    followUpDue: row.follow_up_due,
  };
}

export const MEETING_METHODS: Array<{
  key: InterviewMeetingMethod;
  label: string;
  /** What the free-text field is for, when this method is chosen. */
  detailLabel: string;
  detailPlaceholder: string;
}> = [
  {
    key: "video_call",
    label: "Video call",
    detailLabel: "Meeting link",
    detailPlaceholder: "https://…",
  },
  { key: "phone", label: "Phone", detailLabel: "Number to call", detailPlaceholder: "+91 …" },
  { key: "in_person", label: "In person", detailLabel: "Where", detailPlaceholder: "Address or landmark" },
  { key: "other", label: "Something else", detailLabel: "Details", detailPlaceholder: "How you'll meet" },
];

export function meetingMethodLabel(method: string): string {
  return MEETING_METHODS.find((entry) => entry.key === method)?.label ?? "Details in the message";
}

/** Common lengths, offered as chips so nobody types "30" by hand. */
export const DURATION_CHOICES = [15, 30, 45, 60] as const;

/**
 * The reader's own clock. Rendered from the absolute instant, so it is correct
 * regardless of which zone the organiser was thinking in.
 *
 * Falls back to the server's pre-rendered label if the browser cannot format
 * the date — a wrong time would be worse than a plain one.
 */
export function formatInterviewLocal(iso: string | null, locale?: string): string | null {
  if (!iso) return null;
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return null;
  try {
    return new Intl.DateTimeFormat(locale, {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
    }).format(when);
  } catch {
    return null;
  }
}

/** The viewer's IANA zone, for the "…your time" qualifier. */
export function viewerTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
  } catch {
    return null;
  }
}

/**
 * Whether the organiser's zone needs spelling out. When both people are in the
 * same zone, repeating it is noise; when they differ, omitting it is a missed
 * interview.
 */
export function needsZoneQualifier(interview: Pick<Interview, "timezone">): boolean {
  const viewer = viewerTimeZone();
  return Boolean(viewer && viewer !== interview.timezone);
}

/**
 * One short, honest sentence about where the arrangement stands.
 *
 * Written from the reader's side: the organiser is told what they are waiting
 * for, the invited participant is told what is being asked of them.
 */
export function interviewStatusLine(interview: Interview): string {
  switch (interview.status) {
    case "proposed":
      return interview.canManage ? "Waiting for them to confirm" : "Confirm if this works";
    case "confirmed":
      return interview.followUpDue ? "This time has passed" : "Confirmed";
    case "completed":
      return "Interview done";
    case "cancelled":
      return "Cancelled";
  }
}

/**
 * The one thing the organiser should do next about the *interview* — not about
 * the candidate. Returning null means the interview needs nothing and the
 * ordinary next-best-action ladder should speak instead.
 */
export function interviewNextStep(
  interview: Interview | null
): { key: "confirm" | "mark-complete" | "record-decision"; label: string } | null {
  if (!interview) return null;
  if (interview.status === "cancelled") return null;
  if (interview.status === "completed") {
    return { key: "record-decision", label: "Record decision" };
  }
  if (!interview.canManage) {
    return interview.status === "proposed" ? { key: "confirm", label: "Confirm this time" } : null;
  }
  if (interview.followUpDue) {
    return { key: "mark-complete", label: "Mark interview done" };
  }
  return null;
}

/** Mirrors the backend grace period, so both sides agree on "has it happened?". */
export const FOLLOW_UP_GRACE_MINUTES = 60;

/**
 * Local recomputation of the follow-up signal.
 *
 * The server sends `follow_up_due` at fetch time; a workspace left open for
 * hours would otherwise keep showing a stale answer. Deliberately the *same*
 * rule, not a looser one — the two must never disagree.
 */
export function interviewFollowUpDue(
  interview: Pick<Interview, "status" | "scheduledAt"> | null,
  now: number = Date.now()
): boolean {
  if (!interview) return false;
  if (interview.status === "completed") return true;
  if (interview.status !== "proposed" && interview.status !== "confirmed") return false;
  if (!interview.scheduledAt) return false;
  const at = Date.parse(interview.scheduledAt);
  if (Number.isNaN(at)) return false;
  return now - at > FOLLOW_UP_GRACE_MINUTES * 60 * 1000;
}

/** An arrangement still ahead of us: the date, not a decision, is what is next. */
export function interviewIsUpcoming(
  interview: Pick<Interview, "status" | "scheduledAt"> | null,
  now: number = Date.now()
): boolean {
  if (!interview) return false;
  if (interview.status !== "proposed" && interview.status !== "confirmed") return false;
  return !interviewFollowUpDue(interview, now);
}

export type ScheduleDraft = {
  /** `<input type="date">` value, local to the browser. */
  date: string;
  /** `<input type="time">` value, local to the browser. */
  time: string;
  method: InterviewMeetingMethod;
  detail: string;
  durationMinutes: number | null;
  note: string;
};

export type ScheduleValidation =
  | { ok: true; scheduledAt: string }
  | { ok: false; reason: string };

/**
 * Turn the two local inputs into one absolute instant, refusing the mistakes
 * that actually happen: a blank field, an unparseable combination, and a date
 * in the past that the organiser almost certainly did not mean.
 *
 * Kept lenient about *how far* ahead — a hiring process can legitimately book a
 * month out, and guessing a maximum here would only produce false rejections.
 * The server still enforces the outer bounds.
 */
export function validateScheduleDraft(
  draft: Pick<ScheduleDraft, "date" | "time">,
  now: number = Date.now()
): ScheduleValidation {
  if (!draft.date) return { ok: false, reason: "Pick a date." };
  if (!draft.time) return { ok: false, reason: "Pick a time." };
  const parsed = new Date(`${draft.date}T${draft.time}`);
  if (Number.isNaN(parsed.getTime())) return { ok: false, reason: "That date and time didn't parse." };
  if (parsed.getTime() < now) return { ok: false, reason: "That time has already passed." };
  return { ok: true, scheduledAt: parsed.toISOString() };
}

/** Sensible opening values: tomorrow, mid-morning, on a video call. */
export function initialScheduleDraft(interview: Interview | null, now: Date = new Date()): ScheduleDraft {
  if (interview?.scheduledAt) {
    const when = new Date(interview.scheduledAt);
    if (!Number.isNaN(when.getTime())) {
      return {
        date: toDateInput(when),
        time: toTimeInput(when),
        method: interview.meetingMethod,
        detail: interview.meetingDetail ?? "",
        durationMinutes: interview.durationMinutes ?? 30,
        note: "",
      };
    }
  }
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  tomorrow.setHours(11, 0, 0, 0);
  return {
    date: toDateInput(tomorrow),
    time: toTimeInput(tomorrow),
    method: "video_call",
    detail: "",
    durationMinutes: 30,
    note: "",
  };
}

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

export function toDateInput(when: Date): string {
  return `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`;
}

export function toTimeInput(when: Date): string {
  return `${pad(when.getHours())}:${pad(when.getMinutes())}`;
}
