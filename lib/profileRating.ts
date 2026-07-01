import type { BackendPublicProfileResponse, BackendReviewsSummary } from "./backendClient";

export type ProfileViewForReviews = "talent" | "hiring";

export type ProfileRatingSummary = {
  average: number;
  count: number;
  href: string;
};

export function buildProfileReviewsHref(username: string, view: ProfileViewForReviews) {
  return `/u/${encodeURIComponent(username)}?view=${view}&tab=reviews`;
}

export function profileRatingSummaryFromReviews(
  reviews: BackendReviewsSummary | null | undefined,
  href: string | null | undefined
): ProfileRatingSummary | null {
  if (!href) return null;
  const average = Number(reviews?.avg_rating);
  const count = Number(reviews?.review_count);
  if (!Number.isFinite(average) || !Number.isFinite(count)) return null;
  if (average <= 0 || count <= 0) return null;
  return {
    average: Number(Math.max(0, Math.min(5, average)).toFixed(1)),
    count: Math.max(0, Math.floor(count)),
    href,
  };
}

export function profileRatingSummaryFromProfile(
  profile: Pick<BackendPublicProfileResponse, "reviews"> | null | undefined,
  href: string | null | undefined
) {
  return profileRatingSummaryFromReviews(profile?.reviews, href);
}
