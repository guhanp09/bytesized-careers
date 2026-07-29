/**
 * Links inside an answer somebody typed.
 *
 * A screening answer is very often "here is the reel: <url>". Rendered as
 * inert text that is a URL the reviewer has to select and copy, which is a
 * small tax paid on every single application. Rendered carelessly it is an
 * injection surface, because the text came from the counterparty.
 *
 * Three rules make the middle ground safe:
 *
 * 1. **Two protocols, allow-listed.** `http:` and `https:` become links. A
 *    `javascript:`, `data:` or `vbscript:` URL is left as text — never as an
 *    anchor whose href the browser would honour on click.
 * 2. **Nothing is fetched.** No preview, no thumbnail, no metadata lookup. A
 *    fetch would let the sender's link see the reviewer's IP the moment the
 *    conversation is opened, before anyone decided to trust it, and would turn
 *    an unopened application into a delivery receipt.
 * 3. **Only what was typed.** The link text is exactly the matched substring,
 *    so a link can never display one destination and carry another.
 */

export type AnswerSegment =
  | { kind: "text"; value: string }
  | { kind: "link"; value: string; href: string };

/** Protocols a rendered link may use. Everything else stays text. */
export const SAFE_PROTOCOLS = ["http:", "https:"] as const;

/**
 * Candidate spans. Deliberately narrow — it matches a scheme explicitly rather
 * than guessing at bare domains, so "e.g. see plate.and.pan" is not a link and
 * a sentence ending in a hostname does not silently become one.
 */
const CANDIDATE = /\b[a-z][a-z0-9+.-]*:\/\/[^\s<>"']+/gi;

/** Trailing punctuation that belongs to the sentence, not the URL. */
const TRAILING = /[.,;:!?)\]}>'"]+$/;

export function isSafeHref(value: string): boolean {
  try {
    const url = new URL(value);
    return (SAFE_PROTOCOLS as readonly string[]).includes(url.protocol);
  } catch {
    return false;
  }
}

/**
 * Split text into what to render as prose and what to render as a link.
 *
 * Returning segments rather than HTML is the point: nothing here builds markup,
 * so there is no string for a caller to inject into `dangerouslySetInnerHTML`.
 */
export function splitAnswerLinks(text: string): AnswerSegment[] {
  const segments: AnswerSegment[] = [];
  let index = 0;

  for (const match of text.matchAll(CANDIDATE)) {
    const start = match.index ?? 0;
    let value = match[0];

    // A URL at the end of a sentence should not swallow the full stop.
    const trailing = value.match(TRAILING)?.[0] ?? "";
    if (trailing) value = value.slice(0, value.length - trailing.length);

    if (start > index) segments.push({ kind: "text", value: text.slice(index, start) });

    if (value && isSafeHref(value)) {
      segments.push({ kind: "link", value, href: value });
    } else if (value) {
      // Unsafe scheme: shown, never actionable.
      segments.push({ kind: "text", value });
    }

    if (trailing) segments.push({ kind: "text", value: trailing });
    index = start + match[0].length;
  }

  if (index < text.length) segments.push({ kind: "text", value: text.slice(index) });
  return segments.length > 0 ? segments : [{ kind: "text", value: text }];
}
