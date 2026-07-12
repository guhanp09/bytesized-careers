// Import Hiring Post — shared contracts for the deterministic paste-to-draft parser.
//
// Everything in lib/importJob is pure TypeScript with no DOM/React dependencies so
// it runs under `node --test` type-stripping and could load inside a Web Worker.
// Relative imports must keep explicit `.ts` extensions; types-only imports must use
// `import type` (see lib/search/queryParser.ts for the established pattern).

import type { JobCategory, ReferenceVideo, StartTimeframe } from "../types.ts";

export type ImportFieldStatus = "imported" | "review" | "conflict" | "missing" | "unsupported";

export type ImportEvidence = {
  /** Human-readable quote around the match, ≤160 chars, codepoint-safe. */
  snippet: string;
  /** [start, end) offsets of the matched phrase into ImportParseResult.source.normalized. */
  start: number;
  end: number;
};

export type FieldExtraction<T> = {
  status: ImportFieldStatus;
  /**
   * null for missing fields, and for "review"/"conflict" fields that have evidence
   * but no safe prefill (annual compensation, region-only city). "unsupported"
   * fields are usually null too — employmentType is the exception: it keeps its
   * value so the tag survives even when the form can't represent it.
   */
  value: T | null;
  evidence: ImportEvidence[];
  alternatives?: Array<{ value: T; evidence: ImportEvidence }>;
  /** User-facing note. Calm, sentence case. */
  note?: string;
};

export type ImportBudgetValue = {
  /** Digit strings in the wizard's format; both empty = no prefilled amount. */
  min: string;
  max: string;
  unit: "per project" | "per month";
  intent: "" | "range" | "flexible" | "contact";
};

export type ImportEmploymentType =
  | "full-time"
  | "part-time"
  | "internship"
  | "freelance"
  | "contract"
  | "retainer";

export type ImportSuggestedRequirement = "relevant_portfolio" | "expected_rate" | "start_availability";

/** Contact/off-platform routing found in the post. Never prefilled into public fields. */
export type ApplicationSignals = {
  contactLines: ImportEvidence[];
  suggestedRequirements: ImportSuggestedRequirement[];
};

export type ImportedJobDraft = {
  title: FieldExtraction<string>;
  category: FieldExtraction<JobCategory>;
  employmentType: FieldExtraction<ImportEmploymentType>;
  budget: FieldExtraction<ImportBudgetValue>;
  workMode: FieldExtraction<"Remote" | "Hybrid" | "On-site">;
  city: FieldExtraction<string>;
  experience: FieldExtraction<{ min: string; max: string }>;
  startWithin: FieldExtraction<StartTimeframe>;
  platforms: FieldExtraction<Array<"youtube" | "instagram">>;
  turnaround: FieldExtraction<{ value: number; unit: "hours" | "days" | "weeks" }>;
  tools: FieldExtraction<string[]>;
  languages: FieldExtraction<string[]>;
  about: FieldExtraction<string>;
  /** Newline-joined bullet lines (the wizard's BulletListEditor format). */
  responsibilities: FieldExtraction<string>;
  requirements: FieldExtraction<string>;
  /** Native screening instructions + verbatim deadline sentence only. No contacts. */
  howToApply: FieldExtraction<string>;
  applicationSignals: ApplicationSignals;
  tags: FieldExtraction<string[]>;
  contentNiches: FieldExtraction<string[]>;
  contentGenres: FieldExtraction<string[]>;
  formatsHiredFor: FieldExtraction<string[]>;
  refVideos: FieldExtraction<ReferenceVideo[]>;
  /** Found deadlines are "unsupported" (no form field); the sentence is kept in howToApply. */
  deadline: FieldExtraction<string>;
};

export type ImportFieldKey = keyof ImportedJobDraft;

export type ImportWarningCode =
  | "non-inr-currency"
  | "multiple-roles"
  | "city-not-recognized"
  | "per-unit-coerced"
  | "single-amount-as-range"
  | "annual-compensation"
  | "truncated-input"
  | "multiple-budgets"
  | "deadline-unsupported"
  | "external-application-routing"
  | "region-needs-city"
  | "engagement-type-unsupported";

export type ImportWarning = { code: ImportWarningCode; message: string; evidence?: ImportEvidence };

export type ImportClassification = {
  looksLikeJobPost: boolean;
  score: number;
  reasons: string[];
  rolesDetected: string[];
};

export type ImportParseResult = {
  version: 1;
  /** Raw input is NOT retained; all offsets refer to `normalized`. */
  source: { normalized: string; charCount: number; truncated: boolean };
  classification: ImportClassification;
  draft: ImportedJobDraft;
  /** Lines the parser left out entirely — shown in review so nothing silently disappears. */
  unmapped: string[];
  warnings: ImportWarning[];
};

// ---------------------------------------------------------------------------
// Handoff (import page → wizard) contracts
// ---------------------------------------------------------------------------

export type ImportInitialStep =
  | "basics"
  | "details"
  | "about"
  | "creatorContext"
  | "toolsTags"
  | "applicationRequirements"
  | "referenceVideos";

/** EXACT wizard state values — one property per setter in PostJobPage's hydration. */
export type WizardPrefill = {
  title: string;
  category: JobCategory;
  budgetMin: string;
  budgetMax: string;
  budgetUnit: "per project" | "per month";
  budgetIntent: "" | "range" | "flexible" | "contact";
  workMode: "" | "Remote" | "Hybrid" | "On-site";
  city: string;
  expMin: string;
  expMax: string;
  startWithin: StartTimeframe | "";
  platform: "" | "youtube" | "instagram";
  platforms: Array<"youtube" | "instagram">;
  turnaround: { value: number; unit: "hours" | "days" | "weeks" } | null;
  tools: string[];
  languages: string[];
  about: string;
  responsibilities: string;
  requirements: string;
  howToApply: string;
  applicationRequirements: string[];
  tags: string[];
  contentNiches: string[];
  contentGenres: string[];
  formatsHiredFor: string[];
  refVideos: ReferenceVideo[];
  previewBudgetText: string;
  previewExperienceText: string;
  previewLocationText: string;
};

export type ImportFieldMeta = Partial<
  Record<ImportFieldKey, { status: ImportFieldStatus; note?: string; snippet?: string }>
>;

export type ImportHandoffPayloadV1 = {
  version: 1;
  createdAt: number;
  /** backendUserId when authenticated, "anon" otherwise. Validated on every read. */
  owner: string;
  initialStep: ImportInitialStep;
  prefill: WizardPrefill;
  meta: ImportFieldMeta;
};
