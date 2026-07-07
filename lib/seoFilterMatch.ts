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
import type { SeoFilterRoute, SeoRequiredIntent } from "./seoFilterRoutes.ts";

/** Normalized intent fields extracted from a listing, one bag per intent group. */
export type SeoIntentFields = {
  /** Role-bearing/structured fields: title, primary role, roles, formats, category. */
  role: string;
  /** Niche/genre fields. */
  niche: string;
  /** Work mode + location (for "remote"). */
  workMode: string;
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
    groupSatisfied(fields.workMode, intent.workMode)
  );
}

export function jobIntentFields(job: JobLike): SeoIntentFields {
  return {
    role: bag(job.title, job.category, job.tags, job.formatsHiredFor),
    niche: bag(job.contentNiches, job.contentGenres, job.category, job.tags),
    workMode: bag(job.workMode, job.contractType, job.location),
  };
}

export function talentIntentFields(talent: TalentLike): SeoIntentFields {
  return {
    role: bag(talent.title, talent.primary_role, talent.roles, talent.formats),
    niche: bag(talent.niche, talent.content_niches, talent.content_genres),
    workMode: bag(talent.work_mode, talent.location),
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
export function filterAndOrderJobsForSeoRoute<T extends JobLike>(jobs: T[], route: SeoFilterRoute): T[] {
  const eligible = jobs.filter((job) => seoRouteMatchesFields(route.requiredIntent, jobIntentFields(job)));
  const parsed = parseQuery(route.searchQuery);
  return eligible
    .map((item) => ({ item, score: scoreJob(item, parsed) }))
    .sort((a, b) => b.score - a.score || recencyKey(b.item.createdAt) - recencyKey(a.item.createdAt))
    .map((entry) => entry.item);
}

export function filterAndOrderTalentForSeoRoute<T extends TalentLike>(listings: T[], route: SeoFilterRoute): T[] {
  const eligible = listings.filter((item) => seoRouteMatchesFields(route.requiredIntent, talentIntentFields(item)));
  const parsed = parseQuery(route.searchQuery);
  return eligible
    .map((item) => ({ item, score: scoreTalent(item, parsed) }))
    .sort((a, b) => b.score - a.score || recencyKey(b.item.created_at) - recencyKey(a.item.created_at))
    .map((entry) => entry.item);
}
