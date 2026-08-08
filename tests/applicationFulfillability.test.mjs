/**
 * Every requirement a recruiter can select, a candidate must be able to satisfy.
 *
 * A selected requirement that no control can answer is worse than a missing
 * feature: the recruiter believes they asked for something, the candidate is
 * given no way to provide it, and neither of them is told. This project has
 * shipped that exact defect once already — `reference_links` was emitted for a
 * job, silently discarded by the job-side sanitizer, and so was never asked and
 * never received.
 *
 * The chain has four links and a break in any of them produces the same silence:
 *
 *   registry says the key is selectable for a job
 *     → a control exists that can answer its answer type
 *       → validation knows whether the answer is complete
 *         → a complete answer actually passes
 *
 * So the cases are derived from the registry rather than written down. A key
 * added tomorrow is covered tomorrow, and a key whose control was never built
 * fails here rather than in front of an applicant.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (
        (specifier.startsWith("./") || specifier.startsWith("../")) &&
        !/\.[a-z0-9]+$/i.test(specifier)
      ) {
        return nextResolve(`${specifier}.ts`, context);
      }
      throw error;
    }
  },
});

const {
  CUSTOM_INSTRUCTION_REQUIREMENT_KEY,
  isAnswerComplete,
  requirementsForContext,
  sanitizeRequirementKeys,
  validateAnswers,
} = await import("../lib/firstMessageRequirements.ts");

const JOB_REQUIREMENTS = requirementsForContext("job");
const FIELDS_SOURCE = read("components/first-message/FirstMessageFields.tsx");

/** A complete, valid answer for each answer type the job side can ask for. */
const ANSWER_FOR = {
  currency: { amount: "5000", unit: "per month", currency: "INR" },
  turnaround: { value: "3", unit: "days" },
  portfolio: [{ id: "p1", title: "SENTINEL_PORTFOLIO_A1", url: "https://example.invalid/a" }],
  tools: ["CapCut", "SENTINEL_TOOL_B2"],
  availability: "SENTINEL_HOURS_C3 — 10 hours a week",
  startDate: "SENTINEL_START_D4 — from 1 September",
  experience: "SENTINEL_EXPERIENCE_E5 — four years of short-form editing",
  longText: "SENTINEL_NOTE_F6 — why this role fits what I do",
  link: "https://example.invalid/link",
  multiLink: ["https://example.invalid/one"],
  select: "option",
};

test("the job-selectable set is exactly what a job can ask for", () => {
  const keys = JOB_REQUIREMENTS.map((def) => def.key);

  // Derived from the registry, then compared against an independently written
  // expectation — so a key silently added or removed shows up as a failure
  // rather than as a change nobody reviewed.
  assert.deepEqual(
    [...keys].sort(),
    [
      "custom_instruction",
      "expected_rate",
      "fit_note",
      "relevant_experience",
      "relevant_portfolio",
      "start_availability",
      "tools_workflow",
      "turnaround",
      "working_hours",
    ],
    "the job requirement set changed; confirm every new key is fulfillable"
  );
});

test("a talent-only key is never accepted for a job", () => {
  // `reference_links` is talent-only. Emitting it for a job produced a
  // requirement the sanitizer discarded, so the candidate was never asked and
  // the recruiter never received it — a phantom selection.
  assert.deepEqual(
    sanitizeRequirementKeys(["relevant_portfolio", "reference_links"], "job"),
    ["relevant_portfolio"]
  );
});

test("every job answer type has a control that can answer it", () => {
  for (const def of JOB_REQUIREMENTS) {
    if (def.key === CUSTOM_INSTRUCTION_REQUIREMENT_KEY) continue;

    const rendered =
      FIELDS_SOURCE.includes(`def.answerType === "${def.answerType}"`) ||
      // longText and experience share the multiline branch.
      (["longText", "experience"].includes(def.answerType) &&
        FIELDS_SOURCE.includes('def.answerType === "longText"'));

    assert.ok(
      rendered,
      `${def.key} has answer type ${def.answerType} and no control renders it`
    );
  }
});

test("a complete answer is recognised as complete for every job requirement", () => {
  for (const def of JOB_REQUIREMENTS) {
    const answer = ANSWER_FOR[def.answerType];
    assert.ok(answer !== undefined, `no test answer for ${def.answerType}`);

    assert.ok(
      isAnswerComplete(def, answer),
      `${def.key} (${def.answerType}) rejected a complete answer`
    );
  }
});

test("a missing answer is recognised as missing for every job requirement", () => {
  for (const def of JOB_REQUIREMENTS) {
    // The negative half matters as much: a requirement that accepts nothing is
    // required only visually, and the candidate is told they answered it.
    assert.equal(
      isAnswerComplete(def, undefined),
      false,
      `${def.key} treated an unanswered requirement as answered`
    );
  }
});

test("an empty answer is not mistaken for a real one", () => {
  const EMPTY = {
    currency: { amount: "", unit: "", currency: "" },
    turnaround: { value: "", unit: "days" },
    portfolio: [],
    tools: [],
    availability: "   ",
    startDate: "",
    experience: "  ",
    longText: "",
    link: "",
    multiLink: [],
    select: "",
  };
  for (const def of JOB_REQUIREMENTS) {
    assert.equal(
      isAnswerComplete(def, EMPTY[def.answerType]),
      false,
      `${def.key} accepted an empty ${def.answerType} answer`
    );
  }
});

test("validation reports exactly the requirements left unanswered", () => {
  const keys = JOB_REQUIREMENTS.map((def) => def.key);

  // Returns a map of key -> message. Every unanswered requirement must have
  // one, because a requirement that reports no error is one the candidate is
  // told they satisfied without providing anything.
  const none = validateAnswers(keys, "job", {});
  assert.deepEqual(
    Object.keys(none).sort(),
    [...keys].sort(),
    "unanswered requirements were not all reported"
  );

  const all = Object.fromEntries(
    JOB_REQUIREMENTS.map((def) => [def.key, ANSWER_FOR[def.answerType]])
  );
  const complete = validateAnswers(keys, "job", all);
  assert.deepEqual(
    Object.keys(complete),
    [],
    `a fully answered application was reported as incomplete: ${JSON.stringify(complete)}`
  );
});

test("every generated requirement subset is satisfiable", () => {
  // 500+ subsets: each key alone, every pair, and seeded random combinations.
  const keys = JOB_REQUIREMENTS.map((def) => def.key);
  const subsets = [];
  for (const key of keys) subsets.push([key]);
  for (let i = 0; i < keys.length; i += 1) {
    for (let j = i + 1; j < keys.length; j += 1) subsets.push([keys[i], keys[j]]);
  }
  let seed = 20260808;
  while (subsets.length < 500) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    const subset = keys.filter((_, index) => (seed >> index) & 1);
    if (subset.length) subsets.push(subset);
  }
  subsets.push([...keys]);

  for (const subset of subsets) {
    const answers = Object.fromEntries(
      subset.map((key) => [
        key,
        ANSWER_FOR[JOB_REQUIREMENTS.find((def) => def.key === key).answerType],
      ])
    );
    const result = validateAnswers(subset, "job", answers);

    assert.deepEqual(
      Object.keys(result),
      [],
      `subset ${subset.join("+")} could not be satisfied: ${JSON.stringify(result)}`
    );
  }

  assert.ok(subsets.length >= 500, subsets.length);
});
