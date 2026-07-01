import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  formatTalentExperienceYears,
  formatTalentListingExperience,
  talentExperienceYears,
} from "../lib/talentListing.ts";

// Talent listings describe the talent's own background, so experience is an exact
// whole number of years — never a range ("2–4 years") or a level ("Senior").
// Job-listing experience requirements are unaffected (they keep ranges).

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (relPath) => readFileSync(join(repoRoot, relPath), "utf8");

// ── Data layer ───────────────────────────────────────────────────────────────

test("talentExperienceYears prefers the canonical numeric field", () => {
  assert.equal(talentExperienceYears({ experience_years: 5 }), 5);
  // Numeric value wins even when a legacy range string is also present.
  assert.equal(talentExperienceYears({ experience_years: 5, experience_level: "2–4 years" }), 5);
});

test("talentExperienceYears keeps 0 (less than a year) distinct from unknown (null)", () => {
  assert.equal(talentExperienceYears({ experience_years: 0 }), 0);
  assert.equal(talentExperienceYears({}), null);
});

test("the under-a-year bucket renders as 'Less than 1 year'", () => {
  assert.equal(formatTalentExperienceYears(0), "Less than 1 year");
  assert.equal(formatTalentListingExperience({ experience_years: 0 }), "Less than 1 year");
});

test("talentExperienceYears converts ONLY exact legacy single-year strings, never ranges/levels", () => {
  assert.equal(talentExperienceYears({ experience_level: "3 years" }), 3);
  assert.equal(talentExperienceYears({ experience_level: "3" }), 3);
  assert.equal(talentExperienceYears({ experience_level: "2–4 years" }), null);
  assert.equal(talentExperienceYears({ experience_level: "5+ years" }), null);
  assert.equal(talentExperienceYears({ experience_level: "Senior" }), null);
  assert.equal(talentExperienceYears({}), null);
});

test("formatTalentExperienceYears / formatTalentListingExperience render exact years or omit", () => {
  assert.equal(formatTalentExperienceYears(1), "1 year");
  assert.equal(formatTalentExperienceYears(7), "7 years");
  assert.equal(formatTalentExperienceYears(null), "");
  assert.equal(formatTalentListingExperience({ experience_years: 3 }), "3 years");
  // A legacy range must not be shown as an exact year — the row is omitted instead.
  assert.equal(formatTalentListingExperience({ experience_level: "2–4 years" }), "");
});

// ── Post Talent form: exact years, no range, no level labels ──────────────────

test("Post Talent form collects exact years via a single selector (no range, no levels)", () => {
  const src = read("components/PostTalentPage.tsx");
  assert.match(src, /Years of experience/);
  assert.match(src, /Select years/);
  // Offers the under-a-year bucket.
  assert.match(src, /Less than 1 year/);
  // Publish/draft payload sends the canonical numeric field.
  assert.match(src, /experience_years: experienceYearsValue/);
  // The old min/max range selector is gone.
  assert.doesNotMatch(src, /experienceMin|experienceMax|Min years|Max years/);
  // No level labels are offered for talent experience.
  assert.doesNotMatch(src, /Beginner|Junior|Intermediate|Senior|Expert/);
});

// ── Display surfaces + mock data ──────────────────────────────────────────────

test("talent card and detail page format experience with the exact-years helper", () => {
  assert.match(read("components/TalentCard.tsx"), /formatTalentListingExperience\(item\)/);
  assert.match(read("app/talent/[id]/page.tsx"), /formatTalentListingExperience\(listing\)/);
});

test("mock talent listings carry numeric experience_years, never range/level strings", () => {
  const src = read("lib/mockTalentListings.ts");
  assert.match(src, /experience_years: \d+/);
  assert.doesNotMatch(src, /experience_level/);
});

test("talent draft completion counts exact years, not a legacy range string", () => {
  assert.match(read("lib/draftCompletion.ts"), /listing\.experience_years === "number"/);
});
