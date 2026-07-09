import test from "node:test";
import assert from "node:assert/strict";

import {
  baseRouteForRole,
  getSeoFilterRoute,
  isSubfilterActive,
  primaryRoleChipsForType,
  subfilterHref,
  subfilterToggleHref,
  subfiltersForRoute,
} from "../lib/seoFilterRoutes.ts";
import { seoSearchTarget } from "../lib/seoFilterMatch.ts";
import { buildSavedSearchCriteria, refinementParamsFromCriteria } from "../lib/savedSearch.ts";

const chip = (route, label) => subfiltersForRoute(route).find((c) => c.label === label);

test("isSubfilterActive: curated combo chip is active on its own route", () => {
  const financeRoute = getSeoFilterRoute("talent", "finance-video-editors");
  const financeChip = chip(getSeoFilterRoute("talent", "video-editors"), "Finance");
  assert.equal(financeChip.curatedPath, "/talent/finance-video-editors");
  // Active when you're on the curated combo route.
  assert.equal(isSubfilterActive(financeRoute, financeChip, new URLSearchParams()), true);
  // Not active on the plain role route.
  assert.equal(
    isSubfilterActive(getSeoFilterRoute("talent", "video-editors"), financeChip, new URLSearchParams()),
    false
  );
});

test("isSubfilterActive: param chip reflects the query param", () => {
  const route = getSeoFilterRoute("talent", "video-editors");
  const longform = chip(route, "Long-form");
  assert.equal(isSubfilterActive(route, longform, new URLSearchParams("format=long-form")), true);
  assert.equal(isSubfilterActive(route, longform, new URLSearchParams("format=shorts")), false);
  assert.equal(isSubfilterActive(route, longform, new URLSearchParams()), false);
});

test("isSubfilterActive: selectedFilters imply active state on combo routes", () => {
  // On finance-video-editors, the Finance niche is implied even without a param.
  const financeRoute = getSeoFilterRoute("talent", "finance-video-editors");
  const gamingChip = chip(getSeoFilterRoute("talent", "video-editors"), "Gaming");
  // Gaming's curatedPath is /talent/gaming-video-editors, so on finance route it's inactive.
  assert.equal(isSubfilterActive(financeRoute, gamingChip, new URLSearchParams()), false);
});

test("subfilterToggleHref: multi-select adds/removes keyword dims", () => {
  const route = getSeoFilterRoute("talent", "video-editors");
  const longform = chip(route, "Long-form");
  const base = "/talent/video-editors";
  // Add.
  assert.equal(subfilterToggleHref(base, new URLSearchParams(), longform), `${base}?format=long-form`);
  // Toggle off when already present.
  assert.equal(subfilterToggleHref(base, new URLSearchParams("format=long-form"), longform), base);
  // Compose with an existing different dim.
  assert.equal(
    subfilterToggleHref(base, new URLSearchParams("platform=youtube"), longform),
    `${base}?platform=youtube&format=long-form`
  );
});

test("subfilterToggleHref: experience/availability are single-select (replace, not append)", () => {
  const route = getSeoFilterRoute("talent", "video-editors");
  const exp5 = chip(route, "5+ yrs");
  const base = "/talent/video-editors";
  // Replaces any existing experience value.
  assert.equal(subfilterToggleHref(base, new URLSearchParams("experience=0-1"), exp5), `${base}?experience=5%2B`);
  // Toggles off.
  assert.equal(subfilterToggleHref(base, new URLSearchParams("experience=5%2B"), exp5), base);
});

test("subfilterHref: an active curated-combo chip deselects to the role's base route, not itself (Finance-stuck bug)", () => {
  const financeRoute = getSeoFilterRoute("talent", "finance-video-editors");
  const financeChip = chip(getSeoFilterRoute("talent", "video-editors"), "Finance");
  const href = subfilterHref(financeRoute, financeChip, true, financeRoute.path, new URLSearchParams());
  // Must NOT just re-link to the page you're already on (the original bug).
  assert.notEqual(href, financeChip.curatedPath);
  assert.equal(href, "/talent/video-editors");
});

test("subfilterHref: an inactive curated-combo chip still navigates to the combo route", () => {
  const route = getSeoFilterRoute("talent", "video-editors");
  const financeChip = chip(route, "Finance");
  const href = subfilterHref(route, financeChip, false, route.path, new URLSearchParams());
  assert.equal(href, "/talent/finance-video-editors");
});

test("subfilterHref: deselecting a curated combo preserves other active refinement params", () => {
  const financeRoute = getSeoFilterRoute("talent", "finance-video-editors");
  const financeChip = chip(getSeoFilterRoute("talent", "video-editors"), "Finance");
  const href = subfilterHref(financeRoute, financeChip, true, financeRoute.path, new URLSearchParams("platform=youtube"));
  assert.equal(href, "/talent/video-editors?platform=youtube");
});

test("subfilterHref: non-curated chips behave exactly like subfilterToggleHref (no regression)", () => {
  const route = getSeoFilterRoute("talent", "video-editors");
  const longform = chip(route, "Long-form");
  const params = new URLSearchParams("format=long-form");
  assert.equal(
    subfilterHref(route, longform, true, "/talent/video-editors", params),
    subfilterToggleHref("/talent/video-editors", params, longform)
  );
});

test("baseRouteForRole resolves the plain Row-1 route for a role, not a same-labelled combo", () => {
  assert.equal(baseRouteForRole("talent", "video editor").path, "/talent/video-editors");
  assert.equal(baseRouteForRole("jobs", "video editor").path, "/jobs/video-editor-jobs");
  assert.equal(baseRouteForRole("talent", "scriptwriter").path, "/talent/youtube-scriptwriters");
  assert.equal(baseRouteForRole("talent", "nonexistent-role"), null);
  assert.equal(baseRouteForRole("jobs", null), null);
});

test("every curated-combo Row-2 chip, on both jobs and talent, can be deselected back to a distinct base route", () => {
  let checked = 0;
  for (const type of ["jobs", "talent"]) {
    for (const roleRoute of primaryRoleChipsForType(type)) {
      for (const subfilterChip of subfiltersForRoute(roleRoute).filter((c) => c.curatedPath)) {
        const comboRoute = getSeoFilterRoute(type, subfilterChip.curatedPath.split("/").pop());
        assert.ok(comboRoute, `${subfilterChip.curatedPath} must resolve to a registered route`);
        // Simulate being on that combo page: the chip must read as active...
        assert.equal(isSubfilterActive(comboRoute, subfilterChip, new URLSearchParams()), true);
        // ...and its href must lead somewhere OTHER than the page it's already on.
        const href = subfilterHref(comboRoute, subfilterChip, true, comboRoute.path, new URLSearchParams());
        assert.notEqual(href, subfilterChip.curatedPath, `${type} "${subfilterChip.label}" chip on ${comboRoute.path} must not re-link to itself`);
        checked += 1;
      }
    }
  }
  // Sanity: this sweep actually covered chips (guards against a silent no-op if the registry shape changes).
  assert.ok(checked >= 10, `expected to sweep at least 10 curated-combo chips, found ${checked}`);
});

test("saved-search criteria merges route selectedFilters + refinements + role", () => {
  const route = getSeoFilterRoute("talent", "finance-video-editors");
  const criteria = buildSavedSearchCriteria(route, { tools: ["after effects"], platforms: ["youtube"] });
  assert.deepEqual(criteria.roles, ["video editor"]);
  assert.deepEqual(criteria.niches, ["finance"]);
  assert.deepEqual(criteria.tools, ["after effects"]);
  assert.deepEqual(criteria.platforms, ["youtube"]);
  assert.equal(criteria.experience, null);
});

test("refinementParamsFromCriteria serializes only the refinement dims", () => {
  const params = refinementParamsFromCriteria({ niches: ["finance", "gaming"], experience: "5+" });
  assert.equal(params.get("niche"), "finance,gaming");
  assert.equal(params.get("experience"), "5+");
  assert.equal(params.get("platform"), null);
});

test("seoSearchTarget tier 1: an exact curated intent routes to the clean indexable page", () => {
  assert.deepEqual(seoSearchTarget("jobs", "video editor jobs"), {
    href: "/jobs/video-editor-jobs",
    indexable: true,
  });
  // A curated combo alias resolves straight to its own route.
  assert.deepEqual(seoSearchTarget("talent", "gaming video editor"), {
    href: "/talent/gaming-video-editors",
    indexable: true,
  });
});

test("seoSearchTarget tier 2: role + mappable modifiers → base route with refinement params (noindex)", () => {
  const target = seoSearchTarget("talent", "gaming shorts editor");
  assert.ok(target.href.startsWith("/talent/shorts-editors?"), target.href);
  const params = new URLSearchParams(target.href.split("?")[1]);
  assert.match((params.get("niche") || "").toLowerCase(), /gaming/);
  assert.equal(target.indexable, false);
});

test("seoSearchTarget tier 3: ambiguous / location- or budget-heavy → ranked ?q= search", () => {
  const target = seoSearchTarget("jobs", "video editor delhi 10k");
  assert.equal(target.href, "/jobs?q=video%20editor%20delhi%2010k");
  assert.equal(target.indexable, false);
  // No recognised role at all also falls through to search.
  assert.equal(seoSearchTarget("jobs", "photographer for weddings").indexable, false);
});

test("seoSearchTarget: empty query goes to the clean base list", () => {
  assert.deepEqual(seoSearchTarget("talent", "   "), { href: "/talent", indexable: true });
});

test("Row-1 chips are deduped by label; new combos are Row-2-only", () => {
  for (const type of ["jobs", "talent"]) {
    const labels = primaryRoleChipsForType(type).map((r) => r.chipLabel.toLowerCase());
    assert.equal(new Set(labels).size, labels.length, `${type} Row-1 has no duplicate chip labels`);
  }
  // gaming-video-editors (label "Video editor") is a combo → not its own Row-1 chip;
  // the base video-editors owns that label.
  const talentRow1 = primaryRoleChipsForType("talent").map((r) => r.path);
  assert.ok(talentRow1.includes("/talent/video-editors"));
  assert.equal(talentRow1.includes("/talent/gaming-video-editors"), false);
});
