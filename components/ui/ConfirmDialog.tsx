"use client";

import React from "react";
import { createPortal } from "react-dom";

/**
 * Small, reusable confirmation dialog for destructive owner actions (e.g. deleting
 * a listing). Portal-based so it escapes card/overflow-menu stacking contexts, and
 * dark-themed to match the marketplace surfaces. Replaces ad-hoc `window.confirm()`.
 */
export default function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const confirmRef = React.useRef<HTMLButtonElement | null>(null);

  React.useEffect(() => {
    if (!open) return;
    confirmRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onCancel]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <button
        type="button"
        aria-hidden="true"
        tabIndex={-1}
        className="absolute inset-0 cursor-default"
        onClick={() => {
          if (!busy) onCancel();
        }}
      />
      <div className="relative w-full max-w-sm rounded-2xl border border-white/[0.1] bg-[#15151b] p-5 shadow-[0_24px_60px_-30px_rgba(0,0,0,0.95)]">
        <h2 className="text-base font-semibold text-white">{title}</h2>
        {body ? <div className="mt-2 text-sm leading-6 text-white/60">{body}</div> : null}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-xl border border-white/[0.1] px-3.5 py-2 text-sm font-semibold text-white/75 transition hover:bg-white/[0.07] hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={[
              "rounded-xl px-3.5 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60",
              destructive
                ? "border border-rose-400/30 bg-rose-500/15 text-rose-100 hover:bg-rose-500/25"
                : "border border-white/[0.1] bg-white/[0.08] text-white hover:bg-white/[0.14]",
            ].join(" ")}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
