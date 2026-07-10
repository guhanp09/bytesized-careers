import assert from "node:assert/strict";
import test from "node:test";

import {
  buildProfileReviewsHref,
  profileRatingSummaryFromProfile,
  profileRatingSummaryFromReviews,
} from "../lib/profileRating.ts";

test("profile rating summaries hide no-review profiles", () => {
  assert.equal(profileRatingSummaryFromReviews({ avg_rating: 0, review_count: 0 }, "/u/x?tab=reviews"), null);
  assert.equal(profileRatingSummaryFromReviews({ avg_rating: 4.6, review_count: 0 }, "/u/x?tab=reviews"), null);
  assert.equal(profileRatingSummaryFromReviews({ avg_rating: 0, review_count: 8 }, "/u/x?tab=reviews"), null);
});

test("profile rating summaries use the profile reviews average and count", () => {
  assert.deepEqual(
    profileRatingSummaryFromReviews({ avg_rating: 4.64, review_count: 18 }, "/u/channel?view=hiring&tab=reviews"),
    { average: 4.6, count: 18, href: "/u/channel?view=hiring&tab=reviews" }
  );
});

test("reviews href uses the public profile tab route", () => {
  assert.equal(buildProfileReviewsHref("aarav-mehta", "talent"), "/u/aarav-mehta?view=talent&tab=reviews");
  assert.equal(buildProfileReviewsHref("finance-creator", "hiring"), "/u/finance-creator?view=hiring&tab=reviews");
});

test("profileRatingSummaryFromProfile reads the profile review summary only", () => {
  const profile = { reviews: { avg_rating: 4.2, review_count: 7 } };
  assert.deepEqual(
    profileRatingSummaryFromProfile(profile, buildProfileReviewsHref("sample-profile", "talent")),
    { average: 4.2, count: 7, href: "/u/sample-profile?view=talent&tab=reviews" }
  );
});

test("profileRatingSummaryFromProfile uses role-specific reputation when available", () => {
  const profile = {
    reviews: { avg_rating: 3.5, review_count: 4 },
    reviews_by_mode: {
      talent: { summary: { avg_rating: 4.8, review_count: 3 }, items: [] },
      hiring: { summary: { avg_rating: 4.1, review_count: 1 }, items: [] },
    },
  };
  assert.deepEqual(
    profileRatingSummaryFromProfile(profile, "/u/sample?view=talent&tab=reviews", "talent"),
    { average: 4.8, count: 3, href: "/u/sample?view=talent&tab=reviews" }
  );
  assert.deepEqual(
    profileRatingSummaryFromProfile(profile, "/u/sample?view=hiring&tab=reviews", "hiring"),
    { average: 4.1, count: 1, href: "/u/sample?view=hiring&tab=reviews" }
  );
});
