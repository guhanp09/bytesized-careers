// Shared token/vocabulary matching helpers for the import parser.
//
// All vocabulary matching is tokenize + edit distance (never regex over free text),
// mirroring lib/search/queryParser.ts semantics: short targets (≤3 chars) require an
// exact match, fuzzy matches must share the first letter, thresholds are 1–2 edits.

import { editDistance } from "../search/queryParser.ts";
import type { VocabEntry } from "../search/searchVocabulary.ts";
import type { ImportEvidence } from "./types.ts";

export type Token = {
  /** Lowercased token text. */
  text: string;
  /** Absolute [start, end) offsets into the normalized document. */
  start: number;
  end: number;
};

const TOKEN_RE = /[\p{L}\p{N}+#'@._/-]+/gu;

/** Tokenize a slice of the normalized document, keeping absolute offsets. */
export function tokenize(text: string, baseOffset = 0): Token[] {
  const tokens: Token[] = [];
  for (const match of text.matchAll(TOKEN_RE)) {
    let raw = match[0];
    let start = baseOffset + (match.index ?? 0);
    // Trim punctuation that the broad class keeps for emails/urls but that hurts
    // word matching ("premiere," → handled by class; "premiere." → trim the dot).
    let leading = 0;
    while (leading < raw.length && /[.'/@#+-]/.test(raw[leading]) && !/[#@+]/.test(raw[leading])) leading += 1;
    let trailing = raw.length;
    while (trailing > leading && /[.'/-]/.test(raw[trailing - 1])) trailing -= 1;
    const clean = raw.slice(leading, trailing);
    if (!clean || !/[\p{L}\p{N}]/u.test(clean)) continue;
    tokens.push({ text: clean.toLowerCase(), start: start + leading, end: start + trailing });
  }
  return tokens;
}

export type WordMatch = { match: boolean; corrected: boolean };

/** queryParser's wordMatch rules, re-implemented over its exported editDistance. */
export function wordMatch(token: string, target: string): WordMatch {
  if (token === target) return { match: true, corrected: false };
  if (target.length <= 3) return { match: false, corrected: false };
  if (token[0] !== target[0]) return { match: false, corrected: false };
  const threshold = target.length <= 4 ? 1 : 2;
  if (editDistance(token, target) <= threshold) return { match: true, corrected: true };
  return { match: false, corrected: false };
}

export type VocabHit = {
  canonical: string;
  /** Absolute offsets of the matched token span. */
  start: number;
  end: number;
  matchedText: string;
};

export type VocabScanOptions = {
  /** Disable fuzzy matching (exact tokens only). */
  exact?: boolean;
  /** Skip aliases shorter than this many characters (joined, no spaces). */
  minAliasLength?: number;
  /** Aliases to skip entirely (lowercased). */
  denyAliases?: ReadonlySet<string>;
};

/**
 * Longest-alias-first vocabulary scan over a token list. Each token can be claimed
 * by at most one alias within the scan (queryParser's claiming semantics), so
 * "thumbnail designer" wins over the looser "designer".
 */
export function scanVocab(tokens: Token[], vocab: VocabEntry[], options: VocabScanOptions = {}): VocabHit[] {
  const aliasList = vocab
    .flatMap((entry) =>
      entry.aliases.map((alias) => ({ canonical: entry.canonical, alias, words: alias.split(" ") }))
    )
    .filter(({ alias }) => {
      if (options.denyAliases?.has(alias)) return false;
      const joined = alias.replace(/\s+/g, "");
      return joined.length >= (options.minAliasLength ?? 1);
    })
    .sort((a, b) => b.words.length - a.words.length || b.alias.length - a.alias.length);

  const claimed = new Array(tokens.length).fill(false);
  const hits: VocabHit[] = [];

  for (const { canonical, words } of aliasList) {
    for (let i = 0; i + words.length <= tokens.length; i += 1) {
      if (claimed.slice(i, i + words.length).some(Boolean)) continue;
      let ok = true;
      for (let j = 0; j < words.length; j += 1) {
        const res = options.exact
          ? { match: tokens[i + j].text === words[j], corrected: false }
          : wordMatch(tokens[i + j].text, words[j]);
        if (!res.match) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      for (let j = 0; j < words.length; j += 1) claimed[i + j] = true;
      hits.push({
        canonical,
        start: tokens[i].start,
        end: tokens[i + words.length - 1].end,
        matchedText: tokens
          .slice(i, i + words.length)
          .map((t) => t.text)
          .join(" "),
      });
      // An alias may appear more than once; keep scanning further tokens.
    }
  }

  hits.sort((a, b) => a.start - b.start);
  return hits;
}

// ---------------------------------------------------------------------------
// Evidence + claims
// ---------------------------------------------------------------------------

const SNIPPET_MAX = 160;

/**
 * Build evidence for a matched phrase. `start`/`end` cover the matched phrase
 * exactly (the no-fabrication property slices these); the snippet pads with
 * surrounding context up to 160 codepoints for readability.
 */
export function makeEvidence(text: string, start: number, end: number): ImportEvidence {
  const safeStart = Math.max(0, Math.min(start, text.length));
  const safeEnd = Math.max(safeStart, Math.min(end, text.length));
  const matched = text.slice(safeStart, safeEnd);
  const matchedPoints = Array.from(matched);

  if (matchedPoints.length >= SNIPPET_MAX) {
    return { snippet: `${matchedPoints.slice(0, SNIPPET_MAX - 1).join("")}…`, start: safeStart, end: safeEnd };
  }

  const budgetEach = Math.floor((SNIPPET_MAX - matchedPoints.length) / 2);
  // Expand within the same line for context.
  const lineStart = text.lastIndexOf("\n", safeStart - 1) + 1;
  const lineEndIdx = text.indexOf("\n", safeEnd);
  const lineEnd = lineEndIdx === -1 ? text.length : lineEndIdx;

  const before = Array.from(text.slice(lineStart, safeStart));
  const after = Array.from(text.slice(safeEnd, lineEnd));
  const beforePart = before.slice(Math.max(0, before.length - budgetEach)).join("");
  const afterPart = after.slice(0, budgetEach).join("");
  const prefix = before.length > budgetEach ? "…" : "";
  const suffix = after.length > budgetEach ? "…" : "";

  return {
    snippet: `${prefix}${beforePart}${matched}${afterPart}${suffix}`.trim(),
    start: safeStart,
    end: safeEnd,
  };
}

export type ClaimSet = {
  add: (start: number, end: number) => void;
  /** Fraction (0..1) of a range's non-whitespace characters covered by claims. */
  coverage: (start: number, end: number, text: string) => number;
};

export function createClaimSet(): ClaimSet {
  const ranges: Array<[number, number]> = [];
  return {
    add(start: number, end: number) {
      if (end > start) ranges.push([start, end]);
    },
    coverage(start: number, end: number, text: string) {
      if (end <= start) return 0;
      let significant = 0;
      let covered = 0;
      for (let i = start; i < end; i += 1) {
        if (/\s/.test(text[i])) continue;
        significant += 1;
        for (const [s, e] of ranges) {
          if (i >= s && i < e) {
            covered += 1;
            break;
          }
        }
      }
      return significant === 0 ? 0 : covered / significant;
    },
  };
}

/** Title-case a canonical vocab value ("video editor" → "Video Editor"). */
export function titleCase(value: string): string {
  return value
    .split(" ")
    .map((word) => (word ? word.charAt(0).toUpperCase() + word.slice(1) : word))
    .join(" ");
}
