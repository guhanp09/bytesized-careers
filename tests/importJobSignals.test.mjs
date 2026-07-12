import test from "node:test";
import assert from "node:assert/strict";

import { parseJobPost } from "../lib/importJob/parseJobPost.ts";

const BASE = "Hiring a video editor for our channel.\n";

const publicText = (draft) =>
  [draft.howToApply.value, draft.about.value, draft.responsibilities.value, draft.requirements.value]
    .filter(Boolean)
    .join("\n");

test("emails, phones, forms and DM phrases become contact signals, never public text", () => {
  const post = `${BASE}How to apply:\nEmail hire@studio.in or WhatsApp +91 98765 43210.\nGoogle form: https://forms.google.com/xyz\nDM us on Instagram.`;
  const r = parseJobPost(post);
  const d = r.draft;
  assert.ok(d.applicationSignals.contactLines.length >= 3);
  const text = publicText(d);
  assert.doesNotMatch(text, /hire@studio\.in/);
  assert.doesNotMatch(text, /98765/);
  assert.doesNotMatch(text, /forms\.google\.com/);
  assert.ok(r.warnings.some((w) => w.code === "external-application-routing"));
});

test("portfolio / rate / availability intent maps to native requirement suggestions", () => {
  const post = `${BASE}To apply, share your portfolio, your expected rate, and when you can start.`;
  const d = parseJobPost(post).draft;
  assert.deepEqual(
    [...d.applicationSignals.suggestedRequirements].sort(),
    ["expected_rate", "relevant_portfolio", "start_availability"]
  );
});

test("native screening instructions stay in How to apply", () => {
  const post = `${BASE}To apply, mention your favourite video of ours and why it works.`;
  const d = parseJobPost(post).draft;
  assert.match(d.howToApply.value, /favourite video/);
});

test("the deadline sentence stays in How to apply (not contact routing)", () => {
  const post = `${BASE}To apply, tell us about your best edit.\nApply by 20 September.`;
  const r = parseJobPost(post);
  assert.match(r.draft.howToApply.value, /Apply by 20 September/);
  assert.equal(r.draft.deadline.status, "unsupported");
});

test("YouTube links become reference videos (max 3), other links are contact signals", () => {
  const post = `${BASE}Style references:\nhttps://youtu.be/aaaaaaaaaaa\nhttps://www.youtube.com/watch?v=bbbbbbbbbbb\nhttps://youtu.be/ccccccccccc\nhttps://youtu.be/ddddddddddd\nApply at https://example.com/apply`;
  const d = parseJobPost(post).draft;
  assert.equal(d.refVideos.value.length, 3);
  assert.match(d.refVideos.note, /up to 3 reference videos/);
  assert.ok(
    d.applicationSignals.contactLines.some((c) => c.snippet.includes("example.com")),
    "non-YouTube link should be a contact signal"
  );
  assert.doesNotMatch(publicText(d), /example\.com/);
});

test("no signals → empty contact list and no routing warning", () => {
  const r = parseJobPost(`${BASE}Edit weekly videos. ₹20,000 per month.`);
  assert.equal(r.draft.applicationSignals.contactLines.length, 0);
  assert.ok(!r.warnings.some((w) => w.code === "external-application-routing"));
});
