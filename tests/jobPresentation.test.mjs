import test from "node:test";
import assert from "node:assert/strict";

import {
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
