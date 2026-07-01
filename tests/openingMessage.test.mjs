import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  buildOpeningMessageBody,
  getDefaultApplicationOpeningMessage,
  getDefaultHiringRequestOpeningMessage,
  resolveJobChannelName,
  resolveTalentDisplayName,
  selectOpeningMessageTemplate,
  stableHash,
} from "../lib/openingMessage.ts";
import { JOBS } from "../lib/jobs.ts";

// The inbox opening message must never look blank: applications / hiring requests
// always carry a natural opening line (a provided fit note, otherwise a rotated,
// personalised default). Behaviour is exercised through the pure helper; the
// submit + render wiring is guarded with source assertions (repo convention).

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (relPath) => readFileSync(join(repoRoot, relPath), "utf8");

// The exact templates from spec, used for membership checks.
const JOB_WITH_CHANNEL = [
  "Hi, I came across the listing and would love to work for {c}.",
  "Hi, this looks like a good fit. I'd be glad to help with work for {c}.",
  "Hi, I'm interested in this role and would like to be considered for work with {c}.",
  "Hi, I'd be happy to help with the work you're hiring for at {c}.",
  "Hi, I came across the role and think I could be a good fit for {c}.",
];
const JOB_FALLBACK = [
  "Hi, I came across the listing and would love to be considered.",
  "Hi, this looks like a good fit. I'd be glad to help with the work.",
  "Hi, I'm interested in this role and would like to be considered.",
  "Hi, I'd be happy to help with the work you're hiring for.",
  "Hi, I came across the role and think I could be a good fit.",
];
const TALENT_WITH_NAME = [
  "Hi {n}, I came across your listing and would like to discuss working with you.",
  "Hi {n}, your listing looks relevant for what we need. I'd like to talk about working together.",
  "Hi {n}, I liked your listing and would be interested in hiring you.",
  "Hi {n}, I think your work could be a good fit for what we're looking for.",
  "Hi {n}, I came across your profile and would like to explore working together.",
];
const TALENT_FALLBACK = [
  "Hi, I came across your listing and would like to discuss working with you.",
  "Hi, your listing looks relevant for what we need. I'd like to talk about working together.",
  "Hi, I liked your listing and would be interested in hiring you.",
  "Hi, I think your work could be a good fit for what we're looking for.",
  "Hi, I came across your profile and would like to explore working together.",
];

// ── Job application opening messages (1–8) ────────────────────────────────────

test("job: a default is generated when there are answers but no fit note", () => {
  const body = buildOpeningMessageBody({ context: "job", recipientName: "Tech Channel", seed: "a" });
  assert.ok(body.trim().length > 0, "job application body must not be blank");
});

test("job: the channel name is used when available", () => {
  const body = getDefaultApplicationOpeningMessage("Tech Channel", "seed-7");
  assert.ok(body.includes("Tech Channel"), "channel name should appear in the message");
  assert.ok(!body.includes("{channelName}"), "the placeholder must be substituted");
  const expected = JOB_WITH_CHANNEL.map((t) => t.replace("{c}", "Tech Channel"));
  assert.ok(expected.includes(body), "must be one of the channel templates");
});

test("job: reads like working FOR the channel, never 'Hi [channel] team'", () => {
  for (let i = 0; i < 25; i += 1) {
    const body = getDefaultApplicationOpeningMessage("Tech Channel", `seed-${i}`);
    assert.ok(!/Tech Channel team/i.test(body), `must not address the channel as a team: ${body}`);
  }
});

test("job: the agency name is never used when an agency posts for a channel", () => {
  // Agency posted, no channel name, only a hiring display name → no confident
  // channel, so the no-channel fallback is used (agency name never leaks).
  const resolved = resolveJobChannelName({
    channel: { name: "" },
    hiringDisplayName: "Bright Media Agency",
    postedByAgency: true,
  });
  assert.equal(resolved, null);
  const body = buildOpeningMessageBody({
    context: "job",
    recipientName: resolved,
    seed: "agency",
  });
  assert.ok(!body.includes("Bright Media Agency"), "agency name must not appear");
  assert.ok(JOB_FALLBACK.includes(body), "must fall back to a no-channel default");
});

test("job: the real channel is preferred even when an agency manages it", () => {
  const resolved = resolveJobChannelName({
    channel: { name: "Finance Channel" },
    postedByAgency: true,
  });
  assert.equal(resolved, "Finance Channel");
});

test("job: the generic 'Content creator' placeholder is treated as no channel", () => {
  assert.equal(resolveJobChannelName({ channel: { name: "Content creator" } }), null);
  const body = buildOpeningMessageBody({ context: "job", recipientName: "Content creator", seed: "x" });
  assert.ok(JOB_FALLBACK.includes(body), "placeholder name falls back to no-channel copy");
});

test("job: defaults never mention attached requirements/details", () => {
  const all = [...JOB_WITH_CHANNEL, ...JOB_FALLBACK].map((t) => t.replace("{c}", "Tech Channel"));
  for (const body of all) {
    for (const forbidden of ["attach", "requirement", "below", "please find", "details"]) {
      assert.ok(!body.toLowerCase().includes(forbidden), `template hints at attachments: "${body}"`);
    }
  }
});

test("job: rotation varies across records but is stable on re-render", () => {
  const outputs = new Set();
  for (let i = 0; i < 30; i += 1) {
    outputs.add(getDefaultApplicationOpeningMessage("Tech Channel", `job:${i}:owner`));
  }
  assert.ok(outputs.size >= 3, "rotation should cover multiple templates");
  // Same seed → identical output every time (no flicker on re-render).
  const seed = "job-1:applicant-9:owner-2";
  assert.equal(
    getDefaultApplicationOpeningMessage("Tech Channel", seed),
    getDefaultApplicationOpeningMessage("Tech Channel", seed)
  );
});

// ── Acceptance: real job cards resolve to their visible channel name ──────────
// These run against the actual mock jobs (lib/jobs.ts) — the same objects the
// job card renders and the apply panel receives — so they prove the generated
// opening message uses the card-visible channel, not a generic fallback.

test("acceptance: applying to the 'Indie Gamer' card generates a message naming Indie Gamer", () => {
  const job = JOBS.find((j) => j.channel?.name === "Indie Gamer");
  assert.ok(job, "the Indie Gamer mock job must exist");
  assert.equal(resolveJobChannelName(job), "Indie Gamer");
  const body = buildOpeningMessageBody({
    context: "job",
    recipientName: resolveJobChannelName(job),
    seed: `${job.id}:applicant:owner`,
  });
  assert.ok(body.includes("Indie Gamer"), `message must name the channel: "${body}"`);
  // Must not be no-channel copy.
  assert.ok(!JOB_FALLBACK.includes(body), "must not fall back to generic copy");
});

test("acceptance: applying to the 'Money & Mindset' card generates a message naming Money & Mindset", () => {
  const job = JOBS.find((j) => j.channel?.name === "Money & Mindset");
  assert.ok(job, "the Money & Mindset mock job must exist");
  assert.equal(resolveJobChannelName(job), "Money & Mindset");
  const body = buildOpeningMessageBody({
    context: "job",
    recipientName: resolveJobChannelName(job),
    seed: `${job.id}:applicant:owner`,
  });
  assert.ok(body.includes("Money & Mindset"), `message must name the channel: "${body}"`);
  assert.ok(!JOB_FALLBACK.includes(body), "must not fall back to generic copy");
});

test("acceptance: every mock job with a real channel name resolves it (none fall back)", () => {
  const named = JOBS.filter((j) => {
    const n = (j.channel?.name || "").trim();
    return n && n.toLowerCase() !== "content creator";
  });
  assert.ok(named.length > 0, "there should be mock jobs with real channel names");
  for (const job of named) {
    assert.equal(
      resolveJobChannelName(job),
      job.channel.name,
      `card-visible channel "${job.channel.name}" must resolve, not fall back`
    );
  }
});

test("resolver reads nested channel aliases (title / displayName) defensively", () => {
  assert.equal(resolveJobChannelName({ channel: { title: "Brand Studio" } }), "Brand Studio");
  assert.equal(resolveJobChannelName({ channel: { displayName: "Studio X" } }), "Studio X");
  assert.equal(resolveJobChannelName({ channelName: "Top-Level Channel" }), "Top-Level Channel");
  // channel.name still wins over the aliases.
  assert.equal(
    resolveJobChannelName({ channel: { name: "Primary", title: "Secondary" } }),
    "Primary"
  );
});

// ── Fit note override (1–4) ───────────────────────────────────────────────────

test("fit note: a provided fit note becomes the message body verbatim", () => {
  const fit = "I already edit in your niche, so I can match the pacing from day one.";
  const body = buildOpeningMessageBody({ context: "job", recipientName: "Tech Channel", fitNote: fit, seed: "s" });
  assert.equal(body, fit);
});

test("fit note: no default is prepended above the fit note", () => {
  const fit = "Here is why I'm a great fit.";
  const body = buildOpeningMessageBody({ context: "talent", recipientName: "Aarav", fitNote: fit, seed: "s" });
  assert.equal(body, fit, "the body is exactly the fit note, nothing else");
});

test("fit note: a blank/whitespace fit note falls through to a generated default", () => {
  const body = buildOpeningMessageBody({ context: "job", recipientName: "Tech Channel", fitNote: "   ", seed: "s" });
  assert.ok(body.includes("Tech Channel"));
});

test("fit note: the inbox drops the fit note from the details when it is the body", () => {
  const source = read("components/you/ApplicationsWorkspace.tsx");
  // The dedup only removes fit_note when the body equals the fit note, and only
  // the fit_note key is stripped (other answers still render below).
  assert.match(source, /openingBody\.trim\(\) === fitNote/);
  assert.match(source, /key !== "fit_note"/);
});

// ── Hiring request opening messages (1–7) ─────────────────────────────────────

test("hiring: a default is generated when there are answers but no fit note", () => {
  const body = buildOpeningMessageBody({ context: "talent", recipientName: "Aarav", seed: "h" });
  assert.ok(body.trim().length > 0, "hiring request body must not be blank");
});

test("hiring: the talent name is used when available", () => {
  const body = getDefaultHiringRequestOpeningMessage("Aarav", "seed-3");
  assert.ok(body.startsWith("Hi Aarav,"), `should greet the talent by name: ${body}`);
  assert.ok(!body.includes("{talentName}"));
  const expected = TALENT_WITH_NAME.map((t) => t.replace("{n}", "Aarav"));
  assert.ok(expected.includes(body));
});

test("hiring: defaults never reference 'this project'", () => {
  const all = [...TALENT_WITH_NAME, ...TALENT_FALLBACK].map((t) => t.replace("{n}", "Aarav"));
  for (const body of all) {
    assert.ok(!/this project/i.test(body), `must not say 'this project': "${body}"`);
  }
});

test("hiring: defaults carry no creator-economy language", () => {
  const all = [...TALENT_WITH_NAME, ...TALENT_FALLBACK].map((t) => t.replace("{n}", "Aarav"));
  for (const body of all) {
    for (const forbidden of ["creator", "creator-native", "creator economy"]) {
      assert.ok(!body.toLowerCase().includes(forbidden), `creator-work language leaked: "${body}"`);
    }
  }
});

test("hiring: the talent display name resolves with sensible fallbacks", () => {
  assert.equal(resolveTalentDisplayName({ owner_display_name: "Aarav Mehta" }), "Aarav Mehta");
  assert.equal(resolveTalentDisplayName({ name: "Priya" }), "Priya");
  assert.equal(resolveTalentDisplayName({ owner_username: "sana_k" }), "sana_k");
  // Generic placeholder is treated as no name.
  assert.equal(resolveTalentDisplayName({ name: "Talent" }), null);
  const body = buildOpeningMessageBody({ context: "talent", recipientName: "Talent", seed: "s" });
  assert.ok(TALENT_FALLBACK.includes(body), "placeholder name falls back to no-name copy");
});

test("hiring: no blank bubble — a body is always produced", () => {
  assert.ok(buildOpeningMessageBody({ context: "talent", recipientName: null, seed: "s" }).length > 0);
  assert.ok(buildOpeningMessageBody({ context: "talent", recipientName: "Aarav", seed: "s" }).length > 0);
});

test("hiring: rotation varies across records but is stable on re-render", () => {
  const outputs = new Set();
  for (let i = 0; i < 30; i += 1) {
    outputs.add(getDefaultHiringRequestOpeningMessage("Aarav", `listing:${i}:requester`));
  }
  assert.ok(outputs.size >= 3);
  const seed = "listing-4:requester-1";
  assert.equal(
    getDefaultHiringRequestOpeningMessage("Aarav", seed),
    getDefaultHiringRequestOpeningMessage("Aarav", seed)
  );
});

// ── Regression (1–7) ──────────────────────────────────────────────────────────

test("regression: stableHash is deterministic and non-negative", () => {
  assert.equal(stableHash("abc"), stableHash("abc"));
  assert.notEqual(stableHash("abc"), stableHash("abd"));
  for (const seed of ["", "x", "a-very-long-seed-value:1:2:3", "🙂"]) {
    const h = stableHash(seed);
    assert.ok(Number.isInteger(h) && h >= 0, `hash must be a non-negative integer for "${seed}"`);
  }
});

test("regression: selectOpeningMessageTemplate stays within bounds and handles empty", () => {
  assert.equal(selectOpeningMessageTemplate([], "seed"), "");
  for (let i = 0; i < 50; i += 1) {
    assert.ok(JOB_FALLBACK.includes(selectOpeningMessageTemplate(JOB_FALLBACK, `s${i}`)));
  }
});

test("regression: the inbox only generates a fallback body for blank records with answers", () => {
  const source = read("components/you/ApplicationsWorkspace.tsx");
  // Generation is gated on an empty stored body AND structured answers being
  // present, so normal messages and blank records without answers are untouched.
  assert.match(source, /if \(!openingBody\.trim\(\) && rawAnswers\)/);
  // Responses and replies are still flattened verbatim (normal chat unchanged).
  assert.match(source, /id: `\$\{item\.id\}-response`/);
  assert.match(source, /id: `\$\{item\.id\}-reply-\$\{index\}`/);
});

test("regression: requirement details render below the message body, not above", () => {
  const source = read("components/you/ApplicationsWorkspace.tsx");
  const bubbleBody = source.indexOf("{message.body ? <p");
  const summary = source.indexOf("<FirstMessageSummary");
  assert.ok(bubbleBody > -1 && summary > -1, "both the body and the details renderer must exist");
  assert.ok(summary > bubbleBody, "FirstMessageSummary must come after the message body");
});

test("regression: no wrapper/heading label is introduced around the details", () => {
  const source = read("components/you/ApplicationsWorkspace.tsx");
  for (const forbidden of ["Requirements", "Required details", "Application details", "Attached details", "First-message requirements"]) {
    assert.ok(!source.includes(`>${forbidden}<`), `must not add a "${forbidden}" heading`);
  }
});

test("regression: job submit stores a generated body and gates the fit-note override on the requirement", () => {
  const source = read("components/job-details/JobActionsPanelClient.tsx");
  assert.match(source, /buildOpeningMessageBody\(\{/);
  assert.match(source, /resolveJobChannelName\(job\)/);
  assert.match(source, /requirementKeys\.includes\("fit_note"\)/);
  assert.match(source, /cover_note: coverNote/);
  // No longer sends an empty cover note.
  assert.ok(!/cover_note: "",/.test(source), "must not submit a blank cover note");
});

test("regression: talent submit stores a generated body personalised by the talent name", () => {
  const client = read("components/TalentListingActionsClient.tsx");
  assert.match(client, /buildOpeningMessageBody\(\{/);
  assert.match(client, /recipientName: talentName/);
  assert.match(client, /keys\.includes\("fit_note"\)/);
  // The note argument is the generated body, not an empty string.
  assert.match(client, /sendTalentInterest\(\s*token,\s*listingId,\s*note,/);
  // The talent page feeds the resolved display name in.
  const page = read("app/talent/[id]/page.tsx");
  assert.match(page, /talentName=\{name\}/);
});
