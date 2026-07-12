// Employment-type extraction (plan D19). A first-class concept: shown in review,
// preserved as a tag, never mapped to work mode. Representable intents supply a
// budget-unit hint that applies ONLY when the post has no explicit compensation
// unit (deterministic precedence, enforced by the orchestrator).

import type { VocabEntry } from "../../search/searchVocabulary.ts";
import type { SectionedDoc } from "../sections.ts";
import { makeEvidence, scanVocab, tokenize } from "../textMatch.ts";
import type { FieldExtraction, ImportEmploymentType, ImportWarning } from "../types.ts";

export type EmploymentExtractionResult = {
  employmentType: FieldExtraction<ImportEmploymentType>;
  /** Applied by the orchestrator only when the budget extractor found no explicit unit. */
  unitHint: "per month" | "per project" | null;
};

const EMPLOYMENT_VOCAB: VocabEntry[] = [
  { canonical: "full-time", aliases: ["full time", "full-time", "fulltime", "salaried"] },
  { canonical: "part-time", aliases: ["part time", "part-time", "parttime"] },
  { canonical: "internship", aliases: ["internship", "intern"] },
  { canonical: "freelance", aliases: ["freelance", "freelancer"] },
  { canonical: "contract", aliases: ["contract", "contractor", "contractual", "contract basis"] },
  { canonical: "retainer", aliases: ["retainer", "monthly retainer"] },
];

const UNIT_HINT: Record<ImportEmploymentType, "per month" | "per project" | null> = {
  "full-time": "per month",
  retainer: "per month",
  freelance: "per project",
  contract: "per project",
  "part-time": null,
  internship: null,
};

export function extractEmploymentType(doc: SectionedDoc, warnings: ImportWarning[]): EmploymentExtractionResult {
  const hits: Array<{ canonical: ImportEmploymentType; start: number; end: number }> = [];

  for (const unit of doc.units) {
    if (unit.kind === "blank" || unit.kind === "url" || unit.kind === "hashtagRow") continue;
    const tokens = tokenize(unit.text, unit.start);
    // Exact matching only: fuzzy would let "internal" collide with "intern".
    for (const hit of scanVocab(tokens, EMPLOYMENT_VOCAB, { exact: true })) {
      hits.push({ canonical: hit.canonical as ImportEmploymentType, start: hit.start, end: hit.end });
    }
  }

  hits.sort((a, b) => a.start - b.start);
  if (hits.length === 0) {
    return { employmentType: { status: "missing", value: null, evidence: [] }, unitHint: null };
  }

  const primary = hits[0];
  const evidence = makeEvidence(doc.text, primary.start, primary.end);
  const distinctOthers = [...new Set(hits.slice(1).map((h) => h.canonical))].filter((c) => c !== primary.canonical);

  if (primary.canonical === "part-time" || primary.canonical === "internship") {
    const label = primary.canonical === "internship" ? "internship" : "part-time";
    warnings.push({
      code: "engagement-type-unsupported",
      message: `CreatorJobs doesn't have a ${label} engagement type yet — we kept it as a tag.`,
      evidence,
    });
    return {
      employmentType: {
        status: "unsupported",
        value: primary.canonical,
        evidence: [evidence],
        note: `CreatorJobs doesn't have a ${label} engagement type yet — we kept it as a tag so applicants still see it.`,
      },
      unitHint: null,
    };
  }

  return {
    employmentType: {
      status: "imported",
      value: primary.canonical,
      evidence: [evidence],
      note:
        distinctOthers.length > 0
          ? `The post also mentions ${distinctOthers.join(", ")} — we kept "${primary.canonical}".`
          : undefined,
    },
    unitHint: UNIT_HINT[primary.canonical],
  };
}
