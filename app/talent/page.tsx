import TalentFeedClient from "../../components/TalentFeedClient";
import {
  canUseLocalMockFallback,
  listTalentListings,
} from "../../lib/backendClient";
import { getMarketplaceDataSourceState } from "../../lib/devDataSource.server";
import { filterMockTalentListings } from "../../lib/mockTalentListings";
import { parseQuery } from "../../lib/search/queryParser";
import { rankTalent, relaxParsedQuery } from "../../lib/search/ranking";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const first = (value?: string | string[]) => (Array.isArray(value) ? value[0] : value) || "";

export default async function TalentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const q = first(params.q);
  const query = q.trim();
  const role = first(params.role);
  const platform = first(params.platform);
  const location = first(params.location);
  const availability = first(params.availability);
  const dataSource = await getMarketplaceDataSourceState();
  const usingMock = dataSource.source === "mock";
  const canUseMocks = canUseLocalMockFallback() && dataSource.overrideSource !== "backend";

  const rankForQuery = (items: Awaited<ReturnType<typeof listTalentListings>>["items"]) => {
    if (!query) return items;
    const parsed = parseQuery(query);
    let ranked = rankTalent(items, parsed);
    if (ranked.length === 0 && (parsed.budget || parsed.locations.length > 0)) {
      ranked = rankTalent(items, relaxParsedQuery(parsed));
    }
    return ranked.map((result) => result.item);
  };

  if (usingMock) {
    const items = rankForQuery(filterMockTalentListings({ role, platform, location, availability }));
    return <TalentFeedClient items={items} query={query} />;
  }

  const result = await listTalentListings({
    role,
    platform,
    location,
    availability,
    limit: 100,
  })
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

  if (canUseMocks && !query && result.response.total === 0 && result.response.items.length === 0) {
    const items = filterMockTalentListings({ role, platform, location, availability });
    return <TalentFeedClient items={items} />;
  }

  return <TalentFeedClient items={rankForQuery(result.response.items)} notice={result.notice} query={query} />;
}
