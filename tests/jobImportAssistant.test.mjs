import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const {
  availableEarlyQuestions,
  earlyAnswerLabel,
  nextEarlyQuestion,
} = await import("../lib/jobImportEarlyQuestions.ts");

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

// The server publishes this set on the draft. Tests use it literally so a change
// in the backend allowlist has to be reflected here deliberately.
// application_mode was removed: applications always run through CreatorJobs,
// so there is no routing decision for a recruiter to make.
const SERVER_ELIGIBLE = ["employer_context_type"];

test("only server-certified fields become questions", () => {
  // A field the server did not certify yields nothing, even if asked for.
  const smuggled = availableEarlyQuestions(["budget_amount", "title"], {}, "pasted_text");
  assert.deepEqual(smuggled, []);

  const legitimate = availableEarlyQuestions(SERVER_ELIGIBLE, {}, "pasted_text");
  assert.deepEqual(
    legitimate.map((question) => question.fieldPath),
    SERVER_ELIGIBLE
  );
});

test("one decision is offered at a time, never a list of everything missing", () => {
  const question = nextEarlyQuestion(SERVER_ELIGIBLE, {}, "pasted_text");
  assert.ok(question);
  assert.equal(typeof question.question, "string");
  // The caller receives a single turn, not a collection to render at once.
  assert.equal(Array.isArray(question), false);
});

test("an answered question does not come back", () => {
  const none = availableEarlyQuestions(
    SERVER_ELIGIBLE,
    { employer_context_type: "creator" },
    "pasted_text"
  );
  assert.deepEqual(none, []);
  assert.equal(
    nextEarlyQuestion(SERVER_ELIGIBLE, { employer_context_type: "creator" }, "pasted_text"),
    null
  );
});

test("every question explains itself and names the candidate consequence", () => {
  for (const question of availableEarlyQuestions(SERVER_ELIGIBLE, {}, "public_url")) {
    assert.ok(question.question.trim().endsWith("?"), "the prompt must be a question");
    assert.ok(question.explanation.length > 40, "explanation must be specific");
    assert.ok(
      /candidate|applicant|they/i.test(question.candidateImpact),
      "impact must be stated in candidate terms"
    );
    assert.ok(question.options.length >= 2);
    for (const option of question.options) {
      assert.ok(option.label.length > 0);
      assert.ok(option.detail.length > 0, "each option explains what it means");
    }
  }
});

test("the explanation names the actual source kind rather than a generic absence", () => {
  const fromUrl = nextEarlyQuestion(SERVER_ELIGIBLE, {}, "public_url");
  const fromPaste = nextEarlyQuestion(SERVER_ELIGIBLE, {}, "pasted_text");
  assert.match(fromUrl.explanation, /public post/i);
  assert.match(fromPaste.explanation, /pasted/i);
  assert.notEqual(fromUrl.explanation, fromPaste.explanation);
});

test("questions never expose an internal field path or the word legacy", () => {
  const questions = availableEarlyQuestions(SERVER_ELIGIBLE, {}, "pasted_text");
  const prose = questions
    .flatMap((question) => [
      question.question,
      question.explanation,
      question.candidateImpact,
      ...question.options.flatMap((option) => [option.label, option.detail]),
    ])
    .join(" ");
  for (const leak of [
    "employer_context_type",
    "field_path",
    "legacy",
    "_min",
    "_max",
  ]) {
    assert.ok(!prose.includes(leak), `copy must not expose "${leak}"`);
  }
});

test("answers are summarised with the product's own label, not the raw value", () => {
  assert.equal(earlyAnswerLabel("employer_context_type", "production_house"), "Production house");
  assert.equal(earlyAnswerLabel("employer_context_type", "agency"), "Agency");
});

test("the assistant surface refuses the vocabulary of the old review dashboard", () => {
  const surfaces = [
    read("components/import-job/assistant/DraftAssistantCanvas.tsx"),
    read("components/import-job/assistant/DraftAssistantRobot.tsx"),
    read("lib/jobImportEarlyQuestions.ts"),
  ].join("\n");

  for (const banned of [
    "Review flagged fields",
    "Needs your review",
    "Optional details not found",
    "Import notes for this section",
    "Review field",
    "Why was this filled?",
    "fields missing",
    "AI failed",
    "errors found",
  ]) {
    assert.ok(
      !surfaces.includes(banned),
      `the redesigned surface must not say "${banned}"`
    );
  }
});

test("ordinary uncertainty is not dressed as an error", () => {
  const canvas = read("components/import-job/assistant/DraftAssistantCanvas.tsx");
  // Amber and red are the product's real-failure colours. A question is not a
  // failure, so the canvas must not reach for them.
  assert.doesNotMatch(canvas, /text-amber|bg-amber|text-red|bg-red|border-red/);
});

test("the robot is decorative to assistive technology but its state is published as text", () => {
  const robot = read("components/import-job/assistant/DraftAssistantRobot.tsx");
  assert.match(robot, /aria-hidden="true"/);
  assert.match(robot, /DRAFT_ASSISTANT_STATE_LABELS/);

  const canvas = read("components/import-job/assistant/DraftAssistantCanvas.tsx");
  // The label is what a screen reader gets instead of the drawing.
  assert.match(canvas, /DRAFT_ASSISTANT_STATE_LABELS\[robotState\]/);
  assert.match(canvas, /aria-live="polite"/);
});

test("every robot state has an announcement", async () => {
  // Labels live in a .ts data module rather than the .tsx drawing precisely so
  // this invariant is testable.
  const { DRAFT_ASSISTANT_STATES, DRAFT_ASSISTANT_STATE_LABELS } = await import(
    "../lib/draftAssistantStates.ts"
  );
  assert.equal(DRAFT_ASSISTANT_STATES.length, 9);
  for (const state of DRAFT_ASSISTANT_STATES) {
    const label = DRAFT_ASSISTANT_STATE_LABELS[state];
    assert.ok(
      typeof label === "string" && label.length > 0,
      `state "${state}" must be announceable`
    );
    // Announcements name the assistant, never the model or the vendor.
    assert.doesNotMatch(label, /openai|gpt|model|ai\b/i);
  }
});

test("assistant motion is disabled under reduced motion, not merely shortened", () => {
  const css = read("app/globals.css");
  const block = css.slice(css.indexOf("Draft assistant"));
  const reduced = block.slice(block.indexOf("prefers-reduced-motion"));
  assert.match(reduced, /animation: none !important/);
  assert.match(reduced, /transition: none !important/);
  for (const selector of [".bea-eye", ".bea-beacon", ".bea-scan", ".bea-head"]) {
    assert.ok(reduced.includes(selector), `${selector} must opt out of motion`);
  }
});

test("the robot owns no timer, so it cannot depict work that is not happening", () => {
  const robot = read("components/import-job/assistant/DraftAssistantRobot.tsx");
  for (const forbidden of ["setInterval", "Date.now", "Math.random"]) {
    assert.ok(!robot.includes(forbidden), `robot must not use ${forbidden}`);
  }
});

test("conversation questions never carry editor-side label qualifiers", () => {
  const turn = read("components/import-job/assistant/ConversationTurn.tsx");
  // "(free text)" and "(legacy)" belong beside a form control, not inside a
  // question the assistant speaks aloud.
  // The label is stripped of any trailing parenthetical before it is spoken.
  assert.ok(turn.includes("importFieldLabel(question.field_path)"));
  assert.ok(turn.includes(".replace("), "the label must be normalised");
  assert.match(turn, /editor-side qualifiers/);
});

test("the conversation turn offers a skip only for optional suggestions", () => {
  const turn = read("components/import-job/assistant/ConversationTurn.tsx");
  // Essential questions must not present a fake escape.
  assert.match(turn, /\{optional \? \(/);
  assert.match(turn, /conversation-skip-remaining/);
});

test("the manual route out is always available while the assistant is asking", () => {
  const canvas = read("components/import-job/assistant/DraftAssistantCanvas.tsx");
  assert.match(canvas, /conversation-continue-manually/);
  assert.match(canvas, /!conversation\.ready_for_draft/);
});

test("the handoff is an explicit action, never automatic", () => {
  const canvas = read("components/import-job/assistant/DraftAssistantCanvas.tsx");
  // Completion renders a button; nothing navigates on its own.
  assert.match(canvas, /ConversationComplete/);
  const turn = read("components/import-job/assistant/ConversationTurn.tsx");
  assert.match(turn, /conversation-open-draft/);
  assert.doesNotMatch(turn, /router\.(push|replace)/);
});

// ---------------------------------------------------------------------------
// Suggested answers, and the question that no longer exists
// ---------------------------------------------------------------------------

test("applications always run through CreatorJobs, so it is never asked", async () => {
  const { answerOptionsFor } = await import("../lib/jobImportAnswerOptions.ts");
  const early = read("lib/jobImportEarlyQuestions.ts");

  // There is no routing decision to make, so there is no question to ask.
  assert.doesNotMatch(early, /application_mode/);
  assert.deepEqual(answerOptionsFor("application_mode"), []);
  assert.deepEqual(answerOptionsFor("external_apply_url"), []);
});

test("fields with a known shape offer answers instead of an empty box", async () => {
  const { answerOptionsFor, hasAnswerOptions } = await import(
    "../lib/jobImportAnswerOptions.ts"
  );
  for (const field of [
    "work_mode",
    "compensation_mode",
    "budget_currency",
    "trial_status",
    "revision_policy",
    "start_timeframe",
    "engagement_type",
    "duration_type",
    "creative_autonomy",
    "expected_weekly_hours_min",
    "budget_unit",
    "turnaround_unit",
  ]) {
    assert.ok(hasAnswerOptions(field), `${field} should offer options`);
    for (const option of answerOptionsFor(field)) {
      assert.ok(option.value.length > 0, `${field} option needs a value`);
      assert.ok(option.label.length > 0, `${field} option needs a label`);
    }
  }
});

test("genuinely open fields stay free text rather than being guessed at", async () => {
  const { answerOptionsFor } = await import("../lib/jobImportAnswerOptions.ts");
  // A menu of reference links or channel descriptions would be invention.
  for (const field of [
    "reference_videos",
    "about_channel",
    "responsibilities",
    "requirements",
    "budget_amount",
    "title",
  ]) {
    assert.deepEqual(answerOptionsFor(field), [], `${field} must stay free text`);
  }
});

test("compensation units are ordered by what the role is actually paid in", async () => {
  const { answerOptionsFor } = await import("../lib/jobImportAnswerOptions.ts");
  const forDesigner = answerOptionsFor("budget_unit", { roleName: "Thumbnail Designer" });
  const forWriter = answerOptionsFor("budget_unit", { roleName: "Scriptwriter" });
  const forPodcast = answerOptionsFor("budget_unit", { roleName: "Podcast Editor" });

  assert.equal(forDesigner[0].value, "per thumbnail");
  assert.equal(forWriter[0].value, "per script");
  assert.equal(forPodcast[0].value, "per episode");
  // No duplicates once the role-specific units merge with the common ones.
  const values = forDesigner.map((option) => option.value);
  assert.equal(new Set(values).size, values.length);
});

test("engagement options come from the shared taxonomy, not a local copy", async () => {
  const { answerOptionsFor } = await import("../lib/jobImportAnswerOptions.ts");
  const { ENGAGEMENT_TYPES } = await import("../lib/jobContract.ts");
  assert.deepEqual(
    answerOptionsFor("engagement_type").map((option) => option.value),
    [...ENGAGEMENT_TYPES]
  );
});

test("the progress bar is one continuous track, not a row of chunks", () => {
  const canvas = read("components/import-job/assistant/DraftAssistantCanvas.tsx");
  // Segmented chunks read as a checklist the recruiter has to work through.
  assert.doesNotMatch(canvas, /stages\.map\(\(stage\) => \(/);
  assert.match(canvas, /absolute inset-y-0 left-0 rounded-full/);
  assert.match(canvas, /style=\{\{ width: `\$\{Math\.max\(percent, 2\)\}%` \}\}/);
  // The sweep marks in-flight work without advancing the earned width.
  assert.match(canvas, /bea-progress-sweep/);
});

test("the progress sweep stops under reduced motion", () => {
  const css = read("app/globals.css");
  const block = css.slice(css.indexOf("bea-progress-sweep"));
  assert.match(block, /prefers-reduced-motion[\s\S]*bea-progress-sweep[\s\S]*animation: none/);
});

test("asked fields get spoken phrasing, not a form label in a sentence", async () => {
  const { questionPhraseFor } = await import("../lib/jobImportAnswerOptions.ts");

  // "Earlier start window" is a registry label written to sit beside an input.
  // Templated into "What should {label} be?" it produced a question no person
  // would ask.
  const start = questionPhraseFor("start_timeframe");
  assert.ok(start);
  assert.doesNotMatch(start.heading, /earlier start window/i);
  assert.match(start.heading, /when should/i);

  for (const field of [
    "work_mode",
    "budget_currency",
    "budget_unit",
    "compensation_mode",
    "trial_status",
    "engagement_type",
    "requirements",
    "reference_videos",
  ]) {
    const phrase = questionPhraseFor(field);
    assert.ok(phrase, `${field} needs spoken phrasing`);
    assert.ok(phrase.heading.trim().endsWith("?"), `${field} must read as a question`);
    // No internal vocabulary reaches the recruiter.
    for (const leak of ["_", "legacy", "field"]) {
      assert.ok(!phrase.heading.toLowerCase().includes(leak), `${field}: "${leak}"`);
    }
  }
});

test("an unmapped field still falls back rather than breaking", async () => {
  const { questionPhraseFor } = await import("../lib/jobImportAnswerOptions.ts");
  assert.equal(questionPhraseFor("some_unmapped_field"), null);
});
