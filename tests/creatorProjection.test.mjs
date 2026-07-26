import test from "node:test";
import assert from "node:assert/strict";

import {
  COMMERCIAL_STRUCTURE_LABELS,
  TURNAROUND_BUCKET_LABELS,
  audienceTier,
  clientContextLines,
  describeClientContext,
  describeCommercialTerms,
  formatPortfolioDuration,
  normalizeFormat,
  normalizeNiche,
  normalizePlatform,
  normalizeTurnaround,
  toCreatorPortfolio,
  toCreatorPortfolioItem,
} from "../lib/creatorProjection.ts";

/* --- portfolio normalisation --------------------------------------------- */

test("the thin application answer shape renders, because that is what recruiters receive", () => {
  // `relevant_portfolio` carries only id/title/url. If the projection needed a
  // full profile item, every application would show an empty portfolio.
  const item = toCreatorPortfolioItem({
    id: "p1",
    title: "How index funds actually work",
    url: "https://www.youtube.com/watch?v=abc",
  });
  assert.equal(item.id, "p1");
  assert.equal(item.title, "How index funds actually work");
  assert.equal(item.media, "video");
  assert.equal(item.thumbnailUrl, null);
});

test("the full profile item keeps its platform, format, niche and role", () => {
  const item = toCreatorPortfolioItem({
    id: "p2",
    title: "Retention rebuild",
    source_type: "youtube",
    source_url: "https://youtu.be/xyz",
    thumbnail_url: "https://img.example/x.jpg",
    duration: "12:04",
    platforms: ["youtube"],
    formats: ["long_form_video"],
    content_niches: ["finance"],
    role_name: "Lead editor",
  });
  assert.equal(item.platform, "YouTube");
  assert.equal(item.format, "Long-form video");
  assert.equal(item.niche, "Finance");
  assert.equal(item.role, "Lead editor");
  assert.equal(item.duration, "12:04");
});

test("media kind is read from evidence, and defaults to a link rather than a video", () => {
  // Claiming an unknown item is a video would give it a duration slot and a
  // video cue it has no basis for.
  assert.equal(toCreatorPortfolioItem({ id: "a", url: "https://drive.google.com/x" }).media, "link");
  assert.equal(toCreatorPortfolioItem({ id: "b", url: "https://x.com/a.png" }).media, "image");
  assert.equal(toCreatorPortfolioItem({ id: "c", url: "https://tiktok.com/@a/video/1" }).media, "video");
  assert.equal(toCreatorPortfolioItem({ id: "d", source_type: "behance" }).media, "image");
  assert.equal(toCreatorPortfolioItem({ id: "e", source_type: "spotify" }).media, "audio");
});

test("an item without an id still gets a stable one, so its poster is not shared", () => {
  const items = toCreatorPortfolio([{ title: "One" }, { title: "Two" }]);
  assert.notEqual(items[0].id, items[1].id);
  assert.ok(items[0].id.length > 0);
});

test("a non-video never carries a duration", () => {
  const item = toCreatorPortfolioItem({ id: "x", source_type: "behance", duration: "12:04" });
  assert.equal(item.media, "image");
  assert.equal(item.duration, null);
});

test("an empty list is empty, not a placeholder row", () => {
  assert.deepEqual(toCreatorPortfolio(null), []);
  assert.deepEqual(toCreatorPortfolio(undefined), []);
  assert.deepEqual(toCreatorPortfolio([]), []);
});

/* --- duration ------------------------------------------------------------- */

test("durations are read from seconds, clock strings and ISO-8601 alike", () => {
  assert.equal(formatPortfolioDuration(724), "12:04");
  assert.equal(formatPortfolioDuration("12:04"), "12:04");
  assert.equal(formatPortfolioDuration("PT12M4S"), "12:04");
  assert.equal(formatPortfolioDuration("PT1H2M3S"), "1:02:03");
  assert.equal(formatPortfolioDuration(3661), "1:01:01");
});

test("an unreadable duration yields nothing rather than a mangled string", () => {
  for (const bad of [null, undefined, "", "soon", "abc", -5]) {
    assert.equal(formatPortfolioDuration(bad), null, `expected null for ${String(bad)}`);
  }
});

/* --- platform, format, niche ---------------------------------------------- */

test("platforms read as their brands, not as database values", () => {
  assert.equal(normalizePlatform("youtube"), "YouTube");
  assert.equal(normalizePlatform("tiktok"), "TikTok");
  assert.equal(normalizePlatform("instagram_reels"), "Instagram Reels");
  assert.equal(normalizePlatform("multi_platform"), "Multi-platform");
});

test("an unknown platform degrades to prose rather than leaking raw", () => {
  assert.equal(normalizePlatform("some_new_network"), "Some New Network");
  assert.equal(normalizePlatform(null), null);
  assert.equal(normalizePlatform("  "), null);
});

test("canonical format labels pass through untouched, snake_case is mapped", () => {
  // "Shorts/Reels" is the canonical wording; title-casing it would break it.
  assert.equal(normalizeFormat("Shorts/Reels"), "Shorts/Reels");
  assert.equal(normalizeFormat("long_form_video"), "Long-form video");
  assert.equal(normalizeFormat("thumbnail"), "Thumbnails");
});

test("niches are presented, and unknown ones are not dropped", () => {
  assert.equal(normalizeNiche("finance"), "Finance");
  assert.equal(normalizeNiche("true crime"), "True Crime");
  assert.equal(normalizeNiche("Finance"), "Finance");
});

/* --- turnaround ----------------------------------------------------------- */

test("turnaround keeps its wording and gains a comparable magnitude", () => {
  // Both are required: the recruiter filters on the bucket and reads the label.
  const value = normalizeTurnaround({ value: 3, unit: "business_days", basis: "first_draft" });
  assert.match(value.label, /3 business days to first draft/);
  assert.equal(value.hours, 72);
  assert.equal(value.bucket, "2_3_days");
});

test("every bucket boundary lands where the label claims", () => {
  assert.equal(normalizeTurnaround({ value: 6, unit: "hours" }).bucket, "same_day");
  assert.equal(normalizeTurnaround({ value: 24, unit: "hours" }).bucket, "24_hours");
  assert.equal(normalizeTurnaround({ value: 25, unit: "hours" }).bucket, "2_3_days");
  assert.equal(normalizeTurnaround({ value: 7, unit: "calendar_days" }).bucket, "within_a_week");
  assert.equal(normalizeTurnaround({ value: 2, unit: "weeks" }).bucket, "1_2_weeks");
  assert.equal(normalizeTurnaround({ value: 4, unit: "weeks" }).bucket, "longer");
});

test("an unspecified turnaround is unspecified, never zero", () => {
  // Sorting must not rank "not specified" as the fastest option.
  const value = normalizeTurnaround({ value: null, unit: null });
  assert.equal(value.hours, null);
  assert.equal(value.bucket, "unspecified");
  assert.equal(TURNAROUND_BUCKET_LABELS[value.bucket], "Not specified");
});

test("turnaround sorts fastest-first without unspecified jumping the queue", () => {
  const rows = [
    normalizeTurnaround({ value: null, unit: null }),
    normalizeTurnaround({ value: 2, unit: "weeks" }),
    normalizeTurnaround({ value: 6, unit: "hours" }),
  ];
  const sorted = [...rows].sort((a, b) => (a.hours ?? Infinity) - (b.hours ?? Infinity));
  assert.deepEqual(sorted.map((row) => row.bucket), ["same_day", "1_2_weeks", "unspecified"]);
});

/* --- commercial structure ------------------------------------------------- */

test("an amount is never shown without the unit that gives it meaning", () => {
  // ₹3,000 per video is ordinary; ₹3,000 per month is close to unpaid.
  const perVideo = describeCommercialTerms({
    mode: "fixed",
    minimum: 3000,
    currency: "INR",
    unit: "per video",
  });
  assert.match(perVideo.headline, /3,000/);
  assert.match(perVideo.headline, /per video/);
  assert.equal(perVideo.structure, "per_video");
});

test("each commercial structure is recognised for filtering", () => {
  const cases = [
    ["per video", "per_video"],
    ["per project", "per_project"],
    ["per month", "retainer"],
    ["per hour", "hourly"],
    ["commission", "revenue_share"],
  ];
  for (const [unit, expected] of cases) {
    const terms = describeCommercialTerms({ mode: "fixed", minimum: 100, currency: "USD", unit });
    assert.equal(terms.structure, expected, `${unit} should map to ${expected}`);
    assert.equal(terms.structureLabel, COMMERCIAL_STRUCTURE_LABELS[expected]);
  }
});

test("currency is preserved and never converted", () => {
  const usd = describeCommercialTerms({ mode: "fixed", minimum: 25, currency: "USD", unit: "per hour" });
  const eur = describeCommercialTerms({ mode: "fixed", minimum: 800, currency: "EUR", unit: "per project" });
  assert.match(usd.headline, /\$|USD/);
  assert.match(eur.headline, /€|EUR/);
  assert.match(usd.headline, /25/);
  assert.match(eur.headline, /800/);
});

test("unpaid work is named as unpaid and never dressed as a rate", () => {
  const terms = describeCommercialTerms({ mode: "unpaid", unit: "unpaid" });
  assert.equal(terms.unpaid, true);
  assert.equal(terms.headline, "Unpaid collaboration");
  assert.equal(terms.structure, "unpaid");
  assert.doesNotMatch(terms.headline, /\d/);
});

test("undisclosed is not the same claim as unpaid", () => {
  // Treating silence as "free" would invent terms on someone's behalf.
  const terms = describeCommercialTerms({});
  assert.equal(terms.unpaid, false);
  assert.equal(terms.disclosed, false);
  assert.doesNotMatch(terms.headline, /[Uu]npaid/);
});

test("a trial is reported beside the rate, never merged into it", () => {
  const terms = describeCommercialTerms({
    mode: "fixed",
    minimum: 3000,
    currency: "INR",
    unit: "per video",
    trialStatus: "paid",
    trialAmount: 1500,
    trialCurrency: "INR",
  });
  assert.match(terms.headline, /3,000/);
  assert.ok(terms.trial);
  assert.match(terms.trial.label, /Paid trial/);
  assert.match(terms.trial.label, /1,500/);
  // The ongoing rate must not be replaced by the audition rate.
  assert.doesNotMatch(terms.headline, /1,500/);
});

test("an unpaid trial says so plainly", () => {
  const terms = describeCommercialTerms({ trialStatus: "unpaid" });
  assert.equal(terms.trial.paid, false);
  assert.equal(terms.trial.label, "Unpaid trial");
});

/* --- client context ------------------------------------------------------- */

test("audience is a band, never an exact count", () => {
  // A precise figure moves daily and implies a verification we do not do.
  assert.equal(audienceTier(487_213), "250K–500K subscribers");
  assert.equal(audienceTier(1_500), "1K–10K subscribers");
  assert.equal(audienceTier(2_400_000), "1M+ subscribers");
  assert.equal(audienceTier(400), "Under 1K subscribers");
});

test("an unknown audience yields nothing rather than a fabricated tier", () => {
  assert.equal(audienceTier(null), null);
  assert.equal(audienceTier(undefined), null);
});

test("a handle always reads as a handle", () => {
  assert.equal(describeClientContext({ handle: "financechannel" }).handle, "@financechannel");
  assert.equal(describeClientContext({ handle: "@financechannel" }).handle, "@financechannel");
  assert.equal(describeClientContext({}).handle, null);
});

test("the context summary skips what is missing instead of padding it", () => {
  const context = describeClientContext({
    platforms: ["youtube"],
    formats: ["long_form_video"],
    niches: ["finance"],
    cadence: "2 videos/week",
    subscribers: 300_000,
  });
  const lines = clientContextLines(context, normalizeTurnaround({ value: 3, unit: "calendar_days" }));
  assert.equal(lines.length, 2);
  assert.match(lines[0], /YouTube/);
  assert.match(lines[0], /Finance/);
  assert.match(lines[0], /2 videos\/week/);
  assert.match(lines[1], /250K–500K subscribers/);
});

test("an empty context produces no lines at all", () => {
  const lines = clientContextLines(describeClientContext({}), null);
  assert.deepEqual(lines, []);
});
