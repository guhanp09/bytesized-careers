"use client";

import React from "react";
import type {
  JobImportDraftContext,
  JobImportField,
} from "../../lib/jobImportReadiness";
import {
  conciseImportValue,
  jobImportGuidancePhase,
  nextJobImportGuidanceTurn,
  type JobImportGuidanceTurn,
} from "../../lib/jobImportConversation";
import { Icon } from "../Icons";

const sourceQuote = (snippet: string) => `“${snippet}”`;

function SourceEvidence({ turn }: { turn: JobImportGuidanceTurn }) {
  if (!turn.evidence.length) return null;
  return (
    <details className="group mt-4 text-xs text-white/54" data-testid="import-guidance-evidence">
      <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-xl px-2 font-semibold text-white/62 transition-colors hover:bg-white/[0.05] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 [&::-webkit-details-marker]:hidden">
        <Icon name="file" className="h-3.5 w-3.5" />
        What I found
        <span aria-hidden="true" className="transition-transform group-open:rotate-180 motion-reduce:transition-none">
          ⌄
        </span>
      </summary>
      <div className="mt-2 space-y-2 rounded-xl bg-black/20 px-3 py-3">
        {turn.evidence.map((evidence, index) => (
          <blockquote
            key={`${evidence.snippet}-${index}`}
            className="border-l border-white/14 pl-3 leading-5 text-white/52"
          >
            {sourceQuote(evidence.snippet)}
          </blockquote>
        ))}
      </div>
    </details>
  );
}

function AnswerHistory({
  turns,
  onSelect,
}: {
  turns: readonly JobImportGuidanceTurn[];
  onSelect: (turn: JobImportGuidanceTurn) => void;
}) {
  const resolved = turns.filter((turn) => turn.resolved && turn.resolutionLabel);
  if (!resolved.length) return null;
  return (
    <details className="mt-5 border-t border-white/[0.07] pt-4">
      <summary className="min-h-11 cursor-pointer rounded-xl px-2 py-3 text-xs font-semibold text-white/52 hover:bg-white/[0.04] hover:text-white/76 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30">
        Your answers ({resolved.length})
      </summary>
      <ol className="mt-1 space-y-1" aria-label="Guided answers">
        {resolved.map((turn) => (
          <li key={turn.id} className="flex min-w-0 items-center justify-between gap-3 px-2 py-2">
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-white/68">{turn.heading}</p>
              <p className="mt-0.5 truncate text-xs text-white/40">{turn.resolutionLabel}</p>
            </div>
            <button
              type="button"
              onClick={() => onSelect(turn)}
              className="min-h-11 shrink-0 rounded-xl px-3 text-xs font-semibold text-white/52 transition-colors hover:bg-white/[0.05] hover:text-white"
            >
              Change
            </button>
          </li>
        ))}
      </ol>
    </details>
  );
}

export default function ImportedDraftConversation({
  context,
  turns,
  activeTurnId,
  filledCount,
  busy,
  actionError,
  announcement,
  canUseSuggestion,
  onSelectTurn,
  onJumpToField,
  onUseSuggestion,
  onResolveAlternative,
  onSkipTurn,
  onSkipRemaining,
  onUseFullEditor,
  onSaveForLater,
}: {
  context: JobImportDraftContext;
  turns: readonly JobImportGuidanceTurn[];
  activeTurnId: string | null;
  filledCount: number;
  busy: boolean;
  actionError: string | null;
  announcement: string;
  canUseSuggestion: (field: JobImportField) => boolean;
  onSelectTurn: (turn: JobImportGuidanceTurn, focusQuestion?: boolean) => void;
  onJumpToField: (turn: JobImportGuidanceTurn) => void;
  onUseSuggestion: (turn: JobImportGuidanceTurn, field: JobImportField) => void;
  onResolveAlternative: (
    turn: JobImportGuidanceTurn,
    field: JobImportField,
    alternativeIndex: number
  ) => void;
  onSkipTurn: (turn: JobImportGuidanceTurn) => void;
  onSkipRemaining: (turns: readonly JobImportGuidanceTurn[]) => void;
  onUseFullEditor: () => void;
  onSaveForLater: () => void;
}) {
  const phase = jobImportGuidancePhase(turns);
  const activeTurn =
    turns.find((turn) => turn.id === activeTurnId) ??
    nextJobImportGuidanceTurn(turns);
  const unresolvedEssential = turns.filter(
    (turn) => turn.phase === "essential" && !turn.resolved
  );
  const unresolvedQuality = turns.filter(
    (turn) => turn.phase === "quality" && !turn.resolved
  );
  const activeFields = activeTurn
    ? context.draft.fields.filter((field) => activeTurn.fieldPaths.includes(field.field_path))
    : [];
  const proposedField = activeFields.find(
    (field) =>
      field.review_status === "pending" &&
      field.provenance_state !== "missing" &&
      field.provenance_state !== "conflicting_source_values" &&
      field.validation_errors.length === 0 &&
      field.proposed_value !== null &&
      field.proposed_value !== undefined &&
      canUseSuggestion(field)
  );
  const conflictField = activeFields.find(
    (field) => field.provenance_state === "conflicting_source_values"
  );
  const progressText =
    phase === "essential"
      ? `${unresolvedEssential.length} essential decision${unresolvedEssential.length === 1 ? "" : "s"} left`
      : phase === "quality"
        ? "The essentials are complete"
        : "Guided decisions complete";

  if (phase === "complete" && !activeTurn) {
    return (
      <section
        className="rounded-3xl border border-white/10 bg-white/[0.045] p-5 sm:p-6"
        data-testid="conversational-import-guidance"
        aria-labelledby="import-guidance-title"
      >
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white/[0.08] text-white/70">
            <Icon name="check" className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/38">
              CreatorJobs Assistant
            </p>
            <h2 id="import-guidance-title" tabIndex={-1} className="mt-2 text-xl font-semibold tracking-tight text-white outline-none">
              Your draft is ready to edit.
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-white/58">
              I added {filledCount} useful details from {context.source_label} and saved your
              decisions. This is still a private draft; it will only be published after the normal
              Post Job review.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={onUseFullEditor}
                className="min-h-11 rounded-xl bg-white px-4 text-sm font-semibold text-black transition-colors hover:bg-white/90"
              >
                Continue editing the draft
              </button>
              {context.source_url ? (
                <a
                  href={context.source_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-semibold text-white/55 transition-colors hover:bg-white/[0.05] hover:text-white"
                >
                  View original source
                </a>
              ) : null}
            </div>
            <AnswerHistory turns={turns} onSelect={(turn) => onSelectTurn(turn, true)} />
          </div>
        </div>
      </section>
    );
  }

  if (!activeTurn) return null;

  const isReviewingResolvedTurn = activeTurn.resolved;
  const showNativeAnswer = !conflictField && !proposedField;

  return (
    <section
      className="min-h-[330px] rounded-3xl border border-white/10 bg-white/[0.045] p-5 sm:p-6"
      data-testid="conversational-import-guidance"
      aria-labelledby="import-guidance-question"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white/[0.08] text-white/66">
            <Icon name="file" className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/38">
              CreatorJobs Assistant
            </p>
            <p className="mt-1 truncate text-xs text-white/42">From {context.source_label}</p>
          </div>
        </div>
        <span className="rounded-full bg-white/[0.055] px-3 py-1.5 text-xs font-semibold text-white/52">
          {progressText}
        </span>
      </div>

      <p className="sr-only" aria-live="polite">
        {announcement || `${progressText}. ${activeTurn.heading}`}
      </p>

      <div className="mt-6 max-w-2xl">
        {phase === "essential" && turns.every((turn) => turn.resolved || turn.id === activeTurn.id) ? (
          <p className="mb-3 text-sm font-medium text-emerald-100/70">
            I’ve built a strong first draft with {filledCount} useful details from {context.source_label}. One decision still needs your expertise.
          </p>
        ) : phase === "essential" ? (
          <p className="mb-3 text-sm text-white/54">
            I’ve built a strong first draft with {filledCount} useful details from {context.source_label}. Let’s finish the few decisions only you can make.
          </p>
        ) : (
          <p className="mb-3 text-sm text-emerald-100/70">
            Your essential decisions are complete. This optional improvement could make the role clearer to strong candidates.
          </p>
        )}
        <h2
          id="import-guidance-question"
          tabIndex={-1}
          className="text-xl font-semibold tracking-tight text-white outline-none sm:text-2xl"
        >
          {activeTurn.heading}
        </h2>
        <p className="mt-3 text-sm leading-6 text-white/62">{activeTurn.explanation}</p>
        <p className="mt-3 text-sm font-semibold leading-6 text-white/82">{activeTurn.question}</p>
        <p className="mt-2 text-xs leading-5 text-white/42">{activeTurn.candidateImpact}</p>

        <SourceEvidence turn={activeTurn} />

        {conflictField ? (
          <fieldset className="mt-5">
            <legend className="text-xs font-semibold text-white/64">Choose the answer candidates should see</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {conflictField.conflicting_values.map((alternative, index) => (
                <button
                  key={`${conciseImportValue(alternative.value)}-${index}`}
                  type="button"
                  disabled={busy}
                  onClick={() => onResolveAlternative(activeTurn, conflictField, index)}
                  className="min-h-11 rounded-xl border border-white/12 bg-white/[0.045] px-3 py-3 text-left text-sm font-semibold text-white/78 transition-colors hover:bg-white/[0.08] hover:text-white disabled:cursor-wait disabled:opacity-50"
                >
                  {conciseImportValue(alternative.value)}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => onJumpToField(activeTurn)}
              className="mt-2 min-h-11 rounded-xl px-3 text-xs font-semibold text-white/50 transition-colors hover:bg-white/[0.05] hover:text-white"
            >
              Enter a different answer in the draft
            </button>
          </fieldset>
        ) : proposedField && !isReviewingResolvedTurn ? (
          <div className="mt-5 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => onUseSuggestion(activeTurn, proposedField)}
              className="min-h-11 rounded-xl bg-white px-4 text-sm font-semibold text-black transition-colors hover:bg-white/90 disabled:cursor-wait disabled:opacity-55"
            >
              Use {conciseImportValue(proposedField.proposed_value)}
            </button>
            <button
              type="button"
              onClick={() => onJumpToField(activeTurn)}
              className="min-h-11 rounded-xl border border-white/10 px-4 text-sm font-semibold text-white/62 transition-colors hover:bg-white/[0.05] hover:text-white"
            >
              Choose a different answer
            </button>
          </div>
        ) : showNativeAnswer ? (
          <div className="mt-5 flex items-start gap-3 rounded-2xl bg-black/20 px-4 py-3 text-sm text-white/58">
            <Icon name={isReviewingResolvedTurn ? "check" : "chevron-right"} className="mt-0.5 h-4 w-4 shrink-0 text-white/52" />
            <p className="leading-6">
              {isReviewingResolvedTurn
                ? `Your current answer is ${activeTurn.resolutionLabel || "saved in the draft"}. Use the field below to change it, or continue when it looks right.`
                : "Use the normal Post Job field directly below to answer. The candidate preview will update as you make your choice."}
            </p>
          </div>
        ) : null}

        {actionError ? (
          <p role="alert" className="mt-4 text-sm leading-6 text-amber-100/82">
            {actionError}
          </p>
        ) : null}

        <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-white/[0.07] pt-4">
          {activeTurn.canSkip && !activeTurn.resolved ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => onSkipTurn(activeTurn)}
              className="min-h-11 rounded-xl px-3 text-sm font-semibold text-white/52 transition-colors hover:bg-white/[0.05] hover:text-white disabled:opacity-50"
            >
              Not now
            </button>
          ) : null}
          {phase === "quality" && unresolvedQuality.length > 1 ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => onSkipRemaining(unresolvedQuality)}
              className="min-h-11 rounded-xl px-3 text-sm font-semibold text-white/46 transition-colors hover:bg-white/[0.05] hover:text-white disabled:opacity-50"
            >
              Skip remaining suggestions
            </button>
          ) : null}
          {activeTurn.canDecideLater && !activeTurn.resolved ? (
            <button
              type="button"
              onClick={onSaveForLater}
              className="min-h-11 rounded-xl px-3 text-sm font-semibold text-white/46 transition-colors hover:bg-white/[0.05] hover:text-white"
            >
              Save and finish later
            </button>
          ) : null}
          <button
            type="button"
            onClick={onUseFullEditor}
            className="ml-auto min-h-11 rounded-xl px-3 text-sm font-semibold text-white/52 transition-colors hover:bg-white/[0.05] hover:text-white"
          >
            Use the full editor
          </button>
        </div>
      </div>

      <AnswerHistory turns={turns} onSelect={(turn) => onSelectTurn(turn, true)} />
    </section>
  );
}
