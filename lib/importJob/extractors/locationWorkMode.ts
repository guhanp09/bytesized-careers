// Work mode × city extraction (plan §6.4.1). Only remote/onsite/hybrid map to the
// form's work mode — freelance/retainer/full-time never do (they are employment
// type). Regions (NCR) and multiple cities become conflicts, never auto-picks.

import {
  LOCATION_ALIASES,
  LOCATION_CANONICALS,
  LOCATION_EXPANSIONS,
  WORK_MODE_VOCAB,
  type VocabEntry,
} from "../../search/searchVocabulary.ts";
import type { SectionedDoc, SectionedUnit } from "../sections.ts";
import type { ClaimSet } from "../textMatch.ts";
import { makeEvidence, scanVocab, tokenize } from "../textMatch.ts";
import type { FieldExtraction, ImportEvidence, ImportWarning } from "../types.ts";

export type WorkModeValue = "Remote" | "Hybrid" | "On-site";

export type LocationExtractionResult = {
  workMode: FieldExtraction<WorkModeValue>;
  city: FieldExtraction<string>;
};

const MODE_CANONICAL_TO_FORM: Record<string, WorkModeValue> = {
  remote: "Remote",
  hybrid: "Hybrid",
  onsite: "On-site",
};

// Only the true work-mode entries; freelance/retainer/part-time/full-time are
// deliberately excluded (regression-tested).
const MODE_VOCAB: VocabEntry[] = WORK_MODE_VOCAB.filter((entry) =>
  ["remote", "onsite", "hybrid"].includes(entry.canonical)
);

const CITY_VOCAB: VocabEntry[] = [
  ...LOCATION_CANONICALS.map((city) => ({ canonical: city, aliases: [city.toLowerCase()] })),
  ...Object.entries(LOCATION_ALIASES).map(([alias, city]) => ({ canonical: city, aliases: [alias] })),
];

type CityHit = { city: string; evidence: ImportEvidence };
type RegionHit = { cities: string[]; evidence: ImportEvidence };

export function extractWorkModeAndCity(
  doc: SectionedDoc,
  warnings: ImportWarning[],
  claims: ClaimSet
): LocationExtractionResult {
  const modeHits: Array<{ mode: WorkModeValue; evidence: ImportEvidence }> = [];
  const cityHits: CityHit[] = [];
  let regionHit: RegionHit | null = null;
  let unrecognizedLocation: { text: string; evidence: ImportEvidence; unit: SectionedUnit } | null = null;

  const scanUnit = (unit: SectionedUnit) => {
    if (unit.kind === "blank" || unit.kind === "url" || unit.kind === "hashtagRow") return;
    const tokens = tokenize(unit.text, unit.start);

    // Exact only — fuzzy would let "remove" become "remote".
    for (const hit of scanVocab(tokens, MODE_VOCAB, { exact: true })) {
      const mode = MODE_CANONICAL_TO_FORM[hit.canonical];
      if (mode && !modeHits.some((m) => m.mode === mode)) {
        modeHits.push({ mode, evidence: makeEvidence(doc.text, hit.start, hit.end) });
      }
    }

    // Region expansions ("ncr", "delhi ncr") never auto-pick a city.
    const lowered = unit.text.toLowerCase();
    for (const [key, cities] of Object.entries(LOCATION_EXPANSIONS)) {
      const idx = lowered.indexOf(key);
      if (idx >= 0 && !regionHit) {
        regionHit = { cities, evidence: makeEvidence(doc.text, unit.start + idx, unit.start + idx + key.length) };
      }
    }

    // Exact matching only: fuzzy city matching turns ordinary words into cities
    // ("short" → Surat, "India" → Indore). Misspellings are covered by the alias map.
    for (const hit of scanVocab(tokens, CITY_VOCAB, { exact: true })) {
      if (!cityHits.some((c) => c.city === hit.canonical)) {
        cityHits.push({ city: hit.canonical, evidence: makeEvidence(doc.text, hit.start, hit.end) });
      }
    }
  };

  // Location-labeled KV lines first (they also surface unrecognized city text).
  const labeled = doc.units.filter((unit) => unit.label === "location");
  for (const unit of labeled) {
    scanUnit(unit);
    claims.add(unit.start, unit.end);
    if (unit.kvValue) {
      const valueTokens = tokenize(unit.kvValue, unit.kvValueStart);
      const matched =
        scanVocab(valueTokens, CITY_VOCAB).length > 0 ||
        scanVocab(valueTokens, MODE_VOCAB).length > 0 ||
        Object.keys(LOCATION_EXPANSIONS).some((key) => unit.kvValue!.toLowerCase().includes(key));
      if (!matched && unit.kvValue.trim().length >= 3) {
        unrecognizedLocation = {
          text: unit.kvValue.trim().slice(0, 80),
          evidence: makeEvidence(doc.text, unit.kvValueStart, unit.kvValueStart + unit.kvValue.length),
          unit,
        };
      }
    }
  }
  for (const unit of doc.units) {
    if (unit.label === "location") continue;
    scanUnit(unit);
  }

  const primaryMode = modeHits[0] ?? null;

  // ---- Work mode field ----
  let workMode: FieldExtraction<WorkModeValue>;
  if (!primaryMode) {
    workMode = { status: "missing", value: null, evidence: [] };
  } else if (modeHits.length > 1) {
    workMode = {
      status: "conflict",
      value: primaryMode.mode,
      evidence: [primaryMode.evidence],
      alternatives: modeHits.slice(1).map((m) => ({ value: m.mode, evidence: m.evidence })),
      note: "The post mentions more than one work mode — confirm which applies.",
    };
  } else {
    workMode = { status: "imported", value: primaryMode.mode, evidence: [primaryMode.evidence] };
  }

  // ---- City field ----
  const effectiveMode = primaryMode?.mode ?? null;
  let city: FieldExtraction<string>;

  if (effectiveMode === "Remote") {
    // The form doesn't collect a city for remote roles; a mentioned city becomes a
    // note on work mode instead of prefilled data.
    city = { status: "missing", value: null, evidence: [] };
    if (cityHits.length > 0 && workMode.status !== "conflict") {
      workMode.note = `The post also mentions ${cityHits[0].city} — switch to Hybrid or On-site if presence is required.`;
      workMode.status = "review";
      workMode.evidence = [...workMode.evidence, cityHits[0].evidence];
    }
  } else if (regionHit !== null || cityHits.length > 1) {
    const alternatives: Array<{ value: string; evidence: ImportEvidence }> = [];
    const region = regionHit as RegionHit | null;
    if (region) {
      for (const c of region.cities) alternatives.push({ value: c, evidence: region.evidence });
    }
    for (const hit of cityHits) {
      if (!alternatives.some((a) => a.value === hit.city)) alternatives.push({ value: hit.city, evidence: hit.evidence });
    }
    const evidence = region ? region.evidence : cityHits[0].evidence;
    city = {
      status: "conflict",
      value: null,
      evidence: [evidence],
      alternatives,
      note: `The post mentions ${region ? "a region" : "more than one city"} ("${evidence.snippet.trim()}") — pick the exact city.`,
    };
    warnings.push({
      code: "region-needs-city",
      message: "A region or multiple cities were mentioned — pick the exact city in the editor.",
      evidence,
    });
  } else if (cityHits.length === 1) {
    if (effectiveMode === "Hybrid" || effectiveMode === "On-site") {
      city = { status: "imported", value: cityHits[0].city, evidence: [cityHits[0].evidence] };
    } else {
      // Location without a work-mode word: never infer On-site.
      city = {
        status: "review",
        value: cityHits[0].city,
        evidence: [cityHits[0].evidence],
        note: "Pick Remote, Hybrid, or On-site — the post only mentions a location.",
      };
    }
  } else if (unrecognizedLocation) {
    const loc = unrecognizedLocation as { text: string; evidence: ImportEvidence };
    city = {
      status: "review",
      value: loc.text,
      evidence: [loc.evidence],
      note: `We couldn't match "${loc.text}" to a supported city — pick the closest one in the editor.`,
    };
    warnings.push({
      code: "city-not-recognized",
      message: `"${loc.text}" isn't in the supported city list.`,
      evidence: loc.evidence,
    });
  } else {
    city = { status: "missing", value: null, evidence: [] };
  }

  return { workMode, city };
}
