// Import pipeline orchestrator (plan §6.2). Pure and synchronous: normalize →
// segment → sections → field extractors (shared claim set) → prose composition →
// classification. Deterministic precedence rules that span extractors live here —
// notably: an explicitly extracted compensation unit always overrides an
// employment-type-derived budget-unit hint (plan D19).

import { normalizeImportText } from "./normalize.ts";
import { segmentImportText } from "./segment.ts";
import { detectSections } from "./sections.ts";
import { createClaimSet } from "./textMatch.ts";
import { extractBudget } from "./extractors/budget.ts";
import { extractWorkModeAndCity } from "./extractors/locationWorkMode.ts";
import { extractTitle } from "./extractors/titleRole.ts";
import { extractEmploymentType } from "./extractors/employmentType.ts";
import { extractExperienceAndTimeline } from "./extractors/experienceTimeline.ts";
import { extractPlatformsToolsLanguages } from "./extractors/platformsToolsLanguages.ts";
import { extractCreatorContext } from "./extractors/creatorContext.ts";
import { extractLinks } from "./extractors/links.ts";
import { composeNarrative } from "./compose.ts";
import { classifyJobPost } from "./classify.ts";
import { categoryForRole } from "./categoryMap.ts";
import type { JobCategory } from "../types.ts";
import type { FieldExtraction, ImportParseResult, ImportWarning } from "./types.ts";

export function parseJobPost(raw: string): ImportParseResult {
  const source = normalizeImportText(raw);
  const doc = detectSections(segmentImportText(source.text), source.text);
  const warnings: ImportWarning[] = [];
  const claims = createClaimSet();

  if (source.truncated) {
    warnings.push({
      code: "truncated-input",
      message: "Your paste was longer than 20,000 characters — we analyzed the first 20,000.",
    });
  }

  const { budget, explicitUnit } = extractBudget(doc, warnings, claims);
  const { workMode, city } = extractWorkModeAndCity(doc, warnings, claims);
  const { title, rolesDetected } = extractTitle(doc, warnings, claims);
  const { employmentType, unitHint } = extractEmploymentType(doc, warnings);
  const timeline = extractExperienceAndTimeline(doc, warnings, claims);
  const media = extractPlatformsToolsLanguages(doc);
  const context = extractCreatorContext(doc, claims);
  const links = extractLinks(doc, warnings, claims);

  // Deterministic precedence: employment type supplies a billing period only when
  // the post stated no explicit compensation unit.
  if (unitHint && budget.value && !explicitUnit) {
    budget.value = { ...budget.value, unit: unitHint };
    if (employmentType.value && employmentType.status === "imported") {
      const hintNote = `"${employmentType.value}" in the post — we set the budget to ${unitHint}.`;
      employmentType.note = employmentType.note ? `${employmentType.note} ${hintNote}` : hintNote;
    }
  }

  // Category from the primary detected role (plan D13). Uncertain mappings are
  // suggestions the review screen requires the employer to confirm.
  const primaryRole = rolesDetected[0] ?? null;
  const mapped = categoryForRole(primaryRole);
  const categoryConfident = mapped.confident && title.status !== "conflict" && primaryRole !== null;
  const category: FieldExtraction<JobCategory> = {
    status: categoryConfident ? "imported" : "review",
    value: mapped.value,
    evidence: title.evidence,
    note: categoryConfident
      ? undefined
      : primaryRole
        ? `We weren't sure where a ${primaryRole.replace(/\b\w/g, (c) => c.toUpperCase())} role fits — pick a category to continue.`
        : "We couldn't tell the category from the post — pick one to continue.",
  };

  const prose = composeNarrative(doc, claims, {
    deadlineSentence: timeline.deadlineSentence,
    deadlineEvidence: timeline.deadline.evidence,
  });

  // Tags: hashtags + off-form platform mentions. Employment-type tags are appended
  // by applyToWizard so the extraction stays faithful to the source wording.
  const tagValues = [...context.hashtags, ...media.offPlatformTags.filter((t) => !context.hashtags.includes(t))];
  const tags: FieldExtraction<string[]> =
    tagValues.length > 0
      ? { status: "imported", value: tagValues, evidence: [] }
      : { status: "missing", value: null, evidence: [] };

  const classification = classifyJobPost(doc, {
    rolesDetected,
    budget,
    contactSignals: links.applicationSignals.contactLines.length,
  });

  return {
    version: 1,
    source: { normalized: source.text, charCount: source.charCount, truncated: source.truncated },
    classification,
    draft: {
      title,
      category,
      employmentType,
      budget,
      workMode,
      city,
      experience: timeline.experience,
      startWithin: timeline.startWithin,
      platforms: media.platforms,
      turnaround: timeline.turnaround,
      tools: media.tools,
      languages: media.languages,
      about: prose.about,
      responsibilities: prose.responsibilities,
      requirements: prose.requirements,
      howToApply: prose.howToApply,
      applicationSignals: links.applicationSignals,
      tags,
      contentNiches: context.contentNiches,
      contentGenres: context.contentGenres,
      formatsHiredFor: context.formatsHiredFor,
      refVideos: links.refVideos,
      deadline: timeline.deadline,
    },
    unmapped: prose.unmapped,
    warnings,
  };
}
