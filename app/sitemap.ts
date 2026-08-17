import type { MetadataRoute } from "next";
import { isLocalMocksEnabled, listJobsWithMeta, listTalentListings } from "../lib/backendClient";
import { JOBS } from "../lib/jobs";
import { seoFilterSitemapRoutes } from "../lib/seoFilterRoutes";

const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXTAUTH_URL || "http://localhost:3000").replace(
  /\/+$/,
  ""
);

/**
 * Rendered per request, never at build time.
 *
 * It was being prerendered, which is wrong twice over. A sitemap listing live
 * jobs baked into the build output is frozen until the next deploy, so a job
 * posted an hour after a release is not in it. And a build without a reachable
 * backend produced a sitemap containing only the static routes — permanently,
 * because the file was then a build artifact rather than something regenerated.
 *
 * That second half is why removing the swallowed error broke the build rather
 * than the request: the failure had been happening at build time all along, and
 * had been silently absorbed. Dynamic rendering puts it where it belongs — a
 * request-time 500, which a crawler treats as "try again later" while keeping
 * what it already has.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * How many records to ask for per request while walking a list.
 *
 * The sitemap previously asked for exactly 100 and stopped. With four hundred
 * open jobs, three hundred of them were simply absent, and nothing anywhere said
 * so — the file was valid, well-formed, and quietly described a smaller site than
 * the one being served.
 */
const PAGE_SIZE = 100;

/**
 * The protocol's own ceiling: 50,000 URLs in one sitemap. Reaching it is not an
 * error, it is the point at which this file has to become a sitemap index, and
 * that is a different piece of work. Stopping here bounds the request loop
 * against a paginating API that never says it is finished.
 */
const MAX_URLS_PER_SITEMAP = 50_000;

const MAX_PAGES = Math.ceil(MAX_URLS_PER_SITEMAP / PAGE_SIZE);

/**
 * A timestamp a crawler can act on, or nothing at all.
 *
 * `new Date()` was being used as the fallback, which claims every job changed at
 * the moment the sitemap was fetched. That is worse than omitting the field:
 * `lastmod` exists so a crawler can skip what has not changed, and a file where
 * everything changed one second ago teaches it to disregard `lastmod` for this
 * site entirely. An absent timestamp says "I do not know", which is true and
 * costs nothing.
 */
function realTimestamp(value: string | null | undefined): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

/**
 * Walk a paginated list to the end.
 *
 * Deliberately has no `catch`. A failure has to reach the caller — see the note
 * on `sitemap()` about why a partial sitemap must not be served as a complete
 * one.
 */
async function collectAllPages<T>(
  fetchPage: (offset: number, limit: number) => Promise<{ items: T[]; total?: number }>,
): Promise<T[]> {
  const collected: T[] = [];

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const { items, total } = await fetchPage(page * PAGE_SIZE, PAGE_SIZE);
    collected.push(...items);

    // Three separate ways a walk ends, and all three are needed: a short page,
    // an empty page, and a reported total already reached. A server that ignores
    // `offset` would otherwise return the same first page forever.
    if (items.length < PAGE_SIZE) break;
    if (typeof total === "number" && collected.length >= total) break;
    if (collected.length >= MAX_URLS_PER_SITEMAP) break;
  }

  return collected.slice(0, MAX_URLS_PER_SITEMAP);
}

/**
 * Every static page that is indexable, matching lib/seo/routeIndexing.ts.
 *
 * /faq was missing until now, which is the failure mode a hand-maintained list
 * has: a page ships, and its absence from this file is invisible because the
 * file is still valid. tests/sitemapCoverage.test.mjs now compares this against
 * the route registry.
 */
const STATIC_ROUTES: MetadataRoute.Sitemap = [
  { url: siteUrl, changeFrequency: "daily", priority: 1 },
  { url: `${siteUrl}/jobs`, changeFrequency: "daily", priority: 0.85 },
  { url: `${siteUrl}/talent`, changeFrequency: "daily", priority: 0.8 },
  { url: `${siteUrl}/faq`, changeFrequency: "monthly", priority: 0.4 },
  { url: `${siteUrl}/support`, changeFrequency: "monthly", priority: 0.35 },
  { url: `${siteUrl}/terms`, changeFrequency: "monthly", priority: 0.3 },
  { url: `${siteUrl}/privacy`, changeFrequency: "monthly", priority: 0.3 },
];

/**
 * The sitemap, or an error.
 *
 * The `.catch(() => [])` this used to carry is the interesting part of the fix.
 * With the backend unreachable, it produced a valid sitemap listing six static
 * pages and served it with a 200 — and a crawler reads that as an authoritative
 * statement that the site now has six pages, which is how an index gets emptied
 * by an outage that lasted an afternoon. Letting the error propagate means Next
 * answers 500, the crawler treats the sitemap as temporarily unavailable, and it
 * keeps what it already knows.
 *
 * Filter routes and static routes are still assembled first so a diagnostic can
 * tell "we could not reach the backend" from "the backend says there is nothing".
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const seoFilterRoutes = seoFilterSitemapRoutes().map((route) => ({
    url: `${siteUrl}${route.path}`,
    changeFrequency: "daily" as const,
    priority: route.type === "jobs" ? 0.78 : 0.74,
    // No lastModified: a filtered listing changes when its contents change, and
    // that is not a date this file knows. Inventing one is what taught crawlers
    // to ignore the field.
  }));

  if (isLocalMocksEnabled()) {
    // Mock mode has a fixed set and no backend to page through.
    const mockJobRoutes = JOBS.filter(
      (job) => job.status !== "archived" && job.status !== "closed",
    ).map((job) => ({
      url: `${siteUrl}/jobs/${encodeURIComponent(String(job.id))}`,
      lastModified: realTimestamp(job.updatedAt) ?? realTimestamp(job.createdAt),
      changeFrequency: "weekly" as const,
      priority: 0.7,
    }));

    return [...STATIC_ROUTES, ...seoFilterRoutes, ...mockJobRoutes];
  }

  const jobs = await collectAllPages(async (offset, limit) => {
    const response = await listJobsWithMeta({ limit, offset });
    return { items: response.items, total: response.total };
  });

  const jobRoutes = jobs
    .filter((job) => job.status !== "archived" && job.status !== "closed")
    .map((job) => ({
      url: `${siteUrl}/jobs/${encodeURIComponent(String(job.id))}`,
      lastModified: realTimestamp(job.updatedAt) ?? realTimestamp(job.createdAt),
      changeFrequency: "weekly" as const,
      priority: 0.7,
    }));

  const listings = await collectAllPages(async (offset, limit) => {
    const response = await listTalentListings({ limit, offset });
    return { items: response.items, total: response.total };
  });

  const talentRoutes = listings.map((listing) => ({
    url: `${siteUrl}/talent/${encodeURIComponent(listing.id)}`,
    lastModified: realTimestamp(listing.updated_at),
    changeFrequency: "weekly" as const,
    priority: 0.6,
  }));

  return [...STATIC_ROUTES, ...seoFilterRoutes, ...jobRoutes, ...talentRoutes];
}
