import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { HOME_MARKET_SIGNALS } from "../lib/marketingClaims.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(repoRoot, path), "utf8");

const marketingFiles = [
  "components/marketplace/HomeMarketSignalHero.tsx",
  "components/marketplace/HomeWhySection.tsx",
  "components/marketplace/HomeHowItWorks.tsx",
  "components/marketplace/HomeComparison.tsx",
  "components/marketplace/HomeRolesMarquee.tsx",
];

test("every quantitative homepage market claim carries an exact visible-source contract", () => {
  const quantitative = HOME_MARKET_SIGNALS.filter((claim) => /\d/.test(claim.value));
  assert.ok(quantitative.length > 0, "the evidence rule would be vacuous without a quantitative claim");
  for (const claim of quantitative) {
    assert.ok(claim.source, `${claim.value} has no source`);
    assert.match(claim.source.href, /^https:\/\//);
    assert.ok(claim.source.label.trim());
    assert.ok(claim.source.publisher.trim());
    assert.match(claim.source.published, /^20\d{2}-\d{2}-\d{2}$/);
    assert.match(claim.caption, /estimate|projection/i);
  }

  const hero = read(marketingFiles[0]);
  assert.match(hero, /HOME_MARKET_SIGNALS/);
  assert.match(hero, /activeStat\.source\.href/);
  assert.match(hero, /activeStat\.source\.label/);
  assert.doesNotMatch(hero, /const heroStats\s*=/);
});

test("homepage contains no invented market, speed, review, payment, or competitor claims", () => {
  const source = marketingFiles.map(read).join("\n");
  for (const unsupported of [
    /₹5,000 Cr/i,
    /Conceptual CreatorJobs market scene/i,
    /1M\+/i,
    /24\/7/i,
    /Creator-verified profiles/i,
    /Every profile is reviewed/i,
    /Hire in 24 hours/i,
    /Most recruiters hire within 24 hours/i,
    /UPI payments/i,
    /Unlimited free applications & hires/i,
    /General Freelance Platforms/i,
  ]) {
    assert.doesNotMatch(source, unsupported);
  }
});

test("homepage workflow copy describes product actions without promising a hiring outcome", () => {
  const flow = read("components/marketplace/HomeHowItWorks.tsx");
  assert.match(flow, /Use CreatorJobs as talent/);
  assert.match(flow, /Use CreatorJobs for hiring/);
  assert.doesNotMatch(flow, /Get hired in three steps|Hire in three steps|land creator-native work|Hire the right candidate/);
});

test("homepage role navigation is curated, not presented as measured demand", () => {
  const roles = read("components/marketplace/HomeRolesMarquee.tsx");
  assert.match(roles, /aria-label="Creator roles"/);
  assert.doesNotMatch(roles, /popularity_score|Popular roles/);
});

test("homepage capability section states only implemented CreatorJobs behavior", () => {
  const capabilities = read("components/marketplace/HomeComparison.tsx");
  for (const copy of [
    "Creator-native job and talent listings",
    "One profile to look for work and hire",
    "Applications and hiring requests",
    "Portfolio-based public profiles",
    "Saved jobs and talent",
    "Messaging and pipeline workspaces",
  ]) {
    assert.match(capabilities, new RegExp(copy));
  }
  assert.doesNotMatch(capabilities, /competitor|freelance platforms/i);
});

test("job alerts stay off the beta surface until durable delivery exists", () => {
  const home = read("app/page.tsx");
  assert.doesNotMatch(home, /HomeJobAlerts|job-alerts/);

  for (const unsupportedPath of [
    "app/api/job-alerts/route.ts",
    "components/marketplace/HomeJobAlerts.tsx",
    "components/marketplace/HomeJobAlertsPopup.tsx",
    "components/marketplace/useJobAlerts.ts",
    "lib/jobAlertsPopup.ts",
  ]) {
    assert.equal(existsSync(join(repoRoot, unsupportedPath)), false, `${unsupportedPath} must remain absent`);
  }
});

test("beta pricing copy does not invent unapproved list prices or discounts", () => {
  const betaCopy = [
    read("components/marketplace/HomeBetaBanner.tsx"),
    read("components/marketplace/HomeWhySection.tsx"),
  ].join("\n");
  assert.match(betaCopy, /Free during beta/);
  assert.match(betaCopy, /No payment method is required/);
  assert.doesNotMatch(betaCopy, /Standard price|Launch beta adjustment|₹(?:4,999|499|7,499|999)/i);
});
