import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { parseJobPost } from "../lib/importJob/parseJobPost.ts";
import { toWizardPrefill, IMPORT_JUMP_TARGETS, IMPORT_FIELD_LABELS } from "../lib/importJob/applyToWizard.ts";
import { formatBudgetPreview, formatExperiencePreview } from "../lib/format.ts";

const fixture = (name) =>
  readFileSync(new URL(`./fixtures/import-posts/${name}`, import.meta.url), "utf8");

const handoffFor = (text, category = "Editing", titleIndex = null) =>
  toWizardPrefill(parseJobPost(text), titleIndex, category);

test("full prefill for a rich post matches the wizard state shapes", () => {
  const { prefill, meta, initialStep } = handoffFor(fixture("video-editor-linkedin.txt"));
  assert.equal(prefill.budgetMin, "25000");
  assert.equal(prefill.budgetMax, "35000");
  assert.equal(prefill.budgetUnit, "per month");
  assert.equal(prefill.budgetIntent, "range");
  assert.equal(prefill.workMode, "Hybrid");
  assert.equal(prefill.city, "Bengaluru");
  assert.equal(prefill.platform, "youtube");
  assert.deepEqual(prefill.platforms, ["youtube"]);
  assert.equal(prefill.startWithin, "ASAP");
  assert.ok(prefill.tools.includes("Adobe Premiere Pro"));
  assert.ok(prefill.about.length >= 20);
  // Suggested native requirements pass the registry sanitizer.
  assert.deepEqual([...prefill.applicationRequirements].sort(), ["expected_rate", "relevant_portfolio"]);
  assert.equal(meta.budget.status, "imported");
  // Experience is 3+ (review) → the wizard opens where nothing blocks: experience
  // isn't publish-required, so the fast path lands on the final step.
  assert.equal(initialStep, "referenceVideos");
});

test("preview strings match the wizard's own formatters exactly", () => {
  const { prefill } = handoffFor(fixture("video-editor-linkedin.txt"));
  assert.equal(prefill.previewBudgetText, formatBudgetPreview("25000", "35000", "per month"));
  assert.equal(prefill.previewExperienceText, formatExperiencePreview("3", "3"));
  assert.equal(prefill.previewLocationText, "Hybrid - Bengaluru");
});

test("contact intent produces the Contact for pricing preview label", () => {
  const { prefill } = handoffFor("Hiring a video editor.\nDM your rates.");
  assert.equal(prefill.budgetIntent, "contact");
  assert.equal(prefill.previewBudgetText, "Contact for pricing");
});

test("Remote clears the city and previews as Remote", () => {
  const { prefill } = handoffFor("Hiring a video editor.\nRemote (Bangalore preferred).");
  assert.equal(prefill.workMode, "Remote");
  assert.equal(prefill.city, "");
  assert.equal(prefill.previewLocationText, "Remote");
});

test("the confirmed category flows into the prefill", () => {
  const { prefill } = handoffFor(fixture("scriptwriter-email.txt"), "Writing");
  assert.equal(prefill.category, "Writing");
});

test("employment-type tags are appended and deduped", () => {
  const { prefill } = handoffFor(fixture("production-house-formal.txt"));
  assert.ok(prefill.tags.includes("full-time"));
  const again = handoffFor(fixture("smm-instagram-caption.txt"));
  // Hashtags preserved; no employment type in that post.
  assert.ok(again.prefill.tags.includes("hiring"));
});

test("title conflict resolves through the chosen alternative index", () => {
  const raw = fixture("agency-multi-role.txt");
  const result = parseJobPost(raw);
  const alts = result.draft.title.alternatives.map((a) => a.value);
  const idx = alts.indexOf("Thumbnail Designer");
  const { prefill, meta } = toWizardPrefill(result, idx, "Thumbnails");
  assert.equal(prefill.title, "Thumbnail Designer");
  assert.equal(prefill.category, "Thumbnails");
  assert.equal(meta.title.status, "imported"); // resolved, no longer a conflict
});

test("chips respect the wizard caps and refVideos cap at 3", () => {
  const post = `Hiring a video editor for Tech, Finance, Gaming, Education, Food, Fitness, Beauty, Fashion, Travel, Business, Comedy, News, Entertainment and Sports content.\nReferences: https://youtu.be/aaaaaaaaaaa https://youtu.be/bbbbbbbbbbb https://youtu.be/ccccccccccc https://youtu.be/ddddddddddd`;
  const { prefill } = handoffFor(post);
  assert.ok(prefill.contentNiches.length <= 12);
  assert.equal(prefill.refVideos.length, 3);
});

test("missing/review publish-relevant fields decide the fast-path step", () => {
  // Missing budget → basics.
  assert.equal(handoffFor("Hiring a video editor. Remote. About: a long channel description that goes on.").initialStep, "basics");
  // Everything publish-relevant satisfied → final step.
  const complete = handoffFor(
    "Hiring a video editor for our YouTube channel.\nPay: ₹20,000–₹30,000 per month\nRemote role.\nWe are a lovely growing tech channel with lots of fun work."
  );
  assert.equal(complete.initialStep, "referenceVideos");
});

test("contact signals become review meta, never prefill text", () => {
  const { prefill, meta } = handoffFor(fixture("contact-heavy-apply.txt"));
  assert.doesNotMatch(prefill.howToApply, /forms\.google\.com|hire@sketchfactory\.in|98765/);
  assert.equal(meta.applicationSignals.status, "review");
  assert.match(meta.applicationSignals.note, /Inbox/);
});

test("IMPORT_JUMP_TARGETS keys resolve to real JOB_COMPLETION_TARGETS entries", () => {
  const page = readFileSync(new URL("../components/PostJobPage.tsx", import.meta.url), "utf8");
  const mapMatch = page.match(/const JOB_COMPLETION_TARGETS[^=]*=\s*\{([\s\S]*?)\n\};/);
  assert.ok(mapMatch, "PostJobPage should declare JOB_COMPLETION_TARGETS");
  const keys = new Set(
    Array.from(mapMatch[1].matchAll(/^\s*(?:"([^"]+)"|([A-Za-z][A-Za-z0-9]*))\s*:\s*\{/gm)).map(
      (m) => m[1] ?? m[2]
    )
  );
  for (const target of Object.values(IMPORT_JUMP_TARGETS)) {
    assert.ok(keys.has(target), `jump target "${target}" must exist in JOB_COMPLETION_TARGETS`);
  }
});

test("every draft field has a human label for banner pills", () => {
  const result = parseJobPost("Hiring a video editor.");
  for (const key of Object.keys(result.draft)) {
    assert.ok(IMPORT_FIELD_LABELS[key], `missing label for ${key}`);
  }
});
