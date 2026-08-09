import test from "node:test";
import assert from "node:assert/strict";

import {
  aboutBrandLabel,
  buildJobTransparency,
  compensationForJob,
  deadlineForJob,
  formatJobCompensation,
  formatJobDeliverable,
  hiringVerificationForJob,
  requiredToolsForJob,
  roleForJob,
  trialForJob,
} from "../lib/jobPresentation.ts";

const baseJob = (overrides = {}) => ({
  id: "job-1",
  title: "Creator job",
  category: "Editing",
  legacyCategory: "Editing",
  budget: "",
  experience: "",
  location: "",
  postedShort: "",
  views: 0,
  applicants: 0,
  responseRate: 0,
  channel: { name: "Studio", logoUrl: "", subscribers: null },
  tags: [],
  startTimeframe: "",
  ...overrides,
});

test("compensation presentation covers canonical fixed, range, negotiable, commission, mixed, custom, and legacy values", () => {
  assert.match(formatJobCompensation({ mode: "fixed", minimum: 2500, currency: "INR", unit: "per thumbnail" }).headline, /₹2,500.*per thumbnail/);
  assert.match(formatJobCompensation({ mode: "range", minimum: 20, maximum: 35, currency: "USD", unit: "per hour" }).headline, /\$20.*\$35.*per hour/);
  assert.equal(formatJobCompensation({ mode: "negotiable", unit: "per month" }).headline, "Negotiable · per month");
  assert.equal(formatJobCompensation({ mode: "negotiable", unit: "commission", note: "10% of attributed sales" }).headline, "Commission-based");
  assert.match(formatJobCompensation({ mode: "fixed", minimum: 1200, currency: "USD", unit: "mixed", note: "Base plus revenue share" }).headline, /Mixed compensation.*\$1,200 base/);
  assert.match(formatJobCompensation({ mode: "range", minimum: 1200, maximum: 1800, currency: "USD", unit: "mixed", note: "Base plus revenue share" }).headline, /\$1,200.*\$1,800 base/);
  assert.match(formatJobCompensation({ mode: "fixed", minimum: 90, currency: "EUR", unit: "custom", customUnit: "per content batch" }).headline, /€90.*per content batch/);
  assert.deepEqual(
    formatJobCompensation({ legacyDisplay: "₹500–₹900 per project" }),
    { headline: "₹500–₹900 per project", note: "", disclosed: true, outputBased: false, unitLabel: "", legacy: true },
  );
});

test("candidate role and tool presentation uses canonical values without inferring them from legacy category", () => {
  const canonical = baseJob({ primaryRoleName: "Video Editor", roleSpecialization: "Documentary pacing", requiredToolKeys: ["premiere-pro", "after-effects"], otherRequiredTools: ["Custom review portal"] });
  assert.deepEqual(roleForJob(canonical), { name: "Video Editor", specialization: "Documentary pacing", canonical: true, legacy: false });
  assert.deepEqual(requiredToolsForJob(canonical), ["Adobe Premiere Pro", "Adobe After Effects", "Custom review portal"]);

  const legacy = roleForJob(baseJob());
  assert.deepEqual(legacy, { name: "Editing", specialization: "", canonical: false, legacy: true });
  assert.equal(baseJob().primaryRoleName, undefined);

  assert.deepEqual(requiredToolsForJob(baseJob({ requiredToolKeys: null, tools: ["Premiere Pro"] })), ["Premiere Pro"]);
  assert.deepEqual(requiredToolsForJob(baseJob({ requiredToolKeys: [], otherRequiredTools: [], tools: ["Premiere Pro"] })), []);
});

test("deliverables and trials remain factual and scannable", () => {
  assert.equal(formatJobDeliverable({ type: "thumbnail", quantity: 8, frequency: "per_month" }), "8 thumbnails · per month");
  assert.equal(formatJobDeliverable({ type: "other", custom_type: "chapter package", quantity: 1, frequency: "other", custom_frequency: "per launch" }), "1 chapter package · per launch");

  const paid = trialForJob(baseJob({
    trialStatus: "paid",
    trialScope: "Edit one short segment.",
    trialEffortValue: 2,
    trialEffortUnit: "hours",
    trialCompensationAmount: 100,
    trialCompensationCurrency: "USD",
    trialCompensationBasis: "flat",
    trialWorkUsage: "evaluation_only",
  }));
  assert.equal(paid.title, "Paid trial");
  assert.ok(paid.details.some((detail) => detail.includes("Trial pay: $100")));
  assert.equal(trialForJob(baseJob({ trialStatus: "unpaid" })).title, "Unpaid trial");
  assert.equal(trialForJob(baseJob({ trialStatus: "undecided" })).title, "Trial not decided");
  assert.deepEqual(trialForJob(baseJob({ trialStatus: "none", trialScope: "stale scope" })).details, []);
  const incompletePaid = trialForJob(baseJob({ trialStatus: "paid" }));
  assert.equal(incompletePaid.title, "Trial — compensation not specified");
  assert.equal(incompletePaid.status, "undecided");
  assert.match(incompletePaid.details.join(" "), /not fully specified/i);
});

test("transparency distinguishes V3 omissions from fields an older listing never captured", () => {
  const v3 = buildJobTransparency(baseJob({ listingSchemaVersion: 3, primaryRoleName: "Video Editor", compensationMode: "negotiable", budgetUnit: "per hour", budget: "Negotiable" }));
  assert.ok(v3.attention.some((item) => item.label.includes("Weekly hours")));
  assert.ok(v3.attention.some((item) => item.label.includes("Revision policy")));
  assert.equal(v3.legacyNotice, "");

  const legacy = buildJobTransparency(baseJob({ listingSchemaVersion: 1, budget: "₹1,000 per project" }));
  assert.equal(legacy.attention.length, 0);
  assert.match(legacy.legacyNotice, /older listing did not capture every structured detail/i);

  const versionTwo = buildJobTransparency(baseJob({ listingSchemaVersion: 2, budget: "Contact for pricing" }));
  assert.equal(versionTwo.attention.length, 0);
  assert.match(versionTwo.legacyNotice, /older listing/i);
});

test("deadline state reports open and passed dates without guessing", () => {
  assert.equal(deadlineForJob(null).valid, false);
  assert.equal(deadlineForJob("2027-01-01T00:00:00Z", new Date("2026-01-01T00:00:00Z")).expired, false);
  assert.equal(deadlineForJob("2025-01-01T00:00:00Z", new Date("2026-01-01T00:00:00Z")).expired, true);
  assert.equal(compensationForJob(baseJob()).disclosed, false);
});

test("canonical hiring verification takes precedence over a legacy boolean", () => {
  assert.equal(hiringVerificationForJob(baseJob({ hiringVerificationStatus: "UNVERIFIED", channel: { ...baseJob().channel, verified: true } })).verified, false);
  assert.equal(hiringVerificationForJob(baseJob({ hiringVerificationStatus: "VERIFIED" })).verified, true);
  assert.equal(hiringVerificationForJob(baseJob({ channel: { ...baseJob().channel, verified: true } })).verified, true);
  assert.equal(hiringVerificationForJob(baseJob()).captured, false);
});

test("a ceiling with no floor is stated rather than called unspecified", () => {
  // Job pages write pay as "Up to ₹20,000 a month" constantly, and there was no
  // branch for it: the whole compensation read "Compensation not specified"
  // while a stray "Up to" sat in the note, so the preview rendered
  // "Compensation not specified · Up to" — a qualifier with nothing to qualify.
  const ceiling = formatJobCompensation({
    mode: null,
    minimum: null,
    maximum: 20000,
    currency: "INR",
    unit: "per month",
  });

  assert.match(ceiling.headline, /^Up to /);
  assert.match(ceiling.headline, /20,000/);
  assert.match(ceiling.headline, /month/i);
  assert.equal(ceiling.disclosed, true);
});

test("a ceiling is never promoted into a flat rate", () => {
  const ceiling = formatJobCompensation({
    mode: null,
    minimum: null,
    maximum: 20000,
    currency: "INR",
    unit: "per month",
  });

  // Dropping the qualifier would tell a candidate the job pays ₹20,000 when the
  // employer said it pays at most that.
  assert.ok(ceiling.headline.toLowerCase().includes("up to"));
});

test("a note that only repeats the headline is dropped", () => {
  // The imported listing arrived with budget_note "Up to" — a fragment of the
  // figure beside it. Callers join headline and note with "·", so a fragment
  // renders as a dangling word.
  const withFragment = formatJobCompensation({
    mode: null,
    minimum: null,
    maximum: 20000,
    currency: "INR",
    unit: "per month",
    note: "Up to",
  });

  assert.equal(withFragment.note, "");
  assert.equal([withFragment.headline, withFragment.note].filter(Boolean).join(" · "), withFragment.headline);
});

test("a note that adds something is kept", () => {
  const informative = formatJobCompensation({
    mode: "fixed",
    minimum: 20000,
    currency: "INR",
    unit: "per month",
    note: "Reviewed after three months",
  });

  assert.equal(informative.note, "Reviewed after three months");
});

test("a negotiable job is not turned into a figure by a stray maximum", () => {
  const negotiable = formatJobCompensation({
    mode: "negotiable",
    minimum: null,
    maximum: 20000,
    currency: "INR",
    unit: "per month",
  });

  assert.match(negotiable.headline, /^Negotiable/);
});

test("a floor with no ceiling keeps its plus", () => {
  // "₹20,000+/month" is what the employer promised. Rendering it as a flat
  // ₹20,000 reports a maximum they never agreed to, which is the same class of
  // error as showing a ceiling as the rate.
  const floor = formatJobCompensation({
    mode: "range",
    minimum: 20000,
    maximum: null,
    currency: "INR",
    unit: "per month",
  });

  assert.match(floor.headline, /\+/);
  assert.match(floor.headline, /20,000/);
  assert.equal(floor.disclosed, true);
});

test("a fixed rate does not gain a plus it never had", () => {
  const fixed = formatJobCompensation({
    mode: "fixed",
    minimum: 20000,
    currency: "INR",
    unit: "per month",
  });

  assert.ok(!fixed.headline.includes("+"), fixed.headline);
});

test("both ends equal read as approximate rather than a null range", () => {
  const about = formatJobCompensation({
    mode: "range",
    minimum: 20000,
    maximum: 20000,
    currency: "INR",
    unit: "per month",
  });

  assert.match(about.headline, /^About /);
  assert.ok(!about.headline.includes("–"), about.headline);
});

test("an approximate rate is shown as approximate, not exact", () => {
  // "About ₹20,000 a month" is a fourth distinct fact. Showing it as a flat
  // ₹20,000 claims a precision the employer explicitly declined to give.
  const approximate = formatJobCompensation({
    mode: "approximate",
    minimum: 20000,
    maximum: null,
    currency: "INR",
    unit: "per month",
  });

  assert.match(approximate.headline, /^About /);
  assert.match(approximate.headline, /20,000/);
  assert.equal(approximate.disclosed, true);
});

test("approximate, exact, ceiling and floor all read differently", () => {
  const money = { minimum: 20000, currency: "INR", unit: "per month" };
  const headlines = [
    formatJobCompensation({ ...money, mode: "fixed" }).headline,
    formatJobCompensation({ ...money, mode: "approximate" }).headline,
    formatJobCompensation({ mode: "range", minimum: null, maximum: 20000, currency: "INR", unit: "per month" }).headline,
    formatJobCompensation({ ...money, mode: "range", maximum: null }).headline,
  ];

  // Four statements about the same number that a candidate must never have
  // confused with one another.
  assert.equal(new Set(headlines).size, 4, headlines.join(" | "));
});

test("a note that restates the structured pay is not shown twice", () => {
  // The reported candidate listing: "₹22,000+ per month · The post also states:
  // From ₹22,000.00 per month." One fact, written twice, the second time in the
  // import's own voice.
  const shown = formatJobCompensation({
    mode: "range",
    minimum: 22000,
    maximum: null,
    currency: "INR",
    unit: "per month",
    note: "The post also states: From ₹22,000.00 per month.",
  });

  assert.equal(shown.note, "");
  assert.match(shown.headline, /22,000\+/);
});

test("a note carrying genuinely more than the figure survives", () => {
  const bonus = formatJobCompensation({
    mode: "range",
    minimum: 22000,
    maximum: null,
    currency: "INR",
    unit: "per month",
    note: "Performance bonus after probation",
  });

  // Suppressing this would lose a real part of the offer.
  assert.equal(bonus.note, "Performance bonus after probation");
});

test("a note naming a figure the headline does not carry is kept", () => {
  const extra = formatJobCompensation({
    mode: "range",
    minimum: 22000,
    maximum: null,
    currency: "INR",
    unit: "per month",
    note: "Up to ₹30,000 for senior candidates",
  });

  assert.equal(extra.note, "Up to ₹30,000 for senior candidates");
});

test("about-brand label uses the hiring identity when there is one", () => {
  assert.equal(aboutBrandLabel("Finance Simplified"), "About Finance Simplified");
  assert.equal(aboutBrandLabel("  Finance Simplified  "), "About Finance Simplified");
});

test("about-brand label falls back safely when identity is unknown", () => {
  // Never a guess and never a scraped source employer: the generic label is the
  // honest answer when no CreatorJobs identity is attached.
  assert.equal(aboutBrandLabel(""), "About the brand");
  assert.equal(aboutBrandLabel(null), "About the brand");
  assert.equal(aboutBrandLabel(undefined), "About the brand");
});

test("a long brand name is not truncated", () => {
  const long = "The Extremely Long Independent Finance Education Collective";
  assert.equal(aboutBrandLabel(long), `About ${long}`);
});
