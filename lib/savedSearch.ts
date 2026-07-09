// Saved-search / job-alert compatibility (STRUCTURE ONLY — no backend, no alert
// scheduling yet; see docs plan Phase 5). The point of this module is that the
// hierarchical filter state serializes to one structured criteria object that can
// later reconstruct the selected chips, the curated route slug (if any), the
// query params (if ad-hoc), and alert matching — all from the same shape used by
// the browse pages (a superset of RefinementCriteria + the anchoring role/route).

import type { RefinementCriteria } from "./seoFilterMatch.ts";
import {
  roleForRoute,
  subfilterParam,
  type SeoFilterRoute,
  type SeoFilterType,
} from "./seoFilterRoutes.ts";

export type SavedSearchCriteria = {
  roles: string[];
  platforms: string[];
  niches: string[];
  genres: string[];
  formats: string[];
  workModes: string[];
  languages: string[];
  tools: string[];
  experience: string | null;
  availability: string | null;
};

export type SavedSearch = {
  type: SeoFilterType;
  name: string;
  criteria: SavedSearchCriteria;
  /** Set when the criteria map exactly onto a curated route; else null (ad-hoc). */
  seoRoutePath: string | null;
};

const dedupe = (values: Array<string | null | undefined>): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const v = (value ?? "").trim();
    if (!v) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
};

/**
 * Merge a route's implied selectedFilters with Row-2 refinements into one
 * structured criteria object. This is the object a future saved search stores.
 */
export function buildSavedSearchCriteria(
  route: SeoFilterRoute | null | undefined,
  refinements: RefinementCriteria | null | undefined
): SavedSearchCriteria {
  const sel = route?.selectedFilters ?? {};
  const ref = refinements ?? {};
  const role = roleForRoute(route);
  return {
    roles: dedupe([role, ...(sel.roles ?? [])]),
    platforms: dedupe([...(sel.platforms ?? []), ...(ref.platforms ?? [])]),
    niches: dedupe([...(sel.niches ?? []), ...(ref.niches ?? [])]),
    genres: dedupe([...(sel.genres ?? []), ...(ref.genres ?? [])]),
    formats: dedupe([...(sel.formats ?? []), ...(ref.formats ?? [])]),
    workModes: dedupe([...(sel.workModes ?? []), ...(ref.workModes ?? [])]),
    languages: dedupe([...(ref.languages ?? [])]),
    tools: dedupe([...(ref.tools ?? [])]),
    experience: ref.experience ?? null,
    availability: ref.availability ?? null,
  };
}

/**
 * Serialize the ad-hoc portion of criteria back to `?<dimension>=` params (for
 * reconstructing an ad-hoc filtered URL). The role/curated part is carried by
 * the route slug, so only the refinement dims are emitted here.
 */
export function refinementParamsFromCriteria(refinements: RefinementCriteria | null | undefined): URLSearchParams {
  const params = new URLSearchParams();
  const ref = refinements ?? {};
  const push = (dimension: Parameters<typeof subfilterParam>[0], values?: string[]) => {
    if (values && values.length) params.set(subfilterParam(dimension), values.join(","));
  };
  push("platform", ref.platforms);
  push("niche", ref.niches);
  push("genre", ref.genres);
  push("format", ref.formats);
  push("workMode", ref.workModes);
  push("language", ref.languages);
  push("tool", ref.tools);
  if (ref.experience) params.set("experience", ref.experience);
  if (ref.availability) params.set("availability", ref.availability);
  return params;
}
