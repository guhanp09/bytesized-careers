// Creator-context extraction (plan §6.4.7): niches, genres, and formats via the
// shared search vocabularies, plus hashtags → candidate tags. Display values are
// canonicalized against the wizard's suggestion lists so casing matches exactly.

import { FORMAT_VOCAB, GENRE_VOCAB, NICHE_VOCAB } from "../../search/searchVocabulary.ts";
import {
  CONTENT_GENRE_SUGGESTIONS,
  CONTENT_NICHE_SUGGESTIONS,
  FORMATS_HIRED_FOR_SUGGESTIONS,
} from "../../jobCreatorContext.ts";
import type { SectionedDoc } from "../sections.ts";
import type { ClaimSet } from "../textMatch.ts";
import { makeEvidence, scanVocab, tokenize } from "../textMatch.ts";
import type { FieldExtraction, ImportEvidence } from "../types.ts";

export type CreatorContextExtractionResult = {
  contentNiches: FieldExtraction<string[]>;
  contentGenres: FieldExtraction<string[]>;
  formatsHiredFor: FieldExtraction<string[]>;
  hashtags: string[];
};

const HASHTAG_RE = /#([A-Za-z0-9_]{2,30})/g;
const MAX_HASHTAG_TAGS = 10;

function toSuggestionCasing(canonical: string, suggestions: readonly string[]): string {
  const match = suggestions.find((s) => s.toLowerCase() === canonical.toLowerCase());
  return match ?? canonical;
}

function collect(
  doc: SectionedDoc,
  vocab: typeof NICHE_VOCAB,
  suggestions: readonly string[]
): { values: string[]; evidence: ImportEvidence[] } {
  const values: string[] = [];
  const evidence: ImportEvidence[] = [];
  for (const unit of doc.units) {
    if (unit.kind === "blank" || unit.kind === "url" || unit.kind === "contact") continue;
    const tokens = tokenize(unit.text, unit.start);
    for (const hit of scanVocab(tokens, vocab, { exact: true })) {
      const display = toSuggestionCasing(hit.canonical, suggestions);
      if (!values.includes(display)) {
        values.push(display);
        if (evidence.length < 3) evidence.push(makeEvidence(doc.text, hit.start, hit.end));
      }
    }
  }
  return { values, evidence };
}

function toExtraction(collected: { values: string[]; evidence: ImportEvidence[] }): FieldExtraction<string[]> {
  if (collected.values.length === 0) return { status: "missing", value: null, evidence: [] };
  return { status: "imported", value: collected.values, evidence: collected.evidence };
}

export function extractCreatorContext(doc: SectionedDoc, claims: ClaimSet): CreatorContextExtractionResult {
  const niches = collect(doc, NICHE_VOCAB, CONTENT_NICHE_SUGGESTIONS);
  const genres = collect(doc, GENRE_VOCAB, CONTENT_GENRE_SUGGESTIONS);
  const formats = collect(doc, FORMAT_VOCAB, FORMATS_HIRED_FOR_SUGGESTIONS);

  const hashtags: string[] = [];
  for (const unit of doc.units) {
    for (const match of unit.text.matchAll(HASHTAG_RE)) {
      const tag = match[1];
      if (!hashtags.some((t) => t.toLowerCase() === tag.toLowerCase())) {
        hashtags.push(tag);
        if (hashtags.length >= MAX_HASHTAG_TAGS) break;
      }
    }
    if (unit.kind === "hashtagRow") claims.add(unit.start, unit.end);
    if (hashtags.length >= MAX_HASHTAG_TAGS) break;
  }

  return {
    contentNiches: toExtraction(niches),
    contentGenres: toExtraction(genres),
    formatsHiredFor: toExtraction(formats),
    hashtags,
  };
}
