import type { Metadata } from "next";
import TalentFeedClient from "../../components/TalentFeedClient";
import {
  canUseLocalMockFallback,
  deepSearchTalent,
  listTalentListings,
  type BackendSearchIntent,
} from "../../lib/backendClient";
import { getMarketplaceDataSourceState } from "../../lib/devDataSource.server";
import { filterMockTalentListings } from "../../lib/mockTalentListings";
import { parseQuery } from "../../lib/search/queryParser";
import { rankTalent, relaxParsedQuery } from "../../lib/search/ranking";
import { filterAndOrderTalentForSeoRoute, refinementCriteriaFromParams } from "../../lib/seoFilterMatch";
import type { SeoFilterRoute } from "../../lib/seoFilterRoutes";

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
    title: "Talent",
    description: "Browse creator-economy talent for YouTube, short-form, thumbnails, strategy, and creator-led workflows.",
    alternates: { canonical: "/talent" },
    robots: hasParams ? { index: false, follow: true } : undefined,
  };
}

export async function TalentBrowse({
  searchParams,
  seoRoute,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
  seoRoute?: SeoFilterRoute | null;
}) {
  const params = await searchParams;
  const q = first(params.q);
  // Curated SEO routes are a hard filter (applied via `selectForView`); free-text
  // search is ranked. `query` stays empty on SEO routes so the empty state reads
  // as a filtered browse, not a failed search.
  const query = seoRoute ? "" : q.trim();
  const role = first(params.role);
  // On an SEO route, platform/availability params are Row-2 refinements applied
  // strictly in memory — keep the server fetch broad (no pre-narrowing).
  const refinements = seoRoute ? refinementCriteriaFromParams(params) : null;
  const platform = seoRoute ? "" : first(params.platform);
  const location = seoRoute ? "" : first(params.location);
  const availability = seoRoute ? "" : first(params.availability);
  const dataSource = await getMarketplaceDataSourceState();
  const usingMock = dataSource.source === "mock";
  const canUseMocks = canUseLocalMockFallback() && dataSource.overrideSource !== "backend";
  let searchIntent: BackendSearchIntent | null = null;
  let searchTotal: number | undefined;
  let noExactMatch = false;
  let matchReasons: Record<string, string[]> = {};
  let usedDeepSearch = false;

  type TalentItems = Awaited<ReturnType<typeof listTalentListings>>["items"];
  const rankForQuery = (items: TalentItems) => {
    if (!query || usedDeepSearch) return items;
    const parsed = parseQuery(query);
    let ranked = rankTalent(items, parsed);
    if (ranked.length === 0 && (parsed.budget || parsed.locations.length > 0)) {
      ranked = rankTalent(items, relaxParsedQuery(parsed));
    }
    return ranked.map((result) => result.item);
  };
  // SEO route → hard eligibility gate + Row-2 refinements + relevance ordering;
  // otherwise free-text rank.
  const selectForView = (items: TalentItems) =>
    seoRoute ? filterAndOrderTalentForSeoRoute(items, seoRoute, refinements) : rankForQuery(items);

  if (usingMock) {
    const items = selectForView(filterMockTalentListings({ role, platform, location, availability }));
    return <TalentFeedClient items={items} query={query} seoRoute={seoRoute || null} />;
  }

  const result = await (
    query
      ? deepSearchTalent({
          q: query,
          role: role || undefined,
          platform: platform || undefined,
          location: location || undefined,
          availability: availability || undefined,
          limit: 100,
        }).then((search) => {
          usedDeepSearch = true;
          searchIntent = search.intent;
          searchTotal = search.total;
          noExactMatch = search.noExactMatch;
          matchReasons = Object.fromEntries(
            search.items.map((match) => [match.item.id, match.reasons]),
          );
          return {
            items: search.items.map((match) => match.item),
            total: search.total,
            limit: search.limit,
            offset: search.offset,
          };
        })
      : listTalentListings({
          role,
          platform,
          location,
          availability,
          limit: 100,
        })
  )
    .then((response) => ({ response, notice: null as string | null }))
    .catch(() => {
      if (!canUseMocks) {
        return {
          response: { items: [], total: 0, limit: 100, offset: 0 },
          notice: "Talent listings could not be loaded right now. Please try again shortly.",
        };
      }
      const items = filterMockTalentListings({ role, platform, location, availability });
      return { response: { items, total: items.length, limit: 100, offset: 0 }, notice: null };
    });

  if (canUseMocks && !query && !seoRoute && result.response.total === 0 && result.response.items.length === 0) {
    const items = filterMockTalentListings({ role, platform, location, availability });
    return <TalentFeedClient items={items} seoRoute={seoRoute || null} />;
  }

  return (
    <TalentFeedClient
      items={selectForView(result.response.items)}
      notice={result.notice}
      query={query}
      seoRoute={seoRoute || null}
      searchIntent={searchIntent}
      searchTotal={searchTotal}
      noExactMatch={noExactMatch}
      matchReasons={matchReasons}
    />
  );
}

export default async function TalentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <TalentBrowse searchParams={searchParams} />;
}
