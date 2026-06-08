import TalentFeedClient from "../../components/TalentFeedClient";
import {
  canUseLocalMockFallback,
  isLocalMocksEnabled,
  listTalentListings,
} from "../../lib/backendClient";
import { filterMockTalentListings } from "../../lib/mockTalentListings";

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
  const role = first(params.role);
  const platform = first(params.platform);
  const location = first(params.location);
  const availability = first(params.availability);
  const usingLocal = isLocalMocksEnabled();
  const canUseMocks = canUseLocalMockFallback();
  if (usingLocal) {
    const items = filterMockTalentListings({ q, role, platform, location, availability });
    return <TalentFeedClient items={items} />;
  }

  const result = await listTalentListings({
    q,
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
      const items = filterMockTalentListings({ q, role, platform, location, availability });
      return { response: { items, total: items.length, limit: 100, offset: 0 }, notice: null };
    });

  if (canUseMocks && result.response.total === 0 && result.response.items.length === 0) {
    const items = filterMockTalentListings({ q, role, platform, location, availability });
    return <TalentFeedClient items={items} />;
  }

  return <TalentFeedClient items={result.response.items} notice={result.notice} />;
}
