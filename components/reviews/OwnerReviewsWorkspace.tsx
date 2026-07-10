"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getMyReviewWorkspace,
  type BackendProfileReviewCollection,
  type BackendReviewOpportunity,
  type BackendReviewWorkspace,
} from "../../lib/backendClient";
import { Icon } from "../Icons";
import { ProfileReviewsTabContent } from "../profile/ProfileReviews";
import ReviewDialog from "./ReviewDialog";

function dateLabel(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function OpportunityCard({
  item,
  onReview,
}: {
  item: BackendReviewOpportunity;
  onReview?: () => void;
}) {
  const state = item.engagement.review_state;
  const label =
    state === "available"
      ? "Ready for feedback"
      : state === "submitted"
        ? "Awaiting publication"
        : state === "published"
          ? "Published"
          : "Window closed";
  const tone =
    state === "available"
      ? "border-violet-200/15 bg-violet-200/[0.05] text-violet-100/75"
      : state === "published"
        ? "border-emerald-200/15 bg-emerald-200/[0.05] text-emerald-100/70"
        : "border-white/[0.08] bg-white/[0.025] text-white/45";
  return (
    <article className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-4 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-white/88">{item.engagement.context_label}</h3>
            <span className={`rounded-full border px-2 py-0.5 text-[9.5px] font-semibold ${tone}`}>{label}</span>
          </div>
          <p className="mt-1 text-xs text-white/42">With {item.engagement.counterpart_name}</p>
          {state === "available" && item.engagement.review_window_ends_at ? (
            <p className="mt-2 text-[10.5px] text-white/34">Closes {dateLabel(item.engagement.review_window_ends_at)}</p>
          ) : null}
          {state === "submitted" ? (
            <p className="mt-2 text-[11px] leading-relaxed text-white/42">Your feedback is saved privately until blind publication.</p>
          ) : null}
        </div>
        {onReview ? (
          <button type="button" onClick={onReview} className="inline-flex h-8 shrink-0 cursor-pointer items-center justify-center rounded-lg bg-white px-3 text-[11px] font-semibold text-black transition-colors hover:bg-white/90">
            {item.my_review ? "Edit feedback" : "Leave feedback"}
          </button>
        ) : null}
      </div>
    </article>
  );
}

export default function OwnerReviewsWorkspace({
  mode,
  accessToken,
  initialReceived,
}: {
  mode: "talent" | "hiring";
  accessToken?: string;
  initialReceived: BackendProfileReviewCollection;
}) {
  const [view, setView] = useState<"received" | "written">("received");
  const [workspace, setWorkspace] = useState<BackendReviewWorkspace | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">(accessToken ? "loading" : "ready");
  const [selected, setSelected] = useState<BackendReviewOpportunity | null>(null);

  const load = useCallback(async () => {
    if (!accessToken) return;
    setState("loading");
    try {
      setWorkspace(await getMyReviewWorkspace(accessToken, mode));
      setState("ready");
    } catch {
      setState("error");
    }
  }, [accessToken, mode]);

  useEffect(() => {
    if (!accessToken) return;
    let active = true;
    getMyReviewWorkspace(accessToken, mode)
      .then((result) => {
        if (!active) return;
        setWorkspace(result);
        setState("ready");
      })
      .catch(() => {
        if (active) setState("error");
      });
    return () => {
      active = false;
    };
  }, [accessToken, mode]);

  const received = workspace?.received || initialReceived;
  const feedbackItems = useMemo(
    () => [...(workspace?.opportunities || []), ...(workspace?.written || [])],
    [workspace]
  );

  return (
    <div className="space-y-5" data-testid="owner-reviews-workspace">
      <div className="flex items-center gap-1 border-b border-white/[0.07]" role="tablist" aria-label="Reviews">
        {([
          ["received", "About you"],
          ["written", "Your feedback"],
        ] as const).map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={view === key} onClick={() => setView(key)} className={`relative h-10 cursor-pointer px-1.5 text-xs font-semibold transition-colors after:absolute after:inset-x-1.5 after:bottom-0 after:h-px after:bg-white after:transition-transform ${view === key ? "text-white after:scale-x-100" : "text-white/45 after:scale-x-0 hover:text-white/75"}`}>
            {label}
          </button>
        ))}
      </div>

      {view === "received" ? (
        <ProfileReviewsTabContent items={received.items} averageRating={received.summary.avg_rating} reviewCount={received.summary.review_count} />
      ) : state === "loading" ? (
        <div className="flex min-h-40 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.02] text-xs text-white/40">Loading feedback…</div>
      ) : state === "error" ? (
        <div className="flex min-h-40 flex-col items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.02] px-6 text-center">
          <Icon name="alert" className="h-5 w-5 text-white/35" />
          <p className="mt-2 text-sm font-semibold text-white/65">Couldn’t load your feedback</p>
          <button type="button" onClick={() => void load()} className="mt-3 h-8 cursor-pointer rounded-lg border border-white/12 px-3 text-[11px] font-semibold text-white/60 hover:bg-white/[0.04]">Retry</button>
        </div>
      ) : feedbackItems.length ? (
        <div className="space-y-3">
          {feedbackItems.map((item) => (
            <OpportunityCard
              key={item.engagement.id}
              item={item}
              onReview={item.engagement.review_state === "available" || item.my_review?.editable ? () => setSelected(item) : undefined}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-6 py-10 text-center">
          <p className="text-sm text-white/58">No feedback actions yet.</p>
          <p className="mt-1 text-xs text-white/34">They appear after both sides confirm that work started and ended.</p>
        </div>
      )}

      {accessToken ? (
        <ReviewDialog
          open={Boolean(selected)}
          opportunity={selected}
          accessToken={accessToken}
          onClose={() => setSelected(null)}
          onSaved={() => void load()}
        />
      ) : null}
    </div>
  );
}
