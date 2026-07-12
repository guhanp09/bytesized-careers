// Stage 2 of the import pipeline: split normalized text into classified extraction
// units with absolute offsets. Long paragraph lines (LinkedIn/WhatsApp pastes) are
// segmented into sentence-bounded units ≤280 chars so structured extractors never
// run a regex over an unbounded string, while prose composition can rejoin the
// original paragraph verbatim via offsets.

export type ImportUnitKind =
  | "heading"
  | "bullet"
  | "kv"
  | "text"
  | "blank"
  | "url"
  | "hashtagRow"
  | "contact";

export type ImportLabel =
  | "role"
  | "location"
  | "pay"
  | "experience"
  | "type"
  | "timeline"
  | "apply"
  | "tools"
  | "language"
  | "deadline";

export type ImportUnit = {
  /** Verbatim slice of the normalized document for [start, end). */
  text: string;
  start: number;
  end: number;
  kind: ImportUnitKind;
  /** Canonical KV label when kind === "kv". */
  label: ImportLabel | null;
  /** Value part of a KV line (text after the separator) and its absolute offset. */
  kvValue: string | null;
  kvValueStart: number;
  /** Index of the source line this unit came from (long lines share one index). */
  lineIndex: number;
};

export const MAX_UNIT_CHARS = 280;
const HARD_SPLIT_MIN = 200;

// Label words → canonical label. Matched against the text before ":" on a line.
export const FIELD_LABEL_LEXICON: Array<{ label: ImportLabel; words: string[] }> = [
  { label: "role", words: ["role", "position", "designation", "job title", "title", "hiring", "hiring for", "opening", "vacancy"] },
  { label: "location", words: ["location", "city", "based", "based in", "base location", "work location", "place"] },
  {
    label: "pay",
    words: [
      "salary",
      "pay",
      "budget",
      "compensation",
      "stipend",
      "rate",
      "rates",
      "ctc",
      "remuneration",
      "package",
      "payment",
    ],
  },
  { label: "experience", words: ["experience", "exp", "experience required", "experience level"] },
  { label: "type", words: ["type", "job type", "employment type", "engagement", "engagement type", "work type", "mode"] },
  { label: "timeline", words: ["duration", "timeline", "start", "start date", "joining", "availability"] },
  { label: "apply", words: ["apply", "to apply", "contact", "email", "dm", "whatsapp", "reach out", "application"] },
  { label: "tools", words: ["tools", "software", "skills", "stack", "tools required"] },
  { label: "language", words: ["language", "languages"] },
  { label: "deadline", words: ["deadline", "last date", "apply by", "closing date"] },
];

const EMAIL_RE = /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,255}\.[A-Za-z]{2,10}/;
const PHONE_RE = /(?:\+91[ -]?)?[6-9]\d{4}[ -]?\d{5}(?!\d)/;
const URL_RE = /(?:https?:\/\/|www\.)[^\s<>"')]{4,300}/i;
const DM_RE = /\b(?:dm|dms)\b|direct message|whats\s?app|wa\.me|link in bio|google form|fill (?:out )?(?:the |this )?form|telegram/i;

const SENTENCE_SPLIT_RE = /[.!?;]\s+|\s+—\s+|\s+\|\s+/g;

function detectLabel(head: string): ImportLabel | null {
  const key = head.trim().toLowerCase().replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();
  if (!key || key.length > 24) return null;
  for (const entry of FIELD_LABEL_LEXICON) {
    if (entry.words.includes(key)) return entry.label;
  }
  return null;
}

function isHashtagRow(text: string): boolean {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return Boolean(tokens[0]?.startsWith("#") && tokens.length === 1 && tokens[0].length > 2);
  const tags = tokens.filter((token) => token.startsWith("#")).length;
  return tags >= 2 && tags / tokens.length >= 0.6;
}

function isContactLine(text: string): boolean {
  return EMAIL_RE.test(text) || PHONE_RE.test(text) || DM_RE.test(text);
}

function isUrlOnly(text: string): boolean {
  const trimmed = text.trim();
  const match = trimmed.match(URL_RE);
  if (!match) return false;
  return match[0].length >= trimmed.length - 24;
}

function isHeading(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 48) return false;
  if (/[:：]$/.test(trimmed)) return true;
  // ALL-CAPS headings — but "CTC 4 LPA" style data lines carry digits and are not
  // headings.
  if (/\d/.test(trimmed)) return false;
  const letters = trimmed.replace(/[^A-Za-z]/g, "");
  if (letters.length >= 3 && letters === letters.toUpperCase()) return true;
  return false;
}

function classify(text: string): { kind: ImportUnitKind; label: ImportLabel | null; kvValue: string | null; kvValueOffset: number } {
  const trimmed = text.trim();
  if (!trimmed) return { kind: "blank", label: null, kvValue: null, kvValueOffset: 0 };
  const isBullet = /^- /.test(text.trimStart());

  if (!isBullet && isUrlOnly(text)) return { kind: "url", label: null, kvValue: null, kvValueOffset: 0 };
  if (isHashtagRow(text)) return { kind: "hashtagRow", label: null, kvValue: null, kvValueOffset: 0 };

  // KV: "Label: value" (also matches inside a bullet: "- Location: Mumbai").
  const body = isBullet ? text.slice(text.indexOf("- ") + 2) : text;
  const kv = body.match(/^([^:：\n]{2,28})[:：]\s*(\S.*)$/);
  if (kv) {
    const label = detectLabel(kv[1]);
    if (label) {
      const kvValueOffset = text.length - body.length + kv[1].length + (body.match(/^([^:：\n]{2,28})([:：]\s*)/)?.[2].length ?? 1);
      return { kind: "kv", label, kvValue: kv[2], kvValueOffset };
    }
  }

  if (isContactLine(text)) return { kind: "contact", label: null, kvValue: null, kvValueOffset: 0 };
  if (isBullet) return { kind: "bullet", label: null, kvValue: null, kvValueOffset: 0 };
  if (isHeading(text)) return { kind: "heading", label: null, kvValue: null, kvValueOffset: 0 };
  return { kind: "text", label: null, kvValue: null, kvValueOffset: 0 };
}

/** Split a long line into sentence-bounded [start, end) sub-ranges (relative to the line). */
export function splitLongLine(line: string): Array<[number, number]> {
  if (line.length <= MAX_UNIT_CHARS) return [[0, line.length]];

  // Candidate boundaries: end positions after sentence punctuation / separators,
  // plus emoji-followed-by-capital boundaries.
  const boundaries: number[] = [];
  for (const match of line.matchAll(SENTENCE_SPLIT_RE)) {
    if (match.index !== undefined) boundaries.push(match.index + match[0].length);
  }
  for (const match of line.matchAll(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]\s+(?=[A-Z])/gu)) {
    if (match.index !== undefined) boundaries.push(match.index + match[0].length);
  }
  boundaries.sort((a, b) => a - b);

  const ranges: Array<[number, number]> = [];
  let start = 0;
  while (line.length - start > MAX_UNIT_CHARS) {
    // Furthest boundary that keeps the unit ≤ MAX_UNIT_CHARS.
    let cut = -1;
    for (const b of boundaries) {
      if (b > start && b - start <= MAX_UNIT_CHARS) cut = b;
      if (b - start > MAX_UNIT_CHARS) break;
    }
    if (cut === -1) {
      // Hard fallback: nearest whitespace in [HARD_SPLIT_MIN, MAX_UNIT_CHARS].
      let ws = -1;
      for (let i = start + MAX_UNIT_CHARS; i >= start + HARD_SPLIT_MIN; i -= 1) {
        if (/\s/.test(line[i])) {
          ws = i + 1;
          break;
        }
      }
      cut = ws === -1 ? start + MAX_UNIT_CHARS : ws;
    }
    ranges.push([start, cut]);
    start = cut;
  }
  if (start < line.length) ranges.push([start, line.length]);
  return ranges;
}

export function segmentImportText(text: string): ImportUnit[] {
  const units: ImportUnit[] = [];
  let offset = 0;
  const lines = text.split("\n");

  lines.forEach((line, lineIndex) => {
    const lineStart = offset;
    offset += line.length + 1; // + newline (harmless overshoot on last line)

    const ranges = splitLongLine(line);
    ranges.forEach(([relStart, relEnd], rangeIdx) => {
      const slice = line.slice(relStart, relEnd);
      const start = lineStart + relStart;
      const end = lineStart + relEnd;
      const meta = classify(slice);
      // Continuation units of a split bullet stay prose-like text.
      const kind = rangeIdx > 0 && meta.kind === "bullet" ? "text" : meta.kind;
      units.push({
        text: slice,
        start,
        end,
        kind,
        label: meta.label,
        kvValue: meta.kvValue,
        kvValueStart: start + meta.kvValueOffset,
        lineIndex,
      });
    });
  });

  return units;
}
