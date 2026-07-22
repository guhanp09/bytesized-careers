// Hard eligibility filtering + relevance ordering for curated SEO route pages.
//
// A curated route (e.g. /talent/youtube-scriptwriters) must behave like an
// actual filter, not a fuzzy ranking hint: results are first gated by the
// route's `requiredIntent` (a listing that fails the gate never appears, no
// matter how many broad tokens like "YouTube" it shares), then the eligible
// set is ordered by search relevance. Eligible listings are never dropped for
// a low relevance score — the gate decides inclusion, the score only orders.

import { parseQuery } from "./search/queryParser.ts";
import { scoreJob, scoreTalent, type JobLike, type TalentLike } from "./search/ranking.ts";
import {
  findSeoRouteForSearchQuery,
  primaryRoleChipsForType,
  roleForRoute,
  subfilterParam,
  subfiltersForRole,
} from "./seoFilterRoutes.ts";
import type {
  SeoFilterRoute,
  SeoFilterType,
  SeoRequiredIntent,
  SubfilterDimension,
} from "./seoFilterRoutes.ts";

/** Normalized intent fields extracted from a listing, one bag per intent group. */
export type SeoIntentFields = {
  /** Role-bearing/structured fields: title, primary role, roles, formats, category. */
  role: string;
  /** Niche fields. */
  niche: string;
  /** Work mode + location (for "remote"). */
  workMode: string;
  /** Platform fields (youtube/instagram/…). */
  platform: string;
  /** Format fields (long-form/shorts/thumbnails/…). */
  format: string;
  /** Genre fields (explainers/documentaries/…). */
  genre: string;
  /** Language fields. */
  language: string;
  /** Tool fields. */
  tool: string;
};

const norm = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const bag = (...values: Array<string | null | undefined | (string | null | undefined)[]>): string => {
  const parts: string[] = [];
  for (const value of values) {
    if (Array.isArray(value)) parts.push(...value.filter(Boolean).map(String));
    else if (value) parts.push(String(value));
  }
  return norm(parts.join(" "));
};

/**
 * Does a keyword hit a normalized field? A multi-word phrase matches as a
 * substring ("channel manager"); a single word matches any token that starts
 * with it, so a stem like "edit" catches editor/editing/edits but not "credit".
 */
const keywordHits = (field: string, keyword: string): boolean => {
  const needle = norm(keyword);
  if (!needle) return false;
  if (needle.includes(" ")) return field.includes(needle);
  return field.split(" ").some((token) => token.startsWith(needle));
};

const groupSatisfied = (field: string, keywords: string[] | undefined): boolean => {
  if (!keywords || keywords.length === 0) return true; // absent group = no constraint
  return keywords.some((keyword) => keywordHits(field, keyword));
};

/**
 * Eligibility: every PRESENT intent group must be satisfied (AND across groups),
 * and a group is satisfied when ANY of its keywords hit the matching field.
 */
export function seoRouteMatchesFields(intent: SeoRequiredIntent, fields: SeoIntentFields): boolean {
  return (
    groupSatisfied(fields.role, intent.role) &&
    groupSatisfied(fields.niche, intent.niche) &&
    groupSatisfied(fields.workMode, intent.workMode) &&
    groupSatisfied(fields.platform, intent.platform) &&
    groupSatisfied(fields.format, intent.format) &&
    groupSatisfied(fields.genre, intent.genre) &&
    groupSatisfied(fields.language, intent.language)
  );
}

export function jobIntentFields(job: JobLike): SeoIntentFields {
  const requiredLanguages = job.languageRequirements == null
    ? job.languages
    : job.languageRequirements.filter((item) => item.priority === "required").map((item) => item.language);
  return {
    role: bag(job.primaryRoleName, job.roleSpecialization, job.title, job.category, job.tags, job.formatsHiredFor),
    niche: bag(job.contentNiches, job.category, job.tags),
    workMode: bag(job.workMode, job.contractType, job.location),
    platform: bag(job.platform, job.postedPlatform, job.platforms, job.title, job.tags),
    format: bag(job.formatsHiredFor, job.title, job.tags),
    genre: bag(job.contentGenres, job.title, job.tags),
    language: bag(requiredLanguages),
    tool: bag(job.tools, job.requiredToolKeys, job.otherRequiredTools),
  };
}

export function talentIntentFields(talent: TalentLike): SeoIntentFields {
  return {
    role: bag(talent.title, talent.primary_role, talent.roles, talent.formats),
    niche: bag(talent.niche, talent.content_niches),
    workMode: bag(talent.work_mode, talent.location),
    platform: bag(talent.platforms, talent.title),
    format: bag(talent.formats, talent.title),
    genre: bag(talent.content_genres, talent.formats, talent.title),
    language: bag(talent.languages),
    tool: bag(talent.tools),
  };
}

// ---------------------------------------------------------------------------
// Ad-hoc Row-2 refinements (query params, applied on top of the route gate).
// Keyword dims reuse the same field bags (OR within a dim, AND across dims);
// experience/availability are structured predicates on the raw item.
// ---------------------------------------------------------------------------

export type RefinementCriteria = {
  platforms?: string[];
  niches?: string[];
  genres?: string[];
  formats?: string[];
  workModes?: string[];
  languages?: string[];
  tools?: string[];
  /** Experience band: "0-1" | "2-4" | "5+" (talent only). */
  experience?: string;
  /** Availability: "available" (talent only). */
  availability?: string;
};

export function hasRefinements(c: RefinementCriteria | null | undefined): boolean {
  if (!c) return false;
  return Boolean(
    c.platforms?.length ||
      c.niches?.length ||
      c.genres?.length ||
      c.formats?.length ||
      c.workModes?.length ||
      c.languages?.length ||
      c.tools?.length ||
      c.experience ||
      c.availability
  );
}

const keywordDimSatisfied = (fieldBag: string, values: string[] | undefined): boolean => {
  if (!values || values.length === 0) return true;
  return values.some((value) => keywordHits(fieldBag, value));
};

const experienceBandSatisfied = (years: number | null | undefined, band: string | undefined): boolean => {
  if (!band) return true;
  if (years == null) return false; // an experience refinement excludes listings with no data
  if (band === "0-1") return years <= 1;
  if (band === "2-4") return years >= 2 && years <= 4;
  if (band === "5+") return years >= 5;
  return true;
};

/** Keyword dims + numeric/exact structured dims (experience/availability = talent). */
function matchesRefinements(
  fields: SeoIntentFields,
  criteria: RefinementCriteria,
  structured: { experienceYears?: number | null; availabilityStatus?: string | null }
): boolean {
  return (
    keywordDimSatisfied(fields.platform, criteria.platforms) &&
    keywordDimSatisfied(fields.niche, criteria.niches) &&
    keywordDimSatisfied(fields.genre, criteria.genres) &&
    keywordDimSatisfied(fields.format, criteria.formats) &&
    keywordDimSatisfied(fields.workMode, criteria.workModes) &&
    keywordDimSatisfied(fields.language, criteria.languages) &&
    keywordDimSatisfied(fields.tool, criteria.tools) &&
    experienceBandSatisfied(structured.experienceYears, criteria.experience) &&
    (!criteria.availability || structured.availabilityStatus === criteria.availability)
  );
}

export function jobMatchesRefinements(job: JobLike, criteria: RefinementCriteria): boolean {
  // Jobs have no persisted tools/experience/availability, so those refinement
  // dims are ignored for jobs (the UI never offers them; defended here). Only the
  // supported keyword dims gate.
  const supported: RefinementCriteria = {
    platforms: criteria.platforms,
    niches: criteria.niches,
    genres: criteria.genres,
    formats: criteria.formats,
    workModes: criteria.workModes,
    languages: criteria.languages,
  };
  return matchesRefinements(jobIntentFields(job), supported, {});
}

export function talentMatchesRefinements(talent: TalentLike, criteria: RefinementCriteria): boolean {
  return matchesRefinements(talentIntentFields(talent), criteria, {
    experienceYears: talent.experience_years ?? null,
    availabilityStatus: talent.availability_status ?? null,
  });
}

const readParam = (value: string | string[] | undefined): string[] =>
  (Array.isArray(value) ? value : value ? [value] : [])
    .flatMap((entry) => entry.split(","))
    .map((entry) => entry.trim())
    .filter(Boolean);

const first = (value: string | string[] | undefined): string | undefined =>
  readParam(value)[0];

/**
 * Build refinement criteria from browse-page query params. Multi-value dims are
 * comma-separated (`?niche=finance,gaming`); experience/availability are single.
 * Param keys mirror `subfilterParam` in seoFilterRoutes (workMode stays "workMode").
 */
export function refinementCriteriaFromParams(
  params: Record<string, string | string[] | undefined>
): RefinementCriteria {
  return {
    platforms: readParam(params.platform),
    niches: readParam(params.niche),
    genres: readParam(params.genre),
    formats: readParam(params.format),
    workModes: readParam(params.workMode),
    languages: readParam(params.language),
    tools: readParam(params.tool),
    experience: first(params.experience),
    availability: first(params.availability),
  };
}

const recencyKey = (iso: string | null | undefined): number => {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
};

/**
 * Gate jobs by the route's required intent, then order the eligible set by
 * relevance to the route's canonical query (score desc, newest tiebreak).
 * Eligible jobs are always returned — a low score reorders, never excludes.
 */
export function filterAndOrderJobsForSeoRoute<T extends JobLike>(
  jobs: T[],
  route: SeoFilterRoute,
  refinements?: RefinementCriteria | null
): T[] {
  const eligible = jobs.filter(
    (job) =>
      seoRouteMatchesFields(route.requiredIntent, jobIntentFields(job)) &&
      (!hasRefinements(refinements) || jobMatchesRefinements(job, refinements!))
  );
  const parsed = parseQuery(route.searchQuery);
  return eligible
    .map((item) => ({ item, score: scoreJob(item, parsed) }))
    .sort((a, b) => b.score - a.score || recencyKey(b.item.createdAt) - recencyKey(a.item.createdAt))
    .map((entry) => entry.item);
}

export function filterAndOrderTalentForSeoRoute<T extends TalentLike>(
  listings: T[],
  route: SeoFilterRoute,
  refinements?: RefinementCriteria | null
): T[] {
  const eligible = listings.filter(
    (item) =>
      seoRouteMatchesFields(route.requiredIntent, talentIntentFields(item)) &&
      (!hasRefinements(refinements) || talentMatchesRefinements(item, refinements!))
  );
  const parsed = parseQuery(route.searchQuery);
  return eligible
    .map((item) => ({ item, score: scoreTalent(item, parsed) }))
    .sort((a, b) => b.score - a.score || recencyKey(b.item.created_at) - recencyKey(a.item.created_at))
    .map((entry) => entry.item);
}

// ---------------------------------------------------------------------------
// Search-to-filter: turn a free-text header query into a browse destination.
// ---------------------------------------------------------------------------

/** Two normalized strings "match" when equal or one contains the other as a run. */
const valuesMatch = (a: string, b: string): boolean => {
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
};

// Which ParsedQuery bucket feeds each Row-2 subfilter dimension. Location/budget
// are intentionally excluded — SEO routes don't hard-gate on them (they push a
// query too specific to curate toward the ranked ?q= search instead).
const PARSED_DIMENSIONS: Array<{ key: keyof Pick<ReturnType<typeof parseQuery>,
  "platforms" | "niches" | "genres" | "formats" | "workModes" | "languages">; dimension: SubfilterDimension }> = [
  { key: "platforms", dimension: "platform" },
  { key: "niches", dimension: "niche" },
  { key: "genres", dimension: "genre" },
  { key: "formats", dimension: "format" },
  { key: "workModes", dimension: "workMode" },
  { key: "languages", dimension: "language" },
];

export type SeoSearchTarget = { href: string; indexable: boolean };

/**
 * Decide where a header search navigates, in three tiers (SEO plan §10):
 *  1. A query that equals a curated route/alias → that clean, indexable route
 *     (e.g. "youtube video editor" → /jobs/video-editor-jobs).
 *  2. A recognised role plus modifiers that map onto that role's real Row-2
 *     chips → the role's base route with those refinements as params, so the
 *     browse page pre-selects the chips and hard-filters. Refined pages are
 *     noindex — never treated as landing pages. A bare role with no extra
 *     signal still resolves to its curated base route.
 *  3. Anything ambiguous, or location-/budget-heavy → the ranked ?q= search.
 * Only tiers 1 and the bare-role case of tier 2 return an indexable target.
 */
export function seoSearchTarget(type: SeoFilterType, rawQuery: string): SeoSearchTarget {
  const query = (rawQuery ?? "").trim();
  const base = type === "talent" ? "/talent" : "/jobs";
  if (!query) return { href: base, indexable: true };

  const exact = findSeoRouteForSearchQuery(type, query);
  if (exact) return { href: exact.path, indexable: true };

  const parsed = parseQuery(query);
  const roleValue = parsed.roles[0];
  // A location or budget in the query can't be expressed as an SEO refinement
  // param, and SEO routes never hard-gate on them — so a location-/budget-bearing
  // query is "too specific to curate": skip the curated role route and preserve
  // the full intent in the ranked ?q= search (plan §10 tier 3).
  const hasUncuratableSignal = parsed.locations.length > 0 || Boolean(parsed.budget);
  if (roleValue && !hasUncuratableSignal) {
    const roleRoute = primaryRoleChipsForType(type).find((route) =>
      (route.selectedFilters.roles ?? []).some((r) => valuesMatch(r, roleValue))
    );
    if (roleRoute) {
      const chips = subfiltersForRole(type, roleForRoute(roleRoute)).filter((chip) => !chip.curatedPath);
      const params = new URLSearchParams();
      let candidateCount = 0; // recognised modifiers the user typed
      let mappedCount = 0; // how many resolved to a real Row-2 chip
      for (const { key, dimension } of PARSED_DIMENSIONS) {
        for (const parsedValue of parsed[key]) {
          candidateCount += 1;
          const chip = chips.find((c) => c.dimension === dimension && valuesMatch(c.value, parsedValue));
          if (!chip) continue;
          const paramKey = subfilterParam(dimension);
          const existing = (params.get(paramKey) ?? "").split(",").filter(Boolean);
          if (!existing.some((v) => v.toLowerCase() === chip.value.toLowerCase())) {
            existing.push(chip.value);
            params.set(paramKey, existing.join(","));
            mappedCount += 1;
          }
        }
      }
      const qs = params.toString();
      if (mappedCount > 0) return { href: `${roleRoute.path}?${qs}`, indexable: false };
      // Nothing mapped. A bare role (no other signal at all) → the curated base
      // route; but if the user typed modifiers we couldn't express as chips, or
      // stray free tokens, don't silently drop them — fall through to search.
      const hasExtraSignal = candidateCount > 0 || parsed.freeTokens.length > 0;
      if (!hasExtraSignal) return { href: roleRoute.path, indexable: true };
    }
  }

  return { href: `${base}?q=${encodeURIComponent(query)}`, indexable: false };
}
