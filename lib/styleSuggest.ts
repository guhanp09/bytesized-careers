import stylesRaw from "../src/data/video_editing_styles.big.json";

const styles = Array.from(new Set(stylesRaw.map((s) => s.trim()).filter(Boolean)));
const lowerStyles = styles.map((s) => s.toLowerCase());

const prefixIndex = new Map<string, number[]>();
const tokenIndex = new Map<string, number[]>();

const stopTokens = new Set(["and", "with", "for", "the", "a", "an", "to", "of"]);

const tokenize = (text: string) =>
  text
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((t) => t && !stopTokens.has(t));

const addToIndex = (map: Map<string, number[]>, key: string, idx: number) => {
  const list = map.get(key);
  if (list) list.push(idx);
  else map.set(key, [idx]);
};

lowerStyles.forEach((s, idx) => {
  const key = s.slice(0, 3);
  if (key.length >= 2) addToIndex(prefixIndex, key, idx);
  const tokens = tokenize(s);
  tokens.forEach((t) => addToIndex(tokenIndex, t, idx));
});

const jaccardTrigram = (a: string, b: string) => {
  const trigrams = (str: string) => {
    const t = [];
    const s = str.replace(/\s+/g, " ").trim();
    for (let i = 0; i < s.length - 2; i += 1) {
      t.push(s.slice(i, i + 3));
    }
    return new Set(t);
  };
  const setA = trigrams(a);
  const setB = trigrams(b);
  if (!setA.size || !setB.size) return 0;
  let inter = 0;
  setA.forEach((x) => {
    if (setB.has(x)) inter += 1;
  });
  return inter / (setA.size + setB.size - inter);
};

export function getGhostContinuation(inputText: string, selected: string[]) {
  const input = inputText.trim();
  if (!input) return null;

  const inputLower = input.toLowerCase();
  const selectedSet = new Set(selected.map((s) => s.toLowerCase()));
  const key = inputLower.slice(0, 3);
  const candidates = key.length >= 2 ? prefixIndex.get(key) || [] : [];

  let bestIdx = -1;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const idx of candidates) {
    const candidateLower = lowerStyles[idx];
    if (!candidateLower.startsWith(inputLower)) continue;
    if (selectedSet.has(candidateLower)) continue;
    if (candidateLower === inputLower) return null;
    const extraLen = candidateLower.length - inputLower.length;
    if (extraLen < bestScore) {
      bestScore = extraLen;
      bestIdx = idx;
    }
  }

  if (bestIdx < 0) return null;
  const candidate = styles[bestIdx];
  const remainder = candidate.slice(inputText.length);
  return remainder || null;
}

export function getRelatedSuggestions(inputText: string, selected: string[], limit = 8) {
  const selectedSet = new Set(selected.map((s) => s.toLowerCase()));
  const input = inputText.trim().toLowerCase();

  if (!input) {
    return getInitialSuggestions(selected, limit);
  }

  const tokenSet = new Set(tokenize(inputText));
  selected.forEach((s) => tokenize(s).forEach((t) => tokenSet.add(t)));

  const candidateSet = new Set<number>();
  const prefixKey = input.slice(0, 3);
  if (prefixKey.length >= 2) {
    (prefixIndex.get(prefixKey) || []).forEach((idx) => candidateSet.add(idx));
  }
  tokenSet.forEach((t) => {
    (tokenIndex.get(t) || []).forEach((idx) => candidateSet.add(idx));
  });

  const candidates = Array.from(candidateSet);
  const scored = [];

  for (const idx of candidates) {
    const candidate = styles[idx];
    const candidateLower = lowerStyles[idx];
    if (selectedSet.has(candidateLower)) continue;
    if (input && candidateLower === input) continue;

    let score = 0;
    if (input && candidateLower.startsWith(input)) score += 5;
    const candidateTokens = tokenize(candidate);
    let overlap = 0;
    candidateTokens.forEach((t) => {
      if (tokenSet.has(t)) overlap += 1;
    });
    score += overlap * 2;
    if (input.length >= 3) {
      score += jaccardTrigram(input, candidateLower) * 3;
    }
    if (score > 0) scored.push({ idx, score });
  }

  scored.sort((a, b) => b.score - a.score || styles[a.idx].length - styles[b.idx].length);
  const top = scored.slice(0, Math.max(limit * 4, limit));
  const results: string[] = [];
  for (const item of top) {
    const value = styles[item.idx];
    if (!results.includes(value)) results.push(value);
    if (results.length >= limit) break;
  }

  if (results.length < limit) {
    for (let i = 0; i < styles.length && results.length < limit; i += 1) {
      const value = styles[i];
      if (selectedSet.has(value.toLowerCase())) continue;
      if (!results.includes(value)) results.push(value);
    }
  }

  return results;
}

const hashSeed = (selected: string[]) =>
  selected
    .map((s) => s.toLowerCase())
    .sort()
    .join("|")
    .split("")
    .reduce((acc, ch) => ((acc << 5) - acc + ch.charCodeAt(0)) | 0, 0);

const seededRandom = (seed: number) => {
  let s = seed || 1;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
};

export function getInitialSuggestions(selected: string[], limit = 8) {
  const selectedTokens = new Set<string>();
  selected.forEach((s) => tokenize(s).forEach((t) => selectedTokens.add(t)));
  const usedTokens = new Set<string>();
  const selectedSet = new Set(selected.map((s) => s.toLowerCase()));

  const seed = hashSeed(selected) + Math.floor(Date.now() / 60000);
  const rand = seededRandom(seed);

  const results: string[] = [];
  const maxAttempts = 5000;
  let attempts = 0;

  while (results.length < limit && attempts < maxAttempts) {
    attempts += 1;
    const idx = Math.floor(rand() * styles.length);
    const candidate = styles[idx];
    const candidateLower = candidate.toLowerCase();
    if (selectedSet.has(candidateLower)) continue;
    const tokens = tokenize(candidate);
    if (!tokens.length) continue;
    if (tokens.some((t) => selectedTokens.has(t))) continue;
    if (tokens.some((t) => usedTokens.has(t))) continue;

    results.push(candidate);
    tokens.forEach((t) => usedTokens.add(t));
  }

  if (results.length < limit) {
    for (let i = 0; i < styles.length && results.length < limit; i += 1) {
      const candidate = styles[i];
      const candidateLower = candidate.toLowerCase();
      if (selectedSet.has(candidateLower)) continue;
      const tokens = tokenize(candidate);
      if (!tokens.length) continue;
      if (tokens.some((t) => selectedTokens.has(t))) continue;
      if (tokens.some((t) => usedTokens.has(t))) continue;
      results.push(candidate);
      tokens.forEach((t) => usedTokens.add(t));
    }
  }

  return results;
}
