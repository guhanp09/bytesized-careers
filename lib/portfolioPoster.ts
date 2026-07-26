/**
 * Deterministic local posters for portfolio evidence.
 *
 * A creator marketplace whose applicant cards are grey rectangles is telling
 * you nothing about the work. But real thumbnails are frequently missing: an
 * application's `relevant_portfolio` answer carries only `{ id, title, url }`,
 * imports lose artwork, and links to Drive or a personal site never had any.
 *
 * The alternative to a grey rectangle is *not* fetching the real thing. oEmbed
 * and thumbnail scraping mean a network request per card, third-party calls
 * from a hiring inbox, and a layout that breaks when the request fails — for a
 * decorative image. So the poster is generated locally from the item's own id:
 * no request, no dependency, no failure mode, and the same item is the same
 * artwork on every render and in every session.
 *
 * It is deliberately abstract. It represents the item; it never pretends to be
 * a frame from it.
 */

import type { CreatorMediaKind } from "./creatorProjection.ts";

export type PosterPalette = {
  key: string;
  /** Two stops, dark enough that white overlay text clears 4.5:1 on both. */
  from: string;
  to: string;
  /** A brighter accent for the pattern, used at low alpha. */
  accent: string;
};

/**
 * Six families, each dark enough to carry white text.
 *
 * Contrast is the constraint that picked these: the title sits on top of the
 * poster, so every stop is a dark tone and the accent only ever appears at low
 * alpha behind it. A pastel family would have looked better empty and failed
 * the moment a title was drawn on it.
 */
export const POSTER_PALETTES: PosterPalette[] = [
  { key: "indigo", from: "#1e1b4b", to: "#312e81", accent: "#818cf8" },
  { key: "teal", from: "#042f2e", to: "#134e4a", accent: "#2dd4bf" },
  { key: "plum", from: "#2e1065", to: "#4c1d95", accent: "#c084fc" },
  { key: "ember", from: "#431407", to: "#7c2d12", accent: "#fb923c" },
  { key: "slate", from: "#0f172a", to: "#1e293b", accent: "#94a3b8" },
  { key: "moss", from: "#14532d", to: "#166534", accent: "#4ade80" },
];

export type PosterPattern = "rays" | "grid" | "waves" | "arcs";

export const POSTER_PATTERNS: PosterPattern[] = ["rays", "grid", "waves", "arcs"];

export type PortfolioPoster = {
  palette: PosterPalette;
  pattern: PosterPattern;
  /** 0–359. Rotates the pattern so two items sharing a family still differ. */
  angle: number;
  /** Two letters from the title — an anchor while the eye scans a strip. */
  initials: string;
};

/**
 * FNV-1a. Small, dependency-free, and — the part that matters — stable across
 * runs and machines, so a poster never changes identity between sessions.
 */
function hash(value: string): number {
  let h = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    h ^= value.charCodeAt(index);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Up to two letters from the first two words — "MB", not "M". */
export function posterInitials(title: string): string {
  const words = (title || "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "··";
  const letters = words
    .slice(0, 2)
    .map((word) => word.replace(/[^\p{L}\p{N}]/gu, "").charAt(0))
    .filter(Boolean)
    .join("");
  return (letters || words[0].charAt(0) || "·").toUpperCase().slice(0, 2);
}

/**
 * The poster for an item. Same id in, same poster out, always.
 *
 * Three independent draws off one hash — family, pattern, rotation — so two
 * items landing on the same palette are still told apart by composition rather
 * than being visual duplicates.
 */
export function portfolioPoster(id: string, title = ""): PortfolioPoster {
  const seed = hash(id || title || "portfolio");
  return {
    palette: POSTER_PALETTES[seed % POSTER_PALETTES.length],
    pattern: POSTER_PATTERNS[(seed >>> 8) % POSTER_PATTERNS.length],
    angle: (seed >>> 16) % 360,
    initials: posterInitials(title),
  };
}

/**
 * The pattern as an inline SVG data URI.
 *
 * Inline because a poster must never cost a request — that is the whole point
 * of generating it — and `encodeURIComponent` rather than base64 so the markup
 * stays greppable when something looks wrong.
 */
export function posterPatternUrl(poster: PortfolioPoster): string {
  const { pattern, palette, angle } = poster;
  const stroke = palette.accent;
  let body = "";

  if (pattern === "rays") {
    body = Array.from({ length: 7 }, (_, index) => {
      const x = index * 24;
      return `<line x1="${x}" y1="-40" x2="${x - 40}" y2="200" stroke="${stroke}" stroke-width="10" opacity="0.16"/>`;
    }).join("");
  } else if (pattern === "grid") {
    body =
      Array.from({ length: 6 }, (_, index) => {
        const p = index * 28 + 8;
        return `<line x1="${p}" y1="0" x2="${p}" y2="160" stroke="${stroke}" stroke-width="2" opacity="0.16"/>`;
      }).join("") +
      Array.from({ length: 4 }, (_, index) => {
        const p = index * 40 + 12;
        return `<line x1="0" y1="${p}" x2="160" y2="${p}" stroke="${stroke}" stroke-width="2" opacity="0.16"/>`;
      }).join("");
  } else if (pattern === "waves") {
    body = Array.from({ length: 5 }, (_, index) => {
      const y = index * 34 + 10;
      return `<path d="M-10 ${y} q 30 -18 60 0 t 60 0 t 60 0" fill="none" stroke="${stroke}" stroke-width="5" opacity="0.16"/>`;
    }).join("");
  } else {
    body = Array.from({ length: 4 }, (_, index) => {
      const r = 30 + index * 26;
      return `<circle cx="20" cy="150" r="${r}" fill="none" stroke="${stroke}" stroke-width="6" opacity="0.15"/>`;
    }).join("");
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160" preserveAspectRatio="none"><g transform="rotate(${angle} 80 80)">${body}</g></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/** The gradient behind the pattern. */
export function posterGradient(poster: PortfolioPoster): string {
  return `linear-gradient(135deg, ${poster.palette.from} 0%, ${poster.palette.to} 100%)`;
}

/** Icon name for the media cue, from the repo's own icon set. */
export const MEDIA_ICONS: Record<CreatorMediaKind, string> = {
  video: "circle-play",
  image: "image",
  audio: "podcast",
  link: "external-link",
};
