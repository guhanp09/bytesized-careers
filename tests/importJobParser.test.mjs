import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { performance } from "node:perf_hooks";

import { parseJobPost } from "../lib/importJob/parseJobPost.ts";
import { MAX_IMPORT_CHARS } from "../lib/importJob/normalize.ts";

const fixture = (name) =>
  readFileSync(new URL(`./fixtures/import-posts/${name}`, import.meta.url), "utf8");

const parseFixture = (name) => parseJobPost(fixture(name));

// ---------------------------------------------------------------------------
// Corpus expectations
// ---------------------------------------------------------------------------

test("video-editor-linkedin: sectioned post extracts the full field set", () => {
  const r = parseFixture("video-editor-linkedin.txt");
  const d = r.draft;
  assert.equal(r.classification.looksLikeJobPost, true);
  assert.ok(r.classification.rolesDetected.includes("video editor"));
  assert.equal(d.title.status, "imported");
  assert.match(d.title.value, /video editor/i);
  assert.equal(d.category.status, "imported");
  assert.equal(d.category.value, "Editing");
  assert.deepEqual(d.budget.value, { min: "25000", max: "35000", unit: "per month", intent: "range" });
  assert.equal(d.budget.status, "imported");
  assert.equal(d.workMode.value, "Hybrid");
  assert.equal(d.city.status, "imported");
  assert.equal(d.city.value, "Bengaluru");
  assert.deepEqual(d.experience.value, { min: "3", max: "3" });
  assert.equal(d.experience.status, "review");
  assert.equal(d.startWithin.value, "ASAP");
  assert.deepEqual(d.platforms.value, ["youtube"]);
  assert.ok(d.tools.value.includes("Adobe Premiere Pro"));
  assert.ok(d.tools.value.includes("Adobe After Effects"));
  assert.match(d.responsibilities.value, /Edit 2 long-form videos per week/);
  assert.match(d.requirements.value, /retention editing/);
  assert.match(d.about.value, /Finance Simplified/);
  // Portfolio + rate intent from the apply line.
  assert.ok(d.applicationSignals.suggestedRequirements.includes("relevant_portfolio"));
  assert.ok(d.applicationSignals.suggestedRequirements.includes("expected_rate"));
});

test("thumbnail-designer-whatsapp: emoji bullets, DM-your-rates, per-thumbnail coercion", () => {
  const r = parseFixture("thumbnail-designer-whatsapp.txt");
  const d = r.draft;
  assert.equal(r.classification.looksLikeJobPost, true);
  assert.equal(d.category.value, "Thumbnails");
  assert.equal(d.category.status, "imported");
  // ₹800 per thumbnail → per-project coercion, single amount as range, review.
  assert.equal(d.budget.status, "review");
  assert.deepEqual(d.budget.value, { min: "800", max: "800", unit: "per project", intent: "range" });
  assert.ok(r.warnings.some((w) => w.code === "per-unit-coerced"));
  assert.ok(d.tools.value.includes("Adobe Photoshop"));
  assert.ok(d.tools.value.includes("Canva"));
  // "DM your rates" routes off-platform → signals, never howToApply.
  assert.ok(d.applicationSignals.contactLines.length > 0);
  assert.ok(d.applicationSignals.suggestedRequirements.includes("expected_rate"));
  assert.ok(d.applicationSignals.suggestedRequirements.includes("relevant_portfolio"));
});

test("scriptwriter-email: LPA is surfaced for review, never converted; deadline unsupported", () => {
  const r = parseFixture("scriptwriter-email.txt");
  const d = r.draft;
  assert.equal(d.category.value, "Writing");
  assert.equal(d.budget.status, "review");
  // No prefilled amounts for annual compensation.
  assert.equal(d.budget.value.min, "");
  assert.equal(d.budget.value.max, "");
  assert.match(d.budget.note, /annual compensation/i);
  assert.match(d.budget.note, /25,000/); // hint arithmetic only in the note
  assert.ok(r.warnings.some((w) => w.code === "annual-compensation"));
  assert.equal(d.deadline.status, "unsupported");
  assert.match(d.howToApply.value, /Apply by 15 August/);
  assert.equal(d.employmentType.value, "full-time");
});

test("smm-instagram-caption: hashtags become tags, USD is unsupported, category Marketing", () => {
  const r = parseFixture("smm-instagram-caption.txt");
  const d = r.draft;
  assert.equal(d.category.value, "Marketing");
  assert.equal(d.budget.status, "unsupported");
  assert.equal(d.budget.value, null);
  assert.ok(r.warnings.some((w) => w.code === "non-inr-currency"));
  assert.ok(d.tags.value.includes("hiring"));
  assert.ok(d.applicationSignals.contactLines.length > 0); // "link in bio"
  assert.deepEqual(d.platforms.value, ["instagram"]);
});

test("channel-manager-remote: Remote wins, mentioned city becomes a work-mode note", () => {
  const r = parseFixture("channel-manager-remote.txt");
  const d = r.draft;
  assert.equal(d.category.value, "Channel Manager");
  assert.equal(d.workMode.value, "Remote");
  assert.equal(d.city.value, null); // never prefilled for remote roles
  assert.match(d.workMode.note, /Mumbai/);
  assert.deepEqual(d.experience.value, { min: "2", max: "4" });
  assert.equal(d.experience.status, "imported");
  assert.deepEqual(d.budget.value, { min: "40000", max: "60000", unit: "per month", intent: "range" });
});

test("ugc-creator-brief: unmapped role → category requires confirmation", () => {
  const r = parseFixture("ugc-creator-brief.txt");
  const d = r.draft;
  assert.equal(d.category.status, "review");
  assert.deepEqual(d.platforms.value, ["instagram"]);
  assert.equal(d.budget.status, "review");
  assert.ok(r.warnings.some((w) => w.code === "per-unit-coerced"));
  assert.ok(d.languages.value.includes("Hindi"));
  assert.ok(d.languages.value.includes("English"));
});

test("agency-multi-role: two roles produce a title conflict with alternatives", () => {
  const r = parseFixture("agency-multi-role.txt");
  const d = r.draft;
  assert.equal(d.title.status, "conflict");
  assert.ok(d.title.alternatives.length >= 2);
  const altValues = d.title.alternatives.map((a) => a.value);
  assert.ok(altValues.includes("Video Editor"));
  assert.ok(altValues.includes("Thumbnail Designer"));
  assert.ok(r.warnings.some((w) => w.code === "multiple-roles"));
  // Category must not silently commit while the title is ambiguous.
  assert.equal(d.category.status, "review");
});

test("podcast-producer: podcast is a tag not a platform; producer category needs review", () => {
  const r = parseFixture("podcast-producer.txt");
  const d = r.draft;
  assert.equal(d.platforms.value, null);
  assert.ok(d.tags.value.includes("podcast"));
  assert.equal(d.category.status, "review");
  assert.equal(d.category.value, "Channel Manager"); // suggestion only
  assert.equal(d.budget.value.intent, "flexible");
  assert.ok(d.tools.value.includes("Descript"));
});

test("motion-designer-onsite: on-site + monthly range + experience range", () => {
  const r = parseFixture("motion-designer-onsite.txt");
  const d = r.draft;
  assert.equal(d.category.value, "Motion Graphics");
  assert.equal(d.workMode.value, "On-site");
  assert.deepEqual(d.budget.value, { min: "45000", max: "55000", unit: "per month", intent: "range" });
  assert.deepEqual(d.experience.value, { min: "2", max: "5" });
  assert.equal(d.startWithin.value, "<1mo");
});

test("influencer-marketing-brand: salary-context monthly, Gurugram alias, Marketing", () => {
  const r = parseFixture("influencer-marketing-brand.txt");
  const d = r.draft;
  assert.equal(d.category.value, "Marketing");
  assert.equal(d.budget.value.unit, "per month");
  assert.equal(d.budget.value.min, "30000");
  assert.equal(d.workMode.value, "Hybrid");
  assert.equal(d.city.value, "Gurugram");
  assert.ok(d.applicationSignals.contactLines.length > 0); // email
  assert.doesNotMatch(d.howToApply.value ?? "", /talent@fitbrand\.in/);
});

test("production-house-formal: explicit ₹50,000 single amount + full-time tag flows", () => {
  const r = parseFixture("production-house-formal.txt");
  const d = r.draft;
  assert.equal(d.employmentType.value, "full-time");
  assert.equal(d.employmentType.status, "imported");
  // No explicit billing period on the amount → employment-type hint applies.
  assert.equal(d.budget.value.unit, "per month");
  assert.equal(d.budget.value.min, "50000");
  assert.equal(d.workMode.value, "On-site");
  assert.equal(d.city.value, "Mumbai");
  assert.ok(d.tools.value.includes("Frame.io"));
});

test("internship-part-time: engagement type is unsupported but preserved", () => {
  const r = parseFixture("internship-part-time.txt");
  const d = r.draft;
  assert.equal(d.employmentType.status, "unsupported");
  assert.ok(["internship", "part-time"].includes(d.employmentType.value));
  assert.ok(r.warnings.some((w) => w.code === "engagement-type-unsupported"));
  assert.equal(d.category.value, "Shorts");
  assert.equal(d.workMode.value, "Remote");
  assert.deepEqual(d.experience.value, { min: "0", max: "0" });
});

test("fresher-onsite-no-city: on-site without a city stays missing", () => {
  const r = parseFixture("fresher-onsite-no-city.txt");
  const d = r.draft;
  assert.equal(d.workMode.value, "On-site");
  assert.equal(d.city.status, "missing");
  assert.deepEqual(d.experience.value, { min: "0", max: "0" });
});

test("ncr-region-post: region becomes a city conflict, never an auto-pick", () => {
  const r = parseFixture("ncr-region-post.txt");
  const d = r.draft;
  assert.equal(d.city.status, "conflict");
  assert.equal(d.city.value, null);
  const cities = d.city.alternatives.map((a) => a.value);
  assert.ok(cities.includes("Delhi"));
  assert.ok(cities.includes("Noida"));
  assert.ok(r.warnings.some((w) => w.code === "region-needs-city"));
  assert.equal(d.category.value, "Design");
});

test("negotiable-budget: contact-for-pricing intent", () => {
  const r = parseFixture("negotiable-budget.txt");
  const d = r.draft;
  assert.equal(d.budget.status, "imported");
  assert.equal(d.budget.value.intent, "contact");
  assert.equal(d.budget.value.min, "");
  assert.equal(d.category.value, "Writing");
});

test("very-short-post: still classified as a job via the role signal", () => {
  const r = parseFixture("very-short-post.txt");
  assert.equal(r.classification.looksLikeJobPost, true);
  assert.equal(r.draft.category.value, "Shorts");
});

test("single-paragraph-linkedin: one long paragraph still yields structured fields", () => {
  const raw = fixture("single-paragraph-linkedin.txt");
  assert.ok(raw.split("\n")[0].length > 1000, "fixture should be one long paragraph");
  const r = parseJobPost(raw);
  const d = r.draft;
  assert.equal(r.classification.looksLikeJobPost, true);
  assert.ok(r.classification.rolesDetected.includes("video editor"));
  assert.deepEqual(d.budget.value, { min: "28000", max: "38000", unit: "per month", intent: "range" });
  assert.equal(d.workMode.value, "Hybrid");
  assert.equal(d.city.value, "Jaipur");
  assert.deepEqual(d.experience.value, { min: "2", max: "4" });
  assert.equal(d.employmentType.value, "full-time");
  // Evidence offsets survive long-line unit splitting.
  const slice = r.source.normalized.slice(d.budget.evidence[0].start, d.budget.evidence[0].end);
  assert.match(slice, /28,000/);
});

test("contact-heavy-apply: contacts never reach How to apply; intents map to requirements", () => {
  const r = parseFixture("contact-heavy-apply.txt");
  const d = r.draft;
  assert.ok(d.applicationSignals.contactLines.length >= 3); // form URL, email, phone
  const publicText = [d.howToApply.value, d.about.value, d.responsibilities.value, d.requirements.value]
    .filter(Boolean)
    .join("\n");
  assert.doesNotMatch(publicText, /forms\.google\.com/);
  assert.doesNotMatch(publicText, /hire@sketchfactory\.in/);
  assert.doesNotMatch(publicText, /98765/);
  assert.deepEqual(
    [...d.applicationSignals.suggestedRequirements].sort(),
    ["expected_rate", "relevant_portfolio", "start_availability"]
  );
  assert.ok(r.warnings.some((w) => w.code === "external-application-routing"));
});

test("not-a-job posts are classified out with reasons, never a hard failure", () => {
  for (const name of ["not-a-job-blog-snippet.txt", "not-a-job-lyrics.txt"]) {
    const r = parseFixture(name);
    assert.equal(r.classification.looksLikeJobPost, false, name);
    assert.ok(r.classification.reasons.length > 0, name);
  }
});

test("mixed-language-hinglish: partial extraction, no crash", () => {
  const r = parseFixture("mixed-language-hinglish.txt");
  const d = r.draft;
  assert.equal(r.classification.looksLikeJobPost, true);
  assert.ok(r.classification.rolesDetected.includes("video editor"));
  assert.deepEqual(d.budget.value, { min: "15000", max: "20000", unit: "per month", intent: "range" });
  assert.ok(d.tools.value.includes("Adobe Premiere Pro"));
});

test("html-pasted: tags are inert text and fields still extract", () => {
  const r = parseFixture("html-pasted.txt");
  const d = r.draft;
  assert.ok(r.classification.rolesDetected.includes("video editor"));
  assert.equal(d.budget.value.min, "30000");
  assert.equal(d.budget.value.unit, "per month");
  assert.equal(d.workMode.value, "Remote");
  // The email inside the anchor is a contact signal, not public text.
  assert.ok(d.applicationSignals.contactLines.length > 0);
});

test("unicode-heavy-whatsapp: zero-width chars and emoji bullets survive", () => {
  const r = parseFixture("unicode-heavy-whatsapp.txt");
  const d = r.draft;
  assert.ok(r.classification.rolesDetected.includes("video editor"));
  assert.deepEqual(d.budget.value, { min: "12000", max: "18000", unit: "per month", intent: "range" });
  assert.deepEqual(d.platforms.value, ["instagram"]);
});

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

const CORPUS = readdirSync(new URL("./fixtures/import-posts/", import.meta.url)).filter((f) =>
  f.endsWith(".txt")
);

test("no-fabrication property: every evidence range slices real source text", () => {
  for (const name of CORPUS) {
    const r = parseFixture(name);
    const text = r.source.normalized;
    const fields = Object.entries(r.draft).filter(([key]) => key !== "applicationSignals");
    for (const [key, extraction] of fields) {
      for (const evidence of extraction.evidence) {
        assert.ok(
          evidence.start >= 0 && evidence.end <= text.length && evidence.end > evidence.start,
          `${name} ${key}: evidence offsets must address the normalized text`
        );
        const slice = text.slice(evidence.start, evidence.end);
        assert.ok(slice.trim().length > 0, `${name} ${key}: evidence slice must be non-empty`);
        assert.ok(
          evidence.snippet.replace(/…/g, "").length > 0,
          `${name} ${key}: snippet must be non-empty`
        );
      }
      // tags aggregate hashtags (no single phrase); category derives its evidence
      // from the title, which can legitimately be missing.
      if (extraction.value !== null && extraction.status !== "missing" && key !== "tags" && key !== "category") {
        assert.ok(
          extraction.evidence.length > 0,
          `${name} ${key}: non-missing values need evidence (status ${extraction.status})`
        );
      }
    }
    for (const evidence of r.draft.applicationSignals.contactLines) {
      const slice = text.slice(evidence.start, evidence.end);
      assert.ok(slice.trim().length > 0, `${name} contactLines slice must be non-empty`);
    }
  }
});

test("duplicate input parses to a stable, identical result", () => {
  const raw = fixture("video-editor-linkedin.txt");
  const once = parseJobPost(raw);
  const twice = parseJobPost(raw);
  assert.deepEqual(once, twice);
  // Pasting the post twice in a row still parses without throwing.
  const doubled = parseJobPost(`${raw}\n\n${raw}`);
  assert.equal(doubled.classification.looksLikeJobPost, true);
});

test("perf gate: pathological 20k input parses in under 80ms", () => {
  const patterns = [
    "₹1,1,1,1,1,1,1,1 ",
    "- - - - - - - - ",
    "aaaaaaaaaaaa: ",
    "20-30k to 40k per month per video ",
    "#tag #tag2 #tag3 ",
  ];
  let pathological = "";
  let i = 0;
  while (pathological.length < MAX_IMPORT_CHARS + 500) {
    pathological += patterns[i % patterns.length];
    if (i % 7 === 0) pathological += "\n";
    i += 1;
  }
  // Warm-up, then measure best-of-3 to reduce machine noise.
  parseJobPost(pathological);
  let best = Infinity;
  for (let run = 0; run < 3; run += 1) {
    const start = performance.now();
    const r = parseJobPost(pathological);
    const elapsed = performance.now() - start;
    best = Math.min(best, elapsed);
    assert.equal(r.source.truncated, true);
  }
  assert.ok(best < 80, `pathological parse took ${best.toFixed(1)}ms (limit 80ms)`);
});

test("fuzz: 200 random-garbage inputs never throw", () => {
  const alphabet =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ₹#@:.-–—/\\|!?()[]{}\n\t'\"$€£%+*&^;,<>~`🎬🚀👉😀é中æ";
  let seed = 42;
  const rand = () => {
    // Deterministic LCG so failures are reproducible.
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  for (let i = 0; i < 200; i += 1) {
    const length = Math.floor(rand() * 3000);
    let s = "";
    for (let j = 0; j < length; j += 1) s += alphabet[Math.floor(rand() * alphabet.length)];
    const r = parseJobPost(s);
    assert.equal(r.version, 1);
  }
});

test("empty and whitespace input produce a calm empty result", () => {
  for (const raw of ["", "   \n\n  ", "\t"]) {
    const r = parseJobPost(raw);
    assert.equal(r.classification.looksLikeJobPost, false);
    assert.equal(r.draft.title.status, "missing");
  }
});
