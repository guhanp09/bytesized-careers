import test from "node:test";
import assert from "node:assert/strict";

import { CATEGORY_BY_ROLE, categoryForRole, normalizeJobCategory, JOB_CATEGORIES } from "../lib/importJob/categoryMap.ts";
import { parseJobPost } from "../lib/importJob/parseJobPost.ts";

test("the full role→category table maps as designed", () => {
  const expected = {
    "video editor": ["Editing", true],
    "shorts editor": ["Shorts", true],
    "thumbnail designer": ["Thumbnails", true],
    "graphic designer": ["Design", true],
    "motion designer": ["Motion Graphics", true],
    "script writer": ["Writing", true],
    researcher: ["Research", true],
    "channel manager": ["Channel Manager", true],
    "social media manager": ["Marketing", true],
    "content strategist": ["Marketing", true],
    "voice over artist": ["Voice Over", true],
    producer: ["Channel Manager", false],
  };
  for (const [role, [category, confident]] of Object.entries(expected)) {
    const mapped = categoryForRole(role);
    assert.equal(mapped.value, category, role);
    assert.equal(mapped.confident, confident, role);
  }
  assert.equal(Object.keys(CATEGORY_BY_ROLE).length, Object.keys(expected).length);
});

test("unmapped or missing roles suggest Editing without confidence", () => {
  for (const role of [null, undefined, "ugc creator", "astronaut"]) {
    const mapped = categoryForRole(role);
    assert.equal(mapped.value, "Editing");
    assert.equal(mapped.confident, false);
  }
});

test("never silently Editing: scriptwriter → Writing, thumbnail → Thumbnails, SMM → Marketing", () => {
  const cases = [
    ["We are hiring a scriptwriter for explainers.", "Writing"],
    ["Need a thumbnail designer for our gaming channel.", "Thumbnails"],
    ["Hiring a social media manager for Instagram.", "Marketing"],
  ];
  for (const [post, category] of cases) {
    const d = parseJobPost(post).draft;
    assert.equal(d.category.value, category, post);
    assert.equal(d.category.status, "imported", post);
  }
});

test("producer maps to a suggestion that requires confirmation", () => {
  const d = parseJobPost("Looking for a podcast producer for our weekly show.").draft;
  assert.equal(d.category.status, "review");
  assert.equal(d.category.value, "Channel Manager");
  assert.match(d.category.note, /pick a category to continue/i);
});

test("no recognized role → category review with a pick-one note", () => {
  const d = parseJobPost("We want a UGC creator for our skincare brand. DM to apply.").draft;
  assert.equal(d.category.status, "review");
  assert.match(d.category.note, /pick one to continue/i);
});

test("title conflict keeps category unconfirmed until the title is resolved", () => {
  const d = parseJobPost("Hiring a video editor and a thumbnail designer.").draft;
  assert.equal(d.title.status, "conflict");
  assert.equal(d.category.status, "review");
});

test("normalizeJobCategory validates against the closed union with Editing fallback", () => {
  assert.equal(normalizeJobCategory("Writing"), "Writing");
  assert.equal(normalizeJobCategory("writing"), "Writing");
  assert.equal(normalizeJobCategory(" MOTION GRAPHICS "), "Motion Graphics");
  assert.equal(normalizeJobCategory("Astral Projection"), "Editing");
  assert.equal(normalizeJobCategory(null), "Editing");
  assert.equal(normalizeJobCategory(undefined), "Editing");
  assert.equal(normalizeJobCategory(42), "Editing");
  assert.equal(JOB_CATEGORIES.length, 10);
});
