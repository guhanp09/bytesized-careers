// Stage 1 of the import pipeline: input sanitation and normalization.
// Output text is the canonical string every evidence offset refers to.

export const MAX_IMPORT_CHARS = 20_000;

export type NormalizedImportSource = {
  text: string;
  charCount: number;
  truncated: boolean;
};

// Bullet glyphs commonly pasted from LinkedIn/WhatsApp/Instagram posts, unified to
// "- " at line start so segmentation sees one bullet syntax.
const BULLET_RE =
  /^[ \t]*(?:[•●▪▸▶‣◦·★⭐✅✔☑◆■□○–—*-]|👉|➡️?|🔹|🔸|✳️?|✨)+[ \t]+/;

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
    let out = line.replace(BULLET_RE, "- ");
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
