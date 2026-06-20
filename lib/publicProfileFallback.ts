import type { BackendPublicProfileResponse, BackendTalentListing } from "./backendClient";
import { getPublicProfile, listTalentListings } from "./backendClient";
import { buildMockPublicTalentProfileFromListing, getMockPublicTalentProfile } from "./mockPublicTalentProfiles";
import { publicProfileFallbackSlug } from "./profileSlug";

const talentProfileSlugFromListing = (listing: Pick<BackendTalentListing, "owner_username" | "owner_display_name" | "id">) =>
  (listing.owner_username || publicProfileFallbackSlug(listing.owner_display_name || listing.id)).trim().toLowerCase();

export async function resolvePublicProfileWithTalentFallback(
  username: string
): Promise<BackendPublicProfileResponse | null> {
  const normalizedUsername = username.trim().toLowerCase();

  try {
    const profile = await getPublicProfile(normalizedUsername);
    if (profile) return profile;
  } catch {
    // Fall through to testing-friendly fallbacks.
  }

  const mockProfile = getMockPublicTalentProfile(normalizedUsername);
  if (mockProfile) return mockProfile;

  try {
    const response = await listTalentListings({ status: "published", limit: 100, offset: 0 });
    const listing = response.items.find((item) => talentProfileSlugFromListing(item) === normalizedUsername);
    return listing ? buildMockPublicTalentProfileFromListing(listing) : null;
  } catch {
    return null;
  }
}
