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
const SERVER_ELIGIBLE = ["application_mode", "employer_context_type"];

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
  const remaining = availableEarlyQuestions(
    SERVER_ELIGIBLE,
    { application_mode: "internal" },
    "pasted_text"
  );
  assert.deepEqual(
    remaining.map((question) => question.fieldPath),
    ["employer_context_type"]
  );

  const none = availableEarlyQuestions(
    SERVER_ELIGIBLE,
    { application_mode: "internal", employer_context_type: "creator" },
    "pasted_text"
  );
  assert.deepEqual(none, []);
  assert.equal(
    nextEarlyQuestion(
      SERVER_ELIGIBLE,
      { application_mode: "internal", employer_context_type: "creator" },
      "pasted_text"
    ),
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
    "application_mode",
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
  assert.equal(earlyAnswerLabel("application_mode", "internal"), "Apply on CreatorJobs");
  assert.equal(earlyAnswerLabel("employer_context_type", "production_house"), "Production house");
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
