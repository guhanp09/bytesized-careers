import type { BackendPublicProfileResponse, BackendTalentListing } from "./backendClient";
import { getPublicProfile, listTalentListings } from "./backendClient";
import { buildMockPublicTalentProfileFromListing, getMockPublicTalentProfile } from "./mockPublicTalentProfiles";
import { publicProfileFallbackSlug } from "./profileSlug";
import { getCanonicalPublicProfile } from "./seed/canonicalProfile";

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

  // The canonical corpus first, because a scenario slug is unambiguous: only
  // the generator produces `def-`/`bus-`-prefixed handles, so this can never
  // shadow a real profile, and a canonical applicant would otherwise fall
  // through every remaining source to "Profile not found".
  const canonical = await getCanonicalPublicProfile(normalizedUsername);
  if (canonical) return canonical;

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
