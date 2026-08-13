"use client";

import * as React from "react";

import { importFieldLabel } from "../../../lib/importedDraftGuidance.ts";
import {
  answerOptionsFor,
  controlledAnswerOptionsFor,
  DELIVERABLE_FREQUENCY_OPTIONS,
  experienceAnswerError,
  isHttpUrlAnswer,
  isMeaningfulImportAnswer,
  minimumAnswerLength,
  multiSelectOptionsFor,
  numericAnswerError,
  questionPhraseFor,
  shapeCustomStructuredAnswer,
  shapeHttpUrlList,
  shapeMultiSelect,
  shapeStringMultiSelect,
  shapeStructuredAnswer,
  shapeStructuredCandidateAnswer,
  sourceInputLabelNeedsSensitiveConfirmation,
  structuredAnswerNeedsSensitiveConfirmation,
  textExampleFor,
  type DeliverableAnswerDetail,
} from "../../../lib/jobImportAnswerOptions.ts";
import type {
  JobImportActiveQuestion,
  JobImportNonNullJsonValue,
} from "../../../lib/jobImportReadiness.ts";
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

/** Native count fields reject fractional answers even on old checkpoints. */
const INTEGER_NUMBER_FIELDS: ReadonlySet<string> = new Set([
  "turnaround_value",
  "revision_rounds",
  "duration_value",
]);

/**
 * Today, as the `YYYY-MM-DD` a date input speaks.
 *
 * Used only to floor a start date: a collaboration cannot begin in the past, and
 * refusing to offer those days is quieter than rejecting one afterwards. This is
 * a calendar bound, not a timer — nothing here re-renders on a clock.
 */
function todayIso(offsetDays = 0): string {
  const now = new Date();
  const target = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + offsetDays
  );
  const year = target.getFullYear();
  const month = String(target.getMonth() + 1).padStart(2, "0");
  const day = String(target.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Shape a typed answer for the field it belongs to.
 *
 * A number field given a string, or a list field given a bare line, fails
 * validation and leaves the recruiter staring at a question they just answered.
 */
export function shapeAnswer(
  fieldPath: string,
  text: string,
  shape?: JobImportActiveQuestion["answer"]
): string | string[] | number {
  const kind = shape?.kind ?? (NUMBER_FIELDS.has(fieldPath) ? "number" : "text");
  const isList = shape?.is_list ?? LIST_FIELDS.has(fieldPath);
  if (kind === "number") {
    const parsed = Number(text.replace(/[^0-9.-]/g, ""));
    return Number.isFinite(parsed) ? parsed : text;
  }
  return isList ? [text] : text;
}

// Six designed states, not five plus a browser default: rest, hover, focus,
// pressed, disabled, and the recommended variant applied on top. The lift on
// hover is 1px — enough to feel like the card answered, small enough that a
// column of them does not ripple.
const optionButton =
  "ui-press group/option w-full cursor-pointer rounded-2xl border border-line-mid bg-raised px-4 py-3.5 text-left text-sm text-ink transition-[transform,background-color,border-color] duration-150 hover:-translate-y-px hover:border-line-strong hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/60 active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none motion-reduce:hover:translate-y-0";

/** Passing on an optional question: available, quiet, still 44px to hit. */
const skipAction =
  "ui-press inline-flex min-h-11 cursor-pointer items-center rounded-lg text-[12px] font-medium text-muted underline-offset-4 transition-colors hover:text-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/60 disabled:cursor-not-allowed disabled:opacity-40";

// ---------------------------------------------------------------------------
// Message primitives
// ---------------------------------------------------------------------------

/** An assistant message. The avatar appears once per run, as in any chat. */
export function AssistantMessage({
  children,
  showAvatar = true,
  muted = false,
  prominent = false,
}: {
  children: React.ReactNode;
  showAvatar?: boolean;
  muted?: boolean;
  /**
   * The live question, rather than a line of history.
   *
   * It loses the bubble. A container around the one thing on screen the
   * recruiter has to act on adds an edge to look at and shrinks the words
   * inside it, and the question was ending up smaller than the page title above
   * it. Typography carries it instead; history keeps the bubble, which is what
   * makes settled turns read as settled.
   */
  prominent?: boolean;
}) {
  return (
    <div className="flex items-start gap-2.5 sm:gap-3">
      <div className="w-[30px] shrink-0 sm:w-8">
        {showAvatar ? (
          <DraftAssistantRobot state="asking" size={30} className="mt-0.5" />
        ) : null}
      </div>
      <div
        className={[
          "min-w-0 overflow-hidden break-words [overflow-wrap:anywhere]",
          prominent
            ? "max-w-[34rem] pt-0.5 text-ink"
            : "max-w-[88%] rounded-2xl rounded-tl-md px-4 py-3",
          prominent
            ? ""
            : muted
              ? "bg-wash text-muted"
              : "bg-raised text-default elev-1",
        ].join(" ")}
      >
        {children}
      </div>
    </div>
  );
}

/** The assistant mid-turn: reading, deciding, composing the next question.
 *
 * A chat surface that goes blank between turns reads as broken, which is why
 * the working state used to be a heading floating outside the conversation.
 * Keeping it in the stream as a bubble is what makes the pause feel like
 * someone thinking rather than nothing happening.
 */
export function TypingBubble({
  label,
  showAvatar = true,
  testId = "assistant-typing",
}: {
  label?: string | null;
  showAvatar?: boolean;
  testId?: string;
}) {
  return (
    <div
      className="ui-bubble-in flex items-start gap-2.5 sm:gap-3"
      data-testid={testId}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <div className="w-[30px] shrink-0 sm:w-8">
        {showAvatar ? (
          <DraftAssistantRobot state="thinking" size={30} className="mt-0.5" />
        ) : null}
      </div>
      <div className="min-w-0 rounded-2xl rounded-tl-md bg-raised px-4 py-3.5 elev-1">
        <span className="flex items-center gap-1.5" aria-hidden="true">
          <span className="bea-dot block h-1.5 w-1.5 rounded-full bg-secondary" />
          <span className="bea-dot bea-dot--2 block h-1.5 w-1.5 rounded-full bg-secondary" />
          <span className="bea-dot bea-dot--3 block h-1.5 w-1.5 rounded-full bg-secondary" />
        </span>
        {label ? <span className="sr-only">{label}</span> : null}
      </div>
    </div>
  );
}

/** The recruiter's own reply, mirrored to the opposite side. */
export function RecruiterReply({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex justify-end pl-9 sm:pl-11">
      <div
        className="max-w-[82%] overflow-hidden rounded-2xl rounded-br-md border border-state-review/10 bg-state-review-fill px-4 py-2.5 text-sm break-words [overflow-wrap:anywhere] text-ink"
        data-testid="conversation-reply"
      >
        {children}
      </div>
    </div>
  );
}

function SensitiveAccessConfirmation({
  checked,
  busy,
  className = "",
  onChange,
}: {
  checked: boolean;
  busy: boolean;
  className?: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      className={`${className} flex cursor-pointer items-start gap-2 rounded-xl border border-line bg-wash px-3 py-2.5 text-[12px] leading-4 text-secondary`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        disabled={busy}
        data-testid="conversation-sensitive-access-confirmation"
        className="mt-0.5 h-4 w-4 rounded border-line-mid bg-base accent-white"
      />
      I confirm this role requires the account or analytics access described here.
      Access details can be agreed securely after hiring.
    </label>
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
  onAnswer: (fieldPath: string, value: JobImportNonNullJsonValue) => void;
  onSkip: () => void;
  onSkipRemaining: () => void;
  onLayoutChange?: () => void;
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
  onLayoutChange,
}: ConversationTurnProps) {
  const [text, setText] = React.useState("");
  const [picked, setPicked] = React.useState<string[]>([]);
  const [deliverableDetails, setDeliverableDetails] = React.useState<
    Record<string, DeliverableAnswerDetail>
  >({});
  const [sensitiveAccessConfirmed, setSensitiveAccessConfirmed] =
    React.useState(false);
  const [roleOverride, setRoleOverride] = React.useState("");
  const [customAnswerTouched, setCustomAnswerTouched] = React.useState(false);
  const [submittedReply, setSubmittedReply] = React.useState<string | null>(null);
  const submittedReplyRef = React.useRef<string | null>(null);
  const requestWasBusyRef = React.useRef(false);
  const customAnswerId = React.useId();
  const customAnswerHelpId = `${customAnswerId}-help`;
  const customAnswerErrorId = `${customAnswerId}-error`;
  const label = importFieldLabel(question.field_path)
    .replace(/\s*\([^)]*\)\s*$/, "")
    .trim();
  const optional = question.kind === "optional";
  const shape = question.answer;
  // The server says what a valid answer is; local option copy only supplies
  // friendlier labels for values it already knows.
  const serverChoices = shape?.choices ?? [];
  const shapeStringChoiceAnswer = (
    selected: readonly string[],
    customValue?: string
  ) => {
    const shaped = shapeStringMultiSelect(selected, customValue);
    if (!shaped) return null;
    if (
      shape?.custom_values_allowed !== true &&
      shaped.some((value) => !serverChoices.includes(value))
    ) {
      return null;
    }
    return shaped;
  };
  const labelled = answerOptionsFor(question.field_path, { jobTitle, roleName });
  const localMultiOptions = multiSelectOptionsFor(question.field_path);
  const controlled = controlledAnswerOptionsFor(
    question.field_path,
    shape?.kind,
    { jobTitle, roleName }
  );
  const labelFor = (value: string) =>
    shape?.labels?.[value] ??
    labelled.find((option) => option.value === value)?.label ??
    localMultiOptions.find((option) => option.value === value)?.label ??
    value.replace(/_/g, " ").replace(/^./, (letter) => letter.toUpperCase());
  const displayValue = (value: unknown): string => {
    if (Array.isArray(value)) {
      return value.map(displayValue).filter(Boolean).join(", ");
    }
    if (value && typeof value === "object") {
      const row = value as Record<string, unknown>;
      const discriminator =
        typeof row.type === "string"
          ? row.type
          : typeof row.stage === "string"
            ? row.stage
            : null;
      const custom =
        typeof row.custom_type === "string"
          ? row.custom_type
          : typeof row.custom_label === "string"
            ? row.custom_label
            : null;
      const name = custom || (discriminator ? labelFor(discriminator) : "");
      const quantity = typeof row.quantity === "number" ? row.quantity : null;
      const frequency =
        typeof row.custom_frequency === "string"
          ? row.custom_frequency
          : typeof row.frequency === "string"
            ? labelFor(row.frequency)
            : null;
      if (name && quantity !== null && frequency) {
        return `${quantity} × ${name} · ${frequency}`;
      }
      if (name) return name;
      const workMode = typeof row.work_mode === "string" ? labelFor(row.work_mode) : "";
      const location = typeof row.location === "string" ? row.location : "";
      if (workMode || location) return [workMode, location].filter(Boolean).join(" · ");
      return "Use the details from the post";
    }
    if (typeof value === "string") return labelFor(value);
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    return "";
  };
  const detailFor = (value: string) =>
    labelled.find((option) => option.value === value)?.detail;

  const isMulti = shape?.kind === "multi_choice";
  const isUrl =
    shape?.kind === "url" || (!shape && question.field_path === "reference_videos");
  // Checkpointed conversations created before answer-shape metadata existed can
  // still contain one of the three known structured list questions. Their
  // controls must remain usable rather than rendering chips with a permanently
  // disabled submit button.
  const isLegacyStructuredMulti = !shape && localMultiOptions.length > 0;
  const isStructuredMulti =
    (isMulti && Boolean(shape?.item_key)) || isLegacyStructuredMulti;
  const isStringMulti = isMulti && !shape?.item_key;
  const choices =
    shape?.kind === "choice"
      ? serverChoices.map((value) => ({
          value,
          label: labelFor(value),
          detail: detailFor(value),
          recommended:
            question.recommended_value !== undefined &&
            String(question.recommended_value) === value,
        }))
          .sort((left, right) => Number(right.recommended) - Number(left.recommended))
      : controlled;
  const recommendedRoleChoiceSet = new Set(
    question.field_path === "primary_role_key"
      ? (question.recommended_choices ?? [])
      : []
  );
  const recommendedRoleChoices = choices.filter((choice) =>
    recommendedRoleChoiceSet.has(choice.value)
  );
  const overrideRoleChoices = choices.filter(
    (choice) => !recommendedRoleChoiceSet.has(choice.value)
  );
  const multi = isMulti
    ? serverChoices.map((value) => ({ value, label: labelFor(value) }))
    : shape
      ? []
      : localMultiOptions;
  const allowedMultiValues = isMulti
    ? serverChoices
    : localMultiOptions.map((option) => option.value);
  const recommendedMulti = (isMulti || isLegacyStructuredMulti) &&
    Array.isArray(question.recommended_value)
    ? question.recommended_value.filter(
        (value): value is string =>
          typeof value === "string" && allowedMultiValues.includes(value)
      )
    : [];
  const recommendedOpenStringMulti =
    isStringMulti &&
    shape?.custom_values_allowed === true &&
    Array.isArray(question.recommended_value) &&
    question.recommended_value.every((value) => typeof value === "string")
      ? shapeStringMultiSelect(question.recommended_value)
      : null;
  const recommendedStructuredRaw =
    isStructuredMulti &&
    Array.isArray(question.recommended_value) &&
    question.recommended_value.length > 0 &&
    question.recommended_value.every(
      (value) => value !== null && typeof value === "object" && !Array.isArray(value)
    )
      ? question.recommended_value
      : null;
  const phrase = questionPhraseFor(question.field_path);
  const alternatives = question.alternatives ?? [];
  // A single surviving value is not a conflict. Rendering it under copy that
  // says the post "mentions both" makes a lossy server normalization look like
  // a decision the recruiter has to make.
  const visibleAlternatives = alternatives.length >= 2 ? alternatives : [];
  const structuredCustomAllowed =
    shape?.kind === "multi_choice" &&
    shape.custom_values_allowed === true &&
    shape.is_list === true &&
    Boolean(shape.item_key && shape.custom_item_key && shape.custom_item_value);
  const customValuesAllowed =
    (shape?.kind === "choice" &&
      shape.custom_values_allowed === true &&
      shape.is_list !== true) ||
    (isStringMulti && shape?.custom_values_allowed === true) ||
    structuredCustomAllowed;
  const structuredContext = React.useMemo(
    () => ({ deliverables: deliverableDetails, sensitiveAccessConfirmed }),
    [deliverableDetails, sensitiveAccessConfirmed]
  );
  const recommendedNeedsSensitiveConfirmation =
    structuredAnswerNeedsSensitiveConfirmation(
      question.field_path,
      recommendedStructuredRaw
    ) ||
    (question.field_path === "source_inputs" &&
      recommendedMulti.some(
        (value) => value === "analytics_access" || value === "account_access"
      ));
  const recommendedStructured = recommendedStructuredRaw
    ? shapeStructuredAnswer(
        question.field_path,
        recommendedStructuredRaw,
        structuredContext
      )
    : null;
  const suggestedStructuredRaw =
    isStructuredMulti &&
    Array.isArray(question.suggested_value) &&
    question.suggested_value.length > 0
      ? question.suggested_value
      : null;
  const suggestedNeedsSensitiveConfirmation =
    structuredAnswerNeedsSensitiveConfirmation(
      question.field_path,
      suggestedStructuredRaw
    );
  const suggestedStructured = suggestedStructuredRaw
    ? shapeStructuredCandidateAnswer(
        question.field_path,
        suggestedStructuredRaw,
        structuredContext
      )
    : null;
  const suggestedStringMulti =
    isStringMulti && typeof question.suggested_value === "string"
      ? shapeStringChoiceAnswer([question.suggested_value])
      : isStringMulti &&
          Array.isArray(question.suggested_value) &&
          question.suggested_value.every((value) => typeof value === "string")
        ? shapeStringChoiceAnswer(question.suggested_value)
        : null;
  const suggestedUrlList = isUrl
    ? shapeHttpUrlList(question.suggested_value)
    : null;
  const canAcceptSuggested =
    question.suggested_value !== undefined &&
    question.suggested_value !== null &&
    (!suggestedStructuredRaw || suggestedStructured !== null) &&
    (!isStringMulti || suggestedStringMulti !== null) &&
    (!isUrl || suggestedUrlList !== null);
  const safeSuggestedValue = suggestedStructuredRaw
    ? suggestedStructured
    : isStringMulti
      ? suggestedStringMulti
      : isUrl
        ? suggestedUrlList
        : question.suggested_value;
  const alternativesNeedSensitiveConfirmation = visibleAlternatives.some(
    (alternative) =>
      structuredAnswerNeedsSensitiveConfirmation(
        question.field_path,
        alternative.value
      )
  );
  const shapedPicked = isStructuredMulti
    ? shapeMultiSelect(question.field_path, picked, structuredContext)
    : isStringMulti
      ? shapeStringChoiceAnswer(picked)
      : null;
  const shapedRecommended = recommendedMulti.length
    ? isStructuredMulti
      ? shapeMultiSelect(question.field_path, recommendedMulti, structuredContext)
      : recommendedOpenStringMulti ?? shapeStringChoiceAnswer(recommendedMulti)
    : recommendedOpenStringMulti;
  const selectedSensitiveInput =
    question.field_path === "source_inputs" &&
    picked.some((value) => value === "analytics_access" || value === "account_access");
  const showSensitiveAccessConfirmationBeforeChoices =
    alternativesNeedSensitiveConfirmation ||
    recommendedNeedsSensitiveConfirmation ||
    suggestedNeedsSensitiveConfirmation;
  // Bounds come from the schema where the server supplied them, so the control
  // enforces exactly what the field accepts.
  const isNumber =
    shape?.kind === "number" || (!shape && NUMBER_FIELDS.has(question.field_path));
  const isDate = shape?.kind === "date";
  const dateMinimum = question.field_path === "deadline_at"
    ? todayIso(1)
    : todayIso();
  const integerOnly =
    shape?.integer_only ?? INTEGER_NUMBER_FIELDS.has(question.field_path);
  const minLength = shape?.min_length ?? minimumAnswerLength(question.field_path);
  const maxLength = shape?.max_length;
  const trimmed = text.trim();
  const numericError = isNumber
    ? numericAnswerError(trimmed, {
        ...shape,
        integer_only: integerOnly,
        step: shape?.step ?? (integerOnly ? 1 : "any"),
      })
    : null;
  const urlError = isUrl && trimmed && !isHttpUrlAnswer(trimmed)
    ? "Enter a complete http or https link."
    : null;
  const semanticError =
    trimmed && question.field_path === "experience_level"
      ? experienceAnswerError(trimmed)
      : null;
  const showSemanticError = Boolean(semanticError && customAnswerTouched);
  const meaningful = isMeaningfulImportAnswer(question.field_path, trimmed);
  const openListCustomValue = isStringMulti
    ? shapeStringChoiceAnswer(picked, trimmed)
    : null;
  // Send stays disabled until the answer would be accepted, so the recruiter is
  // never told afterwards that what they wrote could not be used.
  const canSend = isDate
    ? /^\d{4}-\d{2}-\d{2}$/.test(trimmed) && trimmed >= dateMinimum
    :
    trimmed.length >= (isNumber ? 1 : minLength) &&
    (maxLength === undefined || trimmed.length <= maxLength) &&
    numericError === null &&
    urlError === null &&
    meaningful;
  const customStructuredRow = structuredCustomAllowed
    ? shapeCustomStructuredAnswer(question.field_path, trimmed, structuredContext)
    : null;
  const customSourceInputNeedsSensitiveConfirmation =
    question.field_path === "source_inputs" &&
    sourceInputLabelNeedsSensitiveConfirmation(trimmed);
  const customAnswerMaxLength =
    question.field_path === "experience_level"
      ? Math.min(shape?.custom_item_max_length ?? maxLength ?? 64, 64)
      : shape?.custom_item_max_length ?? maxLength ?? 80;
  const customSubmitDisabled =
    busy ||
    !canSend ||
    (structuredCustomAllowed &&
      (!customStructuredRow || (picked.length > 0 && !shapedPicked))) ||
    (isStringMulti && !openListCustomValue);

  const recommendedText =
    typeof question.recommended_value === "string"
      ? question.recommended_value.trim()
      : "";
  const suggestedText =
    typeof question.suggested_value === "string"
      ? question.suggested_value.trim()
      : "";
  const recommendationAlreadyVisible =
    serverChoices.includes(recommendedText) ||
    visibleAlternatives.some(
      (alternative) => String(alternative.value ?? "") === recommendedText
    ) ||
    suggestedText === recommendedText;
  const outOfBandRecommendation =
    customValuesAllowed &&
    recommendedText.length > 0 &&
    !recommendationAlreadyVisible &&
    (question.field_path !== "experience_level" ||
      experienceAnswerError(recommendedText) === null)
      ? recommendedText
      : null;

  const heading = phrase?.heading ?? `What should ${label.toLowerCase()} be?`;
  const why =
    question.explanation ??
    whyItMatters(phrase?.prompt, roleName, jobTitle);

  const beginReply = (
    value: JobImportNonNullJsonValue,
    displayValue: string
  ) => {
    if (busy || submittedReplyRef.current) return;
    submittedReplyRef.current = displayValue;
    setSubmittedReply(displayValue);
    onAnswer(question.field_path, value);
  };

  const beginAction = (displayValue: string, action: () => void) => {
    if (busy || submittedReplyRef.current) return;
    submittedReplyRef.current = displayValue;
    setSubmittedReply(displayValue);
    action();
  };

  const submit = () => {
    if (!canSend || busy) return;
    beginReply(
      shapeAnswer(question.field_path, trimmed, shape),
      trimmed
    );
  };

  const submitCustom = () => {
    if (!canSend || busy) return;
    if (isStringMulti) {
      if (!openListCustomValue) return;
      beginReply(
        openListCustomValue,
        openListCustomValue.map(labelFor).join(", ")
      );
      return;
    }
    if (!structuredCustomAllowed) {
      submit();
      return;
    }
    if (!customStructuredRow || (picked.length > 0 && !shapedPicked)) return;
    const selectedRows = shapedPicked ?? [];
    beginReply(
      [...selectedRows, customStructuredRow] as JobImportNonNullJsonValue,
      [...picked.map(labelFor), trimmed].join(", ")
    );
  };

  // A failed or stale no-op request keeps the same keyed turn mounted. Put its
  // composer back when that request settles; a successful advancing response
  // replaces this keyed turn, and the persisted reply takes over in history.
  React.useEffect(() => {
    if (busy) {
      requestWasBusyRef.current = true;
      return;
    }
    if (!requestWasBusyRef.current || !submittedReplyRef.current) return;
    requestWasBusyRef.current = false;
    submittedReplyRef.current = null;
    setSubmittedReply(null);
    onLayoutChange?.();
  }, [busy, error, onLayoutChange]);

  const toggle = (value: string) =>
    setPicked((current) =>
      current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value]
    );

  const updateDeliverableDetail = (
    key: string,
    patch: Partial<DeliverableAnswerDetail>
  ) => {
    setDeliverableDetails((current) => ({
      ...current,
      [key]: { ...current[key], ...patch },
    }));
  };

  return (
    <div
      className="ui-rise space-y-3"
      data-testid="conversation-turn"
      data-kind={question.kind}
    >
      <AssistantMessage prominent>
        <p
          className="text-[19px] font-semibold leading-7 tracking-[-0.01em] text-ink sm:text-[21px] sm:leading-8"
          data-field={question.field_path}
        >
          {heading}
        </p>
        <p className="mt-2 text-[13px] leading-6 text-muted">{why}</p>
      </AssistantMessage>

      {submittedReply ? (
        <>
          <RecruiterReply>{submittedReply}</RecruiterReply>
          {busy ? (
            <TypingBubble testId="conversation-thinking" label="Working on your answer" />
          ) : null}
        </>
      ) : (
      // One measure for the whole turn. The question is capped at 34rem for
      // readability; letting the answers run the full width of a 1680px column
      // made a three-word option 730px wide and broke the alignment between
      // what was asked and what answers it.
      <div className="max-w-[34rem] pl-9 sm:pl-11">
        {outOfBandRecommendation ? (
          <button
            type="button"
            disabled={busy}
            data-testid="conversation-accept-custom-recommendation"
            onClick={() =>
              beginReply(outOfBandRecommendation, outOfBandRecommendation)
            }
            className={`${optionButton} mb-2 border-white/25 bg-white/[0.09]`}
          >
            <span className="flex items-baseline justify-between gap-3">
              <span className="font-medium">Use {outOfBandRecommendation}</span>
              <span className="shrink-0 rounded-full bg-state-review-fill px-2 py-0.5 text-[10px] font-semibold text-state-review">
                This matches your post
              </span>
            </span>
          </button>
        ) : null}

        {showSensitiveAccessConfirmationBeforeChoices ? (
          <SensitiveAccessConfirmation
            checked={sensitiveAccessConfirmed}
            busy={busy}
            className="mb-3"
            onChange={setSensitiveAccessConfirmed}
          />
        ) : null}

        {visibleAlternatives.length ? (
          <div className="space-y-2" data-testid="conversation-alternatives">
            <p className="mb-2 text-[12px] leading-5 text-secondary">
              Your post gives more than one answer — which should candidates see?
            </p>
            {visibleAlternatives.map((alternative, index) => {
              if (alternative.value === null || alternative.value === undefined) {
                return null;
              }
              const value = displayValue(alternative.value);
              const structuredAlternative =
                isStructuredMulti && Array.isArray(alternative.value)
                  ? shapeStructuredCandidateAnswer(
                      question.field_path,
                      alternative.value,
                      structuredContext
                  )
                  : null;
              const stringListAlternative =
                isStringMulti && typeof alternative.value === "string"
                  ? shapeStringChoiceAnswer([alternative.value])
                  : isStringMulti &&
                      Array.isArray(alternative.value) &&
                      alternative.value.every((item) => typeof item === "string")
                    ? shapeStringChoiceAnswer(alternative.value)
                    : null;
              const urlListAlternative = isUrl
                ? shapeHttpUrlList(alternative.value)
                : null;
              const canAcceptAlternative =
                (!isStructuredMulti ||
                  !Array.isArray(alternative.value) ||
                  structuredAlternative !== null) &&
                (!isStringMulti || stringListAlternative !== null) &&
                (!isUrl || urlListAlternative !== null);
              const acceptedAlternative =
                structuredAlternative ??
                stringListAlternative ??
                urlListAlternative ??
                alternative.value;
              const recommended =
                question.recommended_value !== undefined &&
                JSON.stringify(question.recommended_value) ===
                  JSON.stringify(alternative.value);
              return (
                <button
                  key={`${index}-${value}`}
                  type="button"
                  disabled={busy || !canAcceptAlternative}
                  data-testid={`conversation-alternative-${index}`}
                  onClick={() =>
                    beginReply(
                      acceptedAlternative as JobImportNonNullJsonValue,
                      value
                    )
                  }
                  className={`${optionButton} ${
                    recommended ? "border-white/25 bg-white/[0.09]" : ""
                  }`}
                >
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="font-medium">{value}</span>
                    {recommended ? (
                      <span className="shrink-0 rounded-full bg-state-review-fill px-2 py-0.5 text-[10px] font-semibold text-state-review">
                        Best match
                      </span>
                    ) : null}
                  </span>
                  {alternative.evidence[0] ? (
                    <span className="mt-1 block text-[11px] italic leading-4 text-muted">
                      &ldquo;{alternative.evidence[0]}&rdquo;
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        ) : canAcceptSuggested && safeSuggestedValue !== null ? (
          <button
            type="button"
            disabled={busy}
            data-testid="conversation-accept-suggestion"
            onClick={() =>
              beginReply(
                safeSuggestedValue as JobImportNonNullJsonValue,
                displayValue(safeSuggestedValue)
              )
            }
            className={`${optionButton} border-white/25 bg-white/[0.09]`}
          >
            Yes, use {displayValue(safeSuggestedValue)}
          </button>
        ) : multi.length ? (
          <div data-testid="conversation-multiselect">
            {recommendedStructured && !recommendedNeedsSensitiveConfirmation ? (
              <button
                type="button"
                disabled={busy}
                data-testid="conversation-accept-structured-recommendation"
                onClick={() =>
                  beginReply(
                    recommendedStructured as JobImportNonNullJsonValue,
                    displayValue(recommendedStructured)
                  )
                }
                className={`${optionButton} mb-3 border-white/25 bg-white/[0.09]`}
              >
                <span className="flex items-baseline justify-between gap-3">
                  <span className="font-medium">
                    Use {displayValue(recommendedStructured)}
                  </span>
                  <span className="shrink-0 rounded-full bg-state-review-fill px-2 py-0.5 text-[10px] font-semibold text-state-review">
                    This matches your post
                  </span>
                </span>
              </button>
            ) : null}
            {recommendedNeedsSensitiveConfirmation ? (
              <p className="mb-3 rounded-xl border border-line bg-wash px-3 py-2 text-[11px] leading-4 text-muted">
                The post mentions account access. Confirm it explicitly before Bea
                adds it to the draft.
              </p>
            ) : null}
            {shapedRecommended?.length ? (
              <button
                type="button"
                disabled={busy}
                data-testid="conversation-accept-multi-recommendation"
                onClick={() =>
                  beginReply(
                    shapedRecommended as JobImportNonNullJsonValue,
                    displayValue(shapedRecommended)
                  )
                }
                className={`${optionButton} mb-3 border-white/25 bg-white/[0.09]`}
              >
                <span className="flex items-baseline justify-between gap-3">
                  <span className="font-medium">
                    Use {displayValue(shapedRecommended)}
                  </span>
                  <span className="shrink-0 rounded-full bg-state-review-fill px-2 py-0.5 text-[10px] font-semibold text-state-review">
                    This matches your post
                  </span>
                </span>
              </button>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {multi.map((option) => {
                const on = picked.includes(option.value);
                const recommended = recommendedMulti.includes(option.value);
                return (
                  <button
                    key={option.value}
                    type="button"
                    disabled={busy}
                    aria-pressed={on}
                    data-testid={`conversation-chip-${option.value}`}
                    onClick={() => toggle(option.value)}
                    className={[
                      "ui-press min-h-10 cursor-pointer rounded-full border px-3.5 py-2 text-[13px] transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/60",
                      on
                        ? "border-[color:var(--color-state-review,#8ec5ff)]/50 bg-[color:var(--color-state-review,#8ec5ff)]/18 text-white"
                        : recommended
                          ? "border-white/25 bg-white/[0.09] text-white"
                        : "border-line-mid bg-raised text-secondary hover:border-line-strong hover:bg-elevated hover:text-ink",
                    ].join(" ")}
                  >
                    {on ? "✓ " : ""}
                    {option.label}
                    {recommended && !on ? " · suggested" : ""}
                  </button>
                );
              })}
            </div>
            {question.field_path === "deliverables" && picked.length ? (
              <div
                className="mt-3 space-y-2 rounded-2xl border border-line bg-wash p-3"
                data-testid="conversation-deliverable-details"
              >
                <p className="text-[11px] leading-4 text-muted">
                  Add the real quantity and cadence for each deliverable. Bea will
                  not guess either one.
                </p>
                {picked.map((value) => {
                  const detail = deliverableDetails[value] ?? {};
                  return (
                    <div
                      key={value}
                      className="grid gap-2 rounded-xl border border-line bg-raised p-2.5 sm:grid-cols-[minmax(0,1fr)_88px_minmax(130px,0.8fr)]"
                      data-testid={`conversation-deliverable-row-${value}`}
                    >
                      <span className="self-center text-[12px] font-medium text-secondary">
                        {labelFor(value)}
                      </span>
                      <label className="grid gap-1 text-[10px] text-muted">
                        Quantity
                        <input
                          type="number"
                          min={1}
                          max={10000}
                          step={1}
                          value={detail.quantity ?? ""}
                          onChange={(event) =>
                            updateDeliverableDetail(value, {
                              quantity: event.target.value,
                            })
                          }
                          disabled={busy}
                          aria-label={`${labelFor(value)} quantity`}
                          className="h-10 rounded-xl border border-line-mid bg-base px-3 text-sm text-ink outline-none focus:border-line-strong focus-visible:ring-2 focus-visible:ring-focus/60"
                        />
                      </label>
                      <label className="grid gap-1 text-[10px] text-muted">
                        Cadence
                        <select
                          value={detail.frequency ?? ""}
                          onChange={(event) =>
                            updateDeliverableDetail(value, {
                              frequency: event.target.value,
                            })
                          }
                          disabled={busy}
                          aria-label={`${labelFor(value)} cadence`}
                          className="h-10 rounded-xl border border-line-mid bg-base px-3 text-sm text-ink outline-none focus:border-line-strong focus-visible:ring-2 focus-visible:ring-focus/60"
                        >
                          <option value="">Choose…</option>
                          {DELIVERABLE_FREQUENCY_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      {detail.frequency === "other" ? (
                        <label className="grid gap-1 text-[10px] text-muted sm:col-start-2 sm:col-span-2">
                          Exact cadence
                          <input
                            type="text"
                            maxLength={80}
                            value={detail.customFrequency ?? ""}
                            onChange={(event) =>
                              updateDeliverableDetail(value, {
                                customFrequency: event.target.value,
                              })
                            }
                            disabled={busy}
                            className="h-10 rounded-xl border border-line-mid bg-base px-3 text-sm text-ink outline-none placeholder:text-subtle focus:border-line-strong focus-visible:ring-2 focus-visible:ring-focus/60"
                            placeholder="e.g. Every fortnight"
                          />
                        </label>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : null}
            {(selectedSensitiveInput || customSourceInputNeedsSensitiveConfirmation) &&
            !showSensitiveAccessConfirmationBeforeChoices ? (
              <SensitiveAccessConfirmation
                checked={sensitiveAccessConfirmed}
                busy={busy}
                className="mt-3"
                onChange={setSensitiveAccessConfirmed}
              />
            ) : null}
            <button
              type="button"
              disabled={busy || picked.length === 0 || !shapedPicked}
              data-testid="conversation-multiselect-submit"
              onClick={() => {
                if (!shapedPicked) return;
                beginReply(
                  shapedPicked as JobImportNonNullJsonValue,
                  picked.map(labelFor).join(", ")
                );
              }}
              className="ui-press surface-primary mt-3 min-h-11 cursor-pointer rounded-xl border border-white px-4 text-sm font-semibold text-black elev-1 hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:border-line disabled:bg-raised disabled:bg-none disabled:text-disabled"
            >
              {picked.length ? `Use ${picked.length} selected` : "Pick at least one"}
            </button>
          </div>
        ) : question.field_path === "primary_role_key" &&
          recommendedRoleChoices.length ? (
          <div
            className="grid gap-3"
            data-testid="conversation-role-choice-with-override"
          >
            <div
              className={`grid gap-2 ${
                recommendedRoleChoices.length > 3 ? "sm:grid-cols-2" : ""
              }`}
            >
              {recommendedRoleChoices.map((choice) => (
                <button
                  key={choice.value}
                  type="button"
                  disabled={busy}
                  data-testid={`conversation-option-${choice.value}`}
                  onClick={() => beginReply(choice.value, choice.label)}
                  className={`${optionButton} border-white/25 bg-white/[0.09]`}
                >
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="font-medium">{choice.label}</span>
                    <span className="shrink-0 rounded-full bg-state-review-fill px-2 py-0.5 text-[10px] font-semibold text-state-review">
                      Likely match
                    </span>
                  </span>
                </button>
              ))}
            </div>
            <div className="grid gap-2 rounded-2xl border border-line bg-wash p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
              <label className="grid gap-1.5 text-[11px] text-muted">
                Or choose another creator role
                <select
                  value={roleOverride}
                  onChange={(event) => setRoleOverride(event.target.value)}
                  disabled={busy}
                  data-testid="conversation-role-override"
                  className="h-11 min-w-0 rounded-xl border border-line-mid bg-base px-3 text-sm text-ink outline-none focus:border-line-strong focus-visible:ring-2 focus-visible:ring-focus/60"
                >
                  <option value="">Select a role…</option>
                  {overrideRoleChoices.map((choice) => (
                    <option key={choice.value} value={choice.value}>
                      {choice.label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                disabled={busy || !roleOverride}
                onClick={() => {
                  const selected = choices.find(
                    (choice) => choice.value === roleOverride
                  );
                  if (selected) beginReply(selected.value, selected.label);
                }}
                data-testid="conversation-role-override-submit"
                className="ui-press surface-primary h-11 cursor-pointer rounded-xl border border-white px-4 text-sm font-semibold text-black elev-1 hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:border-line disabled:bg-raised disabled:bg-none disabled:text-disabled"
              >
                Use role
              </button>
            </div>
          </div>
        ) : choices.length ? (
          // One column up to three options, two beyond it. Two columns for
          // three left the third stranded beside a gap, which reads as a
          // missing option rather than as a layout; a short list also gains
          // from each option owning a full line.
          <div className={`grid gap-2 ${choices.length > 3 ? "sm:grid-cols-2" : ""}`}>
            {choices.map((choice) => (
              <button
                key={choice.value}
                type="button"
                disabled={busy}
                data-testid={`conversation-option-${choice.value}`}
                onClick={() => beginReply(choice.value, choice.label)}
                className={`${optionButton} ${
                  "recommended" in choice && choice.recommended
                    ? "border-white/25 bg-white/[0.09]"
                    : ""
                }`}
              >
                <span className="flex items-baseline justify-between gap-3">
                  <span className="font-medium">{choice.label}</span>
                  {"recommended" in choice && choice.recommended ? (
                    <span className="shrink-0 rounded-full bg-state-review-fill px-2 py-0.5 text-[10px] font-semibold text-state-review">
                      Suggested
                    </span>
                  ) : null}
                </span>
                {choice.detail ? (
                  <span className="mt-0.5 block text-[11px] leading-4 text-muted">
                    {choice.detail}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        ) : isDate ? (
          <div className="flex items-end gap-2">
            <input
              type="date"
              value={text}
              min={dateMinimum}
              onChange={(event) => setText(event.target.value)}
              disabled={busy}
              aria-label={heading}
              data-testid="conversation-date-answer"
              className="h-12 min-w-0 flex-1 rounded-2xl border border-line-mid bg-raised px-4 text-sm text-ink outline-none transition-colors focus:border-line-strong focus-visible:ring-2 focus-visible:ring-focus/60 [color-scheme:dark]"
            />
            <button
              type="button"
              onClick={submit}
              disabled={busy || !canSend}
              data-testid="conversation-submit"
              className="ui-press surface-primary h-11 shrink-0 cursor-pointer rounded-xl border border-white px-4 text-sm font-semibold text-black elev-1 hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:border-line disabled:bg-raised disabled:bg-none disabled:text-disabled"
            >
              Send
            </button>
          </div>
        ) : (
          <div className="flex items-end gap-2 rounded-2xl border border-line-mid bg-raised p-1.5 transition-colors focus-within:border-line-strong focus-within:bg-elevated focus-within:ring-2 focus-within:ring-focus/35">
            <textarea
              value={text}
              maxLength={maxLength}
              onChange={(event) =>
                setText(
                  isNumber
                    ? event.target.value.replace(/[^0-9.-]/g, "")
                    : event.target.value
                )
              }
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
              inputMode={
                isNumber
                  ? integerOnly
                    ? "numeric"
                    : "decimal"
                  : isUrl
                    ? "url"
                    : "text"
              }
              aria-invalid={
                trimmed.length >= minLength && !meaningful ? true : undefined
              }
              className="min-h-[48px] w-full resize-none bg-transparent px-3 py-2.5 text-sm leading-5 text-ink outline-none placeholder:text-subtle"
              placeholder={textExampleFor(question.field_path)}
            />
            <button
              type="button"
              onClick={submit}
              disabled={busy || !canSend}
              data-testid="conversation-submit"
              className="ui-press surface-primary h-11 shrink-0 cursor-pointer rounded-xl border border-white px-4 text-sm font-semibold text-black elev-1 hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:border-line disabled:bg-overlay disabled:bg-none disabled:text-disabled disabled:shadow-none"
            >
              Send
            </button>
          </div>
        )}

        {customValuesAllowed ? (
          // Suggestions are shortcuts; they are not the domain. A hairline rule
          // and a 12px caption made "anything else" read as the fallback for
          // when the real answers do not fit, which is backwards for an open
          // field. It gets the same surface and the same reading weight as the
          // options above it.
          <div
            className="mt-3 rounded-2xl border border-line bg-wash px-4 py-3.5"
            data-testid="conversation-custom-override"
          >
            <label
              htmlFor={customAnswerId}
              className="block text-[13px] font-medium text-secondary"
            >
              {question.field_path === "experience_level"
                ? "Or type the exact requirement"
                : "Or type your own"}
            </label>
            <div className="mt-2 flex min-w-0 flex-col gap-2 sm:flex-row sm:items-end">
              <input
                id={customAnswerId}
                type="text"
                value={text}
                maxLength={customAnswerMaxLength}
                onChange={(event) => setText(event.target.value)}
                onBlur={() => {
                  if (trimmed) setCustomAnswerTouched(true);
                }}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    !event.nativeEvent.isComposing
                  ) {
                    event.preventDefault();
                    if (semanticError) setCustomAnswerTouched(true);
                    submitCustom();
                  }
                }}
                disabled={busy}
                aria-describedby={[
                  customAnswerHelpId,
                  showSemanticError ? customAnswerErrorId : null,
                ]
                  .filter(Boolean)
                  .join(" ")}
                aria-invalid={showSemanticError ? true : undefined}
                data-testid="conversation-custom-answer"
                className="h-12 min-w-0 w-full rounded-2xl border border-line-mid bg-raised px-4 text-sm text-ink outline-none transition-colors placeholder:text-subtle focus:border-line-strong focus-visible:ring-2 focus-visible:ring-focus/60"
                placeholder={textExampleFor(question.field_path)}
              />
              {!(structuredCustomAllowed && question.field_path === "deliverables") ? (
                <button
                  type="button"
                  onClick={submitCustom}
                  disabled={customSubmitDisabled}
                  data-testid="conversation-custom-submit"
                  className="ui-press surface-primary min-h-11 w-full shrink-0 cursor-pointer rounded-xl border border-white px-4 text-sm font-semibold text-black elev-1 hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:border-line disabled:bg-overlay disabled:bg-none disabled:text-disabled disabled:shadow-none sm:w-auto"
                >
                  Use this
                </button>
              ) : null}
            </div>
            {structuredCustomAllowed && question.field_path === "deliverables" ? (
              <div className="mt-2 grid gap-2 rounded-xl border border-line bg-wash p-2.5 sm:grid-cols-[88px_minmax(130px,1fr)]">
                <label className="grid gap-1 text-[10px] text-muted">
                  Quantity
                  <input
                    type="number"
                    min={1}
                    max={10000}
                    step={1}
                    value={deliverableDetails.__custom__?.quantity ?? ""}
                    onChange={(event) =>
                      updateDeliverableDetail("__custom__", {
                        quantity: event.target.value,
                      })
                    }
                    disabled={busy}
                    aria-label="Custom deliverable quantity"
                    className="h-10 rounded-xl border border-line-mid bg-base px-3 text-sm text-ink outline-none focus:border-line-strong focus-visible:ring-2 focus-visible:ring-focus/60"
                  />
                </label>
                <label className="grid gap-1 text-[10px] text-muted">
                  Cadence
                  <select
                    value={deliverableDetails.__custom__?.frequency ?? ""}
                    onChange={(event) =>
                      updateDeliverableDetail("__custom__", {
                        frequency: event.target.value,
                      })
                    }
                    disabled={busy}
                    aria-label="Custom deliverable cadence"
                    className="h-10 rounded-xl border border-line-mid bg-base px-3 text-sm text-ink outline-none focus:border-line-strong focus-visible:ring-2 focus-visible:ring-focus/60"
                  >
                    <option value="">Choose…</option>
                    {DELIVERABLE_FREQUENCY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                {deliverableDetails.__custom__?.frequency === "other" ? (
                  <label className="grid gap-1 text-[10px] text-muted sm:col-span-2">
                    Exact cadence
                    <input
                      type="text"
                      maxLength={80}
                      value={deliverableDetails.__custom__?.customFrequency ?? ""}
                      onChange={(event) =>
                        updateDeliverableDetail("__custom__", {
                          customFrequency: event.target.value,
                        })
                      }
                      disabled={busy}
                      className="h-10 rounded-xl border border-line-mid bg-base px-3 text-sm text-ink outline-none placeholder:text-subtle focus:border-line-strong focus-visible:ring-2 focus-visible:ring-focus/60"
                      placeholder="e.g. Every fortnight"
                    />
                  </label>
                ) : null}
              </div>
            ) : null}
            {structuredCustomAllowed && question.field_path === "deliverables" ? (
              <button
                type="button"
                onClick={submitCustom}
                disabled={customSubmitDisabled}
                data-testid="conversation-custom-submit"
                className="ui-press surface-primary mt-2 min-h-11 w-full cursor-pointer rounded-xl border border-white px-4 text-sm font-semibold text-black elev-1 hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:border-line disabled:bg-overlay disabled:bg-none disabled:text-disabled disabled:shadow-none sm:w-auto"
              >
                Add deliverable
              </button>
            ) : null}
            <p id={customAnswerHelpId} className="mt-1.5 text-[11px] leading-4 text-muted">
              {question.field_path === "experience_level"
                ? `Use a clear level or amount, up to ${customAnswerMaxLength} characters.`
                : `Use a specific label, up to ${customAnswerMaxLength} characters.`}
            </p>
            {showSemanticError ? (
              <p
                id={customAnswerErrorId}
                className="mt-1.5 text-[12px] leading-4 text-[color:var(--color-state-closed,#f39aa6)]"
                role="alert"
                data-testid="conversation-custom-guidance"
              >
                {semanticError}
              </p>
            ) : null}
          </div>
        ) : null}

        {trimmed.length >= minLength && !meaningful && !customValuesAllowed ? (
          <p
            className="mt-2 text-[12px] leading-4 text-muted"
            data-testid="conversation-answer-guidance"
          >
            Add a short, specific phrase that candidates can understand.
          </p>
        ) : null}

        {trimmed && (numericError || urlError) && !customValuesAllowed ? (
          <p
            className="mt-2 text-[12px] leading-4 text-muted"
            role="alert"
            data-testid="conversation-answer-format-guidance"
          >
            {numericError ?? urlError}
          </p>
        ) : null}

        {/* Kept only for a genuine failure — a network drop or a race. Ordinary
            invalid input can no longer reach here, because Send stays disabled
            and structured fields are picked rather than typed. */}
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
          // Two ways past an optional question, and they are not the same size
          // of decision: one skips this, the other skips every remaining
          // suggestion. Side by side as identical links they read as a pair of
          // synonyms, so the wider one is named for what it does and separated
          // by the word between them.
          <div className="mt-3 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12px] text-subtle">
            <button
              type="button"
              disabled={busy}
              onClick={() => beginAction("Not now", onSkip)}
              data-testid="conversation-skip"
              className={skipAction}
            >
              Skip this one
            </button>
            <span aria-hidden="true">·</span>
            <button
              type="button"
              disabled={busy}
              onClick={() => beginAction("Skip suggestions", onSkipRemaining)}
              data-testid="conversation-skip-remaining"
              className={skipAction}
            >
              Skip all optional questions
            </button>
          </div>
        ) : null}
      </div>
      )}
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
  manual,
  onOpenDraft,
  busy,
}: {
  filledCount: number;
  manual: boolean;
  onOpenDraft: () => void;
  busy: boolean;
}) {
  // The end of the work deserves to look like the end of the work. As one more
  // grey bubble in the stream, finishing looked exactly like being asked
  // something — the recruiter had just handed over a job post and watched it
  // become a draft, and the product's reaction was a sentence the same size as
  // every other sentence.
  return (
    <div className="ui-rise pt-1" data-testid="conversation-complete">
      <div className="flex items-start gap-2.5 sm:gap-3">
        <div className="w-[30px] shrink-0 sm:w-8">
          <DraftAssistantRobot state="celebrating" size={30} className="mt-0.5" />
        </div>
        <div className="min-w-0 max-w-[34rem]">
          <p className="text-[21px] font-semibold leading-8 tracking-[-0.01em] text-ink sm:text-[24px]">
            Your draft is ready.
          </p>
          <p className="mt-2 text-[13px] leading-6 text-muted">
            {manual
              ? "I saved everything you decided — you can finish the rest in the editor."
              : // Naming the source here read badly, because the label is usually
                // the job title: "I filled in what Visual Content Creator - Video
                // Editing, VFX & Animation covered". The header already shows
                // which source this is, so the sentence does not need to.
                "I filled in what the listing covered and used your answers for the rest."}
            {filledCount > 0
              ? ` ${filledCount} ${filledCount === 1 ? "detail is" : "details are"} in place.`
              : ""}
          </p>
          <button
            type="button"
            onClick={onOpenDraft}
            disabled={busy}
            data-testid="conversation-open-draft"
            className="ui-press surface-primary mt-5 inline-flex min-h-12 cursor-pointer items-center gap-2 rounded-xl border border-white px-5 text-sm font-semibold text-black elev-2 transition-[transform,filter] duration-150 hover:-translate-y-px hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:border-line disabled:bg-raised disabled:bg-none motion-reduce:transition-none motion-reduce:hover:translate-y-0"
          >
            Open job draft
            <span aria-hidden="true">→</span>
          </button>
          <p className="mt-2.5 text-[11px] text-muted">
            It stays private until you publish it yourself.
          </p>
        </div>
      </div>
    </div>
  );
}
