// Map an ImportParseResult (+ the review screen's title/category choices) into the
// exact PostJobPage state values, per-field meta for the ImportReviewBanner, and
// the fast-path initial step (plan D12/D13).

import { formatBudgetPreview, formatExperiencePreview } from "../format.ts";
import { normalizeCreatorContextList } from "../jobCreatorContext.ts";
import { sanitizeRequirementKeys } from "../firstMessageRequirements.ts";
import type { JobCategory } from "../types.ts";
import type {
  FieldExtraction,
  ImportFieldKey,
  ImportFieldMeta,
  ImportInitialStep,
  ImportParseResult,
  WizardPrefill,
} from "./types.ts";

// Mirrors PostJobPage's file-local budgetIntentLabel (deliberately not exported
// from that 2,900-line component).
const budgetIntentLabel = (intent: "" | "range" | "flexible" | "contact") =>
  intent === "contact" ? "Contact for pricing" : intent === "flexible" ? "Flexible" : "";

/** ImportFieldKey → JOB_COMPLETION_TARGETS key (PostJobPage's jump mechanism). */
export const IMPORT_JUMP_TARGETS: Partial<Record<ImportFieldKey, string>> = {
  title: "basics",
  category: "basics",
  budget: "budget",
  workMode: "basics",
  city: "basics",
  platforms: "basics",
  experience: "experience",
  startWithin: "start",
  turnaround: "turnaround",
  employmentType: "basics",
  tools: "tools",
  languages: "timeline",
  about: "about",
  responsibilities: "responsibilities",
  requirements: "requirements",
  howToApply: "howToApply",
  applicationSignals: "job-first-message",
  tags: "tags",
  contentNiches: "contentNiches",
  contentGenres: "contentGenres",
  formatsHiredFor: "formatsHiredFor",
  refVideos: "referenceVideos",
  deadline: "howToApply",
};

/** Human labels for banner jump pills and review rows. */
export const IMPORT_FIELD_LABELS: Record<ImportFieldKey, string> = {
  title: "Job title",
  category: "Category",
  employmentType: "Employment type",
  budget: "Budget",
  workMode: "Work mode",
  city: "City",
  experience: "Experience",
  startWithin: "Start",
  platforms: "Platform",
  turnaround: "Turnaround",
  tools: "Tools",
  languages: "Languages",
  about: "About",
  responsibilities: "Responsibilities",
  requirements: "Requirements",
  howToApply: "How to apply",
  applicationSignals: "Application instructions",
  tags: "Tags",
  contentNiches: "Content niches",
  contentGenres: "Genres",
  formatsHiredFor: "Formats hired for",
  refVideos: "Reference videos",
  deadline: "Deadline",
};

const STEP_ORDER: ImportInitialStep[] = [
  "basics",
  "details",
  "about",
  "creatorContext",
  "toolsTags",
  "applicationRequirements",
  "referenceVideos",
];

// Publish-relevant fields, in wizard order: the first one that is missing or under
// review decides where the wizard opens.
const PUBLISH_RELEVANT: Array<{ key: ImportFieldKey; step: ImportInitialStep }> = [
  { key: "title", step: "basics" },
  { key: "platforms", step: "basics" },
  { key: "workMode", step: "basics" },
  { key: "city", step: "basics" },
  { key: "budget", step: "basics" },
  { key: "about", step: "about" },
];

export type WizardHandoffDraft = {
  prefill: WizardPrefill;
  meta: ImportFieldMeta;
  initialStep: ImportInitialStep;
};

export function toWizardPrefill(
  result: ImportParseResult,
  chosenTitleIndex: number | null,
  chosenCategory: JobCategory
): WizardHandoffDraft {
  const d = result.draft;

  // ---- Title (conflict resolution from the review screen) ----
  let title = d.title.value ?? "";
  if (d.title.status === "conflict" && d.title.alternatives && chosenTitleIndex !== null) {
    title = d.title.alternatives[chosenTitleIndex]?.value ?? title;
  }

  // ---- Budget ----
  const budget = d.budget.value;
  const budgetMin = budget?.min ?? "";
  const budgetMax = budget?.max ?? "";
  const budgetUnit = budget?.unit ?? "per project";
  const budgetIntent = budget?.intent ?? "";

  // ---- Work mode / city ----
  const workMode = d.workMode.value ?? "";
  const city = workMode === "Remote" ? "" : (d.city.value ?? "");

  // ---- Experience ----
  const expMin = d.experience.value?.min ?? "";
  const expMax = d.experience.value?.max ?? "";

  // ---- Platforms ----
  const platforms = d.platforms.value ?? [];
  const platform = platforms[0] ?? "";

  // ---- Tags: source tags + preserved employment-type tag (plan D19) ----
  const tags = [...(d.tags.value ?? [])];
  if (d.employmentType.value && !tags.some((t) => t.toLowerCase() === d.employmentType.value)) {
    tags.push(d.employmentType.value);
  }

  // ---- Preview strings (what the wizard's PreviewCard reads) ----
  const previewBudgetText =
    budgetIntent === "range" && budgetMin && budgetMax
      ? formatBudgetPreview(budgetMin, budgetMax, budgetUnit)
      : budgetIntentLabel(budgetIntent);
  const previewExperienceText = expMin && expMax ? formatExperiencePreview(expMin, expMax) : "";
  const previewLocationText =
    workMode === "Remote" ? "Remote" : workMode && city ? `${workMode} - ${city}` : "";

  const prefill: WizardPrefill = {
    title,
    category: chosenCategory,
    budgetMin,
    budgetMax,
    budgetUnit,
    budgetIntent,
    workMode,
    city,
    expMin,
    expMax,
    startWithin: d.startWithin.value ?? "",
    platform,
    platforms,
    turnaround: d.turnaround.value ?? null,
    tools: d.tools.value ?? [],
    languages: d.languages.value ?? [],
    about: d.about.value ?? "",
    responsibilities: d.responsibilities.value ?? "",
    requirements: d.requirements.value ?? "",
    howToApply: d.howToApply.value ?? "",
    applicationRequirements: sanitizeRequirementKeys(d.applicationSignals.suggestedRequirements, "job"),
    tags,
    contentNiches: normalizeCreatorContextList(d.contentNiches.value ?? []),
    contentGenres: normalizeCreatorContextList(d.contentGenres.value ?? []),
    formatsHiredFor: normalizeCreatorContextList(d.formatsHiredFor.value ?? []),
    refVideos: (d.refVideos.value ?? []).slice(0, 3),
    previewBudgetText,
    previewExperienceText,
    previewLocationText,
  };

  // ---- Per-field meta for the wizard banner ----
  const meta: ImportFieldMeta = {};
  const fieldEntries = Object.entries(d) as Array<[ImportFieldKey, FieldExtraction<unknown>]>;
  for (const [key, extraction] of fieldEntries) {
    if (key === "applicationSignals") continue;
    meta[key] = {
      status: key === "title" && d.title.status === "conflict" && chosenTitleIndex !== null ? "imported" : extraction.status,
      note: extraction.note,
      snippet: extraction.evidence[0]?.snippet,
    };
  }
  if (d.applicationSignals.contactLines.length > 0) {
    meta.applicationSignals = {
      status: "review",
      note: "Applications on CreatorJobs arrive in your Inbox — external contact details weren't copied into your listing.",
      snippet: d.applicationSignals.contactLines[0]?.snippet,
    };
  }
  // The confirmed category is no longer pending.
  meta.category = { status: "imported", note: undefined, snippet: d.category.evidence[0]?.snippet };

  // ---- Fast path (plan D12) ----
  let initialStep: ImportInitialStep = "referenceVideos";
  for (const { key, step } of PUBLISH_RELEVANT) {
    const status = meta[key]?.status;
    if (key === "city" && prefill.workMode === "Remote") continue;
    if (key === "city" && prefill.workMode === "" && status === "missing") continue; // mode decides first
    if (status === "missing" || status === "review" || status === "conflict") {
      initialStep = step;
      break;
    }
  }
  // Keep a stable, wizard-known step even if the list above ever changes.
  if (!STEP_ORDER.includes(initialStep)) initialStep = "basics";

  return { prefill, meta, initialStep };
}
