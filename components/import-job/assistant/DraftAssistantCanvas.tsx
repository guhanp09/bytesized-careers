"use client";

import * as React from "react";

import {
  activeJobImportStage,
  jobImportDelayMessage,
  jobImportProgressRatio,
  jobImportStages,
  type JobImportProgressInput,
} from "../../../lib/jobImportProgress.ts";
import {
  earlyAnswerLabel,
  nextEarlyQuestion,
  type EarlyQuestion,
} from "../../../lib/jobImportEarlyQuestions.ts";
import type { JobImportSourceType } from "../../../lib/jobImportReadiness.ts";
import {
  DRAFT_ASSISTANT_STATE_LABELS,
  DraftAssistantRobot,
  type DraftAssistantState,
} from "./DraftAssistantRobot.tsx";

/**
 * The guided creation canvas.
 *
 * One stable surface for the whole preparation: the assistant and the current
 * decision on the left, the candidate preview rail on the right, a truthful
 * milestone bar across the top. It replaces the old three-stage loading screen,
 * and — critically — it is not a waiting screen at all: while extraction runs,
 * the recruiter can answer the questions only they can answer.
 *
 * Nothing here decides what is valid or required. Progress comes from
 * lib/jobImportProgress, eligibility from the server, and every answer is
 * persisted through the ordinary API before it appears in the history.
 */

const panel =
  "rounded-3xl bg-white/[0.06] border border-white/10 p-5 sm:p-6 shadow-[0_10px_30px_-20px_rgba(0,0,0,0.9)]";

const ghostButton =
  "ui-press min-h-11 cursor-pointer rounded-xl border border-white/12 bg-white/6 px-4 text-sm font-semibold text-white/80 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40";

export type DraftAssistantCanvasProps = {
  progress: JobImportProgressInput;
  sourceType: JobImportSourceType;
  sourceLabel: string;
  sourceCharacterCount: number | null;
  /** Field paths the server certified as safe to ask now. */
  earlyQuestionFields: readonly string[];
  /** Answers already recorded, keyed by field path. */
  earlyAnswers: Readonly<Record<string, unknown>>;
  onAnswerEarlyQuestion: (fieldPath: string, value: string) => Promise<void>;
  onCancel: (() => void) | null;
  busy?: boolean;
  error?: string | null;
  /**
   * True once the wait has actually been long. Reassurance about a slow run is
   * only truthful after the run has been slow, so the caller owns that timer and
   * this surface never guesses.
   */
  delayed?: boolean;
};

export function DraftAssistantCanvas({
  progress,
  sourceType,
  sourceLabel,
  sourceCharacterCount,
  earlyQuestionFields,
  earlyAnswers,
  onAnswerEarlyQuestion,
  onCancel,
  busy = false,
  error = null,
  delayed = false,
}: DraftAssistantCanvasProps) {
  const stages = jobImportStages(progress);
  const active = activeJobImportStage(progress);
  const ratio = jobImportProgressRatio(progress);
  const question = nextEarlyQuestion(earlyQuestionFields, earlyAnswers, sourceType);
  const [acknowledging, setAcknowledging] = React.useState(false);
  const [pendingValue, setPendingValue] = React.useState<string | null>(null);

  const answeredEntries = Object.entries(earlyAnswers);

  // Robot state is derived, never set by a timer, so it cannot depict work that
  // is not happening.
  const robotState: DraftAssistantState = progress.failed
    ? "failed"
    : progress.nativeDraftReady
      ? "celebrating"
      : acknowledging
        ? "confirming"
        : question
          ? pendingValue
            ? "thinking"
            : "asking"
          : active?.id === "structuring"
            ? "scanning"
            : "reading";

  const handleAnswer = async (value: string) => {
    if (!question || busy) return;
    setPendingValue(value);
    try {
      await onAnswerEarlyQuestion(question.fieldPath, value);
      setAcknowledging(true);
      window.setTimeout(() => setAcknowledging(false), 500);
    } finally {
      setPendingValue(null);
    }
  };

  const delayMessage = delayed
    ? jobImportDelayMessage(progress, sourceCharacterCount)
    : null;

  return (
    <div
      className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_420px]"
      data-testid="draft-assistant-canvas"
    >
      <section className={`${panel} min-h-[430px]`} aria-labelledby="draft-assistant-heading">
        <header className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <DraftAssistantRobot
              state={robotState}
              acknowledging={acknowledging}
              size={52}
              className="mt-0.5 shrink-0"
            />
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/40">
                Bea · CreatorJobs assistant
              </p>
              <p className="mt-1 truncate text-xs text-white/42">{sourceLabel}</p>
            </div>
          </div>
          {onCancel ? (
            <button
              type="button"
              className={ghostButton}
              onClick={onCancel}
              data-testid="draft-assistant-cancel"
            >
              Cancel
            </button>
          ) : null}
        </header>

        {/* One polite live region for the whole surface. The robot's own state is
            announced here as text, so the drawing can stay decorative. */}
        <p className="sr-only" aria-live="polite" data-testid="draft-assistant-status">
          {DRAFT_ASSISTANT_STATE_LABELS[robotState]}
          {active ? `. ${active.label}` : ""}
        </p>

        <ProgressBar ratio={ratio} stages={stages} active={active?.id ?? null} />

        <div className="mt-6">
          {progress.failed ? (
            <FailureMessage error={error} />
          ) : question ? (
            <EarlyQuestionTurn
              question={question}
              pendingValue={pendingValue}
              busy={busy}
              onAnswer={handleAnswer}
            />
          ) : (
            <WorkingMessage
              activeLabel={active?.label ?? null}
              sourceType={sourceType}
              delayMessage={delayMessage}
            />
          )}
        </div>

        {answeredEntries.length > 0 ? (
          <AnswerHistory entries={answeredEntries} />
        ) : null}
      </section>

      <PreviewRail ratio={ratio} />
    </div>
  );
}

function ProgressBar({
  ratio,
  stages,
  active,
}: {
  ratio: number;
  stages: ReturnType<typeof jobImportStages>;
  active: string | null;
}) {
  const percent = Math.round(ratio * 100);
  return (
    <div className="mt-6">
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={`${percent}% prepared`}
        aria-label="Draft preparation"
        className="flex h-1.5 w-full gap-1 overflow-hidden rounded-full"
        data-testid="draft-assistant-progress"
        data-progress={percent}
      >
        {stages.map((stage) => (
          <span
            key={stage.id}
            data-stage={stage.id}
            data-status={stage.status}
            className={[
              "h-full flex-1 rounded-full transition-colors duration-300 motion-reduce:transition-none",
              stage.status === "complete"
                ? "bg-[color:var(--color-state-review,#8ec5ff)]"
                : stage.status === "active"
                  ? // Unmeasurable work animates in place rather than advancing.
                    "bg-[color:var(--color-state-review,#8ec5ff)]/35 ui-skeleton motion-reduce:animate-none"
                  : stage.status === "failed"
                    ? "bg-white/25"
                    : "bg-white/8",
            ].join(" ")}
          />
        ))}
      </div>
      <p className="mt-2 text-[11px] text-white/38">
        {active ? stages.find((stage) => stage.id === active)?.label : "Draft prepared"}
      </p>
    </div>
  );
}

function WorkingMessage({
  activeLabel,
  sourceType,
  delayMessage,
}: {
  activeLabel: string | null;
  sourceType: JobImportSourceType;
  delayMessage: string | null;
}) {
  return (
    <div className="ui-rise">
      <h2 id="draft-assistant-heading" className="text-xl font-semibold text-white">
        {activeLabel ?? "Your draft is ready"}
      </h2>
      <p className="mt-2 text-sm leading-6 text-white/55">
        {delayMessage ??
          (sourceType === "public_url"
            ? "I\u2019m reading the public post and matching what it says to the fields in your normal Post Job draft."
            : "I\u2019m reading what you supplied and matching it to the fields in your normal Post Job draft.")}
      </p>
    </div>
  );
}

function EarlyQuestionTurn({
  question,
  pendingValue,
  busy,
  onAnswer,
}: {
  question: EarlyQuestion;
  pendingValue: string | null;
  busy: boolean;
  onAnswer: (value: string) => void;
}) {
  return (
    <div className="ui-rise" data-testid="early-question">
      <h2
        id="draft-assistant-heading"
        className="text-xl font-semibold text-white"
        data-field={question.fieldPath}
      >
        {question.question}
      </h2>
      <p className="mt-2 text-sm leading-6 text-white/55">{question.explanation}</p>
      <p className="mt-1.5 text-sm leading-6 text-white/45">{question.candidateImpact}</p>

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {question.options.map((option) => (
          <button
            key={option.value}
            type="button"
            disabled={busy}
            onClick={() => onAnswer(option.value)}
            data-testid={`early-question-option-${option.value}`}
            className={[
              "ui-press min-h-11 cursor-pointer rounded-xl border px-4 py-3 text-left transition-colors",
              "disabled:cursor-not-allowed disabled:opacity-50",
              pendingValue === option.value
                ? "border-white/30 bg-white/12"
                : "border-white/12 bg-white/6 hover:bg-white/10",
            ].join(" ")}
          >
            <span className="block text-sm font-semibold text-white">{option.label}</span>
            <span className="mt-1 block text-[11px] leading-4 text-white/50">
              {option.detail}
            </span>
          </button>
        ))}
      </div>
      <p className="mt-3 text-[11px] text-white/38">
        I&rsquo;ll keep preparing the rest of the draft while you decide.
      </p>
    </div>
  );
}

function AnswerHistory({ entries }: { entries: [string, unknown][] }) {
  return (
    <details className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
      <summary className="min-h-11 cursor-pointer list-none py-2 text-[12px] font-semibold text-white/60">
        Your answers ({entries.length})
      </summary>
      <ul className="mt-1 space-y-1.5 pb-1">
        {entries.map(([fieldPath, value]) => (
          <li key={fieldPath} className="text-[12px] text-white/50">
            {earlyAnswerLabel(fieldPath, value)}
          </li>
        ))}
      </ul>
    </details>
  );
}

function FailureMessage({ error }: { error: string | null }) {
  return (
    <div className="ui-rise" data-testid="draft-assistant-failure">
      <h2 id="draft-assistant-heading" className="text-xl font-semibold text-white">
        I couldn&rsquo;t finish preparing this draft
      </h2>
      <p className="mt-2 text-sm leading-6 text-white/55">
        {error ?? "Nothing was lost. Your answers are saved and you can try again."}
      </p>
    </div>
  );
}

function PreviewRail({ ratio }: { ratio: number }) {
  return (
    <aside
      className="hidden min-h-[430px] rounded-3xl border border-white/[0.08] bg-white/[0.025] p-5 lg:block"
      aria-label="Candidate preview being prepared"
      data-testid="draft-assistant-preview-rail"
    >
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/32">
        Candidate preview
      </p>
      <div className="mt-6 space-y-4" aria-hidden="true">
        {[
          "h-4 w-2/3 rounded-full",
          "h-8 w-full rounded-xl",
          "h-7 w-24 rounded-full",
          "h-20 w-full rounded-2xl",
          "h-20 w-full rounded-2xl",
        ].map((shape, index) => (
          <div
            key={shape}
            className={[
              shape,
              // Filled placeholders track earned progress, so the rail shows the
              // draft taking shape rather than a generic spinner.
              index / 5 < ratio
                ? "bg-white/12"
                : "ui-skeleton motion-reduce:animate-none",
            ].join(" ")}
          />
        ))}
      </div>
      <p className="mt-6 text-[11px] leading-4 text-white/34">
        This stays a private draft. Nothing is published until you review and post it.
      </p>
    </aside>
  );
}
