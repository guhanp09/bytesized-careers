import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { formatTalentRate } from "../lib/talentListing.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(repoRoot, path), "utf8");

const talentRate = (overrides = {}) => ({
  rate_min: null,
  rate_max: null,
  rate_currency: null,
  rate_note: null,
  ...overrides,
});

test("talent rates preserve foreign source currency and never substitute a role-derived INR price", () => {
  const range = formatTalentRate(talentRate({
    rate_min: 25,
    rate_max: 45,
    rate_currency: "USD",
  }));
  assert.match(range, /\$25/);
  assert.match(range, /\$45/);
  assert.doesNotMatch(range, /₹|20,000|long-form video/);

  const sourceNote = "$120 per edit";
  assert.equal(formatTalentRate(talentRate({
    rate_currency: "USD",
    rate_note: sourceNote,
  })), sourceNote);
});

test("talent rates distinguish a ceiling, an unknown rate, flexible pricing, and unpaid work", () => {
  assert.equal(
    formatTalentRate(talentRate({ rate_max: 500, rate_currency: "EUR" })),
    "Up to €500",
  );
  assert.equal(formatTalentRate(talentRate()), "Rate not specified");
  assert.equal(formatTalentRate(talentRate({ rate_note: "Flexible" })), "Flexible");
  assert.equal(formatTalentRate(talentRate({ rate_note: "Unpaid" })), "Unpaid");
});

test("talent rates expose missing currency instead of silently implying INR", () => {
  const rate = formatTalentRate(talentRate({ rate_min: 2000, rate_max: 3500 }));
  assert.equal(rate, "2,000–3,500 (currency not specified)");
  assert.doesNotMatch(rate, /₹|\$|€/);
});

test("all customer-facing talent sinks use the one truthful rate formatter", () => {
  const sinks = [
    ["components/TalentCard.tsx", /formatTalentRate\(item\)/],
    ["components/marketplace/HomePreviewCards.tsx", /formatTalentRate\(item\)/],
    ["app/talent/[id]/page.tsx", /formatTalentRate\(listing\)/],
    ["app/saved/page.tsx", /formatTalentRate\(item\)/],
  ];

  for (const [path, call] of sinks) {
    const source = read(path);
    assert.match(source, call, `${path} bypasses the canonical talent formatter`);
    assert.doesNotMatch(source, /roleBasedRateLabel/, `${path} still invents a rate from the role`);
  }
});

test("compact job surfaces use structured compensation instead of the lossy budget display field", () => {
  const home = read("components/marketplace/HomePreviewCards.tsx");
  const saved = read("app/saved/page.tsx");
  assert.match(home, /compensationForJob\(job\)/);
  assert.doesNotMatch(home, /const meta = \[job\.budget,/);
  assert.match(saved, /compensationForJob\(job\)/);
  assert.doesNotMatch(saved, /"Budget flexible"/);
});

test("duplicating a structured job preserves its exact compensation contract", () => {
  const source = read("lib/ownerDrafts.ts");
  const duplicate = source.slice(
    source.indexOf("export function buildDuplicateJobPayload"),
    source.indexOf("export function buildDuplicateTalentPayload"),
  );

  assert.match(duplicate, /budget_amount: job\.budgetAmount \?\? null/);
  assert.match(duplicate, /budget_max: job\.budgetMax \?\? null/);
  assert.match(duplicate, /budget_currency: job\.budgetCurrency \|\| null/);
  assert.match(duplicate, /budget_unit: .*job\.budgetUnit.*\|\| null/);
  assert.match(duplicate, /budget_note: job\.budgetNote \|\| null/);
  assert.match(duplicate, /compensation_mode: .*job\.compensationMode.*\|\| null/);
  assert.doesNotMatch(duplicate, /budget_currency: "INR"/);
  assert.doesNotMatch(duplicate, /parseBudgetNumbers/);
});

test("saved snapshots retain every compensation field needed for an honest fallback", () => {
  const marketplace = read("backend/app/api/v1/routers/marketplace.py");
  const jobSnapshot = marketplace.slice(
    marketplace.indexOf("def _job_snapshot"),
    marketplace.indexOf("def _candidate_safe_job_read"),
  );
  const talentSnapshot = marketplace.slice(
    marketplace.indexOf("def _talent_snapshot"),
    marketplace.indexOf("def _talent_read"),
  );

  for (const field of ["compensation_mode", "budget_amount", "budget_max", "budget_currency", "budget_unit", "budget_unit_custom", "budget_note"]) {
    assert.match(jobSnapshot, new RegExp(`['\"]${field}['\"]`), `job snapshot drops ${field}`);
  }
  for (const field of ["rate_min", "rate_max", "rate_currency", "rate_note"]) {
    assert.match(talentSnapshot, new RegExp(`['\"]${field}['\"]`), `talent snapshot drops ${field}`);
  }
});

test("editing a foreign-currency talent listing cannot silently save it as INR", () => {
  const source = read("components/PostTalentPage.tsx");
  assert.match(source, /setRateCurrency\(listing\.rate_currency\?\.trim\(\)\.toUpperCase\(\) \|\| "INR"\)/);
  assert.match(source, /rate_currency: normalizedRateCurrency/);
  assert.match(source, /rateCurrency=\{rateCurrency\}/);
  assert.doesNotMatch(source, /rate_currency: "INR"/);
  assert.doesNotMatch(source, /rateCurrency="INR"/);
});

test("draft workspace compensation summaries use canonical structured formatters", () => {
  const ownerDrafts = read("lib/ownerDrafts.ts");
  const completion = read("lib/draftCompletion.ts");
  assert.match(ownerDrafts, /compensationForJob\(job\)/);
  assert.doesNotMatch(ownerDrafts, /meta: \[hasBudgetMeta \? job\.budget/);
  assert.match(completion, /compensationForJob\(job as Job\)/);
  assert.match(completion, /formatTalentRate\(listing\)/);
});
