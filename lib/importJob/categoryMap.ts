// Deterministic ROLE_VOCAB canonical → JobCategory mapping (plan D13).
//
// Confident mappings pre-select the review screen's CategoryPicker; uncertain ones
// (producer, unmapped roles, no role found) only suggest — the employer must pick
// explicitly before continuing to the editor. Category must never silently default
// to "Editing" for non-editing roles.

import type { JobCategory } from "../types.ts";

export const JOB_CATEGORIES: JobCategory[] = [
  "Editing",
  "Design",
  "Writing",
  "Thumbnails",
  "Shorts",
  "Motion Graphics",
  "Channel Manager",
  "Research",
  "Voice Over",
  "Marketing",
];

export const CATEGORY_BY_ROLE: Record<string, { value: JobCategory; confident: boolean }> = {
  "video editor": { value: "Editing", confident: true },
  "shorts editor": { value: "Shorts", confident: true },
  "thumbnail designer": { value: "Thumbnails", confident: true },
  "graphic designer": { value: "Design", confident: true },
  "motion designer": { value: "Motion Graphics", confident: true },
  "script writer": { value: "Writing", confident: true },
  researcher: { value: "Research", confident: true },
  "channel manager": { value: "Channel Manager", confident: true },
  "social media manager": { value: "Marketing", confident: true },
  "content strategist": { value: "Marketing", confident: true },
  "voice over artist": { value: "Voice Over", confident: true },
  // A YouTube "producer" is closest to channel operations, but the fit is uncertain
  // enough that the employer must confirm.
  producer: { value: "Channel Manager", confident: false },
};

export function categoryForRole(roleCanonical: string | null | undefined): { value: JobCategory; confident: boolean } {
  if (roleCanonical) {
    const mapped = CATEGORY_BY_ROLE[roleCanonical.toLowerCase()];
    if (mapped) return mapped;
  }
  // Placeholder suggestion only — never treated as a usable confident default.
  return { value: "Editing", confident: false };
}

/** Validate a stored/unknown value against the closed JobCategory union. */
export function normalizeJobCategory(value: unknown): JobCategory {
  if (typeof value === "string") {
    const trimmed = value.trim();
    const match = JOB_CATEGORIES.find((category) => category.toLowerCase() === trimmed.toLowerCase());
    if (match) return match;
  }
  return "Editing";
}
