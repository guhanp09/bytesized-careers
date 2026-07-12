// Job-title extraction (plan §6.4.2). Candidate priority: role-labeled KV value →
// heading containing a known role → "looking for / hiring …" pattern → first
// ROLE_VOCAB hit. Two or more distinct roles in the title zone become a conflict
// the review screen resolves with a picker.

import { ROLE_VOCAB } from "../../search/searchVocabulary.ts";
import type { SectionedDoc, SectionedUnit } from "../sections.ts";
import type { ClaimSet } from "../textMatch.ts";
import { makeEvidence, scanVocab, titleCase, tokenize } from "../textMatch.ts";
import { truncateCodepoints } from "../normalize.ts";
import type { FieldExtraction, ImportEvidence, ImportWarning } from "../types.ts";

export type TitleExtractionResult = {
  title: FieldExtraction<string>;
  /** Distinct role canonicals in mention order (feeds classification + category). */
  rolesDetected: string[];
};

const TITLE_ZONE_UNITS = 8;
const TITLE_MAX = 94;
const CONFLICT_ZONE_UNITS = 2;
const HIRING_PATTERN_RE =
  /(?:looking for|hiring|we need|we're hiring|seeking|searching for|need|wanted)\s*[:\-–]?\s*(?:a|an)?\s+([^,.!?\n]{3,80})/i;

function cleanTitle(raw: string): string {
  const cleaned = raw
    .replace(/^[-\s:•*"'#]+/, "")
    .replace(/[\s:•*"'#!.]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
  return truncateCodepoints(cleaned, TITLE_MAX);
}

export function extractTitle(doc: SectionedDoc, warnings: ImportWarning[], claims: ClaimSet): TitleExtractionResult {
  // Bullets and units under responsibilities/requirements headings describe the
  // work, not the role being hired — they never feed the title zone (a
  // "Collaborate with our scriptwriter" duty must not create a phantom role).
  const nonBlank = doc.units.filter(
    (unit) =>
      unit.kind !== "blank" &&
      unit.kind !== "bullet" &&
      unit.section !== "responsibilities" &&
      unit.section !== "requirements"
  );
  const zone: SectionedUnit[] = [
    ...doc.units.filter((unit) => unit.label === "role"),
    ...nonBlank.slice(0, TITLE_ZONE_UNITS).filter((unit) => unit.label !== "role"),
  ];

  // Role hits only count from title-ish units: role KV lines, headings, units
  // containing hiring language, and the very first units of the post. Exact
  // matching only — fuzzy role matching turns verbs ("write") into roles.
  const roleHits: Array<{ canonical: string; start: number; end: number; unit: SectionedUnit }> = [];
  const firstUnits = nonBlank.slice(0, CONFLICT_ZONE_UNITS);
  for (const unit of zone) {
    if (unit.kind === "url" || unit.kind === "hashtagRow") continue;
    const titleish =
      unit.label === "role" ||
      unit.kind === "heading" ||
      HIRING_PATTERN_RE.test(unit.text) ||
      firstUnits.includes(unit);
    if (!titleish) continue;
    const tokens = tokenize(unit.text, unit.start);
    for (const hit of scanVocab(tokens, ROLE_VOCAB, { exact: true })) {
      roleHits.push({ canonical: hit.canonical, start: hit.start, end: hit.end, unit });
    }
  }
  roleHits.sort((a, b) => a.start - b.start);
  const rolesDetected: string[] = [];
  for (const hit of roleHits) {
    if (!rolesDetected.includes(hit.canonical)) rolesDetected.push(hit.canonical);
  }

  // Candidate title text by priority.
  let candidateText: string | null = null;
  let candidateEvidence: ImportEvidence | null = null;
  let candidateFromPattern = false;

  const roleKv = doc.units.find((unit) => unit.label === "role" && unit.kvValue && unit.kvValue.trim().length >= 3);
  if (roleKv?.kvValue) {
    candidateText = cleanTitle(roleKv.kvValue);
    candidateEvidence = makeEvidence(doc.text, roleKv.kvValueStart, roleKv.kvValueStart + roleKv.kvValue.length);
    claims.add(roleKv.start, roleKv.end);
  }

  if (!candidateText) {
    const headingHit = roleHits.find((hit) => hit.unit.kind === "heading");
    if (headingHit) {
      candidateText = cleanTitle(headingHit.unit.text);
      candidateEvidence = makeEvidence(doc.text, headingHit.unit.start, headingHit.unit.end);
      claims.add(headingHit.unit.start, headingHit.unit.end);
    }
  }

  if (!candidateText) {
    for (const unit of zone) {
      if (unit.kind === "url" || unit.kind === "hashtagRow") continue;
      const match = unit.text.match(HIRING_PATTERN_RE);
      if (match && match.index !== undefined) {
        const captured = cleanTitle(match[1]);
        if (captured.length >= 3) {
          candidateText = captured;
          candidateEvidence = makeEvidence(
            doc.text,
            unit.start + match.index,
            unit.start + match.index + match[0].length
          );
          candidateFromPattern = true;
          break;
        }
      }
    }
  }

  if (!candidateText && roleHits.length > 0) {
    candidateText = titleCase(roleHits[0].canonical);
    candidateEvidence = makeEvidence(doc.text, roleHits[0].start, roleHits[0].end);
  }

  if (!candidateText || !candidateEvidence) {
    return { title: { status: "missing", value: null, evidence: [] }, rolesDetected };
  }

  if (rolesDetected.length >= 2) {
    const alternatives: Array<{ value: string; evidence: ImportEvidence }> = rolesDetected.map((canonical) => {
      const hit = roleHits.find((h) => h.canonical === canonical)!;
      return { value: titleCase(canonical), evidence: makeEvidence(doc.text, hit.start, hit.end) };
    });
    // The combined source phrase, when one unit mentions several roles and fits.
    const multiUnit = zone.find((unit) => {
      const inUnit = roleHits.filter((h) => h.unit === unit);
      return new Set(inUnit.map((h) => h.canonical)).size >= 2;
    });
    if (multiUnit) {
      const combined = cleanTitle(multiUnit.text);
      if (combined.length >= 3 && combined.length <= TITLE_MAX && !alternatives.some((a) => a.value === combined)) {
        alternatives.push({ value: combined, evidence: makeEvidence(doc.text, multiUnit.start, multiUnit.end) });
      }
    }
    warnings.push({
      code: "multiple-roles",
      message: `This post mentions ${rolesDetected.length} roles. Jobs on CreatorJobs work best with one role — you can import again for the other.`,
      evidence: candidateEvidence,
    });
    return {
      title: {
        status: "conflict",
        value: alternatives[0].value,
        evidence: [candidateEvidence],
        alternatives,
        note: `This post mentions ${rolesDetected.length} roles. Jobs on CreatorJobs work best with one role — you can import again for the other.`,
      },
      rolesDetected,
    };
  }

  return {
    title: {
      status: rolesDetected.length === 0 && candidateFromPattern ? "review" : "imported",
      value: candidateText,
      evidence: [candidateEvidence],
      note: rolesDetected.length === 0 && candidateFromPattern ? "Confirm the job title — we couldn't match it to a known role." : undefined,
    },
    rolesDetected,
  };
}
