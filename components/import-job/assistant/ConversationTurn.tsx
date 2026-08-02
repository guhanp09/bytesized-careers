"use client";

import * as React from "react";

import { importFieldLabel } from "../../../lib/importedDraftGuidance.ts";
import {
  answerOptionsFor,
  questionPhraseFor,
} from "../../../lib/jobImportAnswerOptions.ts";
import type { JobImportActiveQuestion } from "../../../lib/jobImportReadiness.ts";
import { DraftAssistantRobot } from "./DraftAssistantRobot.tsx";

/**
 * The conversation itself: a transcript, not a form with a mascot on it.
 *
 * The shape follows what conversational products settled on long ago — a
 * stream of short assistant messages, the recruiter's replies on the opposite
 * side, and the control for the current question directly under the message
 * that asked it. Everything already decided stays visible but recedes, so the
 * page reads as a conversation with history rather than a wizard that forgets.
 *
 * Deliberately absent: a count of decisions left. The assistant is reading a
 * job post and stopping when it needs something; a countdown turns that into a
 * questionnaire the recruiter is being marched through.
 */

/** Fields the native model stores as lists. */
const LIST_FIELDS: ReadonlySet<string> = new Set([
  "requirements",
  "responsibilities",
  "platforms",
  "tags",
  "content_niches",
  "content_genres",
  "formats_hired_for",
  "tools",
  "application_requirements",
  "other_required_skills",
  "other_preferred_skills",
]);

/** Fields the native model stores as numbers. */
const NUMBER_FIELDS: ReadonlySet<string> = new Set([
  "budget_amount",
  "budget_max",
  "expected_weekly_hours_min",
  "expected_weekly_hours_max",
  "turnaround_value",
  "revision_rounds",
  "duration_value",
  "trial_effort_value",
  "trial_compensation_amount",
]);

/**
 * Shape a typed answer for the field it belongs to.
 *
 * A number field given a string, or a list field given a bare line, fails
 * validation and leaves the recruiter staring at a question they just answered.
 */
export function shapeAnswer(
  fieldPath: string,
  text: string
): string | string[] | number {
  if (NUMBER_FIELDS.has(fieldPath)) {
    const parsed = Number(text.replace(/[^0-9.-]/g, ""));
    return Number.isFinite(parsed) ? parsed : text;
  }
  return LIST_FIELDS.has(fieldPath) ? [text] : text;
}

const optionButton =
  "ui-press w-full cursor-pointer rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-3 text-left text-sm text-white transition-colors hover:border-white/20 hover:bg-white/[0.09] disabled:cursor-not-allowed disabled:opacity-50";

// ---------------------------------------------------------------------------
// Message primitives
// ---------------------------------------------------------------------------

/** An assistant message. The avatar appears once per run, as in any chat. */
export function AssistantMessage({
  children,
  showAvatar = true,
  muted = false,
}: {
  children: React.ReactNode;
  showAvatar?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="hidden w-8 shrink-0 sm:block">
        {showAvatar ? (
          <DraftAssistantRobot state="asking" size={32} className="mt-0.5" />
        ) : null}
      </div>
      <div
        className={[
          "min-w-0 flex-1 rounded-2xl rounded-tl-md px-4 py-3",
          muted ? "bg-white/[0.035] text-white/55" : "bg-white/[0.06] text-white/85",
        ].join(" ")}
      >
        {children}
      </div>
    </div>
  );
}

/** The recruiter's own reply, mirrored to the opposite side. */
export function RecruiterReply({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex justify-end pl-6 sm:pl-11">
      <div
        className="max-w-[85%] rounded-2xl rounded-br-md bg-[color:var(--color-state-review,#8ec5ff)]/15 px-4 py-2.5 text-sm text-white/90"
        data-testid="conversation-reply"
      >
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The active question
// ---------------------------------------------------------------------------

export type ConversationTurnProps = {
  question: JobImportActiveQuestion;
  jobTitle: string | null;
  roleName: string | null;
  sourceLabel: string;
  busy: boolean;
  /** A rejected answer, shown under the control that produced it. */
  error?: string | null;
  onAnswer: (fieldPath: string, value: string | string[] | number) => void;
  onSkip: () => void;
  onSkipRemaining: () => void;
};

export function ConversationTurn({
  question,
  jobTitle,
  roleName,
  busy,
  error = null,
  onAnswer,
  onSkip,
  onSkipRemaining,
}: ConversationTurnProps) {
  const [text, setText] = React.useState("");
  const label = importFieldLabel(question.field_path)
    .replace(/\s*\([^)]*\)\s*$/, "")
    .trim();
  const optional = question.kind === "optional";
  const choices = answerOptionsFor(question.field_path, { jobTitle, roleName });
  const phrase = questionPhraseFor(question.field_path);
  const alternatives = question.alternatives ?? [];

  const heading = phrase?.heading ?? `What should ${label.toLowerCase()} be?`;
  const why =
    question.explanation ??
    whyItMatters(phrase?.prompt, roleName, jobTitle);

  const submit = () => {
    if (!text.trim() || busy) return;
    onAnswer(question.field_path, shapeAnswer(question.field_path, text.trim()));
  };

  return (
    <div className="space-y-3" data-testid="conversation-turn" data-kind={question.kind}>
      <AssistantMessage>
        <p
          className="text-[15px] font-semibold leading-6 text-white"
          data-field={question.field_path}
        >
          {heading}
        </p>
        <p className="mt-1.5 text-[13px] leading-5 text-white/55">{why}</p>
      </AssistantMessage>

      <div className="pl-0 sm:pl-11">
        {alternatives.length ? (
          <div className="space-y-2" data-testid="conversation-alternatives">
            <p className="mb-1 text-[11px] text-white/40">
              Your post mentions both — which should candidates see?
            </p>
            {alternatives.map((alternative, index) => {
              const value = String(alternative.value ?? "");
              const recommended =
                question.recommended_value !== undefined &&
                String(question.recommended_value) === value;
              return (
                <button
                  key={`${value}-${index}`}
                  type="button"
                  disabled={busy}
                  data-testid={`conversation-alternative-${index}`}
                  onClick={() => onAnswer(question.field_path, value)}
                  className={`${optionButton} ${
                    recommended ? "border-white/25 bg-white/[0.09]" : ""
                  }`}
                >
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="font-medium">{value}</span>
                    {recommended ? (
                      <span className="shrink-0 text-[11px] text-[color:var(--color-state-review,#8ec5ff)]">
                        matches your title
                      </span>
                    ) : null}
                  </span>
                  {alternative.evidence[0] ? (
                    <span className="mt-1 block text-[11px] italic leading-4 text-white/40">
                      &ldquo;{alternative.evidence[0]}&rdquo;
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        ) : question.suggested_value !== undefined ? (
          <button
            type="button"
            disabled={busy}
            data-testid="conversation-accept-suggestion"
            onClick={() => onAnswer(question.field_path, String(question.suggested_value))}
            className={`${optionButton} border-white/25 bg-white/[0.09]`}
          >
            Yes, use {String(question.suggested_value)}
          </button>
        ) : choices.length ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {choices.map((choice) => (
              <button
                key={choice.value}
                type="button"
                disabled={busy}
                data-testid={`conversation-option-${choice.value}`}
                onClick={() => onAnswer(question.field_path, choice.value)}
                className={optionButton}
              >
                <span className="block font-medium">{choice.label}</span>
                {choice.detail ? (
                  <span className="mt-0.5 block text-[11px] leading-4 text-white/45">
                    {choice.detail}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        ) : (
          <div className="flex items-end gap-2">
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  submit();
                }
              }}
              rows={2}
              disabled={busy}
              aria-label={heading}
              data-testid="conversation-text-answer"
              inputMode={NUMBER_FIELDS.has(question.field_path) ? "numeric" : "text"}
              className="min-h-[52px] w-full resize-none rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-3 text-sm leading-5 text-white outline-none transition-colors placeholder:text-white/30 focus:border-white/25"
              placeholder="Type your answer…"
            />
            <button
              type="button"
              onClick={submit}
              disabled={busy || !text.trim()}
              data-testid="conversation-submit"
              className="ui-press mb-0.5 h-11 shrink-0 cursor-pointer rounded-xl bg-white px-4 text-sm font-semibold text-black transition-colors hover:bg-white/90 disabled:cursor-not-allowed disabled:bg-white/12 disabled:text-white/35"
            >
              Send
            </button>
          </div>
        )}

        {/* A rejected answer has to appear where it was typed. Storing the
            reason and rendering nothing is what made Save look inert. */}
        {error ? (
          <p
            className="mt-2 text-[12px] leading-4 text-[color:var(--color-state-closed,#f39aa6)]"
            role="alert"
            data-testid="conversation-error"
          >
            {error}
          </p>
        ) : null}

        {optional ? (
          <div className="mt-2 flex flex-wrap gap-4">
            <button
              type="button"
              disabled={busy}
              onClick={onSkip}
              data-testid="conversation-skip"
              className="cursor-pointer text-[12px] text-white/40 transition-colors hover:text-white/75"
            >
              Not now
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={onSkipRemaining}
              data-testid="conversation-skip-remaining"
              className="cursor-pointer text-[12px] text-white/40 transition-colors hover:text-white/75"
            >
              Skip suggestions
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Why this question matters, for this job.
 *
 * Phrased as what the answer does for candidates, never as what the source
 * failed to contain. "Your post did not settle this" tells recruiters their
 * writing was deficient; "editors use this to judge the workload" tells them
 * why thirty seconds here is worth spending.
 */
function whyItMatters(
  prompt: string | undefined,
  roleName: string | null,
  jobTitle: string | null
): string {
  if (prompt) return prompt;
  const subject = (roleName || jobTitle || "").trim();
  return subject
    ? `Candidates weighing up ${subject} use this to decide whether to apply.`
    : "Candidates use this to decide whether the role is right for them.";
}

/**
 * What Bea says when the conversation is genuinely finished.
 *
 * The handoff is an explicit action, not something that happens to the
 * recruiter: they see what was prepared and choose to open the draft.
 */
export function ConversationComplete({
  filledCount,
  sourceLabel,
  manual,
  onOpenDraft,
  busy,
}: {
  filledCount: number;
  sourceLabel: string;
  manual: boolean;
  onOpenDraft: () => void;
  busy: boolean;
}) {
  return (
    <div className="space-y-3" data-testid="conversation-complete">
      <AssistantMessage>
        <p className="text-[15px] font-semibold leading-6 text-white">
          Your draft is ready.
        </p>
        <p className="mt-1.5 text-[13px] leading-5 text-white/55">
          {manual
            ? "I saved everything you decided — you can finish the rest in the editor."
            : `I filled in what ${sourceLabel} covered and used your answers for the rest.`}
          {filledCount > 0 ? ` ${filledCount} details are in place.` : ""}
        </p>
      </AssistantMessage>
      <div className="pl-0 sm:pl-11">
        <button
          type="button"
          onClick={onOpenDraft}
          disabled={busy}
          data-testid="conversation-open-draft"
          className="ui-press min-h-11 cursor-pointer rounded-xl bg-white px-5 text-sm font-semibold text-black transition-colors hover:bg-white/90 disabled:cursor-not-allowed disabled:bg-white/15"
        >
          Open job draft
        </button>
        <p className="mt-2 text-[11px] text-white/35">
          It stays private until you publish it yourself.
        </p>
      </div>
    </div>
  );
}
