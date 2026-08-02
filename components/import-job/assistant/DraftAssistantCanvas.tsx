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
  nextEarlyQuestion,
  type EarlyQuestion,
} from "../../../lib/jobImportEarlyQuestions.ts";
import type {
  JobImportConversation,
  JobImportSourceType,
} from "../../../lib/jobImportReadiness.ts";
import {
  AssistantMessage,
  ConversationComplete,
  ConversationTurn,
  RecruiterReply,
} from "./ConversationTurn.tsx";
import { answerOptionsFor, questionPhraseFor } from "../../../lib/jobImportAnswerOptions.ts";
import { importFieldLabel } from "../../../lib/importedDraftGuidance.ts";
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
  /** The real candidate preview, once there are values worth showing. */
  preview?: React.ReactNode | null;
  /** How many shown values are imported but not yet confirmed. */
  provisionalCount?: number;
  /**
   * The server's statement that the assistant is stopped on a question.
   * While true nothing is running, and the surface must not suggest otherwise.
   */
  waitingForRecruiter?: boolean;
  /** The post-extraction conversation, once it has begun. */
  conversation?: JobImportConversation | null;
  jobTitle?: string | null;
  roleName?: string | null;
  filledCount?: number;
  onAnswerQuestion?: (fieldPath: string, value: string | string[] | number) => void;
  onSkipQuestion?: () => void;
  onSkipRemaining?: () => void;
  onContinueManually?: () => void;
  onOpenDraft?: () => void;
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
  preview = null,
  provisionalCount = 0,
  waitingForRecruiter = false,
  conversation = null,
  jobTitle = null,
  roleName = null,
  filledCount = 0,
  onAnswerQuestion,
  onSkipQuestion,
  onSkipRemaining,
  onContinueManually,
  onOpenDraft,
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
        : pendingValue
          ? "thinking"
          : // Waiting is its own posture. Showing a working animation beside an
            // unanswered question would claim work that is not happening.
            waitingForRecruiter
            ? question
              ? "asking"
              : "listening"
            : question
              ? "asking"
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
      className="grid min-w-0 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_420px]"
      data-testid="draft-assistant-canvas"
    >
      <section
        className={`${panel} min-w-0`}
        aria-labelledby="draft-assistant-heading"
      >
        <header className="flex min-w-0 items-center justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <DraftAssistantRobot
              state={robotState}
              acknowledging={acknowledging}
              size={28}
              className="shrink-0"
            />
            <p className="truncate text-xs text-white/40" title={sourceLabel}>
              {sourceLabel}
            </p>
            {waitingForRecruiter ? (
              <span
                className="shrink-0 rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] font-medium text-white/45"
                data-testid="draft-assistant-paused-note"
              >
                paused
              </span>
            ) : null}
          </div>
          {onCancel ? (
            <button
              type="button"
              className="ui-press -mr-2 min-h-11 shrink-0 cursor-pointer rounded-xl px-3 text-xs font-semibold text-white/45 transition-colors hover:text-white/80"
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

        <ProgressBar ratio={ratio} stages={stages} />

        <div className="mt-5 space-y-3">
          {conversation && answeredEntries.length > 0 ? (
            <AnswerTranscript entries={answeredEntries} />
          ) : null}

          {progress.failed ? (
            <FailureMessage error={error} />
          ) : conversation?.ready_for_draft && onOpenDraft ? (
            <ConversationComplete
              filledCount={filledCount}
              sourceLabel={sourceLabel}
              manual={conversation.manual_continuation}
              onOpenDraft={onOpenDraft}
              busy={busy}
            />
          ) : conversation?.active_question && onAnswerQuestion ? (
            <ConversationTurn
              // Keyed by field: without this React reuses the instance and the
              // previous question's typed text stays in the box.
              key={conversation.active_question.field_path}
              question={conversation.active_question}
              jobTitle={jobTitle}
              roleName={roleName}
              sourceLabel={sourceLabel}
              busy={busy}
              error={error}
              onAnswer={onAnswerQuestion}
              onSkip={onSkipQuestion ?? (() => undefined)}
              onSkipRemaining={onSkipRemaining ?? (() => undefined)}
            />
          ) : question ? (
            <EarlyQuestionTurn
              question={question}
              pendingValue={pendingValue}
              busy={busy}
              onAnswer={handleAnswer}
              working={!waitingForRecruiter}
            />
          ) : (
            <WorkingMessage
              activeLabel={active?.activeLabel ?? null}
              sourceType={sourceType}
              delayMessage={delayMessage}
            />
          )}
        </div>

        {conversation && !conversation.ready_for_draft && onContinueManually ? (
          <button
            type="button"
            onClick={onContinueManually}
            disabled={busy}
            data-testid="conversation-continue-manually"
            className="ui-press mt-5 min-h-11 cursor-pointer text-xs font-semibold text-white/45 transition-colors hover:text-white/80"
          >
            Continue manually in the full editor
          </button>
        ) : null}

        {preview ? (
          <details
            className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 lg:hidden"
            data-testid="draft-assistant-preview-mobile"
          >
            <summary className="min-h-11 cursor-pointer list-none py-2 text-[12px] font-semibold text-white/60">
              Preview what candidates see
              {provisionalCount > 0 ? (
                <span className="ml-2 font-normal text-white/32">
                  {provisionalCount} still to confirm
                </span>
              ) : null}
            </summary>
            <div className="pb-1">{preview}</div>
          </details>
        ) : null}

      </section>

      <PreviewRail
        ratio={ratio}
        preview={preview}
        provisionalCount={provisionalCount}
      />
    </div>
  );
}

function ProgressBar({
  ratio,
  stages,
}: {
  ratio: number;
  stages: ReturnType<typeof jobImportStages>;
}) {
  const percent = Math.round(ratio * 100);
  const active = stages.find((stage) => stage.status === "active");
  const paused = stages.find((stage) => stage.status === "waiting");
  const failed = stages.some((stage) => stage.status === "failed");

  // One continuous track. Segmented chunks read as a checklist of steps the
  // recruiter is expected to follow, when the point is a single job quietly
  // getting further along.
  return (
    <div className="mt-6">
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={`${percent}% prepared`}
        aria-label="Draft preparation"
        className="relative h-1.5 w-full overflow-hidden rounded-full bg-white/8"
        data-testid="draft-assistant-progress"
        data-progress={percent}
        data-state={failed ? "failed" : paused ? "waiting" : active ? "active" : "complete"}
      >
        {/* Earned progress. Only completed stages contribute width, so the bar
            can never claim more than has actually happened. */}
        <span
          className={[
            "absolute inset-y-0 left-0 rounded-full transition-[width] duration-500 ease-out",
            "motion-reduce:transition-none",
            failed
              ? "bg-white/25"
              : paused
                ? "bg-[color:var(--color-state-review,#8ec5ff)]/55"
                : "bg-[color:var(--color-state-review,#8ec5ff)]",
          ].join(" ")}
          style={{ width: `${Math.max(percent, 2)}%` }}
        />
        {/* Unmeasurable work in flight: a light travelling over the remaining
            track. It advances nothing, so it cannot overstate progress. */}
        {active?.indeterminate ? (
          <span
            className="bea-progress-sweep absolute inset-y-0 rounded-full bg-[color:var(--color-state-review,#8ec5ff)]/40"
            style={{ left: `${percent}%`, width: `${Math.max(100 - percent, 8)}%` }}
          />
        ) : null}
      </div>
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
  working,
}: {
  question: EarlyQuestion;
  pendingValue: string | null;
  busy: boolean;
  onAnswer: (value: string) => void;
  /** False while stopped, so the turn cannot promise work that is not running. */
  working: boolean;
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
      <p className="mt-1.5 text-[13px] leading-5 text-white/40">
        {question.candidateImpact}
      </p>

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
      {working ? (
        <p className="mt-3 text-[11px] text-white/38">
          I&rsquo;ll keep preparing the rest of the draft while you decide.
        </p>
      ) : null}
    </div>
  );
}

/**
 * Everything already decided, as the conversation that produced it.
 *
 * An accordion labelled "Your answers (1)" made settled work look like a filing
 * cabinet. Replies belong in the stream, above the question being asked, the
 * way any chat keeps its history.
 */
function AnswerTranscript({ entries }: { entries: [string, unknown][] }) {
  return (
    <div className="space-y-3" data-testid="conversation-transcript">
      {entries.map(([fieldPath, value], index) => {
        const phrase = questionPhraseFor(fieldPath);
        const heading =
          phrase?.heading ??
          importFieldLabel(fieldPath).replace(/\s*\([^)]*\)\s*$/, "").trim();
        const option = answerOptionsFor(fieldPath).find(
          (candidate) => candidate.value === String(value)
        );
        const shown = Array.isArray(value)
          ? value.filter((item) => typeof item === "string").join(", ")
          : String(value ?? "");
        return (
          <React.Fragment key={fieldPath}>
            <AssistantMessage showAvatar={index === 0} muted>
              <p className="text-[13px] leading-5">{heading}</p>
            </AssistantMessage>
            <RecruiterReply>{option?.label ?? shown}</RecruiterReply>
          </React.Fragment>
        );
      })}
    </div>
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

function PreviewRail({
  ratio,
  preview,
  provisionalCount,
}: {
  ratio: number;
  preview: React.ReactNode | null;
  provisionalCount: number;
}) {
  // The changed section is worth pointing at, but only once and only briefly.
  const [pulse, setPulse] = React.useState(false);
  const previousRatio = React.useRef(ratio);
  React.useEffect(() => {
    if (ratio === previousRatio.current) return;
    previousRatio.current = ratio;
    setPulse(true);
    const timer = window.setTimeout(() => setPulse(false), 700);
    return () => window.clearTimeout(timer);
  }, [ratio]);

  return (
    <aside
      className={[
        "hidden rounded-3xl border bg-white/[0.025] p-5 transition-colors duration-500 lg:block",
        "motion-reduce:transition-none",
        pulse ? "border-[color:var(--color-state-review,#8ec5ff)]/40" : "border-white/[0.08]",
      ].join(" ")}
      aria-label="Candidate preview being prepared"
      data-testid="draft-assistant-preview-rail"
      data-provisional-count={provisionalCount}
    >
      <div className="flex items-baseline justify-between gap-2">
        {/* The real preview prints its own heading; a second one above it was
            just the same words twice. */}
        {preview ? (
          <span />
        ) : (
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/32">
            Candidate preview
          </p>
        )}
        {provisionalCount > 0 ? (
          <p className="text-[10px] text-white/32" data-testid="preview-provisional-note">
            {provisionalCount} still to confirm
          </p>
        ) : null}
      </div>

      <div className="mt-4">
        {preview ?? (
          <div className="space-y-4" aria-hidden="true">
            {[
              "h-4 w-2/3 rounded-full",
              "h-8 w-full rounded-xl",
              "h-7 w-24 rounded-full",
              "h-20 w-full rounded-2xl",
            ].map((shape) => (
              <div
                key={shape}
                className={`${shape} ui-skeleton motion-reduce:animate-none`}
              />
            ))}
          </div>
        )}
      </div>

      <p className="mt-6 text-[11px] leading-4 text-white/34">
        This stays a private draft. Nothing is published until you review and post it.
      </p>
    </aside>
  );
}
