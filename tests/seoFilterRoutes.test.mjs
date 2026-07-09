import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  findSeoRouteForSearchQuery,
  getRelatedSeoRoutes,
  getSeoFilterRoute,
  SEO_FILTER_ROUTES,
  seoFilterRoutesForType,
  seoFilterSitemapRoutes,
} from "../lib/seoFilterRoutes.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("seo filter registry exposes the initial curated jobs and talent pages", () => {
  const jobRoutes = seoFilterRoutesForType("jobs");
  const talentRoutes = seoFilterRoutesForType("talent");

  // 10 original + 5 new curated combos each (new ones are sitemap-ineligible).
  assert.equal(jobRoutes.length, 15);
  assert.equal(talentRoutes.length, 15);
  assert.equal(getSeoFilterRoute("jobs", "video-editor-jobs")?.path, "/jobs/video-editor-jobs");
  assert.equal(getSeoFilterRoute("talent", "video-editors")?.path, "/talent/video-editors");
  assert.equal(getSeoFilterRoute("jobs", "1"), null);
  assert.equal(getSeoFilterRoute("talent", "mock-talent-retention-editor"), null);
});

test("seo search query redirects only strong known intents", () => {
  assert.equal(findSeoRouteForSearchQuery("jobs", "video editor jobs")?.path, "/jobs/video-editor-jobs");
  assert.equal(findSeoRouteForSearchQuery("jobs", "youtube video editor")?.path, "/jobs/video-editor-jobs");
  assert.equal(findSeoRouteForSearchQuery("jobs", "finance thumbnail youtube")?.path, "/jobs/finance-youtube-editor-jobs");
  assert.equal(findSeoRouteForSearchQuery("talent", "hire video editor")?.path, "/talent/video-editors");
  assert.equal(findSeoRouteForSearchQuery("talent", "youtube editor")?.path, "/talent/video-editors");

  assert.equal(findSeoRouteForSearchQuery("jobs", "video editor delhi 10k"), null);
  assert.equal(findSeoRouteForSearchQuery("talent", "gaming shorts editor"), null);
});

test("seo related routes resolve to curated registry entries", () => {
  const route = getSeoFilterRoute("jobs", "video-editor-jobs");
  assert.ok(route);
  const related = getRelatedSeoRoutes(route).map((item) => item.path);

  assert.ok(related.includes("/jobs/thumbnail-designer-jobs"));
  assert.ok(related.includes("/talent/video-editors"));
  assert.equal(related.every((path) => path.startsWith("/jobs/") || path.startsWith("/talent/")), true);
});

test("seo sitemap list contains only approved indexable filter routes", () => {
  const paths = seoFilterSitemapRoutes().map((route) => route.path);

  assert.equal(paths.length, 20);
  assert.ok(paths.includes("/jobs/video-editor-jobs"));
  assert.ok(paths.includes("/talent/video-editors"));
  assert.equal(paths.some((path) => path.includes("?")), false);
  assert.equal(paths.includes("/jobs?role=video-editor"), false);
});

test("every curated route carries a non-empty required-intent gate", () => {
  for (const route of SEO_FILTER_ROUTES) {
    const groups = [route.requiredIntent.role, route.requiredIntent.niche, route.requiredIntent.workMode].filter(
      (group) => Array.isArray(group) && group.length > 0
    );
    assert.ok(groups.length > 0, `${route.path} must declare at least one required-intent group`);
  }
  // The niche routes require both a role/edit intent and the niche.
  const financeTalent = getSeoFilterRoute("talent", "finance-video-editors");
  assert.ok(financeTalent.requiredIntent.role?.length);
  assert.deepEqual(financeTalent.requiredIntent.niche, ["finance"]);
  // The scriptwriter route gates on writing intent, not the shared YouTube tag.
  assert.ok(getSeoFilterRoute("talent", "youtube-scriptwriters").requiredIntent.role.includes("script"));
});

test("browse clients and dynamic routes use the central seo registry", () => {
  const jobsDynamic = read("app/jobs/[id]/page.tsx");
  const talentDynamic = read("app/talent/[id]/page.tsx");
  const jobGrid = read("components/JobGridClient.tsx");
  const talentFeed = read("components/TalentFeedClient.tsx");
  const header = read("components/Header.tsx");
  const sitemap = read("app/sitemap.ts");

  assert.match(jobsDynamic, /getSeoFilterRoute\("jobs"/);
  assert.match(jobsDynamic, /<JobsBrowse/);
  assert.match(talentDynamic, /getSeoFilterRoute\("talent"/);
  assert.match(talentDynamic, /<TalentBrowse/);
  // Row-1 chips come from the registry (deduped to one chip per role label).
  assert.match(jobGrid, /primaryRoleChipsForType\("jobs"\)/);
  assert.match(talentFeed, /primaryRoleChipsForType\("talent"\)/);
  assert.match(header, /seoSearchTarget/);
  assert.match(sitemap, /seoFilterSitemapRoutes/);
});

test("browse clients no longer render a visible SEO title/intro block", () => {
  const jobGrid = read("components/JobGridClient.tsx");
  const talentFeed = read("components/TalentFeedClient.tsx");
  // The niche is conveyed by the selected chip + filtered results, never a
  // visible heading. The registry h1 stays for metadata/breadcrumb use only.
  assert.equal(jobGrid.includes("{seoRoute.h1}"), false);
  assert.equal(talentFeed.includes("{seoRoute.h1}"), false);
  assert.equal(/<h1[^>]*>\{seoRoute/.test(jobGrid), false);
  assert.equal(/<h1[^>]*>\{seoRoute/.test(talentFeed), false);
  // The wired hard-filter is used on the browse pages.
  assert.match(read("app/jobs/page.tsx"), /filterAndOrderJobsForSeoRoute/);
  assert.match(read("app/talent/page.tsx"), /filterAndOrderTalentForSeoRoute/);
});

