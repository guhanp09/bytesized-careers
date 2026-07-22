// Weighted, multi-field scoring for jobs and talent. Separate adapters because the
// fields differ. Budget/location are soft signals (boost, never a hard filter), so
// otherwise-relevant listings still surface — just lower. Tie-break by recency.

import { aliasesForCanonical, normalizeText, type SearchDimension } from "./searchVocabulary.ts";
import { editDistance, type ParsedBudget, type ParsedQuery } from "./queryParser.ts";

export type ScoredResult<T> = { item: T; score: number };

// Structural inputs — the real Job / BackendTalentListing satisfy these.
export type JobLike = {
  id: string;
  title: string;
  category?: string | null;
  primaryRoleName?: string | null;
  roleSpecialization?: string | null;
  location?: string | null;
  budget?: string | null;
  budgetAmount?: number | null;
  workMode?: string | null;
  contractType?: string | null;
  platform?: string | null;
  platforms?: string[] | null;
  postedPlatform?: string | null;
  contentNiches?: string[] | null;
  contentGenres?: string[] | null;
  formatsHiredFor?: string[] | null;
  tools?: string[] | null;
  requiredToolKeys?: string[] | null;
  otherRequiredTools?: string[] | null;
  languages?: string[] | null;
  languageRequirements?: Array<{ language: string; priority: string }> | null;
  tags?: string[] | null;
  about?: string | null;
  responsibilities?: string | null;
  requirements?: string | null;
  channel?: { name?: string | null } | null;
  createdAt?: string | null;
  hiringVerificationStatus?: string | null;
};

export type TalentLike = {
  id: string;
  title: string;
  primary_role?: string | null;
  roles?: string[] | null;
  niche?: string | null;
  content_niches?: string[] | null;
  content_genres?: string[] | null;
  formats?: string[] | null;
  platforms?: string[] | null;
  tools?: string[] | null;
  languages?: string[] | null;
  work_mode?: string | null;
  location?: string | null;
  rate_min?: number | null;
  rate_max?: number | null;
  rate_note?: string | null;
  description?: string | null;
  experience_years?: number | null;
  created_at?: string | null;
  owner_display_name?: string | null;
  availability_status?: string | null;
  turnaround?: string | null;
};

const W = {
  role: 10,
  platform: 6,
  location: 6,
  budget: 6,
  workMode: 5,
  language: 5,
  format: 4,
  niche: 7,
  genre: 6,
  tool: 4,
  free: 2,
};

type FieldMatcher = { joined: string; tokens: Set<string> };

function toParts(...values: Array<string | null | undefined | (string | null | undefined)[]>): string {
  const out: string[] = [];
  for (const value of values) {
    if (Array.isArray(value)) out.push(...value.filter(Boolean).map(String));
    else if (value) out.push(String(value));
  }
  return out.join(" ");
}

function matcher(...values: Array<string | null | undefined | (string | null | undefined)[]>): FieldMatcher {
  const joined = normalizeText(toParts(...values));
  return { joined, tokens: new Set(joined.split(" ").filter(Boolean)) };
}

// A vocabulary term hits a field if a short alias is a standalone token, or a longer
// alias appears as a substring of the (clean) field text.
function termInField(field: FieldMatcher, term: string): boolean {
  if (!term) return false;
  if (term.length <= 2) return field.tokens.has(term);
  return field.joined.includes(term);
}

function canonicalInField(dimension: SearchDimension, canonical: string, field: FieldMatcher): boolean {
  return aliasesForCanonical(dimension, canonical).some((alias) =>
    alias.includes(" ") ? field.joined.includes(alias) : termInField(field, alias)
  );
}

function freeTokenInField(field: FieldMatcher, token: string): number {
  if (termInField(field, token)) return W.free;
  if (token.length >= 5) {
    for (const word of field.tokens) {
      if (word[0] === token[0] && Math.abs(word.length - token.length) <= 2 && editDistance(word, token) <= 2) {
        return W.free * 0.6;
      }
    }
  }
  return 0;
}

function budgetScore(budget: ParsedBudget, amount: number | null | undefined): number {
  if (amount == null || !Number.isFinite(amount) || amount <= 0) return 0;
  if (budget.op === "under") return amount <= budget.amount ? W.budget : 0;
  if (budget.op === "over") return amount >= budget.amount ? W.budget : 0;
  const ratio = amount / budget.amount;
  if (ratio >= 0.8 && ratio <= 1.25) return W.budget;
  if (ratio >= 0.5 && ratio <= 2) return W.budget * 0.6;
  if (ratio >= 0.25 && ratio <= 4) return W.budget * 0.25;
  return 0;
}

function locationScore(parsedLocations: string[], locationField: FieldMatcher, workModeField: FieldMatcher): number {
  let score = 0;
  for (const loc of parsedLocations) {
    if (loc === "Remote") {
      if (locationField.joined.includes("remote") || workModeField.joined.includes("remote")) score += W.location;
    } else if (loc === "India") {
      if (locationField.joined.length > 0) score += W.location * 0.3;
    } else if (locationField.joined.includes(loc.toLowerCase())) {
      score += W.location;
    }
  }
  return score;
}

function firstJobAmount(budget: string | null | undefined): number | null {
  if (!budget) return null;
  const m = budget.replace(/,/g, "").match(/\d+/);
  return m ? Number(m[0]) : null;
}

function recencyKey(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}

export function scoreJob(job: JobLike, p: ParsedQuery): number {
  const roleField = matcher(job.primaryRoleName, job.roleSpecialization, job.title, job.category, job.tags);
  const platformField = matcher(job.platform, job.postedPlatform, job.title, job.tags);
  const formatField = matcher(job.formatsHiredFor, job.title, job.tags, job.responsibilities, job.requirements);
  const nicheField = matcher(job.contentNiches, job.category, job.tags, job.about);
  const genreField = matcher(job.contentGenres, job.title, job.tags, job.about);
  const structuredFormatField = matcher(job.formatsHiredFor);
  const structuredNicheField = matcher(job.contentNiches);
  const structuredGenreField = matcher(job.contentGenres);
  const workModeField = matcher(job.workMode, job.contractType);
  const toolsField = matcher(job.tools, job.requiredToolKeys, job.otherRequiredTools);
  const requiredLanguages = job.languageRequirements == null
    ? job.languages
    : job.languageRequirements.filter((item) => item.priority === "required").map((item) => item.language);
  const langField = matcher(requiredLanguages);
  const locationField = matcher(job.location);
  const corpus = matcher(
    job.title,
    job.primaryRoleName,
    job.roleSpecialization,
    job.category,
    job.about,
    job.responsibilities,
    job.requirements,
    job.contentNiches,
    job.contentGenres,
    job.formatsHiredFor,
    job.tags,
    job.tools,
    requiredLanguages,
    job.channel?.name
  );

  let score = 0;
  for (const role of p.roles) if (canonicalInField("role", role, roleField)) score += W.role;
  for (const platform of p.platforms) if (canonicalInField("platform", platform, platformField)) score += W.platform;
  for (const niche of p.niches)
    if (canonicalInField("niche", niche, structuredNicheField)) score += W.niche + 3;
    else if (canonicalInField("niche", niche, nicheField)) score += W.niche;
  for (const genre of p.genres)
    if (canonicalInField("genre", genre, structuredGenreField)) score += W.genre + 3;
    else if (canonicalInField("genre", genre, genreField)) score += W.genre;
  for (const format of p.formats)
    if (canonicalInField("format", format, structuredFormatField)) score += W.format + 3;
    else if (canonicalInField("format", format, formatField)) score += W.format;
  for (const mode of p.workModes) if (canonicalInField("workMode", mode, workModeField)) score += W.workMode;
  for (const language of p.languages)
    if (termInField(langField, language.toLowerCase()) || termInField(corpus, language.toLowerCase())) score += W.language;
  score += locationScore(p.locations, locationField, workModeField);
  for (const token of p.freeTokens) score += freeTokenInField(corpus, token) || (termInField(nicheField, token) ? W.niche : 0) || (termInField(toolsField, token) ? W.tool : 0);

  // Budget refines listings that already match something — it never qualifies a
  // listing on its own (otherwise every cheap job matches "... under 5k").
  if (score > 0) {
    if (p.budget) score += budgetScore(p.budget, job.budgetAmount ?? firstJobAmount(job.budget));
    if (job.hiringVerificationStatus === "VERIFIED") score += 0.5;
    if (job.about && job.tags && job.tags.length) score += 0.25; // completeness
  }
  return score;
}

export function scoreTalent(t: TalentLike, p: ParsedQuery): number {
  const roleField = matcher(t.title, t.primary_role, t.roles);
  const platformField = matcher(t.platforms, t.title);
  const formatField = matcher(t.formats, t.title, t.niche);
  const nicheField = matcher(t.content_niches, t.niche, t.formats, t.title);
  const genreField = matcher(t.content_genres, t.formats, t.title, t.description);
  const structuredFormatField = matcher(t.formats);
  const structuredNicheField = matcher(t.content_niches);
  const structuredGenreField = matcher(t.content_genres);
  const workModeField = matcher(t.work_mode, t.turnaround);
  const toolsField = matcher(t.tools);
  const langField = matcher(t.languages);
  const locationField = matcher(t.location);
  const corpus = matcher(
    t.title,
    t.primary_role,
    t.roles,
    t.niche,
    t.content_niches,
    t.content_genres,
    t.formats,
    t.tools,
    t.languages,
    t.description,
    t.rate_note,
    t.owner_display_name
  );

  let score = 0;
  for (const role of p.roles) if (canonicalInField("role", role, roleField)) score += W.role;
  for (const platform of p.platforms) if (canonicalInField("platform", platform, platformField)) score += W.platform;
  for (const niche of p.niches)
    if (canonicalInField("niche", niche, structuredNicheField)) score += W.niche + 3;
    else if (canonicalInField("niche", niche, nicheField)) score += W.niche;
  for (const genre of p.genres)
    if (canonicalInField("genre", genre, structuredGenreField)) score += W.genre + 3;
    else if (canonicalInField("genre", genre, genreField)) score += W.genre;
  for (const format of p.formats)
    if (canonicalInField("format", format, structuredFormatField)) score += W.format + 3;
    else if (canonicalInField("format", format, formatField)) score += W.format;
  for (const mode of p.workModes) if (canonicalInField("workMode", mode, workModeField)) score += W.workMode;
  for (const language of p.languages)
    if (termInField(langField, language.toLowerCase()) || termInField(corpus, language.toLowerCase())) score += W.language;
  score += locationScore(p.locations, locationField, workModeField);
  for (const token of p.freeTokens) score += freeTokenInField(corpus, token) || (termInField(nicheField, token) ? W.niche : 0) || (termInField(toolsField, token) ? W.tool : 0);

  if (score > 0) {
    if (p.budget) score += budgetScore(p.budget, t.rate_min ?? t.rate_max ?? null);
    if (t.availability_status === "available") score += 0.25;
  }
  return score;
}

export function rankJobs<T extends JobLike>(jobs: T[], p: ParsedQuery): ScoredResult<T>[] {
  return jobs
    .map((item) => ({ item, score: scoreJob(item, p) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || recencyKey(b.item.createdAt) - recencyKey(a.item.createdAt));
}

export function rankTalent<T extends TalentLike>(listings: T[], p: ParsedQuery): ScoredResult<T>[] {
  return listings
    .map((item) => ({ item, score: scoreTalent(item, p) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || recencyKey(b.item.created_at) - recencyKey(a.item.created_at));
}

/** Drop the most restrictive signals (budget + location) so the page can broaden. */
export function relaxParsedQuery(p: ParsedQuery): ParsedQuery {
  return { ...p, budget: undefined, locations: [] };
}
