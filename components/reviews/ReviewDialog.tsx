"use client";

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import {
  saveEngagementReview,
  type BackendMyReview,
  type BackendReviewOpportunity,
} from "../../lib/backendClient";
import { Icon } from "../Icons";

const DIMENSIONS = {
  recruiter_to_talent: [
    ["quality_of_work", "Quality of work"],
    ["communication", "Communication"],
    ["reliability", "Reliability"],
  ],
  talent_to_recruiter: [
    ["brief_clarity", "Brief clarity"],
    ["communication", "Communication"],
    ["professionalism", "Professionalism"],
  ],
} as const;

type ReviewDraft = {
  overall: number;
  dimensions: Record<string, number>;
  feedback: string;
};

function storageKey(engagementId: string) {
  return `cj.review-draft.${engagementId}`;
}

function StarPicker({
  label,
  value,
  required = false,
  onChange,
  firstButtonRef,
}: {
  label: string;
  value: number;
  required?: boolean;
  onChange: (value: number) => void;
  firstButtonRef?: RefObject<HTMLButtonElement | null>;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-white/[0.06] py-3 last:border-b-0">
      <div>
        <p className="text-[13px] font-semibold text-white/82">{label}{required ? " *" : ""}</p>
        {!required ? <p className="mt-0.5 text-[10.5px] text-subtle">Optional</p> : null}
      </div>
      <div className="flex items-center gap-1" role="radiogroup" aria-label={label}>
        {Array.from({ length: 5 }, (_, index) => {
          const rating = index + 1;
          return (
            <button
              key={`${label}-${rating}`}
              ref={rating === 1 ? firstButtonRef : undefined}
              type="button"
              role="radio"
              aria-checked={value === rating}
              aria-label={`${rating} star${rating === 1 ? "" : "s"}`}
              onClick={() => onChange(value === rating && !required ? 0 : rating)}
              className={`h-8 w-8 cursor-pointer text-xl transition-[color,transform] hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 ${
                rating <= value ? "text-amber-200" : "text-disabled hover:text-subtle"
              }`}
            >
              ★
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function ReviewDialog({
  open,
  opportunity,
  accessToken,
  onClose,
  onSaved,
}: {
  open: boolean;
  opportunity: BackendReviewOpportunity | null;
  accessToken: string;
  onClose: () => void;
  onSaved: (review: BackendMyReview) => void;
}) {
  const previousFocus = useRef<HTMLElement | null>(null);
  const firstStarRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  const savingRef = useRef(false);
  const [draft, setDraft] = useState<ReviewDraft>({ overall: 0, dimensions: {}, feedback: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    savingRef.current = saving;
  }, [saving]);

  useEffect(() => {
    if (!open || !opportunity) return;
    previousFocus.current = document.activeElement as HTMLElement | null;
    const existing = opportunity.my_review;
    let restored: ReviewDraft | null = null;
    try {
      const raw = window.sessionStorage.getItem(storageKey(opportunity.engagement.id));
      if (raw) restored = JSON.parse(raw) as ReviewDraft;
    } catch {
      // Storage is optional; the form still works without it.
    }
    setDraft(
      restored || {
        overall: existing?.overall_rating || 0,
        dimensions: existing?.dimension_ratings || {},
        feedback: existing?.public_feedback || "",
      }
    );
    setError(null);
    window.setTimeout(() => firstStarRef.current?.focus(), 30);
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !savingRef.current) onClose();
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
        )
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("keydown", handleKey);
      previousFocus.current?.focus();
    };
  }, [open, opportunity, onClose]);

  useEffect(() => {
    if (!open || !opportunity) return;
    try {
      window.sessionStorage.setItem(storageKey(opportunity.engagement.id), JSON.stringify(draft));
    } catch {
      // Storage is optional.
    }
  }, [draft, open, opportunity]);

  const dimensions = useMemo(
    () => (opportunity ? DIMENSIONS[opportunity.direction] : []),
    [opportunity]
  );

  if (!open || !opportunity || typeof document === "undefined") return null;

  const save = async () => {
    if (!draft.overall) {
      setError("Choose an overall rating.");
      return;
    }
    if (draft.overall <= 2 && draft.feedback.trim().length < 20) {
      setError("Add at least 20 characters of context for this rating.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const review = await saveEngagementReview(accessToken, opportunity.engagement.id, {
        overall_rating: draft.overall,
        dimension_ratings: Object.fromEntries(
          Object.entries(draft.dimensions).filter(([, value]) => value > 0)
        ),
        public_feedback: draft.feedback.trim() || null,
      });
      window.sessionStorage.removeItem(storageKey(opportunity.engagement.id));
      onSaved(review);
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Couldn’t save your feedback.");
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center sm:px-4" role="dialog" aria-modal="true" aria-labelledby="review-dialog-title">
      <button type="button" aria-label="Close feedback" onClick={() => !saving && onClose()} className="absolute inset-0 cursor-default bg-black/70 backdrop-blur-sm" />
      <section ref={dialogRef} className="relative max-h-[92dvh] w-full overflow-y-auto rounded-t-2xl border border-white/[0.1] bg-[#15151b] shadow-[0_28px_90px_-25px_rgba(0,0,0,1)] sm:max-w-xl sm:rounded-2xl">
        <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-white/[0.07] bg-[#15151b]/95 px-5 py-4 backdrop-blur-xl sm:px-6">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-subtle">Verified engagement</p>
            <h2 id="review-dialog-title" className="mt-1 truncate text-lg font-semibold text-white">Share feedback</h2>
            <p className="mt-1 truncate text-xs text-muted">{opportunity.engagement.context_label}</p>
          </div>
          <button type="button" aria-label="Close" disabled={saving} onClick={onClose} className="inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full border border-white/10 text-white/55 transition-colors hover:bg-white/[0.06] hover:text-white disabled:opacity-40">
            <Icon name="close" className="h-4 w-4" />
          </button>
        </header>

        <div className="px-5 py-4 sm:px-6 sm:py-5">
          <div className="rounded-xl border border-white/[0.08] bg-white/[0.025] px-4">
            <StarPicker label="Overall rating" value={draft.overall} required firstButtonRef={firstStarRef} onChange={(overall) => setDraft((current) => ({ ...current, overall }))} />
            {dimensions.map(([key, label]) => (
              <StarPicker key={key} label={label} value={draft.dimensions[key] || 0} onChange={(value) => setDraft((current) => ({ ...current, dimensions: { ...current.dimensions, [key]: value } }))} />
            ))}
          </div>

          <label className="mt-5 block text-[13px] font-semibold text-white/82" htmlFor="review-feedback">Public feedback</label>
          <textarea
            id="review-feedback"
            value={draft.feedback}
            onChange={(event) => setDraft((current) => ({ ...current, feedback: event.target.value }))}
            rows={4}
            maxLength={1000}
            placeholder="Share what future collaborators should know."
            className="mt-2 w-full resize-none rounded-xl border border-white/[0.1] bg-black/25 px-3.5 py-3 text-[13px] leading-6 text-white/85 placeholder:text-subtle focus:border-white/25 focus:outline-none"
          />
          <div className="mt-1.5 flex justify-between gap-3 text-[10.5px] text-subtle">
            <span>Optional, unless the overall rating is 1–2.</span>
            <span>{draft.feedback.length}/1000</span>
          </div>

          <div className="mt-5 flex gap-2.5 rounded-xl border border-white/[0.07] bg-white/[0.025] px-3.5 py-3">
            <Icon name="shield" className="mt-0.5 h-4 w-4 shrink-0 text-subtle" />
            <p className="text-[11px] leading-relaxed text-muted">Your feedback stays private until both sides submit or the 14-day window closes. Before then, the other person is not told whether you submitted.</p>
          </div>
          {error ? <p className="mt-3 text-[11px] text-rose-300/85">{error}</p> : null}
        </div>

        <footer className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-white/[0.07] bg-[#15151b]/95 px-5 py-4 backdrop-blur-xl sm:px-6">
          <button type="button" disabled={saving} onClick={onClose} className="inline-flex h-9 cursor-pointer items-center rounded-lg border border-white/12 px-3.5 text-xs font-semibold text-white/65 transition-colors hover:bg-white/[0.05] hover:text-white disabled:opacity-40">Cancel</button>
          <button type="button" disabled={saving} onClick={() => void save()} className="inline-flex h-9 cursor-pointer items-center rounded-lg bg-white px-4 text-xs font-semibold text-black transition-colors hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-50">{saving ? "Saving…" : opportunity.my_review ? "Update feedback" : "Submit feedback"}</button>
        </footer>
      </section>
    </div>,
    document.body
  );
}
