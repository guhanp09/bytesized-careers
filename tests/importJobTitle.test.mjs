import test from "node:test";
import assert from "node:assert/strict";

import { parseJobPost } from "../lib/importJob/parseJobPost.ts";

test("role-labeled KV value wins as the title, verbatim", () => {
  const d = parseJobPost("Role: Senior Shorts Editor\nEdit gaming shorts weekly.").draft;
  assert.equal(d.title.status, "imported");
  assert.equal(d.title.value, "Senior Shorts Editor");
});

test("heading containing a role becomes the title", () => {
  const d = parseJobPost("MOTION DESIGNER WANTED\nStudio work in Pune.").draft;
  assert.equal(d.title.status, "imported");
  assert.match(d.title.value, /MOTION DESIGNER/);
});

test("'looking for a …' pattern captures the title phrase", () => {
  const d = parseJobPost("We are looking for a thumbnail designer for our tech channel.").draft;
  assert.equal(d.title.status, "imported");
  assert.match(d.title.value, /thumbnail designer/i);
});

test("bare role mention falls back to the title-cased canonical", () => {
  const d = parseJobPost("Channel manager needed. Own our upload schedule end to end.").draft;
  assert.match(d.title.value, /channel manager/i);
});

test("two roles in the title zone create a conflict with per-role alternatives", () => {
  const r = parseJobPost("Hiring a video editor and a thumbnail designer for our pod.");
  const t = r.draft.title;
  assert.equal(t.status, "conflict");
  const alts = t.alternatives.map((a) => a.value);
  assert.ok(alts.includes("Video Editor"));
  assert.ok(alts.includes("Thumbnail Designer"));
  assert.ok(r.warnings.some((w) => w.code === "multiple-roles"));
  assert.match(t.note, /you can import again for the other/);
});

test("a colleague mention in intro prose never creates a phantom conflict", () => {
  const post = [
    "We are hiring a scriptwriter for our YouTube channel!",
    "",
    "You will write two scripts a week, shape hooks with the editor, and keep our voice sharp.",
  ].join("\n");
  const r = parseJobPost(post);
  assert.equal(r.draft.title.status, "imported");
  assert.deepEqual(r.classification.rolesDetected, ["script writer"]);
  assert.equal(r.draft.category.value, "Writing");
  assert.equal(r.draft.category.status, "imported");
});

test("duty bullets never create phantom title conflicts", () => {
  const post = [
    "Hiring a video editor!",
    "",
    "Responsibilities:",
    "- Collaborate with our scriptwriter on pacing",
    "- Coordinate with the thumbnail designer",
  ].join("\n");
  const d = parseJobPost(post).draft;
  assert.equal(d.title.status, "imported");
  assert.match(d.title.value, /video editor/i);
});

test("title is truncated codepoint-safe at 94 characters", () => {
  const long = `Role: Video Editor ${"🎬".repeat(120)}`;
  const d = parseJobPost(long).draft;
  assert.ok(Array.from(d.title.value).length <= 94);
  // No lone surrogate at the end.
  const last = d.title.value.charCodeAt(d.title.value.length - 1);
  assert.ok(!(last >= 0xd800 && last <= 0xdbff), "must not end on a high surrogate");
});

test("no role and no hiring phrase → title missing", () => {
  const d = parseJobPost("The mountains were quiet that morning. Tea helped.").draft;
  assert.equal(d.title.status, "missing");
  assert.equal(d.title.value, null);
});

test("title evidence slices real source text", () => {
  const r = parseJobPost("Role: Podcast Producer\nWeekly show.");
  const e = r.draft.title.evidence[0];
  assert.match(r.source.normalized.slice(e.start, e.end), /Podcast Producer/);
});
