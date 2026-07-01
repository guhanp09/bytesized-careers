import test from "node:test";
import assert from "node:assert/strict";

import { parseQuery, editDistance, isEmptyParsedQuery } from "../lib/search/queryParser.ts";
import { rankJobs, rankTalent } from "../lib/search/ranking.ts";

// ---- edit distance (Damerau / transpositions) ----
test("editDistance treats adjacent transposition as one edit", () => {
  assert.equal(editDistance("delih", "delhi"), 1);
  assert.equal(editDistance("vidoe", "video"), 1);
  assert.equal(editDistance("editer", "editor"), 1);
  assert.equal(editDistance("youtbe", "youtube"), 1);
  assert.equal(editDistance("instgram", "instagram"), 1);
  assert.equal(editDistance("thumnail", "thumbnail"), 1);
});

// ---- word order does not matter ----
test("word order does not change the parse", () => {
  const a = parseQuery("video editor delhi 10k");
  const b = parseQuery("10k video editor delhi");
  const c = parseQuery("delhi 10k video editor");
  for (const p of [a, b, c]) {
    assert.ok(p.roles.includes("video editor"), `roles for "${p.raw}"`);
    assert.ok(p.locations.includes("Delhi"), `Delhi for "${p.raw}"`);
    assert.equal(p.budget?.amount, 10000);
    assert.equal(p.budget?.op, "approx");
  }
});

test("mixed word order with platform parses every dimension", () => {
  const p = parseQuery("delhi editor youtube 10k");
  assert.ok(p.roles.includes("video editor"));
  assert.ok(p.platforms.includes("youtube"));
  assert.ok(p.locations.includes("Delhi"));
  assert.equal(p.budget?.amount, 10000);
});

// ---- typo tolerance ----
test("typos still resolve to roles + locations", () => {
  const p = parseQuery("vidoe editer delli");
  assert.ok(p.roles.includes("video editor"));
  assert.ok(p.locations.includes("Delhi"));
  assert.ok(p.corrections.length > 0, "records corrections for the 'showing results for' line");
});

// ---- synonyms ----
test("creator-economy synonyms map to canonicals", () => {
  assert.ok(parseQuery("thumbnail designer finance youtube").roles.includes("thumbnail designer"));
  assert.ok(parseQuery("thumbnail designer finance youtube").niches.includes("Finance"));
  assert.ok(parseQuery("motion graphics chennai retainer").roles.includes("motion designer"));
  assert.ok(parseQuery("after effects editor").roles.includes("video editor"));
  assert.ok(parseQuery("script writer instagram reels").roles.includes("script writer"));
  const insta = parseQuery("script writer instagram reels");
  assert.ok(insta.platforms.includes("instagram"));
  assert.ok(insta.platforms.includes("reels"));
  assert.ok(insta.formats.includes("shorts/reels"));
});

test("a specific role phrase keeps creator context as structured metadata", () => {
  const p = parseQuery("thumbnail designer finance youtube");
  assert.deepEqual(p.roles, ["thumbnail designer"]);
  assert.ok(p.platforms.includes("youtube"));
  assert.ok(p.niches.includes("Finance"));
  assert.equal(p.freeTokens.includes("finance"), false);
});

test("work mode + language are recognized", () => {
  const p = parseQuery("shorts editor remote hindi");
  assert.ok(p.roles.includes("shorts editor"));
  assert.ok(p.workModes.includes("remote"));
  assert.ok(p.languages.includes("Hindi"));
});

// ---- budget parsing ----
test("budget parsing handles k / under / above / per-unit / currency", () => {
  assert.deepEqual(parseQuery("10k").budget, { amount: 10000, op: "approx" });
  assert.equal(parseQuery("under 10k").budget?.op, "under");
  assert.equal(parseQuery("below 15000").budget?.op, "under");
  assert.equal(parseQuery("above 25k").budget?.op, "over");
  assert.equal(parseQuery("20k per month").budget?.unit, "month");
  assert.equal(parseQuery("5k per video").budget?.unit, "video");
  const inr = parseQuery("₹30,000 remote editor");
  assert.equal(inr.budget?.amount, 30000);
  assert.ok(inr.workModes.includes("remote"));
  assert.ok(inr.roles.includes("video editor"));
});

test("small bare numbers are not treated as budget", () => {
  // "8-10 mins" style fragments shouldn't become a budget signal.
  assert.equal(parseQuery("editor 3 concepts").budget, undefined);
});

// ---- location parsing ----
test("location aliases and region expansion resolve", () => {
  assert.ok(parseQuery("bangalore editor").locations.includes("Bengaluru"));
  assert.ok(parseQuery("gurgaon thumbnail").locations.includes("Gurugram"));
  assert.ok(parseQuery("remote shorts editor").locations.includes("Remote"));
  const ncr = parseQuery("ncr video editor");
  assert.ok(ncr.locations.includes("Delhi"));
  assert.ok(ncr.locations.includes("Gurugram"));
});

// ---- empty + serializable ----
test("empty query is detected and ParsedQuery is JSON-serializable", () => {
  assert.equal(isEmptyParsedQuery(parseQuery("")), true);
  const p = parseQuery("video editor delhi 10k");
  assert.deepEqual(JSON.parse(JSON.stringify(p)), p, "serializable for saved searches/alerts");
});

// ---- ranking: jobs ----
const jobs = [
  { id: "j1", title: "Video editor for YouTube (long-form)", category: "Editing", location: "Delhi", budget: "₹10,000 per video", workMode: "Remote", platform: "youtube", tools: ["Premiere Pro"], languages: ["Hindi", "English"], tags: ["Premiere"], contentNiches: ["Finance"], contentGenres: ["Explainers"], formatsHiredFor: ["Long-form video"], about: "Finance channel", createdAt: "2026-06-01" },
  { id: "j2", title: "Thumbnail designer (CTR-focused)", category: "Thumbnails", location: "Mumbai", budget: "₹1,500 per thumbnail", platform: "youtube", tags: ["Photoshop"], contentNiches: ["Tech"], contentGenres: ["Reviews"], formatsHiredFor: ["Thumbnails"], about: "Tech channel", createdAt: "2026-06-02" },
  { id: "j3", title: "Video editor", category: "Editing", location: "Bengaluru", budget: "₹25,000 per project", platform: "youtube", tags: [], createdAt: "2026-06-03" },
];

test("rankJobs prioritizes role + location + budget and drops irrelevant", () => {
  const results = rankJobs(jobs, parseQuery("video editor delhi 10k"));
  assert.equal(results[0].item.id, "j1", "Delhi ~10k video editor ranks first");
  assert.equal(results.find((r) => r.item.id === "j2"), undefined, "thumbnail job is not returned");
});

test("rankJobs respects budget op (under)", () => {
  const results = rankJobs(jobs, parseQuery("video editor under 5k"));
  // j1 (10k) and j3 (25k) are over 5k → no budget boost; both may still match on role.
  assert.ok(results.every((r) => r.item.id !== "j2"));
});

test("rankJobs weights structured creator context above accidental description matches", () => {
  const candidates = [
    {
      id: "structured",
      title: "Packaging support for creator channel",
      category: "Design",
      platform: "youtube",
      contentNiches: ["Finance"],
      contentGenres: ["Reviews"],
      formatsHiredFor: ["Thumbnails"],
      tags: [],
      about: "Creator-led investing videos.",
      createdAt: "2026-06-01",
    },
    {
      id: "description-only",
      title: "Packaging support for creator channel",
      category: "Design",
      platform: "youtube",
      tags: [],
      about: "This finance thumbnail YouTube reference appears in a loose description.",
      createdAt: "2026-06-02",
    },
  ];

  const results = rankJobs(candidates, parseQuery("finance thumbnail youtube"));
  assert.equal(results[0].item.id, "structured");
});

test("rankJobs handles niche, genre, and format structured creator queries", () => {
  const candidates = [
    {
      id: "gaming-shorts",
      title: "Editor for fast creator team",
      category: "Editing",
      platform: "youtube",
      contentNiches: ["Gaming"],
      contentGenres: ["Shorts/Reels"],
      formatsHiredFor: ["Shorts/Reels", "Captions"],
      tags: ["CapCut"],
      createdAt: "2026-06-01",
    },
    {
      id: "documentary-longform",
      title: "Editor for narrative creator video",
      category: "Editing",
      platform: "youtube",
      contentNiches: ["Education"],
      contentGenres: ["Documentaries"],
      formatsHiredFor: ["Long-form video"],
      tags: ["Premiere"],
      createdAt: "2026-06-02",
    },
  ];

  assert.equal(rankJobs(candidates, parseQuery("gaming shorts editor"))[0].item.id, "gaming-shorts");
  assert.equal(rankJobs(candidates, parseQuery("documentary long form editor"))[0].item.id, "documentary-longform");
});

// ---- ranking: talent ----
const talent = [
  { id: "t1", title: "Retention video editor", primary_role: "Video editor", roles: ["Video editor"], niche: "Finance", content_niches: ["Finance"], content_genres: ["Explainers"], formats: ["Long-form"], platforms: ["YouTube"], tools: ["Premiere Pro"], languages: ["Hindi"], work_mode: "remote", location: "Delhi", rate_min: 10000, rate_max: 30000, description: "edits finance videos", created_at: "2026-06-01", availability_status: "available" },
  { id: "t2", title: "Thumbnail designer", primary_role: "Thumbnail designer", roles: ["Thumbnail designer"], niche: "Gaming", content_niches: ["Gaming"], content_genres: ["Reviews"], formats: ["Thumbnails"], platforms: ["YouTube"], tools: ["Photoshop"], languages: ["English"], work_mode: "remote", location: "Mumbai", rate_min: 1500, rate_max: 5000, created_at: "2026-06-02", availability_status: "available" },
];

test("rankTalent matches role + location + rate; mode-specific results", () => {
  const results = rankTalent(talent, parseQuery("video editor delhi 10k"));
  assert.equal(results[0].item.id, "t1");
  assert.equal(results.find((r) => r.item.id === "t2"), undefined);
});

test("same query, talent mode keys on niche/language free tokens", () => {
  const results = rankTalent(talent, parseQuery("thumbnail designer gaming"));
  assert.equal(results[0].item.id, "t2");
});

test("rankTalent weights structured creator context above accidental description matches", () => {
  const candidates = [
    {
      id: "structured",
      title: "YouTube packaging designer",
      primary_role: "Thumbnail designer",
      roles: ["Thumbnail designer"],
      content_niches: ["Finance"],
      content_genres: ["Reviews"],
      formats: ["Thumbnails"],
      platforms: ["YouTube"],
      tools: ["Photoshop"],
      created_at: "2026-06-01",
    },
    {
      id: "description-only",
      title: "YouTube packaging designer",
      primary_role: "Thumbnail designer",
      roles: ["Thumbnail designer"],
      formats: [],
      platforms: ["YouTube"],
      tools: ["Photoshop"],
      description: "Has seen finance thumbnail references in past work.",
      created_at: "2026-06-02",
    },
  ];

  const results = rankTalent(candidates, parseQuery("finance thumbnail youtube"));
  assert.equal(results[0].item.id, "structured");
});

test("rankTalent handles niche, genre, and format creator-context queries", () => {
  const candidates = [
    {
      id: "gaming-shorts",
      title: "Shorts editor for fast creator teams",
      primary_role: "Shorts editor",
      roles: ["Shorts editor"],
      content_niches: ["Gaming"],
      content_genres: ["Shorts/Reels"],
      formats: ["Shorts/Reels"],
      platforms: ["YouTube"],
      tools: ["CapCut"],
      created_at: "2026-06-01",
    },
    {
      id: "documentary-longform",
      title: "Documentary editor for creator channels",
      primary_role: "Video editor",
      roles: ["Video editor"],
      content_niches: ["Education"],
      content_genres: ["Documentaries"],
      formats: ["Long-form video"],
      platforms: ["YouTube"],
      tools: ["Premiere Pro"],
      created_at: "2026-06-02",
    },
  ];

  assert.equal(rankTalent(candidates, parseQuery("gaming shorts editor"))[0].item.id, "gaming-shorts");
  assert.equal(rankTalent(candidates, parseQuery("documentary long form editor"))[0].item.id, "documentary-longform");
});
