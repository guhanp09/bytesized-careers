"use client";

import { useState } from "react";
import {
  cancelEngagementBeforeStart,
  requestEngagementCompletion,
  requestEngagementStart,
  respondToEngagementCompletion,
  respondToEngagementStart,
  type BackendEngagementSummary,
} from "../../lib/backendClient";
import { Icon } from "../Icons";

const STATUS_COPY: Record<BackendEngagementSummary["status"], { title: string; detail: string; icon: Parameters<typeof Icon>[0]["name"] }> = {
  ready_to_start: { title: "Ready to start", detail: "Work begins after both sides confirm.", icon: "circle-play" },
  start_pending: { title: "Start confirmation pending", detail: "Waiting for the other side to confirm.", icon: "clock" },
  active: { title: "Work in progress", detail: "Both sides confirmed that work has started.", icon: "bolt" },
  completion_pending: { title: "Completion confirmation pending", detail: "The outcome is waiting for confirmation.", icon: "clock" },
  completed: { title: "Completed", detail: "This engagement is eligible for feedback.", icon: "badge-check" },
  ended_after_start: { title: "Ended after start", detail: "Work began before this engagement ended.", icon: "archive" },
  cancelled_before_start: { title: "Cancelled before start", detail: "No review eligibility was created.", icon: "close" },
};

export default function EngagementStatusRow({
  engagement,
  accessToken,
  onChange,
  onReview,
}: {
  engagement: BackendEngagementSummary;
  accessToken: string;
  onChange: (engagement: BackendEngagementSummary) => void;
  onReview: () => void;
}) {
  const [panel, setPanel] = useState<"outcome" | "issue" | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const copy = STATUS_COPY[engagement.status];
  const actions = new Set(engagement.available_actions);
  const detail = (() => {
    if (engagement.status === "start_pending") {
      return actions.has("confirm_start")
        ? "Your confirmation is needed before work begins."
        : "Waiting for the other side to confirm."
    }
    if (engagement.status === "completion_pending") {
      return actions.has("confirm_completion")
        ? "Your confirmation is needed before feedback unlocks."
        : "Waiting for the other side to confirm the outcome."
    }
    if (engagement.status === "completed" || engagement.status === "ended_after_start") {
      if (engagement.review_state === "submitted") return "Your feedback is saved privately until publication."
      if (engagement.review_state === "published") return "Feedback from this engagement is published."
      if (engagement.review_state === "expired") return "The feedback window has closed."
    }
    return copy.detail;
  })();

  const run = async (action: () => Promise<BackendEngagementSummary>) => {
    setBusy(true);
    setError(null);
    try {
      onChange(await action());
      setPanel(null);
      setNote("");
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Couldn’t update this engagement.");
    } finally {
      setBusy(false);
    }
  };

  const primary = (() => {
    if (actions.has("request_start")) return { label: "Start work", run: () => requestEngagementStart(accessToken, engagement.source_type, engagement.source_record_id) };
    if (actions.has("confirm_start")) return { label: "Confirm start", run: () => respondToEngagementStart(accessToken, engagement.id, "confirm") };
    if (actions.has("request_completion")) return { label: "Update outcome", run: null };
    if (actions.has("confirm_completion")) return { label: "Confirm outcome", run: () => respondToEngagementCompletion(accessToken, engagement.id, "confirm") };
    if (actions.has("write_review")) return { label: "Leave feedback", run: null };
    if (actions.has("edit_review")) return { label: "Edit feedback", run: null };
    return null;
  })();

  const handlePrimary = () => {
    if (!primary) return;
    if (primary.label === "Update outcome") setPanel("outcome");
    else if (primary.label.includes("feedback")) onReview();
    else if (primary.run) void run(primary.run);
  };

  return (
    <section className="mb-5 rounded-xl border border-white/[0.09] bg-white/[0.025] px-3.5 py-3" data-testid="engagement-status-row">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.035] text-white/55">
            <Icon name={copy.icon} className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[12.5px] font-semibold text-white/82">{copy.title}</p>
              {engagement.review_state === "submitted" ? <span className="rounded-full border border-emerald-200/15 bg-emerald-200/[0.06] px-2 py-0.5 text-[9.5px] font-semibold text-emerald-100/70">Feedback submitted</span> : null}
              {engagement.review_state === "available" ? <span className="rounded-full border border-violet-200/15 bg-violet-200/[0.06] px-2 py-0.5 text-[9.5px] font-semibold text-violet-100/70">Feedback available</span> : null}
              {engagement.review_state === "published" ? <span className="rounded-full border border-emerald-200/15 bg-emerald-200/[0.06] px-2 py-0.5 text-[9.5px] font-semibold text-emerald-100/70">Feedback published</span> : null}
            </div>
            <p className="mt-0.5 text-[10.5px] leading-relaxed text-white/40">{detail}</p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
          {actions.has("decline_start") ? <button type="button" disabled={busy} onClick={() => void run(() => respondToEngagementStart(accessToken, engagement.id, "not_started"))} className="h-8 cursor-pointer rounded-lg border border-white/10 px-3 text-[11px] font-semibold text-white/55 transition-colors hover:bg-white/[0.05] hover:text-white disabled:opacity-40">Not started</button> : null}
          {actions.has("flag_completion_issue") ? <button type="button" disabled={busy} onClick={() => setPanel("issue")} className="h-8 cursor-pointer rounded-lg border border-white/10 px-3 text-[11px] font-semibold text-white/55 transition-colors hover:bg-white/[0.05] hover:text-white disabled:opacity-40">Needs attention</button> : null}
          {primary ? <button type="button" disabled={busy} onClick={handlePrimary} className="h-8 cursor-pointer rounded-lg bg-white px-3.5 text-[11px] font-semibold text-black transition-colors hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-50">{busy ? "Updating…" : primary.label}</button> : null}
          {actions.has("cancel_before_start") ? <button type="button" aria-label="Cancel engagement" title="Cancel engagement" disabled={busy} onClick={() => void run(() => cancelEngagementBeforeStart(accessToken, engagement.id))} className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-white/10 text-white/38 transition-colors hover:border-rose-200/20 hover:text-rose-200/70 disabled:opacity-40"><Icon name="close" className="h-3.5 w-3.5" /></button> : null}
        </div>
      </div>

      {panel === "outcome" ? (
        <div className="mt-3 border-t border-white/[0.06] pt-3">
          <p className="text-[11px] font-semibold text-white/65">How did the engagement end?</p>
          <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={2} maxLength={500} placeholder="Optional context" className="mt-2 w-full resize-none rounded-lg border border-white/[0.09] bg-black/20 px-3 py-2 text-[11.5px] text-white/75 placeholder:text-white/30 focus:border-white/20 focus:outline-none" />
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={() => void run(() => requestEngagementCompletion(accessToken, engagement.id, "completed", note))} className="h-8 cursor-pointer rounded-lg bg-white px-3 text-[11px] font-semibold text-black disabled:opacity-50">Work completed</button>
            <button type="button" disabled={busy} onClick={() => void run(() => requestEngagementCompletion(accessToken, engagement.id, "ended_after_start", note))} className="h-8 cursor-pointer rounded-lg border border-white/10 px-3 text-[11px] font-semibold text-white/60 hover:bg-white/[0.04] disabled:opacity-50">Ended after start</button>
            <button type="button" onClick={() => setPanel(null)} className="h-8 cursor-pointer px-2 text-[11px] text-white/38 hover:text-white/65">Cancel</button>
          </div>
        </div>
      ) : null}

      {panel === "issue" ? (
        <div className="mt-3 border-t border-white/[0.06] pt-3">
          <label htmlFor="engagement-issue-note" className="text-[11px] font-semibold text-white/65">What still needs attention?</label>
          <textarea id="engagement-issue-note" value={note} onChange={(event) => setNote(event.target.value)} rows={2} minLength={10} maxLength={1000} placeholder="This note stays private to the conversation." className="mt-2 w-full resize-none rounded-lg border border-white/[0.09] bg-black/20 px-3 py-2 text-[11.5px] text-white/75 placeholder:text-white/30 focus:border-white/20 focus:outline-none" />
          <div className="mt-2 flex gap-2">
            <button type="button" disabled={busy || note.trim().length < 10} onClick={() => void run(() => respondToEngagementCompletion(accessToken, engagement.id, "needs_attention", note))} className="h-8 cursor-pointer rounded-lg bg-white px-3 text-[11px] font-semibold text-black disabled:cursor-not-allowed disabled:opacity-45">Return to active</button>
            <button type="button" onClick={() => setPanel(null)} className="h-8 cursor-pointer px-2 text-[11px] text-white/38 hover:text-white/65">Cancel</button>
          </div>
        </div>
      ) : null}
      {error ? <p className="mt-2 text-[10.5px] text-rose-300/80">{error}</p> : null}
    </section>
  );
}
