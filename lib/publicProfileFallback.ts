import type { BackendPublicProfileResponse } from "./backendClient";
import { canUseLocalMockFallback, getPublicProfile } from "./backendClient";
import type { MarketplaceDataSourceState } from "./devDataSource";
import { getMockPublicTalentProfile } from "./mockPublicTalentProfiles";
import { getCanonicalPublicProfile } from "./seed/canonicalProfile";

export const canUsePublicProfileFixtures = (
  dataSource: MarketplaceDataSourceState,
): boolean =>
  dataSource.source === "mock" ||
  (dataSource.overrideSource !== "backend" && canUseLocalMockFallback());

export async function resolvePublicProfileWithTalentFallback(
  username: string,
  dataSource: MarketplaceDataSourceState,
): Promise<BackendPublicProfileResponse | null> {
  const normalizedUsername = username.trim().toLowerCase();

  // Mock mode is an explicit, isolated data source. It must not become a view
  // over whichever live backend happens to be reachable from a developer's
  // machine.
  if (dataSource.source !== "mock") {
    try {
      const profile = await getPublicProfile(normalizedUsername);
      if (profile) return profile;
    } catch {
      // Local development may deliberately continue into its fixture corpus.
      // Production and explicit Backend mode stop below with no invented user.
    }
  }

  if (!canUsePublicProfileFixtures(dataSource)) return null;

  // The canonical corpus comes first because generated scenario handles are
  // unambiguous inside explicit local Mock mode.
  const canonical = await getCanonicalPublicProfile(normalizedUsername);
  if (canonical) return canonical;

  return getMockPublicTalentProfile(normalizedUsername);
}
