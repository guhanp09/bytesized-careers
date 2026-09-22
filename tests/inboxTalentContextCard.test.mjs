import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  formatTalentExperienceYears,
  formatTalentListingExperience,
  formatTalentRate,
} from "../lib/talentListing.ts";
import { toOwnerInteractions } from "../lib/seed/scenarioManifest.ts";

// The Inbox right-hand context card for talent listings must mirror the job mini
// card: same kind of info, same order — talent identity → listing title → rate →
// experience (numeric years) → location/work mode. No availability status, no raw
// experience level labels ("Senior"), no bio/tag/portfolio clutter.
//
// CompactTalentCard / CompactJobCard are client components, so structural guards
// use source assertions (the repo's convention). The rate + experience data layer
// is exercised directly.

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (relPath) => readFileSync(join(repoRoot, relPath), "utf8");

const workspaceSrc = read("components/you/ApplicationsWorkspace.tsx");
const interactionsSrc = read("lib/ownerInteractions.ts");

// Slice a single function body out of the source so assertions about ordering and
// presence are scoped to that component, not the whole file.
function functionBody(src, name, nextName) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `expected to find function ${name}`);
  const end = src.indexOf(`function ${nextName}(`, start);
  assert.ok(end > start, `expected to find function ${nextName} after ${name}`);
  return src.slice(start, end);
}

const talentCard = functionBody(workspaceSrc, "CompactTalentCard", "InteractionTimeline");
const jobCard = functionBody(workspaceSrc, "CompactJobCard", "CompactTalentCard");

// ── formatTalentRate: the rate label data layer ──────────────────────────────

test("formatTalentRate renders an INR min/max range without raw numbers", () => {
  const rate = formatTalentRate({
    rate_min: 2000,
    rate_max: 3500,
    rate_currency: "INR",
    rate_note: null,
    primary_role: "Editor",
    title: "Editor",
    roles: [],
    niche: null,
  });
  assert.ok(rate.includes("₹2,000"), `expected a formatted min, got "${rate}"`);
  assert.ok(rate.includes("₹3,500"), `expected a formatted max, got "${rate}"`);
});

test("formatTalentRate prefers a human INR note over numbers", () => {
  const rate = formatTalentRate({
    rate_min: 2000,
    rate_max: 3500,
    rate_currency: "INR",
    rate_note: "₹15,000 per month",
    primary_role: "Channel manager",
    title: "Channel manager",
    roles: [],
    niche: null,
  });
  assert.equal(rate, "₹15,000 per month");
});

test("formatTalentRate falls back gracefully when nothing usable is present", () => {
  const rate = formatTalentRate({
    rate_min: null,
    rate_max: null,
    rate_currency: null,
    rate_note: null,
    primary_role: null,
    title: "Mystery role",
    roles: [],
    niche: null,
  });
  assert.equal(rate, "Rate not specified");
  // Never a broken/empty/undefined range.
  assert.doesNotMatch(rate, /undefined|null|NaN/);
});

// ── Talent experience: exact whole years only ────────────────────────────────

test("formatTalentExperienceYears renders exact whole years, never a range or level", () => {
  assert.equal(formatTalentExperienceYears(1), "1 year");
  assert.equal(formatTalentExperienceYears(3), "3 years");
  assert.equal(formatTalentExperienceYears(10), "10 years");
});

test("formatTalentExperienceYears renders 0 as the under-a-year bucket, omits only unknown", () => {
  assert.equal(formatTalentExperienceYears(0), "Less than 1 year");
  assert.equal(formatTalentExperienceYears(null), "");
  assert.equal(formatTalentExperienceYears(undefined), "");
});

test("formatTalentListingExperience prefers exact years and never invents a range/level", () => {
  assert.equal(formatTalentListingExperience({ experience_years: 4 }), "4 years");
  assert.equal(formatTalentListingExperience({ experience_years: 0 }), "Less than 1 year");
  // A legacy exact single-year string is converted honestly.
  assert.equal(formatTalentListingExperience({ experience_level: "3 years" }), "3 years");
  // Legacy ranges/levels are never shown as exact years — the row is omitted instead.
  assert.equal(formatTalentListingExperience({ experience_level: "2–4 years" }), "");
  assert.equal(formatTalentListingExperience({ experience_level: "Senior" }), "");
});

// ── CompactTalentCard: structure mirrors the job card ────────────────────────

test("talent card renders the talent identity and listing title", () => {
  // Identity row (name, genericised to "Your listing" for own listings) + headline title.
  assert.match(talentCard, /\{identity\}/);
  assert.match(talentCard, /talent\.isOwnListing \? "Your listing" : talent\.name/);
  assert.match(talentCard, /\{talent\.headline\}/);
});

test("talent card metadata order is rate → experience → location", () => {
  const rateIdx = talentCard.indexOf("icon={payIcon}");
  const expIdx = talentCard.indexOf('icon="cap"');
  const locIdx = talentCard.indexOf('icon="pin"');
  assert.ok(rateIdx >= 0, "expected a rate row");
  assert.ok(expIdx >= 0, "expected an experience row");
  assert.ok(locIdx >= 0, "expected a location row");
  assert.ok(rateIdx < expIdx, "rate must come before experience");
  assert.ok(expIdx < locIdx, "experience must come before location");
});

test("talent card rate row reads the rate field, experience reads the numeric field", () => {
  assert.match(talentCard, /text=\{rate\}/);
  assert.match(talentCard, /const experience = talent\.experience/);
  assert.match(talentCard, /text=\{experience\}/);
});

test("talent card never renders availability or a raw experience note", () => {
  assert.doesNotMatch(talentCard, /icon="clock"/);
  assert.doesNotMatch(talentCard, /talent\.availability/);
  assert.doesNotMatch(talentCard, /talent\.experienceNote/);
});

test("talent card guards each metadata row so missing fields don't break it", () => {
  // Every row is conditional — no empty icons, no "undefined" text.
  assert.match(talentCard, /\{rate \? <MetaRow/);
  assert.match(talentCard, /\{experience \? <MetaRow/);
  assert.match(talentCard, /\{talent\.location \? <MetaRow/);
});

// ── CompactJobCard: unchanged reference ──────────────────────────────────────

test("job card is unchanged: pay → experience → location, no availability", () => {
  const payIdx = jobCard.indexOf("icon={payIcon}");
  const expIdx = jobCard.indexOf('icon="cap"');
  const locIdx = jobCard.indexOf('icon="pin"');
  assert.ok(payIdx >= 0 && expIdx >= 0 && locIdx >= 0, "job card keeps its three rows");
  assert.ok(payIdx < expIdx && expIdx < locIdx, "job card order is unchanged");
  assert.doesNotMatch(jobCard, /icon="clock"/);
  /*
    The pay row's *source* changed in Phase 3 and its position did not.

    It used to render `job.budget`, a preformatted display string. It now
    renders the projection's headline, which carries the unit — ₹3,000 per video
    rather than ₹3,000 — because an amount without its unit means nothing. This
    asserts the card still has exactly one pay row in the same place, without
    pinning the expression that fills it.
  */
  assert.match(jobCard, /<MetaRow icon=\{payIcon\} text=\{terms\.headline\} \/>/);
  assert.equal((jobCard.match(/icon=\{payIcon\}/g) || []).length, 1, "exactly one pay row");
});

// ── Snapshot wiring + mock data ──────────────────────────────────────────────

test("InteractionTalentSnapshot carries rate + numeric experience fields", () => {
  assert.match(interactionsSrc, /rate\?: string \| null;/);
  assert.match(interactionsSrc, /experience\?: string \| null;/);
});

test("talentSnapshotFromListing populates rate + numeric experience + location", () => {
  assert.match(interactionsSrc, /rate: formatTalentRate\(listing\)/);
  assert.match(interactionsSrc, /experience: formatTalentListingExperience\(listing\)/);
  assert.match(interactionsSrc, /location: listing\.location \|\| listing\.work_mode \|\| null/);
});

test("rendered talent snapshots use exact-year experience, not ranges or level labels", () => {
  // Asserted against the canonical corpus, which is what Mock mode now renders.
  // This used to read strings out of the hand-written fixture; that fixture is
  // retired, and a test policing a file no code path loads proves nothing.
  const manifest = JSON.parse(
    readFileSync(join(repoRoot, "fixtures/creator_scenarios/generated/default.json"), "utf8")
  );
  const cards = [
    ...toOwnerInteractions(manifest, { mode: "recruiter", anchorMode: "fixed" }),
    ...toOwnerInteractions(manifest, { mode: "talent", anchorMode: "fixed" }),
  ]
    .map((item) => item.talent)
    .filter((talent) => talent?.experience);
  assert.ok(cards.length > 0, "the corpus rendered no talent card with an experience value");

  for (const talent of cards) {
    // Exact years, or the sub-year phrasing. Never "2–4 years", never "Senior".
    assert.match(
      talent.experience,
      /^(Less than 1 year|1 year|\d+ years)$/,
      `"${talent.experience}" is not an exact-year experience`
    );
  }
  // And a rate, where the listing has one, reads as money rather than a label.
  const rated = cards.filter((talent) => talent.rate && talent.rate !== "Rate not specified");
  assert.ok(rated.length > 0, "no talent card carried a rate at all");

  assert.doesNotMatch(interactionsSrc, /experience: "(Senior|Junior|Mid-level|Intermediate|Expert)"/);
});
