"use client";

import React from "react";
import { createPortal } from "react-dom";

import {
  FirstMessageAnswers,
  RequirementContext,
} from "../../lib/firstMessageRequirements";
import type { JobScreeningQuestion } from "../../lib/jobContract";
import { applicationRequirementLabel } from "../../lib/jobPresentation";
import {
  SCREENING_RESPONSE_MAX_LENGTH,
  type ScreeningAnswerState,
} from "../../lib/jobApplication";
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
  screeningQuestions = [],
  screeningAnswers = {},
  onScreeningAnswersChange,
  unknownRequirementKeys = [],
  preflightNotice = null,
  currencyCode = null,
}: {
  open: boolean;
  context: RequirementContext;
  requirementKeys: string[];
  answers: FirstMessageAnswers;
  onAnswersChange: (
    next: FirstMessageAnswers | ((previous: FirstMessageAnswers) => FirstMessageAnswers)
  ) => void;
  errors?: Record<string, string>;
  portfolio?: PortfolioState;
  requirementPrompts?: Record<string, string>;
  onSubmit: () => void;
  onClose: () => void;
  submitState: FirstMessageSubmitState;
  submitError?: string | null;
  screeningQuestions?: JobScreeningQuestion[];
  screeningAnswers?: ScreeningAnswerState;
  onScreeningAnswersChange?: (next: ScreeningAnswerState) => void;
  unknownRequirementKeys?: string[];
  preflightNotice?: string | null;
  currencyCode?: string | null;
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
    const firstErroredKey = [...requirementKeys, ...unknownRequirementKeys, ...screeningQuestions.map((_, index) => `screening-question-${index}`)]
      .find((key) => errors[key]);
    if (!firstErroredKey) return;
    const panel = panelRef.current;
    if (!panel) return;
    const field = Array.from(
      panel.querySelectorAll<HTMLElement>("[data-requirement-key]"),
    ).find((element) => element.dataset.requirementKey === firstErroredKey);
    const target = field?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    target?.focus();
    target?.scrollIntoView?.({ block: "center", behavior: "smooth" });
  }, [errors, open, requirementKeys, screeningQuestions, unknownRequirementKeys]);

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
        className="ui-modal-panel relative flex max-h-[92dvh] w-full max-w-xl flex-col overflow-hidden rounded-t-3xl border border-white/12 bg-[#18191d] shadow-[0_30px_110px_-42px_rgba(0,0,0,1)] sm:max-h-[88dvh] sm:rounded-3xl"
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

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5" data-testid={copy.fieldsTestId}>
          {context === "job" && (preflightNotice || requirementKeys.length || unknownRequirementKeys.length || screeningQuestions.length) ? (
            <section className="mb-5 rounded-2xl border border-white/[0.08] bg-white/[0.025] px-4 py-3.5" aria-label="Application overview">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-subtle">Before you apply</p>
              {preflightNotice ? <p className="mt-2 text-sm leading-relaxed text-white/72">{preflightNotice}</p> : null}
              <p className="mt-2 text-xs leading-relaxed text-muted">
                {requirementKeys.length + unknownRequirementKeys.length
                  ? `${requirementKeys.length + unknownRequirementKeys.length} requested detail${requirementKeys.length + unknownRequirementKeys.length === 1 ? "" : "s"}`
                  : "No additional details requested"}
                {screeningQuestions.length
                  ? ` · ${screeningQuestions.length} screening question${screeningQuestions.length === 1 ? "" : "s"}`
                  : ""}
              </p>
            </section>
          ) : null}
          <FirstMessageFields
            context={context}
            requirementKeys={requirementKeys}
            answers={answers}
            onChange={onAnswersChange}
            errors={errors}
            portfolio={portfolio}
            requirementPrompts={requirementPrompts}
            currencyCode={currencyCode}
          />
          {unknownRequirementKeys.length ? (
            <div className={`${requirementKeys.length ? "mt-5 border-t border-white/[0.07] pt-5" : ""} space-y-4`}>
              <h3 className="text-xs font-semibold text-white/82">Additional requested details</h3>
              {unknownRequirementKeys.map((key) => {
                const id = `legacy-requirement-${key.replace(/[^a-z0-9]+/gi, "-")}`;
                const errorId = `${id}-error`;
                const error = errors[key];
                return (
                  <div key={key} className="space-y-1.5" data-requirement-key={key}>
                    <label htmlFor={id} className="block text-xs font-semibold text-white/82">
                      {applicationRequirementLabel(key)}
                    </label>
                    <textarea
                      id={id}
                      required
                      value={typeof answers[key] === "string" ? answers[key] : ""}
                      onChange={(event) => onAnswersChange((previous) => ({ ...previous, [key]: event.target.value }))}
                      aria-invalid={Boolean(error)}
                      aria-describedby={error ? errorId : undefined}
                      className={[
                        "min-h-[96px] w-full rounded-xl border bg-white/6 px-3 py-2.5 text-sm text-white outline-none transition-colors placeholder:text-subtle focus:bg-white/7",
                        error ? "border-amber-200/40 focus:border-amber-200/50" : "border-white/10 focus:border-white/25",
                      ].join(" ")}
                      placeholder="Add the requested detail"
                    />
                    {error ? <p id={errorId} role="alert" className="text-[11px] text-amber-200/90">{error}</p> : null}
                  </div>
                );
              })}
            </div>
          ) : null}
          {screeningQuestions.length ? (
            <fieldset className={`${requirementKeys.length || unknownRequirementKeys.length ? "mt-5 border-t border-white/[0.07] pt-5" : ""} space-y-4`}>
              <legend className="text-xs font-semibold text-white/82">Screening questions</legend>
              {screeningQuestions.map((question, index) => {
                const key = `screening-question-${index}`;
                const id = `${key}-answer`;
                const errorId = `${key}-error`;
                const hintId = `${key}-hint`;
                const error = errors[key];
                return (
                  <div key={`${question.prompt}-${index}`} className="space-y-1.5" data-requirement-key={key}>
                    <label htmlFor={id} className="block text-sm font-medium leading-relaxed text-white/86">
                      {question.prompt}
                      <span className="ml-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-subtle">
                        {question.required ? "Required" : "Optional"}
                      </span>
                    </label>
                    {question.response_guidance ? (
                      <p id={hintId} className="text-xs leading-relaxed text-muted">{question.response_guidance}</p>
                    ) : null}
                    <textarea
                      id={id}
                      required={question.required}
                      maxLength={SCREENING_RESPONSE_MAX_LENGTH}
                      value={screeningAnswers[index] || ""}
                      onChange={(event) => onScreeningAnswersChange?.({ ...screeningAnswers, [index]: event.target.value })}
                      aria-invalid={Boolean(error)}
                      aria-describedby={[question.response_guidance ? hintId : "", error ? errorId : ""].filter(Boolean).join(" ") || undefined}
                      className={[
                        "min-h-[108px] w-full rounded-xl border bg-white/6 px-3 py-2.5 text-sm text-white outline-none transition-colors placeholder:text-subtle focus:bg-white/7",
                        error ? "border-amber-200/40 focus:border-amber-200/50" : "border-white/10 focus:border-white/25",
                      ].join(" ")}
                      placeholder="Write your answer"
                    />
                    {error ? <p id={errorId} role="alert" className="text-[11px] text-amber-200/90">{error}</p> : null}
                  </div>
                );
              })}
            </fieldset>
          ) : null}
          {submitState === "error" ? (
            <p role="alert" aria-live="assertive" className="mt-4 rounded-xl border border-amber-200/20 bg-amber-200/10 px-3 py-2 text-xs text-amber-100">
              {submitError || "Couldn’t send right now. Try again."}
            </p>
          ) : null}
        </div>

        <footer className="flex items-center gap-3 border-t border-white/[0.07] px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
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
