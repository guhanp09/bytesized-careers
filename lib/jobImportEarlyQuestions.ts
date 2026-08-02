/**
 * Questions the assistant can ask while extraction is still running.
 *
 * These are not "the first few questions from the queue". They are the narrow
 * set the server has certified as recruiter-authority decisions: answering one
 * cannot be invalidated by a better extraction, because the recruiter has to
 * decide it either way. Anything the source is likely to answer stays out, so a
 * recruiter is never asked to do work the machine was about to do for them.
 *
 * The server publishes the eligible field paths on the draft as
 * `early_question_fields`. This module only supplies presentation for them and
 * must never widen the set: an unrecognised path yields no question.
 */

import type { JobImportSourceType } from "./jobImportReadiness.ts";

export type EarlyQuestionOption = {
  value: string;
  label: string;
  /** Short consequence of picking this option, in candidate terms. */
  detail: string;
};

export type EarlyQuestion = {
  fieldPath: string;
  /** Assistant heading. A question, not a field name. */
  question: string;
  /** Why this is being asked now, and why the source cannot settle it. */
  explanation: string;
  /** What the answer changes for candidates. */
  candidateImpact: string;
  options: EarlyQuestionOption[];
};

const SOURCE_PHRASE: Readonly<Partial<Record<JobImportSourceType, string>>> = {
  public_url: "the public post",
  pasted_text: "the details you pasted",
  rough_description: "the description you wrote",
  external_listing_text: "the listing you pasted",
  screenshot: "the screenshot you supplied",
  screenshots: "the screenshots you supplied",
  document: "the document you supplied",
  pdf: "the document you supplied",
};

const FALLBACK_SOURCE_PHRASE = "the details you supplied";

const sourcePhrase = (sourceType: JobImportSourceType | null): string =>
  (sourceType ? SOURCE_PHRASE[sourceType] : undefined) ?? FALLBACK_SOURCE_PHRASE;

/**
 * Copy is a function of the source kind so the explanation stays honest about
 * what was and was not available, rather than asserting a generic absence.
 */
function buildQuestion(
  fieldPath: string,
  sourceType: JobImportSourceType | null
): EarlyQuestion | null {
  const source = sourcePhrase(sourceType);

  switch (fieldPath) {
    case "employer_context_type":
      return {
        fieldPath,
        question: "Who is hiring for this role?",
        explanation: `You will know this instantly, and ${source} rarely spells it out.`,
        candidateImpact:
          "Creators, agencies and brands work differently, and candidates use this to judge whether the role suits them.",
        options: [
          {
            value: "creator",
            label: "Creator / channel",
            detail: "You publish under your own channel or name.",
          },
          { value: "agency", label: "Agency", detail: "You hire on behalf of clients." },
          { value: "brand", label: "Brand", detail: "You publish as a company." },
          {
            value: "production_house",
            label: "Production house",
            detail: "You produce content for other creators or brands.",
          },
          { value: "other", label: "Other", detail: "None of these describe you." },
        ],
      };
    default:
      // Unknown paths yield nothing. The client never invents an early question
      // the server has not certified as safe to ask.
      return null;
  }
}

/**
 * The questions that can be asked right now.
 *
 * Anything already answered is dropped, so a refresh mid-processing resumes at
 * the next unanswered question instead of re-asking a settled one.
 */
export function availableEarlyQuestions(
  eligibleFieldPaths: readonly string[],
  answered: Readonly<Record<string, unknown>>,
  sourceType: JobImportSourceType | null
): EarlyQuestion[] {
  return eligibleFieldPaths
    .filter((fieldPath) => !(fieldPath in answered))
    .map((fieldPath) => buildQuestion(fieldPath, sourceType))
    .filter((question): question is EarlyQuestion => question !== null);
}

/** The single question to show now, or null when there is nothing safe to ask. */
export function nextEarlyQuestion(
  eligibleFieldPaths: readonly string[],
  answered: Readonly<Record<string, unknown>>,
  sourceType: JobImportSourceType | null
): EarlyQuestion | null {
  return availableEarlyQuestions(eligibleFieldPaths, answered, sourceType)[0] ?? null;
}

/** Human-readable summary of an answer, for the compact history. */
export function earlyAnswerLabel(fieldPath: string, value: unknown): string {
  const question = buildQuestion(fieldPath, null);
  const option = question?.options.find((candidate) => candidate.value === value);
  return option?.label ?? String(value ?? "");
}
