"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { ReportCategory } from "../lib/backendClient";

/**
 * Report reason picker shared by job, talent-listing, and profile reporting.
 * Replaces the old one-click hard-coded report: the reporter chooses why and
 * can add context, which is what makes the admin queue triageable
 * (docs/ADMIN_PANEL_PLAN.md §7.2).
 */

const REASONS: Array<{ key: ReportCategory; label: string; hint: string }> = [
  { key: "scam_or_fraud", label: "Scam or fraud", hint: "Fake offer, payment tricks, phishing" },
  { key: "off_platform_payment", label: "Off-platform payment pressure", hint: "Pushing to pay or get paid outside CreatorJobs" },
  { key: "impersonation", label: "Impersonation", hint: "Pretending to be another creator, channel, or brand" },
  { key: "harassment", label: "Harassment", hint: "Abusive or threatening behavior" },
  { key: "spam", label: "Spam", hint: "Duplicate, mass-posted, or irrelevant" },
  { key: "inappropriate_content", label: "Inappropriate content", hint: "Content that doesn't belong here" },
  { key: "suspicious_or_inaccurate", label: "Suspicious or inaccurate", hint: "Details don't add up" },
  { key: "other", label: "Something else", hint: "Tell us in the note" },
];

type ReportDialogProps = {
  open: boolean;
  /** What is being reported, e.g. "this job" — used in the title only. */
  targetLabel: string;
  sending?: boolean;
  error?: string | null;
  onSubmit: (category: ReportCategory, note: string | null) => void;
  onClose: () => void;
};

/** Form state lives in the body component, which unmounts on close — every
 * open starts with a clean reason/note without effect-driven resets. */
export default function ReportDialog(props: ReportDialogProps) {
  if (!props.open || typeof document === "undefined") return null;
  return <ReportDialogBody {...props} />;
}

function ReportDialogBody({
  targetLabel,
  sending,
  error,
  onSubmit,
  onClose,
}: ReportDialogProps) {
  const [category, setCategory] = useState<ReportCategory | null>(null);
  const [note, setNote] = useState("");

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[95] flex items-center justify-center px-4" role="dialog" aria-modal="true" aria-label={`Report ${targetLabel}`}>
      <button type="button" aria-label="Cancel report" onClick={onClose} className="absolute inset-0 cursor-default bg-black/65 backdrop-blur-sm" />
      <div
        data-testid="report-dialog"
        className="relative w-full max-w-md rounded-2xl border border-white/[0.1] bg-[#15151b] p-5 shadow-[0_32px_90px_-30px_rgba(0,0,0,1)]"
      >
        <h3 className="text-sm font-semibold text-white">Report {targetLabel}</h3>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          Reports go to CreatorJobs moderation. The other side isn’t told who reported.
        </p>
        <div className="mt-3 max-h-[300px] space-y-1 overflow-y-auto pr-1">
          {REASONS.map((reason) => {
            const active = category === reason.key;
            return (
              <button
                key={reason.key}
                type="button"
                data-testid={`report-reason-${reason.key}`}
                aria-pressed={active}
                onClick={() => setCategory(reason.key)}
                className={[
                  "flex w-full cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2 text-left transition-colors",
                  active
                    ? "border-white/30 bg-white/[0.07]"
                    : "border-white/[0.06] bg-white/[0.02] hover:border-white/[0.16]",
                ].join(" ")}
              >
                <span
                  className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${active ? "bg-white" : "bg-white/20"}`}
                  aria-hidden
                />
                <span className="min-w-0">
                  <span className={`block text-[12.5px] font-semibold ${active ? "text-white" : "text-white/75"}`}>
                    {reason.label}
                  </span>
                  <span className="block text-[10.5px] text-subtle">{reason.hint}</span>
                </span>
              </button>
            );
          })}
        </div>
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={2}
          maxLength={3000}
          data-testid="report-note"
          placeholder="Anything that helps us review (optional)…"
          className="mt-3 w-full resize-none rounded-lg border border-white/[0.1] bg-black/25 px-3 py-2.5 text-[12.5px] leading-relaxed text-white/85 placeholder:text-subtle transition-colors focus:border-white/25 focus:outline-none"
        />
        {error ? <p className="mt-2 text-[11px] text-rose-300/85">{error}</p> : null}
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 cursor-pointer items-center rounded-lg border border-white/15 bg-white/[0.04] px-3 text-[11px] font-semibold text-white/75 transition-colors hover:bg-white/[0.08]"
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="report-submit"
            disabled={!category || sending}
            onClick={() => category && onSubmit(category, note.trim() || null)}
            className="inline-flex h-8 cursor-pointer items-center rounded-lg bg-white px-3.5 text-[11px] font-semibold text-black transition-colors hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {sending ? "Sending…" : "Send report"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
