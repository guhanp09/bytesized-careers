import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("review client exposes only source-bound lifecycle actions", () => {
  const source = read("lib/backendClient.ts");
  assert.match(source, /requestEngagementStart/);
  assert.match(source, /sourceType === "job_application" \? "applications" : "talent-interests"/);
  assert.match(source, /saveEngagementReview/);
  assert.doesNotMatch(source, /reviewer_user_id:\s*string/);
});

test("Inbox renders the compact engagement row from conversation backend data", () => {
  const source = read("components/you/ApplicationsWorkspace.tsx");
  assert.match(source, /detail\.engagement/);
  assert.match(source, /<EngagementStatusRow/);
  assert.match(source, /getMyReviewWorkspace/);
});

test("review dialog preserves unsent input and explains blind publication", () => {
  const source = read("components/reviews/ReviewDialog.tsx");
  assert.match(source, /sessionStorage/);
  assert.match(source, /both sides submit or the 14-day window closes/);
  assert.match(source, /overall_rating/);
  assert.match(source, /dimension_ratings/);
});

test("owner Reviews workspace separates reputation from written feedback", () => {
  const source = read("components/reviews/OwnerReviewsWorkspace.tsx");
  assert.match(source, /About you/);
  assert.match(source, /Your feedback/);
  assert.match(source, /Awaiting publication/);
  assert.match(source, /Window closed/);
});

test("full public review cards provide quiet review reporting", () => {
  const source = read("components/profile/ProfileReviews.tsx");
  assert.match(source, /Report review/);
  assert.match(source, /target_type: "review"/);
});
