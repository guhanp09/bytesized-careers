// Stage 1 of the import pipeline: input sanitation and normalization.
// Output text is the canonical string every evidence offset refers to.

export const MAX_IMPORT_CHARS = 20_000;

export type NormalizedImportSource = {
  text: string;
  charCount: number;
  truncated: boolean;
};

// Typographic bullet glyphs, unified to "- " at line start so segmentation sees
// one bullet syntax.
const BULLET_RE = /^[ \t]*(?:[•●▪▸▶‣◦·★◆■□○–—*-])+[ \t]+/;

// A run of pictographs opening a line, after bullets have had their turn:
// several bullet glyphs live inside these blocks, and a list marker is a list
// marker rather than decoration.
//
// Hiring posts label their rows with emoji
// — a money bag before the pay, an hourglass before the experience — and the
// row beneath is a labelled fact the server reads. Removing the decoration is
// what lets it be read as one. The server applies the identical rule, because
// the text it stores is the evidence; this keeps the recruiter's character
// count and preview honest about what will be read.
const LEADING_PICTOGRAPHS_RE =
  /^[ \t]*(?:[\u2190-\u21FF\u2300-\u27BF\u2B00-\u2BFF\uFE0F\u20E3]|[\u{1F000}-\u{1FAFF}])+[ \t]*/u;

// Control characters (except \n; \r handled separately) and zero-width characters.
const STRIP_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200D\u2060\uFEFF]/g;

// Non-breaking / narrow spaces normalized to a plain space.
const NBSP_RE = /[\u00A0\u2007\u202F]/g;

/** Codepoint-safe truncation (never splits a surrogate pair). */
export function truncateCodepoints(value: string, max: number): string {
  if (value.length <= max) return value;
  const points = Array.from(value);
  if (points.length <= max) return value;
  return points.slice(0, max).join("");
}

export function normalizeImportText(raw: string): NormalizedImportSource {
  const input = typeof raw === "string" ? raw : "";
  const truncated = Array.from(input).length > MAX_IMPORT_CHARS;
  let text = truncated ? truncateCodepoints(input, MAX_IMPORT_CHARS) : input;

  text = text
    .replace(/\r\n?/g, "\n")
    .replace(STRIP_RE, "")
    .replace(NBSP_RE, " ")
    .replace(/[‘’′]/g, "'")
    .replace(/[“”″]/g, '"');

  const lines = text.split("\n").map((line) => {
    let out = line.replace(BULLET_RE, "- ").replace(LEADING_PICTOGRAPHS_RE, "");
    // Collapse intra-line whitespace runs but never touch newlines.
    out = out.replace(/[ \t]{2,}/g, " ").replace(/[ \t]+$/g, "");
    return out;
  });

  const normalized = lines.join("\n");
  return {
    text: normalized,
    charCount: Array.from(normalized).length,
    truncated,
  };
}
