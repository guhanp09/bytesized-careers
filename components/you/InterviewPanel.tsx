"use client";

import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { Icon } from "../Icons";
import {
  DURATION_CHOICES,
  MEETING_METHODS,
  formatInterviewLocal,
  initialScheduleDraft,
  interviewStatusLine,
  meetingMethodLabel,
  needsZoneQualifier,
  validateScheduleDraft,
  viewerTimeZone,
  type Interview,
  type InterviewMeetingMethod,
  type ScheduleDraft,
} from "../../lib/interviewScheduling";

const SURFACE = "border border-line surface-raised elev-2";
/*
  44px tall on a phone, the compact 32px from a pointer device upward. These are
  the controls someone taps while walking to a meeting; a 32px target is the
  kind of thing that reads as fine on a desktop and misses on a bus.
*/
const GHOST =
  "inline-flex h-11 cursor-pointer items-center justify-center rounded-lg border border-line-mid bg-overlay px-3 text-[11.5px] font-semibold text-default transition-colors elev-1 hover:border-line-strong hover:text-ink disabled:cursor-not-allowed disabled:opacity-50 sm:h-8";
const PRIMARY =
  "surface-primary inline-flex h-11 cursor-pointer items-center justify-center rounded-lg px-3 text-[11.5px] font-semibold text-black transition-all elev-2 hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50 sm:h-8";
const FIELD =
  "surface-inset h-9 w-full rounded-lg border border-line px-2.5 text-[12.5px] text-ink outline-none transition-colors focus:border-line-strong focus-visible:ring-2 focus-visible:ring-focus";

const noopSubscribe = () => () => {};

/**
 * False while rendering on the server, true once the client owns the tree.
 *
 * Time-zone- and locale-dependent text cannot be produced on the server: the
 * server's zone is not the reader's, and a mismatch here would leave someone
 * looking at a confident, wrong time. Expressed as an external store rather than
 * an effect so the first client render already knows the answer.
 */
function useHydrated(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false
  );
}

/** Status dot colour. Never the only signal — every state also carries a word. */
const STATUS_DOT: Record<Interview["status"], string> = {
  proposed: "bg-amber-300",
  confirmed: "bg-emerald-300",
  completed: "bg-sky-300",
  cancelled: "bg-white/35",
};

export type InterviewSubmission = {
  scheduledAt: string;
  timezone: string;
  meetingMethod: InterviewMeetingMethod;
  meetingDetail: string | null;
  durationMinutes: number | null;
  note: string | null;
};

/**
 * The arrangement, as it stands, plus whatever the reader can do about it.
 *
 * Read by both participants: everything shown here was deliberately
 * communicated. Which controls appear is decided by `interview.canManage`,
 * which the server also enforces on every write.
 */
export function InterviewCard({
  interview,
  counterpartyName,
  busy,
  onReschedule,
  onConfirm,
  onComplete,
  onCancel,
}: {
  interview: Interview;
  counterpartyName: string;
  busy: boolean;
  onReschedule: () => void;
  onConfirm: () => void;
  onComplete: () => void;
  onCancel: () => void;
}) {
  // The organiser's pre-rendered label is correct everywhere, so it holds the
  // space until the client can render the reader's own clock.
  const hydrated = useHydrated();
  const local = hydrated ? formatInterviewLocal(interview.scheduledAt) : null;
  const showZone = hydrated && needsZoneQualifier(interview);
  const inactive = interview.status === "cancelled" || interview.status === "completed";

  return (
    <section
      data-testid="interview-card"
      data-interview-status={interview.status}
      aria-label={`Interview with ${counterpartyName}`}
      /*
        Sticky, because the conversation scrolls to its newest message the
        moment it opens — which would leave the one thing with a deadline on it
        off-screen. Fully opaque rather than translucent: messages passing
        underneath a see-through panel produced unreadable overlap, and a
        scheduling detail is exactly the wrong text to render ambiguously. The
        shadow, not transparency, is what says "this floats".
      */
      className="ui-rise surface-elevated sticky top-0 z-10 mb-6 rounded-xl border border-line-mid p-4 elev-3"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-[11px] font-semibold text-white/60">
            <Icon name="calendar-clock" className="h-3.5 w-3.5" aria-hidden="true" />
            {interview.roundNumber > 1 ? `Interview · round ${interview.roundNumber}` : "Interview"}
          </p>
          <p
            className={[
              "mt-1.5 text-sm font-semibold",
              inactive ? "text-muted line-through decoration-white/25" : "text-white/90",
            ].join(" ")}
          >
            {local ?? interview.scheduleLabel}
          </p>
          {/*
            The reader's own clock leads, because that is the one they will act
            on. The organiser's stated zone follows only when the two differ —
            repeating an identical zone would be noise, omitting a different one
            would be a missed interview.
          */}
          <p className="mt-1 text-[11.5px] leading-relaxed text-white/65">
            {showZone ? `${interview.scheduleLabel} · their time` : meetingMethodLabel(interview.meetingMethod)}
            {interview.durationMinutes && !showZone ? ` · ${interview.durationMinutes} min` : ""}
          </p>
          {interview.meetingDetail ? (
            <p className="mt-1.5 break-words text-[11.5px] text-white/75" data-testid="interview-detail">
              {interview.meetingDetail}
            </p>
          ) : null}
        </div>
        <p
          data-testid="interview-status-line"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-line bg-raised px-2 py-1 text-[11px] font-medium text-white/85"
        >
          <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[interview.status]}`} aria-hidden="true" />
          {interviewStatusLine(interview)}
        </p>
      </div>

      {interview.rescheduleCount > 0 && !inactive ? (
        <p className="mt-2 text-[11px] text-white/60">
          Moved {interview.rescheduleCount === 1 ? "once" : `${interview.rescheduleCount} times`}.
        </p>
      ) : null}

      <div className="mt-3.5 flex flex-wrap items-center gap-2">
        {!interview.canManage && interview.status === "proposed" ? (
          <button
            type="button"
            data-testid="interview-confirm"
            disabled={busy}
            onClick={onConfirm}
            className={PRIMARY}
          >
            This time works
          </button>
        ) : null}
        {interview.canManage && (interview.status === "proposed" || interview.status === "confirmed") ? (
          <>
            {interview.followUpDue ? (
              <button
                type="button"
                data-testid="interview-complete"
                disabled={busy}
                onClick={onComplete}
                className={PRIMARY}
              >
                Mark interview done
              </button>
            ) : null}
            <button
              type="button"
              data-testid="interview-reschedule"
              disabled={busy}
              onClick={onReschedule}
              className={GHOST}
            >
              Move it
            </button>
            <button
              type="button"
              data-testid="interview-cancel"
              disabled={busy}
              onClick={onCancel}
              className="inline-flex h-11 cursor-pointer items-center rounded-lg px-2.5 text-[11.5px] font-medium text-white/65 transition-colors hover:bg-elevated hover:text-white/90 disabled:cursor-not-allowed disabled:opacity-50 sm:h-8"
            >
              Call it off
            </button>
          </>
        ) : null}
        {interview.canManage && interview.status === "completed" ? (
          <button
            type="button"
            data-testid="interview-new-round"
            disabled={busy}
            onClick={onReschedule}
            className={GHOST}
          >
            Arrange another
          </button>
        ) : null}
        {interview.canManage && interview.status === "cancelled" ? (
          <button
            type="button"
            data-testid="interview-new-round"
            disabled={busy}
            onClick={onReschedule}
            className={GHOST}
          >
            Suggest a new time
          </button>
        ) : null}
      </div>
    </section>
  );
}

/**
 * The focused surface for naming a time.
 *
 * Deliberately small: a date, a time, how you'll meet, and an editable message.
 * No availability grid, no calendar integration, no invitee list — those are
 * the things that turn scheduling into administration.
 */
export function InterviewScheduler({
  interview,
  counterpartyName,
  busy,
  error,
  onSubmit,
  onClose,
}: {
  interview: Interview | null;
  counterpartyName: string;
  busy: boolean;
  error: string | null;
  onSubmit: (submission: InterviewSubmission) => void;
  onClose: () => void;
}) {
  const rescheduling = Boolean(
    interview && (interview.status === "proposed" || interview.status === "confirmed")
  );
  const [draft, setDraft] = useState<ScheduleDraft>(() => initialScheduleDraft(interview));
  const [localError, setLocalError] = useState<string | null>(null);
  // Resolved on the client for the same reason the card defers its local time.
  const zoneLabel = useHydrated() ? viewerTimeZone() : null;
  const headingId = useId();
  const dateRef = useRef<HTMLInputElement | null>(null);
  const containerRef = useRef<HTMLElement | null>(null);

  // The surface was opened deliberately, so focus goes to its first field —
  // this is not an interruption, it is the thing the user just asked for.
  useEffect(() => {
    dateRef.current?.focus();
  }, []);

  // Escape closes, matching every other dismissible surface in the workspace.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    const node = containerRef.current;
    node?.addEventListener("keydown", onKeyDown);
    return () => node?.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const method = useMemo(
    () => MEETING_METHODS.find((entry) => entry.key === draft.method) ?? MEETING_METHODS[0],
    [draft.method]
  );

  const submit = () => {
    const validation = validateScheduleDraft(draft);
    if (!validation.ok) {
      setLocalError(validation.reason);
      return;
    }
    setLocalError(null);
    onSubmit({
      scheduledAt: validation.scheduledAt,
      timezone: viewerTimeZone() ?? "UTC",
      meetingMethod: draft.method,
      meetingDetail: draft.detail.trim() || null,
      durationMinutes: draft.durationMinutes,
      note: draft.note.trim() || null,
    });
  };

  const shown = localError ?? error;

  return (
    <section
      ref={containerRef}
      data-testid="interview-scheduler"
      aria-labelledby={headingId}
      className={`ui-rise mb-6 rounded-xl ${SURFACE} p-4`}
    >
      <div className="flex items-start justify-between gap-3">
        <p id={headingId} className="text-[12.5px] font-semibold text-white/85">
          {rescheduling ? `Move the interview with ${counterpartyName}` : `Invite ${counterpartyName} to interview`}
        </p>
        <button
          type="button"
          data-testid="interview-scheduler-close"
          onClick={onClose}
          aria-label="Close interview scheduling"
          className="-mr-1 -mt-0.5 inline-flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-lg text-white/60 transition-colors hover:bg-elevated hover:text-white"
        >
          <Icon name="x" className="h-3 w-3" />
        </button>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold text-white/60">Date</span>
          <input
            ref={dateRef}
            type="date"
            data-testid="interview-date"
            value={draft.date}
            onChange={(event) => setDraft((current) => ({ ...current, date: event.target.value }))}
            className={FIELD}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold text-white/60">Time</span>
          <input
            type="time"
            data-testid="interview-time"
            value={draft.time}
            onChange={(event) => setDraft((current) => ({ ...current, time: event.target.value }))}
            className={FIELD}
          />
        </label>
      </div>

      {/*
        Stated plainly rather than offered as a picker. The organiser is almost
        always scheduling in their own zone, and a zone dropdown is a
        well-known way to pick the wrong one by accident.
      */}
      <p className="mt-1.5 text-[11px] text-white/60">
        {zoneLabel ? `Your time zone (${zoneLabel}). ` : ""}
        {counterpartyName} sees this in theirs.
      </p>

      <fieldset className="mt-3.5">
        <legend className="mb-1.5 text-[11px] font-semibold text-white/60">How you&rsquo;ll meet</legend>
        <div className="flex flex-wrap gap-1.5">
          {MEETING_METHODS.map((entry) => (
            <button
              key={entry.key}
              type="button"
              data-testid={`interview-method-${entry.key}`}
              aria-pressed={draft.method === entry.key}
              onClick={() => setDraft((current) => ({ ...current, method: entry.key }))}
              className={[
                "inline-flex h-8 cursor-pointer items-center rounded-lg border px-2.5 text-[11.5px] font-semibold transition-colors",
                draft.method === entry.key
                  ? "border-line-strong bg-overlay text-white"
                  : "border-line-mid bg-raised text-white/80 hover:bg-overlay",
              ].join(" ")}
            >
              {entry.label}
            </button>
          ))}
        </div>
      </fieldset>

      <label className="mt-3.5 block">
        <span className="mb-1 block text-[11px] font-semibold text-white/60">
          {method.detailLabel} <span className="font-normal text-white/60">— optional</span>
        </span>
        <input
          type="text"
          data-testid="interview-meeting-detail"
          value={draft.detail}
          placeholder={method.detailPlaceholder}
          onChange={(event) => setDraft((current) => ({ ...current, detail: event.target.value }))}
          className={FIELD}
        />
      </label>

      <fieldset className="mt-3.5">
        <legend className="mb-1.5 text-[11px] font-semibold text-white/60">How long</legend>
        <div className="flex flex-wrap gap-1.5">
          {DURATION_CHOICES.map((minutes) => (
            <button
              key={minutes}
              type="button"
              data-testid={`interview-duration-${minutes}`}
              aria-pressed={draft.durationMinutes === minutes}
              onClick={() =>
                setDraft((current) => ({
                  ...current,
                  durationMinutes: current.durationMinutes === minutes ? null : minutes,
                }))
              }
              className={[
                "inline-flex h-8 cursor-pointer items-center rounded-lg border px-2.5 text-[11.5px] font-semibold transition-colors",
                draft.durationMinutes === minutes
                  ? "border-line-strong bg-overlay text-white"
                  : "border-line-mid bg-raised text-white/80 hover:bg-overlay",
              ].join(" ")}
            >
              {minutes} min
            </button>
          ))}
        </div>
      </fieldset>

      <label className="mt-3.5 block">
        <span className="mb-1 block text-[11px] font-semibold text-white/60">
          Message <span className="font-normal text-white/60">— optional, sent with the invitation</span>
        </span>
        <textarea
          data-testid="interview-note"
          value={draft.note}
          rows={2}
          placeholder={`Anything ${counterpartyName} should know beforehand?`}
          onChange={(event) => setDraft((current) => ({ ...current, note: event.target.value }))}
          className="surface-inset w-full resize-none rounded-lg border border-line px-2.5 py-2 text-[12.5px] leading-relaxed text-ink outline-none transition-colors focus:border-line-strong focus-visible:ring-2 focus-visible:ring-focus"
        />
      </label>

      {shown ? (
        <p
          role="alert"
          data-testid="interview-scheduler-error"
          className="mt-3 rounded-lg border border-amber-200/25 bg-amber-200/10 px-3 py-2 text-[11.5px] text-amber-100"
        >
          {shown}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-testid="interview-submit"
          disabled={busy}
          onClick={submit}
          className={PRIMARY}
        >
          {busy ? "Sending…" : rescheduling ? "Send the new time" : "Send invitation"}
        </button>
        <button type="button" onClick={onClose} disabled={busy} className={GHOST}>
          Not now
        </button>
        <p className="text-[11px] text-white/60">
          {rescheduling
            ? `${counterpartyName} is told what changed.`
            : `${counterpartyName} sees this invitation and the stage moves to Interviewing.`}
        </p>
      </div>
    </section>
  );
}
