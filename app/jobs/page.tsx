import type { Metadata } from "next";
import JobGridClient from "../../components/JobGridClient";
import {
  canUseLocalMockFallback,
  deepSearchJobs,
  listJobsWithMeta,
  listRoles,
  type BackendRole,
  type BackendSearchIntent,
} from "../../lib/backendClient";
import { getMarketplaceDataSourceState } from "../../lib/devDataSource.server";
import { JOBS } from "../../lib/jobs";
import { parseQuery } from "../../lib/search/queryParser";
import { rankJobs, relaxParsedQuery } from "../../lib/search/ranking";
import { filterAndOrderJobsForSeoRoute, refinementCriteriaFromParams } from "../../lib/seoFilterMatch";
import {
  activeJobDiscoveryCount,
  jobMatchesDiscovery,
  parseJobDiscovery,
  roleSlugFromName,
} from "../../lib/jobDiscovery";
import type { SeoFilterRoute } from "../../lib/seoFilterRoutes";
import { Job } from "../../lib/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const first = (value?: string | string[]) => (Array.isArray(value) ? value[0] : value) || "";

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const params = await searchParams;
  const hasParams = Object.values(params).some((value) => {
    if (Array.isArray(value)) return value.length > 0;
    return value != null && value !== "";
  });

  return {
    title: "Jobs",
    description: "Browse creator-economy jobs from creators, YouTube channels, agencies, and creator-led teams.",
    alternates: { canonical: "/jobs" },
    robots: hasParams ? { index: false, follow: true } : undefined,
  };
}

export async function JobsBrowse({
  searchParams,
  seoRoute,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
  seoRoute?: SeoFilterRoute | null;
}) {
  const params = await searchParams;
  const q = first(params.q);
  // Curated SEO routes are a hard filter (see below); free-text search is ranked.
  const query = seoRoute ? "" : q.trim();
  const posted = first(params.posted);
  // Row-2 subfilter refinements (only meaningful on a curated route). On an SEO
  // route we fetch broadly and apply role + refinements strictly in memory, so
  // no refinement param pre-narrows the server fetch (and risks case-mismatch drops).
  const refinements = seoRoute ? refinementCriteriaFromParams(params) : null;
  const platform = seoRoute ? "" : first(params.platform);
  const location = seoRoute ? "" : first(params.location);
  const startTimeframe = seoRoute ? "" : first(params.start_timeframe);
  const role = first(params.role);
  const format = first(params.format);
  const workMode = first(params.workMode);
  const engagement = first(params.engagement);
  const compensationUnit = first(params.compensationUnit);

  const discoveryParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    const resolved = first(value);
    if (resolved) discoveryParams.set(key, resolved);
  });
  const discovery = parseJobDiscovery(discoveryParams);

  let jobs: Job[] = [];
  let roles: BackendRole[] = [];
  let notice: string | null = null;
  let searchIntent: BackendSearchIntent | null = null;
  let searchTotal: number | undefined;
  let noExactMatch = false;
  let matchReasons: Record<string, string[]> = {};
  let usedDeepSearch = false;
  const dataSource = await getMarketplaceDataSourceState();
  const usingMock = dataSource.source === "mock";
  const canUseMocks = canUseLocalMockFallback() && dataSource.overrideSource !== "backend";
  if (usingMock) {
    jobs = JOBS;
  } else {
    try {
      if (query) {
        const response = await deepSearchJobs({
          q: query,
          role: discovery.role,
          platform: discovery.platform,
          format: discovery.format,
          work_mode: discovery.workMode,
          engagement_type: discovery.engagement,
          location: discovery.location,
          limit: 100,
          offset: 0,
        });
        jobs = response.items.map((match) => match.item);
        matchReasons = Object.fromEntries(
          response.items.map((match) => [String(match.item.id), match.reasons]),
        );
        searchIntent = response.intent;
        searchTotal = response.total;
        noExactMatch = response.noExactMatch;
        usedDeepSearch = true;
      } else {
        const response = await listJobsWithMeta({
          role: seoRoute ? undefined : role,
          platform,
          format: seoRoute ? undefined : format,
          work_mode: seoRoute ? undefined : workMode,
          engagement_type: seoRoute ? undefined : engagement,
          budget_unit: seoRoute ? undefined : compensationUnit,
          location,
          start_timeframe: startTimeframe,
          status: "published",
          limit: 100,
          offset: 0,
        });
        jobs = response.items;
      }
      roles = (await listRoles().catch(() => ({ items: [] }))).items;
    } catch {
      if (canUseMocks) {
        jobs = JOBS;
        notice =
          "Backend not reachable — showing local sample listings for development, not the live feed. Start it with `npm run dev:all` (or `npm run dev:backend`), then refresh.";
      } else {
        jobs = [];
        notice = "Jobs could not be loaded right now. Please try again shortly.";
      }
    }
  }

  if (!roles.length) {
    roles = jobs
      .filter((job) => job.primaryRoleId && job.primaryRoleName)
      .map((job) => ({
        id: job.primaryRoleId as string,
        name: job.primaryRoleName as string,
        slug: roleSlugFromName(job.primaryRoleName),
        category: job.legacyCategory || "Creator role",
      }))
      .filter((roleOption, index, all) => all.findIndex((candidate) => candidate.slug === roleOption.slug) === index);
  }

  if (seoRoute) {
    // Hard eligibility gate (role + curated combo) then any Row-2 refinements,
    // then relevance ordering — a curated route must not leak weak/irrelevant
    // matches just because they share a broad tag.
    jobs = filterAndOrderJobsForSeoRoute(jobs, seoRoute, refinements);
  } else if (query && !usedDeepSearch) {
    const parsed = parseQuery(query);
    let ranked = rankJobs(jobs, parsed);
    if (ranked.length === 0 && (parsed.budget || parsed.locations.length > 0)) {
      ranked = rankJobs(jobs, relaxParsedQuery(parsed));
    }
    jobs = ranked.map((result) => result.item);
  }

  // The backend applies these exact filters for the public feed. Reapplying the
  // pure predicate keeps local mocks and curated SEO routes behaviorally equal.
  jobs = jobs.filter((job) => jobMatchesDiscovery(job, discovery));
  if (usedDeepSearch && activeJobDiscoveryCount(discovery) > 0) {
    searchTotal = jobs.length;
  }

  if (posted === "1") {
    notice = "Job posted. It should appear at the top of the feed. Refresh to verify it persists.";
  }

  return (
    <JobGridClient
      jobs={jobs}
      notice={notice}
      query={query}
      seoRoute={seoRoute || null}
      roles={roles}
      searchIntent={searchIntent}
      searchTotal={searchTotal}
      noExactMatch={noExactMatch}
      matchReasons={matchReasons}
    />
  );
}

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <JobsBrowse searchParams={searchParams} />;
}
