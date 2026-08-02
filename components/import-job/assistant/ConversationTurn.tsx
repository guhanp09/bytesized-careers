"use client";

import * as React from "react";

import { importFieldLabel } from "../../../lib/importedDraftGuidance.ts";
import {
  answerOptionsFor,
  questionPhraseFor,
} from "../../../lib/jobImportAnswerOptions.ts";
import { contextualGuidance } from "../../../lib/jobImportRoleGuidance.ts";
import type { JobImportActiveQuestion } from "../../../lib/jobImportReadiness.ts";

/**
 * One post-extraction question, asked in the assistant canvas.
 *
 * Extraction finishing does not end the conversation: the assistant asks
 * everything it identified here, one at a time, before the recruiter is handed
 * to the ordinary editor. Copy comes from the role-aware guidance already built
 * for Post Job, so an editor is asked about footage and a strategist about
 * analytics — the same voice on both sides of the handoff.
 */

/**
 * Fields the native model stores as lists.
 *
 * A single typed line is one entry, not a string — sending the raw text would
 * fail validation and stall the conversation on a question the recruiter has
 * already answered.
 */
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

const optionButton =
  "ui-press min-h-11 cursor-pointer rounded-xl border px-4 py-3 text-left text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50";

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

export type ConversationTurnProps = {
  question: JobImportActiveQuestion;
  jobTitle: string | null;
  roleName: string | null;
  sourceLabel: string;
  busy: boolean;
  essentialRemaining: number;
  onAnswer: (fieldPath: string, value: string | string[] | number) => void;
  onSkip: () => void;
  onSkipRemaining: () => void;
};

export function ConversationTurn({
  question,
  jobTitle,
  roleName,
  sourceLabel,
  busy,
  essentialRemaining,
  onAnswer,
  onSkip,
  onSkipRemaining,
}: ConversationTurnProps) {
  const [text, setText] = React.useState("");
  // Registry labels carry editor-side qualifiers — "(free text)", "(legacy)" —
  // that are useful beside a form control and wrong inside a spoken question.
  const label = importFieldLabel(question.field_path)
    .replace(/\s*\([^)]*\)\s*$/, "")
    .trim();
  const optional = question.kind === "optional";
  // Offer the likely answers wherever the field has them. An empty text box
  // hands the thinking back to the recruiter for a decision the product
  // already knows the shape of.
  const choices = answerOptionsFor(question.field_path, { jobTitle, roleName });

  // Reuse the role-aware copy rather than writing a second voice for the canvas.
  const guidance = contextualGuidance(groupFor(question.field_path), {
    jobTitle,
    roleName,
    sourceLabel,
    omitted: true,
    conflicted: false,
  });

  // Field-specific phrasing first: templating a form label into a sentence
  // produced questions like "What should earlier start window be?".
  const phrase = questionPhraseFor(question.field_path);
  const heading =
    question.explanation && question.kind === "confirmation"
      ? "One thing to confirm"
      : (phrase?.heading ?? guidance?.heading ?? `What should ${label.toLowerCase()} be?`);
  // The label leaks into the fallback too — "did not make earlier start window
  // clear" — so a field with its own phrasing describes the gap without it.
  const explanation =
    question.explanation ??
    guidance?.explanation ??
    (phrase
      ? `${sourceLabel} did not settle this, and it is not something to guess at on a candidate's behalf.`
      : `${sourceLabel} did not make ${label.toLowerCase()} clear, and candidates use it to judge whether this role suits them.`);
  const prompt =
    phrase?.prompt ??
    guidance?.question ??
    `What should candidates see for ${label.toLowerCase()}?`;

  return (
    <div className="ui-rise" data-testid="conversation-turn" data-kind={question.kind}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/38">
        {optional
          ? "Optional improvement"
          : essentialRemaining > 1
            ? `${essentialRemaining} decisions left`
            : "Last decision"}
      </p>
      <h2
        id="draft-assistant-heading"
        className="mt-2 text-xl font-semibold text-white"
        data-field={question.field_path}
      >
        {heading}
      </h2>
      <p className="mt-2 text-sm leading-6 text-white/55">{explanation}</p>
      <p className="mt-1.5 text-[13px] leading-5 text-white/40">{prompt}</p>

      {question.alternatives?.length ? (
        <div className="mt-4 space-y-2" data-testid="conversation-alternatives">
          {question.alternatives.map((alternative, index) => {
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
                className={`${optionButton} w-full ${
                  recommended
                    ? "border-white/30 bg-white/12 text-white"
                    : "border-white/12 bg-white/6 text-white hover:bg-white/10"
                }`}
              >
                <span className="block">{value}</span>
                {recommended ? (
                  <span className="mt-1 block text-[11px] font-normal text-white/60">
                    Matches the title
                  </span>
                ) : null}
                {alternative.evidence[0] ? (
                  <span className="mt-1 block text-[11px] font-normal italic leading-4 text-white/45">
                    &ldquo;{alternative.evidence[0]}&rdquo;
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}

      {question.suggested_value !== undefined ? (
        <button
          type="button"
          disabled={busy}
          data-testid="conversation-accept-suggestion"
          onClick={() => onAnswer(question.field_path, String(question.suggested_value))}
          className={`${optionButton} mt-4 w-full border-white/25 bg-white/10 text-white hover:bg-white/14`}
        >
          Yes, use {String(question.suggested_value)}
        </button>
      ) : null}

      {question.alternatives?.length ? null : choices.length ? (
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {choices.map((choice) => (
            <button
              key={choice.value}
              type="button"
              disabled={busy}
              data-testid={`conversation-option-${choice.value}`}
              onClick={() => onAnswer(question.field_path, choice.value)}
              className={`${optionButton} border-white/12 bg-white/6 text-white hover:bg-white/10`}
            >
              <span className="block">{choice.label}</span>
              {choice.detail ? (
                <span className="mt-1 block text-[11px] font-normal leading-4 text-white/50">
                  {choice.detail}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      ) : question.alternatives?.length ? null : (
        <form
          className="mt-4 flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (text.trim()) {
              onAnswer(question.field_path, shapeAnswer(question.field_path, text.trim()));
            }
          }}
        >
          <input
            inputMode={NUMBER_FIELDS.has(question.field_path) ? "numeric" : "text"}
            value={text}
            onChange={(event) => setText(event.target.value)}
            disabled={busy}
            aria-label={prompt}
            data-testid="conversation-text-answer"
            className="h-11 min-w-0 flex-1 rounded-xl border border-white/10 bg-white/6 px-3 text-sm text-white outline-none transition-colors placeholder:text-white/35 focus:border-white/25"
            placeholder={label}
          />
          <button
            type="submit"
            disabled={busy || !text.trim()}
            data-testid="conversation-submit"
            className="ui-press min-h-11 shrink-0 cursor-pointer rounded-xl bg-white px-4 text-sm font-semibold text-black transition-colors hover:bg-white/90 disabled:cursor-not-allowed disabled:bg-white/15 disabled:text-white/40"
          >
            Save
          </button>
        </form>
      )}

      {optional ? (
        <div className="mt-3 flex flex-wrap gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={onSkip}
            data-testid="conversation-skip"
            className="ui-press min-h-11 cursor-pointer text-xs font-semibold text-white/45 transition-colors hover:text-white/80"
          >
            Not now
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onSkipRemaining}
            data-testid="conversation-skip-remaining"
            className="ui-press min-h-11 cursor-pointer text-xs font-semibold text-white/45 transition-colors hover:text-white/80"
          >
            Skip remaining suggestions
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** Map a field to the guidance group that owns its role-aware copy. */
function groupFor(fieldPath: string): string {
  if (fieldPath.startsWith("budget") || fieldPath === "compensation_mode") return "compensation";
  if (fieldPath.startsWith("trial")) return "trial";
  if (fieldPath === "work_mode" || fieldPath === "location") return "work-arrangement";
  if (fieldPath.startsWith("application") || fieldPath === "external_apply_url") return "application";
  if (fieldPath === "deliverables") return "deliverables";
  if (fieldPath === "source_inputs") return "source-inputs";
  if (fieldPath.startsWith("revision")) return "revisions";
  if (fieldPath.startsWith("turnaround")) return "turnaround";
  if (fieldPath === "creative_autonomy") return "creative-autonomy";
  if (fieldPath === "hiring_process") return "hiring-process";
  if (fieldPath === "reference_videos") return "references";
  return `field:${fieldPath}`;
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
    <div className="ui-rise" data-testid="conversation-complete">
      <h2 id="draft-assistant-heading" className="text-xl font-semibold text-white">
        Your draft is ready
      </h2>
      <p className="mt-2 text-sm leading-6 text-white/55">
        {manual
          ? "I saved everything you decided. You can finish the rest in the ordinary editor."
          : `I added the details from ${sourceLabel} and used your answers where only you could decide.`}
      </p>
      <p className="mt-1.5 text-[13px] leading-5 text-white/40">
        {filledCount > 0 ? `${filledCount} details are in place. ` : ""}
        This stays a private draft until you publish it yourself.
      </p>
      <button
        type="button"
        onClick={onOpenDraft}
        disabled={busy}
        data-testid="conversation-open-draft"
        className="ui-press mt-4 min-h-11 cursor-pointer rounded-xl bg-white px-5 text-sm font-semibold text-black transition-colors hover:bg-white/90 disabled:cursor-not-allowed disabled:bg-white/15"
      >
        Open job draft
      </button>
    </div>
  );
}
