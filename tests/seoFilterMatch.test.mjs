import test from "node:test";
import assert from "node:assert/strict";

import { getSeoFilterRoute } from "../lib/seoFilterRoutes.ts";
import {
  filterAndOrderJobsForSeoRoute,
  filterAndOrderTalentForSeoRoute,
  jobIntentFields,
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
  title: `${primary_role} for creator-led YouTube channels`,
  primary_role,
  roles: [primary_role],
  niche: extra.niche ?? "creator content",
  content_niches: extra.content_niches ?? [],
  content_genres: [],
  formats: extra.formats ?? [],
  platforms: ["YouTube"],
  tools: [],
  work_mode: extra.work_mode ?? "remote",
  location: extra.location ?? "Remote",
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
