import test from "node:test";
import assert from "node:assert/strict";

import {
  QUICK_FILTERS,
  getSeoFilterRoute,
  roleForRoute,
  seoFilterSitemapRoutes,
  subfilterParam,
  subfiltersForRole,
} from "../lib/seoFilterRoutes.ts";
import {
  filterAndOrderJobsForSeoRoute,
  filterAndOrderTalentForSeoRoute,
  hasRefinements,
  jobIntentFields,
  jobMatchesRefinements,
  refinementCriteriaFromParams,
  seoRouteMatchesFields,
  talentIntentFields,
} from "../lib/seoFilterMatch.ts";

// Inline fixtures modelling the exact roles that leaked into the reported bug:
// a scriptwriter route was showing video editors, thumbnail designers, channel
// managers, motion designers, and retention analysts just for sharing a
// "YouTube" tag. Each listing carries platforms:["YouTube"] so the old
// ranking-only path would have surfaced all of them.
const talent = (id, primary_role, extra = {}) => ({
  id,
  // No "YouTube" in the title so platform gating is driven by the platforms
  // field, not an incidental title token.
  title: `${primary_role} for creator-led channels`,
  primary_role,
  roles: [primary_role],
  niche: extra.niche ?? "creator content",
  content_niches: extra.content_niches ?? [],
  content_genres: extra.content_genres ?? [],
  formats: extra.formats ?? [],
  platforms: extra.platforms ?? ["YouTube"],
  tools: extra.tools ?? [],
  languages: extra.languages ?? [],
  work_mode: extra.work_mode ?? "remote",
  location: extra.location ?? "Remote",
  experience_years: extra.experience_years ?? null,
  availability_status: extra.availability_status ?? "selective",
  created_at: "2026-01-01T00:00:00Z",
});

const TALENT = [
  talent("t-script", "Scriptwriter", { formats: ["Explainers"] }),
  talent("t-editor", "Video editor", { formats: ["Long-form"] }),
  talent("t-thumb", "Thumbnail designer", { formats: ["Thumbnails"] }),
  talent("t-motion", "Motion designer"),
  talent("t-channel", "Channel manager"),
  talent("t-retention", "Retention analyst"),
  talent("t-shorts", "Shorts editor", { formats: ["Shorts"] }),
  talent("t-finance-editor", "Video editor", { niche: "finance", content_niches: ["Finance"] }),
];

const job = (id, category, title, extra = {}) => ({
  id,
  title,
  category,
  location: extra.location ?? "Remote",
  workMode: extra.workMode ?? "remote",
  budget: "₹20,000 per video",
  tags: extra.tags ?? ["YouTube"],
  contentNiches: extra.contentNiches ?? [],
  contentGenres: [],
  formatsHiredFor: extra.formatsHiredFor ?? [],
  createdAt: "2026-01-01T00:00:00Z",
});

const JOBS = [
  job("j-editor", "Editing", "Video editor for YouTube (long-form)"),
  job("j-script", "Writing", "Script writer for Hindi explainers"),
  job("j-thumb", "Thumbnails", "Thumbnail designer (CTR-focused)"),
  job("j-channel", "Channel Manager", "Channel manager to run uploads and analytics"),
  job("j-motion", "Motion Graphics", "Motion graphics: animated callouts"),
  job("j-finance", "Editing", "Finance YouTube editor", { contentNiches: ["Finance"] }),
];

const roles = (items) => items.map((item) => item.primary_role);
const cats = (items) => items.map((item) => item.category);

test("talent scriptwriter route admits only writing-intent talent", () => {
  const route = getSeoFilterRoute("talent", "youtube-scriptwriters");
  assert.ok(route);
  const result = filterAndOrderTalentForSeoRoute(TALENT, route);
  assert.deepEqual(roles(result), ["Scriptwriter"]);
  // The exact leaks from the bug report are all excluded.
  for (const excluded of ["Video editor", "Thumbnail designer", "Motion designer", "Channel manager", "Retention analyst"]) {
    assert.equal(roles(result).includes(excluded), false, `${excluded} must not appear`);
  }
});

test("talent video-editors route admits editors (incl. shorts) and excludes non-editors", () => {
  const route = getSeoFilterRoute("talent", "video-editors");
  const result = roles(filterAndOrderTalentForSeoRoute(TALENT, route));
  assert.ok(result.includes("Video editor"));
  assert.ok(result.includes("Shorts editor")); // shorts editors genuinely edit video
  for (const excluded of ["Thumbnail designer", "Motion designer", "Channel manager", "Retention analyst", "Scriptwriter"]) {
    assert.equal(result.includes(excluded), false, `${excluded} must not appear`);
  }
});

test("talent thumbnail route admits only thumbnail designers", () => {
  const route = getSeoFilterRoute("talent", "thumbnail-designers");
  assert.deepEqual(roles(filterAndOrderTalentForSeoRoute(TALENT, route)), ["Thumbnail designer"]);
});

test("talent finance-video-editors requires BOTH editor role and finance niche", () => {
  const route = getSeoFilterRoute("talent", "finance-video-editors");
  const result = filterAndOrderTalentForSeoRoute(TALENT, route);
  assert.deepEqual(result.map((item) => item.id), ["t-finance-editor"]);
});

test("jobs scriptwriter route admits only writing-intent jobs", () => {
  const route = getSeoFilterRoute("jobs", "youtube-scriptwriter-jobs");
  const result = filterAndOrderJobsForSeoRoute(JOBS, route);
  assert.deepEqual(cats(result), ["Writing"]);
  assert.equal(result.some((j) => j.category === "Editing"), false);
});

test("jobs video-editor route admits editing jobs and excludes unrelated YouTube jobs", () => {
  const route = getSeoFilterRoute("jobs", "video-editor-jobs");
  const result = cats(filterAndOrderJobsForSeoRoute(JOBS, route));
  assert.ok(result.includes("Editing"));
  for (const excluded of ["Writing", "Thumbnails", "Channel Manager", "Motion Graphics"]) {
    assert.equal(result.includes(excluded), false, `${excluded} must not appear`);
  }
});

test("jobs finance route requires editing intent AND the finance niche", () => {
  const route = getSeoFilterRoute("jobs", "finance-youtube-editor-jobs");
  const result = filterAndOrderJobsForSeoRoute(JOBS, route);
  assert.deepEqual(result.map((j) => j.id), ["j-finance"]);
});

test("empty eligible set is returned as-is (thin results, never broadened)", () => {
  const route = getSeoFilterRoute("talent", "podcast-editors");
  assert.deepEqual(filterAndOrderTalentForSeoRoute(TALENT, route), []);
});

test("stem matching hits inflections without matching lookalike tokens", () => {
  const route = getSeoFilterRoute("talent", "video-editors");
  // "edit" stem hits editor/editing but not a "credit"-like token.
  assert.equal(seoRouteMatchesFields(route.requiredIntent, { role: "editor of videos", niche: "", workMode: "" }), true);
  assert.equal(seoRouteMatchesFields(route.requiredIntent, { role: "credit specialist", niche: "", workMode: "" }), false);
});

test("intent-field extractors read structured role/niche/workmode fields", () => {
  const fields = talentIntentFields(talent("x", "Scriptwriter", { niche: "finance", work_mode: "remote" }));
  assert.match(fields.role, /scriptwriter/);
  assert.match(fields.niche, /finance/);
  assert.match(fields.workMode, /remote/);

  const jobFields = jobIntentFields(job("y", "Writing", "Script writer for explainers"));
  assert.match(jobFields.role, /writing|writer|script/);
});

test("job intent fields prefer canonical role and required structured languages without inventing role from category", () => {
  const canonical = jobIntentFields({
    ...job("canonical", "Design", "Creator role"),
    primaryRoleName: "Video Editor",
    roleSpecialization: "Documentary pacing",
    languageRequirements: [
      { language: "Hindi", priority: "required" },
      { language: "English", priority: "preferred" },
    ],
    languages: ["English"],
    tools: ["Adobe Premiere Pro"],
  });
  assert.match(canonical.role, /video editor/);
  assert.match(canonical.role, /documentary pacing/);
  assert.match(canonical.language, /hindi/);
  assert.doesNotMatch(canonical.language, /english/);
  assert.match(canonical.tool, /premiere/);

  const explicitNone = jobIntentFields({ ...job("none", "Writing", "Creator role"), languageRequirements: [], languages: ["Hindi"] });
  assert.equal(explicitNone.language, "");
  const legacy = jobIntentFields({ ...job("legacy", "Writing", "Creator role"), languageRequirements: null, languages: ["Hindi"] });
  assert.match(legacy.language, /hindi/);
});

// ---------------------------------------------------------------------------
// Hierarchical subfilter system: new gate groups + refinements + registry.
// ---------------------------------------------------------------------------

test("new gate groups: youtube-shorts-editors requires platform + role intent", () => {
  const route = getSeoFilterRoute("talent", "youtube-shorts-editors");
  assert.ok(route);
  const ytShorts = talent("a", "Shorts editor", { platforms: ["YouTube"] });
  const igShorts = talent("b", "Shorts editor", { platforms: ["Instagram"] });
  const ytEditor = talent("c", "Video editor", { platforms: ["YouTube"] });
  assert.equal(seoRouteMatchesFields(route.requiredIntent, talentIntentFields(ytShorts)), true);
  assert.equal(seoRouteMatchesFields(route.requiredIntent, talentIntentFields(igShorts)), false, "IG shorts fail YouTube gate");
  assert.equal(seoRouteMatchesFields(route.requiredIntent, talentIntentFields(ytEditor)), false, "non-shorts fail role gate");
});

test("language gate: hindi-scriptwriters admits only Hindi writers", () => {
  const route = getSeoFilterRoute("talent", "hindi-scriptwriters");
  assert.ok(route);
  const hindi = talent("h", "Scriptwriter", { languages: ["Hindi", "English"] });
  const tamil = talent("t", "Scriptwriter", { languages: ["Tamil"] });
  const hindiEditor = talent("e", "Video editor", { languages: ["Hindi"] });
  assert.deepEqual(
    filterAndOrderTalentForSeoRoute([hindi, tamil, hindiEditor], route).map((x) => x.id),
    ["h"]
  );
});

test("refinements: talent tool + niche compose (AND across dims, OR within)", () => {
  const route = getSeoFilterRoute("talent", "video-editors");
  const financeAe = talent("1", "Video editor", { niche: "finance", content_niches: ["Finance"], tools: ["Adobe After Effects"] });
  const financePr = talent("2", "Video editor", { niche: "finance", content_niches: ["Finance"], tools: ["Adobe Premiere Pro"] });
  const gamingAe = talent("3", "Video editor", { niche: "gaming", content_niches: ["Gaming"], tools: ["Adobe After Effects"] });
  const items = [financeAe, financePr, gamingAe];
  // niche=finance AND tool=after effects → only #1.
  assert.deepEqual(
    filterAndOrderTalentForSeoRoute(items, route, { niches: ["finance"], tools: ["after effects"] }).map((x) => x.id),
    ["1"]
  );
  // niche = finance OR gaming (both admitted), no tool → 1,2,3 (order by score/recency).
  const both = filterAndOrderTalentForSeoRoute(items, route, { niches: ["finance", "gaming"] }).map((x) => x.id).sort();
  assert.deepEqual(both, ["1", "2", "3"]);
});

test("refinements: talent experience band + availability are structured predicates", () => {
  const route = getSeoFilterRoute("talent", "video-editors");
  const junior = talent("j", "Video editor", { experience_years: 1, availability_status: "available" });
  const senior = talent("s", "Video editor", { experience_years: 6, availability_status: "selective" });
  assert.deepEqual(filterAndOrderTalentForSeoRoute([junior, senior], route, { experience: "5+" }).map((x) => x.id), ["s"]);
  assert.deepEqual(filterAndOrderTalentForSeoRoute([junior, senior], route, { experience: "0-1" }).map((x) => x.id), ["j"]);
  assert.deepEqual(filterAndOrderTalentForSeoRoute([junior, senior], route, { availability: "available" }).map((x) => x.id), ["j"]);
});

test("refinements: jobs ignore tool/experience/availability dims (unsupported), gate keyword dims", () => {
  const ytEditor = job("y", "Editing", "Video editor for YouTube", { tags: ["YouTube"] });
  // A tool/experience refinement must not zero out jobs (they lack the data) — the
  // supported platform dim still gates.
  assert.equal(jobMatchesRefinements(ytEditor, { tools: ["premiere"], experience: "5+", platforms: ["youtube"] }), true);
  assert.equal(jobMatchesRefinements(ytEditor, { platforms: ["instagram"] }), false);
});

test("hasRefinements detects any active dimension", () => {
  assert.equal(hasRefinements(null), false);
  assert.equal(hasRefinements({}), false);
  assert.equal(hasRefinements({ niches: [] }), false);
  assert.equal(hasRefinements({ niches: ["finance"] }), true);
  assert.equal(hasRefinements({ availability: "available" }), true);
});

test("refinementCriteriaFromParams parses comma lists and single dims", () => {
  const c = refinementCriteriaFromParams({
    platform: "youtube",
    niche: "finance,gaming",
    tool: ["premiere", "after effects"],
    experience: "5+",
    availability: "available",
  });
  assert.deepEqual(c.platforms, ["youtube"]);
  assert.deepEqual(c.niches, ["finance", "gaming"]);
  assert.deepEqual(c.tools, ["premiere", "after effects"]);
  assert.equal(c.experience, "5+");
  assert.equal(c.availability, "available");
});

test("registry: role + quick filters + subfilters are wired", () => {
  // Remote/YouTube are quick filters, NOT roles.
  const jobQuick = QUICK_FILTERS.jobs.map((q) => q.label);
  assert.deepEqual(jobQuick.sort(), ["Remote", "YouTube"]);
  assert.equal(QUICK_FILTERS.talent.find((q) => q.label === "Remote").dimension, "workMode");
  assert.equal(QUICK_FILTERS.talent.find((q) => q.label === "YouTube").dimension, "platform");

  // roleForRoute anchors a role even for niche/workmode routes.
  assert.equal(roleForRoute(getSeoFilterRoute("talent", "finance-video-editors")), "video editor");
  assert.equal(roleForRoute(getSeoFilterRoute("jobs", "remote-video-editor-jobs")), "video editor");

  // Tier-2 subfilters exist for talent video editor incl. tools; jobs have no tool chips.
  const talentVe = subfiltersForRole("talent", "video editor");
  assert.ok(talentVe.some((c) => c.group === "Tools"));
  const jobsVe = subfiltersForRole("jobs", "video editor");
  assert.equal(jobsVe.some((c) => c.group === "Tools"), false, "jobs never offer tool chips");
  // A curated-combo chip carries a curatedPath; ad-hoc chips do not.
  assert.equal(talentVe.find((c) => c.label === "Finance").curatedPath, "/talent/finance-video-editors");
  assert.equal(talentVe.find((c) => c.label === "Long-form").curatedPath, undefined);
  assert.equal(subfilterParam("workMode"), "workMode");
  assert.equal(subfilterParam("niche"), "niche");
});

test("sitemap eligibility: existing routes vouched, new combos held out", () => {
  const paths = seoFilterSitemapRoutes().map((r) => r.path);
  // Existing curated routes stay in the sitemap.
  assert.ok(paths.includes("/jobs/video-editor-jobs"));
  assert.ok(paths.includes("/talent/finance-video-editors"));
  // New unvouched combos render as chips/work for users but stay OUT of the sitemap.
  assert.equal(paths.includes("/talent/gaming-video-editors"), false);
  assert.equal(paths.includes("/jobs/remote-video-editor-jobs"), false);
  assert.equal(paths.includes("/talent/hindi-scriptwriters"), false);
});
