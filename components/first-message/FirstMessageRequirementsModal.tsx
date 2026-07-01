"use client";

import React from "react";
import { createPortal } from "react-dom";

import {
  FirstMessageAnswers,
  RequirementContext,
} from "../../lib/firstMessageRequirements";
import { Icon } from "../Icons";
import FirstMessageFields, { PortfolioState } from "./FirstMessageFields";

export type FirstMessageSubmitState = "idle" | "saving" | "sent" | "error";

type ContextCopy = {
  title: string;
  subtitle: string;
  primary: string;
  /** Stable hook for the modal shell in tests. */
  testid: string;
  /** Hook for the structured fields region (reused by detail e2e selectors). */
  fieldsTestId: string;
};

const COPY: Record<RequirementContext, ContextCopy> = {
  job: {
    title: "Complete your opening message",
    subtitle: "This listing asks for a few details before you apply.",
    primary: "Send application",
    testid: "first-message-modal-job",
    fieldsTestId: "job-apply-requirements",
  },
  talent: {
    title: "Complete your hiring request",
    subtitle: "This talent listing asks for a few details before you reach out.",
    primary: "Send hiring request",
    testid: "first-message-modal-talent",
    fieldsTestId: "talent-request-requirements",
  },
};

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/**
 * Polished completion modal for an owner's first-message requirements. It wraps the
 * shared {@link FirstMessageFields} renderer so the same structured inputs, empty
 * states, and validation drive every context. The modal is the submission step:
 * the actual apply / hire request only fires from {@link onSubmit} once the answers
 * are complete, so closing it (Cancel, backdrop, or Escape) creates nothing.
 */
export default function FirstMessageRequirementsModal({
  open,
  context,
  requirementKeys,
  answers,
  onAnswersChange,
  errors = {},
  portfolio,
  requirementPrompts,
  onSubmit,
  onClose,
  submitState,
  submitError = null,
}: {
  open: boolean;
  context: RequirementContext;
  requirementKeys: string[];
  answers: FirstMessageAnswers;
  onAnswersChange: (next: FirstMessageAnswers) => void;
  errors?: Record<string, string>;
  portfolio?: PortfolioState;
  requirementPrompts?: Record<string, string>;
  onSubmit: () => void;
  onClose: () => void;
  submitState: FirstMessageSubmitState;
  submitError?: string | null;
}) {
  const copy = COPY[context];
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const titleId = React.useId();
  const subtitleId = React.useId();
  const [mounted, setMounted] = React.useState(false);
  const busy = submitState === "saving";

  React.useEffect(() => setMounted(true), []);

  // Lock background scroll, restore focus on close, and move focus into the modal.
  React.useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusTimer = window.setTimeout(() => {
      const panel = panelRef.current;
      if (!panel) return;
      const firstField = panel.querySelector<HTMLElement>(
        "[data-requirement-key] input, [data-requirement-key] textarea, [data-requirement-key] select, [data-requirement-key] button"
      );
      (firstField ?? panel.querySelector<HTMLElement>(FOCUSABLE_SELECTOR))?.focus();
    }, 40);

    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus?.();
    };
  }, [open]);

  // After a failed submit, guide the requester to the first field that needs work
  // (calm, no big error panel). Errors clear as soon as they edit, so this never
  // steals focus mid-typing.
  React.useEffect(() => {
    if (!open) return;
    const firstErroredKey = requirementKeys.find((key) => errors[key]);
    if (!firstErroredKey) return;
    const panel = panelRef.current;
    if (!panel) return;
    const target = panel.querySelector<HTMLElement>(
      `[data-requirement-key="${firstErroredKey}"] input, [data-requirement-key="${firstErroredKey}"] textarea, [data-requirement-key="${firstErroredKey}"] select, [data-requirement-key="${firstErroredKey}"] button`
    );
    target?.focus();
    target?.scrollIntoView?.({ block: "center", behavior: "smooth" });
  }, [errors, open, requirementKeys]);

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      if (!busy) onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusables = Array.from(
      panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
    ).filter((el) => el.offsetParent !== null || el === document.activeElement);
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
  };

  if (!mounted || !open) return null;

  return createPortal(
    <div
      className="ui-modal-backdrop fixed inset-0 z-[60] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center sm:px-4 sm:py-6"
      role="presentation"
    >
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label={`Close ${copy.title}`}
        onClick={() => {
          if (!busy) onClose();
        }}
      />
      <section
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={subtitleId}
        data-testid={copy.testid}
        onKeyDown={handleKeyDown}
        className="ui-modal-panel relative flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-t-3xl border border-white/12 bg-[#18191d] shadow-[0_30px_110px_-42px_rgba(0,0,0,1)] sm:max-h-[88vh] sm:rounded-3xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-white/[0.07] px-5 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-lg font-semibold tracking-tight text-white">
              {copy.title}
            </h2>
            <p id={subtitleId} className="mt-1 text-sm leading-relaxed text-white/58">
              {copy.subtitle}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-white/12 bg-white/[0.04] text-white/70 transition-colors hover:bg-white/[0.08] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Close"
          >
            <Icon name="x" className="h-4 w-4" />
          </button>
        </header>

        <div className="overflow-y-auto px-5 py-5" data-testid={copy.fieldsTestId}>
          <FirstMessageFields
            context={context}
            requirementKeys={requirementKeys}
            answers={answers}
            onChange={onAnswersChange}
            errors={errors}
            portfolio={portfolio}
            requirementPrompts={requirementPrompts}
          />
          {submitState === "error" ? (
            <p className="mt-4 rounded-xl border border-amber-200/20 bg-amber-200/10 px-3 py-2 text-xs text-amber-100">
              {submitError || "Couldn’t send right now. Try again."}
            </p>
          ) : null}
        </div>

        <footer className="flex items-center gap-3 border-t border-white/[0.07] px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="inline-flex h-11 flex-1 cursor-pointer items-center justify-center rounded-xl border border-white/12 bg-white/[0.04] text-sm font-semibold text-white/80 transition-colors hover:bg-white/[0.08] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={busy || submitState === "sent"}
            data-testid="first-message-modal-submit"
            className="inline-flex h-11 flex-[1.4] cursor-pointer items-center justify-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-black transition-colors hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-70"
          >
            <Icon name="send" className="h-4 w-4" />
            {busy ? "Sending…" : submitState === "sent" ? "Sent" : copy.primary}
          </button>
        </footer>
      </section>
    </div>,
    document.body
  );
}
