import type { Metadata } from "next";
import JobGridClient from "../../components/JobGridClient";
import { canUseLocalMockFallback, listJobsWithMeta } from "../../lib/backendClient";
import { getMarketplaceDataSourceState } from "../../lib/devDataSource.server";
import { JOBS } from "../../lib/jobs";
import { parseQuery } from "../../lib/search/queryParser";
import { rankJobs, relaxParsedQuery } from "../../lib/search/ranking";
import { filterAndOrderJobsForSeoRoute } from "../../lib/seoFilterMatch";
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
  const platform = first(params.platform);
  const location = first(params.location);
  const startTimeframe = first(params.start_timeframe);
  const posted = first(params.posted);

  let jobs: Job[] = [];
  let notice: string | null = null;
  const dataSource = await getMarketplaceDataSourceState();
  const usingMock = dataSource.source === "mock";
  const canUseMocks = canUseLocalMockFallback() && dataSource.overrideSource !== "backend";
  if (usingMock) {
    jobs = JOBS;
  } else {
    try {
      const response = await listJobsWithMeta({
        platform,
        location,
        start_timeframe: startTimeframe,
        status: "published",
        limit: 100,
        offset: 0,
      });
      jobs = response.items;
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

  if (seoRoute) {
    // Hard eligibility gate first, then relevance ordering — a curated route
    // must not leak weak/irrelevant matches just because they share a broad tag.
    jobs = filterAndOrderJobsForSeoRoute(jobs, seoRoute);
  } else if (query) {
    const parsed = parseQuery(query);
    let ranked = rankJobs(jobs, parsed);
    if (ranked.length === 0 && (parsed.budget || parsed.locations.length > 0)) {
      ranked = rankJobs(jobs, relaxParsedQuery(parsed));
    }
    jobs = ranked.map((result) => result.item);
  }

  if (posted === "1") {
    notice = "Job posted. It should appear at the top of the feed. Refresh to verify it persists.";
  }

  return <JobGridClient jobs={jobs} notice={notice} query={query} seoRoute={seoRoute || null} />;
}

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <JobsBrowse searchParams={searchParams} />;
}
