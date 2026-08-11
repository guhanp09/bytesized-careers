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
  JobImportNonNullJsonValue,
  JobImportSourceType,
} from "../../../lib/jobImportReadiness.ts";
import {
  AssistantMessage,
  ConversationComplete,
  ConversationTurn,
  RecruiterReply,
  TypingBubble,
} from "./ConversationTurn.tsx";
import {
  answerOptionsFor,
  multiSelectOptionsFor,
  questionPhraseFor,
} from "../../../lib/jobImportAnswerOptions.ts";
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
  "rounded-[28px] border border-line bg-panel p-4 elev-3 sm:p-6";

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
  /** The wait has outlasted one provider attempt, so a second one is likely. */
  retrying?: boolean;
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
  onAnswerQuestion?: (fieldPath: string, value: JobImportNonNullJsonValue) => void;
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
  retrying = false,
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
  const [conversationLayoutVersion, setConversationLayoutVersion] = React.useState(0);
  const handleTurnLayoutChange = React.useCallback(
    () => setConversationLayoutVersion((current) => current + 1),
    []
  );

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

  const assistantStatus = progress.failed
    ? "Needs attention"
    : progress.nativeDraftReady
      ? "Ready"
      : waitingForRecruiter
        ? "Your input"
        : "Preparing";

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

  const delayMessage = retrying
    ? // Truthful about what is happening without naming a provider or a code:
      // the first read did not come back, so the source is being read again.
      "This is taking longer than usual, so I\u2019m reading the source again. Nothing you\u2019ve entered is lost."
    : delayed
      ? jobImportDelayMessage(progress, sourceCharacterCount)
      : null;

  // History, the current turn and the assistant's composing state belong to one
  // chronological stream. Keeping one scroll owner is what places the dots
  // directly after the recruiter's reply instead of at the foot of the panel.
  const conversationRef = React.useRef<HTMLDivElement | null>(null);
  const answeredCount = answeredEntries.length;
  React.useEffect(() => {
    const node = conversationRef.current;
    if (!node) return;
    node.scrollTo({
      top: node.scrollHeight,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
  }, [
    answeredCount,
    busy,
    conversation?.active_question?.field_path,
    conversation?.ready_for_draft,
    conversation?.recruiter_context_version,
    conversationLayoutVersion,
    progress.failed,
  ]);

  return (
    <div
      className="grid min-w-0 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(360px,400px)] xl:gap-6 xl:grid-cols-[minmax(0,1fr)_420px]"
      data-testid="draft-assistant-canvas"
    >
      {/* On a large screen this is a chat column of fixed height, not a growing
          card: header and progress pinned, transcript flexing, the live question
          always at the bottom and always reachable. Left to normal flow the
          option chips fell below the fold and the recruiter had to scroll the
          page to answer — which is exactly what a chat layout exists to avoid. */}
      <section
        className={`${panel} flex min-w-0 flex-col lg:h-[calc(100dvh-8rem)] lg:max-h-[820px] lg:min-h-[560px]`}
        aria-labelledby="draft-assistant-title"
        aria-label="Prepare this job draft with Bea"
      >
        <header className="flex min-w-0 items-center justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <DraftAssistantRobot
              state={robotState}
              acknowledging={acknowledging}
              size={36}
              className="shrink-0"
            />
            <div className="min-w-0">
              <p id="draft-assistant-title" className="text-sm font-semibold tracking-tight text-ink">
                Bea
              </p>
              <p className="mt-0.5 truncate text-[11px] text-muted" title={sourceLabel}>
                {sourceLabel}
              </p>
            </div>
            <span
              className={[
                "shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-semibold",
                progress.failed
                  ? "border-state-danger/20 bg-state-danger-fill text-state-danger"
                  : progress.nativeDraftReady
                    ? "border-state-success/20 bg-state-success-fill text-state-success"
                    : waitingForRecruiter
                      ? "border-state-review/20 bg-state-review-fill text-state-review"
                      : "border-line bg-raised text-muted",
              ].join(" ")}
              data-testid={waitingForRecruiter ? "draft-assistant-paused-note" : undefined}
            >
              {assistantStatus}
            </span>
          </div>
          {onCancel ? (
            <button
              type="button"
              className="ui-press -mr-2 min-h-11 shrink-0 cursor-pointer rounded-xl px-3 text-xs font-semibold text-muted transition-colors hover:bg-wash hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/60"
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

        <div className="shrink-0 border-b border-line pb-5">
          <ProgressBar ratio={ratio} stages={stages} />
        </div>

        {/* One chronological chat stream. It uses the same convention as Inbox:
            settled messages, the current turn and typing all share one scroll
            owner, while the secondary manual action remains outside it. */}
        <div className="mt-5 flex min-h-0 flex-1 flex-col">
          <div
            ref={conversationRef}
            className="chat-scroll max-h-[min(66dvh,680px)] min-h-0 space-y-3 overflow-y-auto overscroll-contain pr-1.5 [scroll-padding-bottom:1rem] lg:max-h-none lg:flex-1"
            data-testid="conversation-scroll"
          >
          {conversation && answeredEntries.length > 0 ? (
            <div>
              <AnswerTranscript entries={answeredEntries} />
            </div>
          ) : null}

          <div data-testid="conversation-live">
          {progress.failed ? (
            <FailureMessage error={error} />
          ) : conversation?.ready_for_draft && onOpenDraft ? (
            <ConversationComplete
              filledCount={filledCount}
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
              onLayoutChange={handleTurnLayoutChange}
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
              conversational={Boolean(conversation && answeredEntries.length > 0)}
            />
          )}
          </div>
          </div>
        </div>

        {conversation && !conversation.ready_for_draft && onContinueManually ? (
          <button
            type="button"
            onClick={onContinueManually}
            disabled={busy}
            data-testid="conversation-continue-manually"
            className="ui-press mt-5 inline-flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-line-mid bg-raised px-4 text-xs font-semibold text-secondary transition-colors hover:border-line-strong hover:bg-elevated hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/60 sm:w-auto sm:self-center"
          >
            Continue manually in the full editor
            <span aria-hidden="true">→</span>
          </button>
        ) : null}

        {preview ? (
          <details
            className="mt-5 rounded-2xl border border-line bg-raised px-4 py-2 elev-1 lg:hidden"
            data-testid="draft-assistant-preview-mobile"
          >
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 py-2 text-[12px] font-semibold text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/60">
              <span>Preview what candidates see</span>
              {provisionalCount > 0 ? (
                <span className="shrink-0 rounded-full bg-wash-strong px-2 py-1 font-normal text-muted">
                  {provisionalCount} to confirm
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
    <div className="mt-5">
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-[11px] font-medium text-muted">
          {failed
            ? "Draft preparation paused"
            : paused
              ? "Ready for your answer"
              : active?.activeLabel ?? "Draft prepared"}
        </p>
        <p className="text-[10px] tabular-nums text-subtle" aria-hidden="true">
          {percent}%
        </p>
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={`${percent}% prepared`}
        aria-label="Draft preparation"
        className="relative h-1.5 w-full overflow-hidden rounded-full bg-elevated"
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
              ? "bg-disabled"
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
  conversational = false,
}: {
  activeLabel: string | null;
  sourceType: JobImportSourceType;
  delayMessage: string | null;
  conversational?: boolean;
}) {
  // Mid-conversation the assistant is a participant, so silence between turns
  // has to look like someone composing rather than like a stalled screen. The
  // opening state keeps the fuller heading: there is no conversation yet to
  // belong to.
  if (conversational) {
    return (
      <>
        <h2 id="draft-assistant-heading" className="sr-only">
          {activeLabel ?? "Preparing your draft"}
        </h2>
        <TypingBubble label={activeLabel ?? "Working on your draft"} />
      </>
    );
  }
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
              "ui-press min-h-11 cursor-pointer rounded-xl border px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/60",
              "disabled:cursor-not-allowed disabled:opacity-50",
              pendingValue === option.value
                ? "border-state-review/50 bg-state-review-fill"
                : "border-line-mid bg-raised hover:border-line-strong hover:bg-elevated",
            ].join(" ")}
          >
            <span className="block text-sm font-semibold text-ink">{option.label}</span>
            <span className="mt-1 block text-[11px] leading-4 text-muted">
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
/** A stored value written the way the recruiter saw it on the button. */
function readableAnswer(raw: string): string {
  if (!raw) return raw;
  if (raw !== raw.toLowerCase()) return raw;
  const spaced = raw.replace(/[_-]+/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function transcriptValue(fieldPath: string, value: unknown): string {
  const options = [
    ...answerOptionsFor(fieldPath),
    ...multiSelectOptionsFor(fieldPath),
  ];
  const labelFor = (raw: string) =>
    options.find((option) => option.value === raw)?.label ?? readableAnswer(raw);
  const shownValues = (Array.isArray(value) ? value : [value]).flatMap((item) => {
    if (typeof item === "string" || typeof item === "number") {
      return [labelFor(String(item))];
    }
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const key = typeof row.stage === "string" ? row.stage : row.type;
    if (typeof key !== "string") return [];
    const customLabel =
      typeof row.custom_type === "string"
        ? row.custom_type
        : typeof row.custom_label === "string"
          ? row.custom_label
          : null;
    const label = customLabel || labelFor(key);
    if (typeof row.quantity !== "number") return [label];
    const cadence =
      typeof row.custom_frequency === "string"
        ? row.custom_frequency
        : typeof row.frequency === "string"
          ? labelFor(row.frequency)
          : null;
    return cadence ? [`${row.quantity} × ${label} · ${cadence}`] : [label];
  });
  if (!shownValues.length) return "Saved";
  return shownValues.join(", ");
}

function AnswerTranscript({ entries }: { entries: [string, unknown][] }) {
  return (
    <div className="ui-rise space-y-3" data-testid="conversation-transcript">
      {entries.map(([fieldPath, value], index) => {
        const phrase = questionPhraseFor(fieldPath);
        const heading =
          phrase?.heading ??
          importFieldLabel(fieldPath).replace(/\s*\([^)]*\)\s*$/, "").trim();
        const shown = transcriptValue(fieldPath, value);
        return (
          <React.Fragment key={fieldPath}>
            <AssistantMessage showAvatar={index === 0} muted>
              <p className="text-[13px] leading-5">{heading}</p>
            </AssistantMessage>
            <RecruiterReply>{shown}</RecruiterReply>
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
        "sticky top-6 hidden min-w-0 transition-[filter] duration-500 lg:block",
        "motion-reduce:transition-none",
        pulse ? "brightness-110" : "brightness-100",
      ].join(" ")}
      aria-label="Candidate preview being prepared"
      data-testid="draft-assistant-preview-rail"
      data-provisional-count={provisionalCount}
    >
      <div className="mb-3 flex min-h-6 items-center justify-between gap-2 px-1">
        {/* The real preview prints its own heading; a second one above it was
            just the same words twice. */}
        {preview ? (
          <span />
        ) : (
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-subtle">
            Candidate preview
          </p>
        )}
        {provisionalCount > 0 ? (
          <p className="rounded-full bg-wash px-2 py-1 text-[10px] text-muted" data-testid="preview-provisional-note">
            {provisionalCount} still to confirm
          </p>
        ) : null}
      </div>

      <div>
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

      <p className="mt-4 px-1 text-[11px] leading-5 text-muted">
        This stays a private draft. Nothing is published until you review and post it.
      </p>
    </aside>
  );
}
