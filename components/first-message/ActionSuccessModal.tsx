"use client";

import React from "react";
import { createPortal } from "react-dom";

import { Icon } from "../Icons";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/**
 * Polished post-success confirmation for a sent application / hiring request. It
 * acknowledges the action and offers the two next steps the requester actually
 * wants: open the conversation it created, or keep browsing. Kept deliberately
 * short — the action already succeeded, so this never re-explains the form.
 */
export default function ActionSuccessModal({
  open,
  title,
  body,
  primaryLabel,
  secondaryLabel,
  onPrimary,
  onSecondary,
  onClose,
  testid = "action-success-modal",
}: {
  open: boolean;
  title: string;
  body: string;
  primaryLabel: string;
  secondaryLabel: string;
  /** Open the conversation the action created. */
  onPrimary: () => void;
  /** Dismiss without navigating ("keep browsing"). */
  onSecondary: () => void;
  onClose: () => void;
  testid?: string;
}) {
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const titleId = React.useId();
  const bodyId = React.useId();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => setMounted(true), []);

  // Lock background scroll, restore focus on close, and focus the primary action.
  React.useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => {
      panelRef.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    }, 40);
    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus?.();
    };
  }, [open]);

  if (!mounted || !open) return null;

  return createPortal(
    <div
      className="ui-modal-backdrop fixed inset-0 z-[70] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center sm:px-4 sm:py-6"
      role="presentation"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
          return;
        }
        if (event.key !== "Tab") return;
        const focusables = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) || []);
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }}
    >
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label={`Close ${title}`}
        onClick={onClose}
      />
      <section
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        data-testid={testid}
        className="ui-modal-panel relative flex max-h-[calc(100dvh-1rem)] w-full max-w-sm flex-col items-center gap-5 overflow-y-auto rounded-t-3xl border border-white/12 bg-[#18191d] px-6 pt-7 pb-[max(1.75rem,env(safe-area-inset-bottom))] text-center shadow-[0_30px_110px_-42px_rgba(0,0,0,1)] sm:rounded-3xl sm:pb-7"
      >
        <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-emerald-300/25 bg-emerald-300/10 text-emerald-200">
          <Icon name="check" className="h-6 w-6" />
        </span>
        <div className="space-y-1.5">
          <h2 id={titleId} className="text-lg font-semibold tracking-tight text-white">
            {title}
          </h2>
          <p id={bodyId} className="text-sm leading-relaxed text-white/60">
            {body}
          </p>
        </div>
        <div className="flex w-full flex-col gap-2.5">
          <button
            type="button"
            data-autofocus
            onClick={onPrimary}
            data-testid="action-success-primary"
            className="inline-flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-black transition-colors hover:bg-white/90"
          >
            <Icon name="inbox" className="h-4 w-4" />
            {primaryLabel}
          </button>
          <button
            type="button"
            onClick={onSecondary}
            data-testid="action-success-secondary"
            className="inline-flex h-11 w-full cursor-pointer items-center justify-center rounded-xl border border-white/12 bg-white/[0.04] px-4 text-sm font-semibold text-white/80 transition-colors hover:bg-white/[0.08] hover:text-white"
          >
            {secondaryLabel}
          </button>
        </div>
      </section>
    </div>,
    document.body
  );
}
