// Platform / tool / language extraction (plan §6.4.5–6). Only YouTube and
// Instagram map to the form's platforms; other platforms become tags with an
// explanatory note. Tool matching is exact-token against the shared TOOL_CATALOG
// aliases with a deny-list for generic words.

import { PLATFORM_VOCAB, LANGUAGE_VOCAB, type VocabEntry } from "../../search/searchVocabulary.ts";
import { TOOL_CATALOG } from "../../toolCatalog.ts";
import type { SectionedDoc } from "../sections.ts";
import { makeEvidence, scanVocab, tokenize } from "../textMatch.ts";
import type { FieldExtraction, ImportEvidence } from "../types.ts";

export type MediaExtractionResult = {
  platforms: FieldExtraction<Array<"youtube" | "instagram">>;
  tools: FieldExtraction<string[]>;
  languages: FieldExtraction<string[]>;
  /** Platform mentions the form can't attach to (tiktok, podcast, …) → tags. */
  offPlatformTags: string[];
};

const FORM_PLATFORMS = new Set(["youtube", "instagram"]);
// "shorts"/"reels" are formats, not attachable platforms.
const PLATFORM_SCAN_VOCAB = PLATFORM_VOCAB.filter((entry) => !["shorts", "reels"].includes(entry.canonical));

// Tool-catalog entries that duplicate platforms would double-claim platform mentions.
const TOOL_NAME_DENY = new Set(["Instagram", "TikTok", "LinkedIn", "X / Twitter"]);
// Generic words that are aliases of some tool but far too common in prose.
const TOOL_ALIAS_DENY = new Set([
  "analytics",
  "docs",
  "sheets",
  "drive",
  "monday",
  "motion",
  "later",
  "packaging",
  "research",
  "strategy",
  "buffer",
  "x",
  "twitter",
  "ig",
]);

const TOOL_VOCAB: VocabEntry[] = TOOL_CATALOG.filter((tool) => !TOOL_NAME_DENY.has(tool.name)).map((tool) => ({
  canonical: tool.name,
  aliases: [tool.name.toLowerCase(), ...tool.aliases.map((a) => a.toLowerCase())].filter(
    (alias) => alias.replace(/\s+/g, "").length >= 3 && !TOOL_ALIAS_DENY.has(alias)
  ),
}));

export function extractPlatformsToolsLanguages(doc: SectionedDoc): MediaExtractionResult {
  const platformHits: Array<{ canonical: string; evidence: ImportEvidence }> = [];
  const toolHits: Array<{ canonical: string; evidence: ImportEvidence }> = [];
  const labeledLanguages: Array<{ canonical: string; evidence: ImportEvidence }> = [];
  const looseLanguages: Array<{ canonical: string; evidence: ImportEvidence }> = [];

  for (const unit of doc.units) {
    if (unit.kind === "blank" || unit.kind === "url" || unit.kind === "hashtagRow") continue;
    const tokens = tokenize(unit.text, unit.start);

    for (const hit of scanVocab(tokens, PLATFORM_SCAN_VOCAB, { exact: true })) {
      if (!platformHits.some((p) => p.canonical === hit.canonical)) {
        platformHits.push({ canonical: hit.canonical, evidence: makeEvidence(doc.text, hit.start, hit.end) });
      }
    }

    for (const hit of scanVocab(tokens, TOOL_VOCAB, { exact: true })) {
      if (!toolHits.some((t) => t.canonical === hit.canonical)) {
        toolHits.push({ canonical: hit.canonical, evidence: makeEvidence(doc.text, hit.start, hit.end) });
      }
    }

    const languageTarget = unit.label === "language" ? labeledLanguages : looseLanguages;
    const languageTokens = unit.label === "language" && unit.kvValue ? tokenize(unit.kvValue, unit.kvValueStart) : tokens;
    for (const hit of scanVocab(languageTokens, LANGUAGE_VOCAB, { exact: true })) {
      if (
        !labeledLanguages.some((l) => l.canonical === hit.canonical) &&
        !languageTarget.some((l) => l.canonical === hit.canonical)
      ) {
        languageTarget.push({ canonical: hit.canonical, evidence: makeEvidence(doc.text, hit.start, hit.end) });
      }
    }
  }

  // ---- Platforms ----
  const formPlatforms = platformHits.filter((p) => FORM_PLATFORMS.has(p.canonical));
  const offPlatform = platformHits.filter((p) => !FORM_PLATFORMS.has(p.canonical));
  const offPlatformTags = offPlatform.map((p) => p.canonical);

  let platforms: FieldExtraction<Array<"youtube" | "instagram">>;
  if (formPlatforms.length > 0) {
    platforms = {
      status: "imported",
      value: formPlatforms.map((p) => p.canonical as "youtube" | "instagram"),
      evidence: formPlatforms.map((p) => p.evidence),
      note:
        offPlatform.length > 0
          ? `CreatorJobs jobs attach to YouTube or Instagram — we added ${offPlatform
              .map((p) => `"${p.canonical}"`)
              .join(", ")} as a tag.`
          : undefined,
    };
  } else if (offPlatform.length > 0) {
    platforms = {
      status: "missing",
      value: null,
      evidence: offPlatform.map((p) => p.evidence),
      note: `CreatorJobs jobs attach to YouTube or Instagram — we added ${offPlatform
        .map((p) => `"${p.canonical}"`)
        .join(", ")} as a tag.`,
    };
  } else {
    platforms = { status: "missing", value: null, evidence: [] };
  }

  // ---- Tools ----
  const tools: FieldExtraction<string[]> =
    toolHits.length > 0
      ? {
          status: "imported",
          value: toolHits.map((t) => t.canonical),
          evidence: toolHits.slice(0, 3).map((t) => t.evidence),
        }
      : { status: "missing", value: null, evidence: [] };

  // ---- Languages ----
  let languages: FieldExtraction<string[]>;
  if (labeledLanguages.length > 0) {
    languages = {
      status: "imported",
      value: labeledLanguages.map((l) => l.canonical),
      evidence: labeledLanguages.slice(0, 3).map((l) => l.evidence),
    };
  } else if (looseLanguages.length > 0) {
    languages = {
      status: "review",
      value: looseLanguages.map((l) => l.canonical),
      evidence: looseLanguages.slice(0, 3).map((l) => l.evidence),
      note: "We found language mentions — confirm they're requirements.",
    };
  } else {
    languages = { status: "missing", value: null, evidence: [] };
  }

  return { platforms, tools, languages, offPlatformTags };
}
