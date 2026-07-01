// Parse a free-text search query into a structured, order-independent, typo-tolerant
// ParsedQuery. The shape is intentionally serializable so it can later be persisted
// as a saved search / job alert.
//
// Pipeline: extract budget → normalize → tokenize → classify tokens against the
// creator-economy vocabulary (exact + Damerau-Levenshtein fuzzy) into role/platform/
// format/work-mode/language/location buckets; leftovers become freeTokens.

import {
  COUNTRY_TOKENS,
  LOCATION_ALIASES,
  LOCATION_CANONICALS,
  LOCATION_EXPANSIONS,
  REMOTE_TOKENS,
  VOCAB_BY_DIMENSION,
  normalizeText,
  type SearchDimension,
} from "./searchVocabulary.ts";

export type BudgetOp = "approx" | "under" | "over";
export type BudgetUnit = "project" | "month" | "video" | "hour";
export type ParsedBudget = { amount: number; op: BudgetOp; unit?: BudgetUnit };
export type QueryCorrection = { from: string; to: string };

export type ParsedQuery = {
  raw: string;
  roles: string[];
  platforms: string[];
  niches: string[];
  genres: string[];
  formats: string[];
  workModes: string[];
  languages: string[];
  locations: string[];
  budget?: ParsedBudget;
  freeTokens: string[];
  corrections: QueryCorrection[];
};

/** True if the parsed query carries no usable signal (so callers can broaden). */
export function isEmptyParsedQuery(p: ParsedQuery): boolean {
  return (
    p.roles.length === 0 &&
    p.platforms.length === 0 &&
    p.niches.length === 0 &&
    p.genres.length === 0 &&
    p.formats.length === 0 &&
    p.workModes.length === 0 &&
    p.languages.length === 0 &&
    p.locations.length === 0 &&
    p.freeTokens.length === 0 &&
    !p.budget
  );
}

// Optimal string alignment distance (Damerau-Levenshtein with adjacent transpositions),
// so "delih"→"delhi" and "vidoe"→"video" count as a single edit.
export function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const d: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) d[i][0] = i;
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[m][n];
}

type WordMatch = { match: boolean; corrected: boolean };

// Match a single query token against a vocabulary word with typo tolerance.
// Short words (<=3) require an exact match to avoid noisy fuzzy hits (yt, ig, vo, x, smm).
function wordMatch(token: string, target: string): WordMatch {
  if (token === target) return { match: true, corrected: false };
  if (target.length <= 3) return { match: false, corrected: false };
  if (token[0] !== target[0]) return { match: false, corrected: false };
  const threshold = target.length <= 4 ? 1 : 2;
  if (editDistance(token, target) <= threshold) return { match: true, corrected: true };
  return { match: false, corrected: false };
}

// Match a (possibly multi-word) alias against a window of tokens, fuzzy per word.
function matchAliasAt(tokens: string[], start: number, aliasWords: string[]): WordMatch {
  let corrected = false;
  for (let j = 0; j < aliasWords.length; j++) {
    const res = wordMatch(tokens[start + j], aliasWords[j]);
    if (!res.match) return { match: false, corrected: false };
    if (res.corrected) corrected = true;
  }
  return { match: true, corrected };
}

const BUDGET_RE =
  /\b(under|below|upto|up\s?to|at\s?most|max|above|over|at\s?least|atleast|more\s?than|min)?\s*(?:₹|rs\.?\s?|inr\s?)?(\d[\d,]*)\s*(k|thousand)?\b(?:\s*(?:\/|per\s+|a\s+)?(month|monthly|video|project|hour|hr|hourly|week|day))?/i;

function parseBudget(raw: string): { budget?: ParsedBudget; matched?: string } {
  const m = BUDGET_RE.exec(raw.toLowerCase());
  if (!m) return {};
  const opWord = (m[1] || "").replace(/\s+/g, " ").trim();
  let amount = Number((m[2] || "").replace(/,/g, ""));
  const kSuffix = Boolean(m[3]);
  const unitWord = (m[4] || "").trim();
  if (kSuffix) amount *= 1000;
  if (!Number.isFinite(amount) || amount <= 0) return {};
  const hasCurrency = /₹|rs\.?|inr/.test(m[0]);
  // Only treat a bare number as money when it looks like money.
  if (!kSuffix && !hasCurrency && !unitWord && amount < 1000) return {};
  const op: BudgetOp = /under|below|up\s?to|at\s?most|max/.test(opWord)
    ? "under"
    : /above|over|at\s?least|atleast|more\s?than|min/.test(opWord)
      ? "over"
      : "approx";
  const unit: BudgetUnit | undefined = unitWord.startsWith("month")
    ? "month"
    : unitWord === "video"
      ? "video"
      : unitWord === "project"
        ? "project"
        : unitWord === "hour" || unitWord === "hr" || unitWord === "hourly"
          ? "hour"
          : undefined;
  const budget: ParsedBudget = unit ? { amount, op, unit } : { amount, op };
  return { budget, matched: m[0] };
}

function dedupeCorrections(list: QueryCorrection[]): QueryCorrection[] {
  const seen = new Set<string>();
  const out: QueryCorrection[] = [];
  for (const c of list) {
    const key = `${c.from}→${c.to}`;
    if (c.from === c.to || seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

export function parseQuery(raw: string): ParsedQuery {
  const trimmed = (raw || "").trim();
  const { budget, matched } = parseBudget(trimmed);

  let working = trimmed.toLowerCase();
  if (matched) working = working.replace(matched.toLowerCase(), " ");
  const normalized = normalizeText(working);
  const tokens = normalized ? normalized.split(" ").filter(Boolean) : [];
  const recognized = new Array(tokens.length).fill(false);
  const corrections: QueryCorrection[] = [];

  const buckets: Record<SearchDimension, Set<string>> = {
    role: new Set(),
    platform: new Set(),
    niche: new Set(),
    genre: new Set(),
    format: new Set(),
    workMode: new Set(),
    language: new Set(),
  };

  (Object.keys(VOCAB_BY_DIMENSION) as SearchDimension[]).forEach((dim) => {
    // Flatten to (canonical, alias words) and match longest aliases first, so a
    // specific phrase ("thumbnail designer") claims its tokens before a shorter,
    // looser alias ("designer") can re-match them within the same dimension.
    const aliasList = VOCAB_BY_DIMENSION[dim]
      .flatMap((entry) => entry.aliases.map((alias) => ({ canonical: entry.canonical, words: alias.split(" ") })))
      .sort((a, b) => b.words.length - a.words.length || b.words.join("").length - a.words.join("").length);
    const claimed = new Array(tokens.length).fill(false);
    for (const { canonical, words } of aliasList) {
      for (let i = 0; i + words.length <= tokens.length; i++) {
        if (words.every((_, j) => claimed[i + j])) continue;
        const res = matchAliasAt(tokens, i, words);
        if (!res.match) continue;
        buckets[dim].add(canonical);
        for (let j = 0; j < words.length; j++) {
          claimed[i + j] = true;
          recognized[i + j] = true;
          if (tokens[i + j] !== words[j]) corrections.push({ from: tokens[i + j], to: words[j] });
        }
        break; // this alias matched once; move on
      }
    }
  });

  // Locations (aliases, region expansions, remote/india, fuzzy canonical cities).
  const locations = new Set<string>();
  const joined = tokens.join(" ");
  for (const [key, cities] of Object.entries(LOCATION_EXPANSIONS)) {
    if (joined.includes(key)) {
      cities.forEach((c) => locations.add(c));
      key.split(" ").forEach((w) => {
        const idx = tokens.indexOf(w);
        if (idx >= 0) recognized[idx] = true;
      });
    }
  }
  const lowerCanon: Array<[string, string]> = LOCATION_CANONICALS.map((c) => [c, c.toLowerCase()]);
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (REMOTE_TOKENS.includes(t)) {
      locations.add("Remote");
      recognized[i] = true;
      continue;
    }
    if (COUNTRY_TOKENS.includes(t)) {
      locations.add("India");
      recognized[i] = true;
      continue;
    }
    if (LOCATION_ALIASES[t]) {
      locations.add(LOCATION_ALIASES[t]);
      recognized[i] = true;
      continue;
    }
    for (const [canon, lc] of lowerCanon) {
      const res = wordMatch(t, lc);
      if (res.match) {
        locations.add(canon);
        recognized[i] = true;
        if (res.corrected) corrections.push({ from: t, to: lc });
        break;
      }
    }
  }

  const freeTokens = tokens.filter((tok, i) => !recognized[i] && tok.length >= 2);

  return {
    raw: trimmed,
    roles: [...buckets.role],
    platforms: [...buckets.platform],
    niches: [...buckets.niche],
    genres: [...buckets.genre],
    formats: [...buckets.format],
    workModes: [...buckets.workMode],
    languages: [...buckets.language],
    locations: [...locations],
    budget,
    freeTokens,
    corrections: dedupeCorrections(corrections),
  };
}
