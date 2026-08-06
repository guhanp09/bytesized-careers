import type { JobScreeningQuestion } from "./jobContract.ts";
import {
  applicationRequirementLabel,
  deadlineForJob,
  trialForJob,
  uniqueJobText,
} from "./jobPresentation.ts";
import {
  CUSTOM_INSTRUCTION_REQUIREMENT_KEY,
  sanitizeRequirementKeys,
  type FirstMessageAnswers,
} from "./firstMessageRequirements.ts";
import type { Job } from "./types.ts";

export const SCREENING_ANSWERS_KEY = "screening_questions";
export const SCREENING_RESPONSE_MAX_LENGTH = 5000;

export type ScreeningQuestionAnswer = {
  question_index: number;
  prompt: string;
  required: boolean;
  response: string;
};

export type ScreeningAnswerState = Record<number, string>;

export function partitionJobApplicationRequirements(keys?: readonly string[] | null) {
  const source = uniqueJobText(keys || []);
  const known = sanitizeRequirementKeys(source, "job");
  const knownSet = new Set(known);
  return {
    known,
    unknown: source.filter((key) => !knownSet.has(key)),
  };
}

export function validateUnknownRequirementAnswers(
  requirementKeys: readonly string[],
  answers: FirstMessageAnswers,
) {
  const errors: Record<string, string> = {};
  for (const key of requirementKeys) {
    const value = answers[key];
    if (typeof value !== "string" || !value.trim()) {
      errors[key] = `${applicationRequirementLabel(key)} is required.`;
    }
  }
  return errors;
}

export function validateScreeningQuestionAnswers(
  questions: readonly JobScreeningQuestion[],
  answers: ScreeningAnswerState,
) {
  const errors: Record<string, string> = {};
  questions.forEach((question, index) => {
    const response = (answers[index] || "").trim();
    if (question.required && !response) {
      errors[`screening-question-${index}`] = "Answer this required question.";
    } else if (response.length > SCREENING_RESPONSE_MAX_LENGTH) {
      errors[`screening-question-${index}`] = `Keep your answer under ${SCREENING_RESPONSE_MAX_LENGTH.toLocaleString()} characters.`;
    }
  });
  return errors;
}

export function buildScreeningQuestionAnswers(
  questions: readonly JobScreeningQuestion[],
  answers: ScreeningAnswerState,
): ScreeningQuestionAnswer[] {
  return questions
    .map((question, index) => ({
      question_index: index,
      prompt: question.prompt.trim(),
      required: question.required,
      response: (answers[index] || "").trim(),
    }))
    .filter((answer) => answer.response);
}

/** Whether a note already states a closing date, so it is not stated twice. */
function mentionsDeadline(note: string | null): boolean {
  if (!note) return false;
  return /\b(?:applications?\s+close|apply\s+by|deadline)\b/i.test(note);
}

export function applicationPreflightForJob(job: Job) {
  const requirements = partitionJobApplicationRequirements(job.applicationRequirements);
  const deadline = deadlineForJob(job.deadlineAt);
  const trial = job.trialStatus ? trialForJob(job) : null;
  const howToApply = job.howToApply?.trim() || null;
  const baseInstruction =
    howToApply && !requirements.known.includes(CUSTOM_INSTRUCTION_REQUIREMENT_KEY)
      ? howToApply
      : null;
  // A deadline is part of the instructions, not a row of its own. Older jobs
  // stored it separately, so it is folded in here rather than shown twice or
  // lost — and only when the note does not already say it.
  const deadlineSentence =
    deadline.valid && deadline.label && !mentionsDeadline(baseInstruction)
      ? `Applications close on ${deadline.label}.`
      : null;
  const applicationInstruction =
    [baseInstruction, deadlineSentence].filter(Boolean).join(" ").trim() || null;
  return {
    // Applications run through CreatorJobs. A stored external mode belongs to
    // some other hiring process the platform never saw and cannot record, so it
    // is compatibility data rather than a setting: reading it here is what let
    // an old record send candidates off the platform.
    mode: "internal" as const,
    deadline,
    externalUrl: null as string | null,
    trial,
    knownRequirementKeys: requirements.known,
    unknownRequirementKeys: requirements.unknown,
    materialLabels: [
      ...requirements.known.map(applicationRequirementLabel),
      ...requirements.unknown.map(applicationRequirementLabel),
    ],
    // Screening questions are no longer public listing content nor collected before
    // applying — CreatorJobs sends them into the Inbox conversation after a successful
    // application instead. Kept as an always-empty list so downstream code stays inert.
    screeningQuestions: [] as NonNullable<Job["screeningQuestions"]>,
    applicationInstruction,
    hasPreflightDetails: Boolean(
      requirements.known.length ||
        requirements.unknown.length ||
        trial ||
        applicationInstruction,
    ),
  };
}
