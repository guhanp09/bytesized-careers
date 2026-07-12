import test from "node:test";
import assert from "node:assert/strict";

import { parseJobPost } from "../lib/importJob/parseJobPost.ts";

const BASE = "Hiring a video editor.\n";

test("full-time is detected and supplies a per-month hint (+ note) without an explicit unit", () => {
  const d = parseJobPost(`${BASE}Full-time role. Compensation: ₹40,000`).draft;
  assert.equal(d.employmentType.status, "imported");
  assert.equal(d.employmentType.value, "full-time");
  assert.equal(d.budget.value.unit, "per month");
  assert.match(d.employmentType.note, /we set the budget to per month/);
});

test("retainer maps like full-time; freelance/contract hint per project", () => {
  assert.equal(parseJobPost(`${BASE}Monthly retainer. Budget ₹30,000 per month`).draft.employmentType.value, "retainer");
  assert.equal(parseJobPost(`${BASE}Freelance basis. Budget ₹9,000`).draft.budget.value.unit, "per project");
  assert.equal(parseJobPost(`${BASE}Contract role. Budget ₹9,000`).draft.employmentType.value, "contract");
});

test("unit hint is suppressed when the post states an explicit compensation unit", () => {
  const d = parseJobPost(`${BASE}Full-time. Budget: ₹50,000 per project`).draft;
  assert.equal(d.budget.value.unit, "per project");
  assert.doesNotMatch(d.employmentType.note ?? "", /we set the budget/);
});

test("part-time and internship are unsupported but preserved with a warning", () => {
  for (const [phrase, value] of [
    ["This is a part-time role.", "part-time"],
    ["Internship for students.", "internship"],
  ]) {
    const r = parseJobPost(`${BASE}${phrase}`);
    assert.equal(r.draft.employmentType.status, "unsupported", phrase);
    assert.equal(r.draft.employmentType.value, value, phrase);
    assert.ok(r.warnings.some((w) => w.code === "engagement-type-unsupported"), phrase);
  }
});

test("employment words never set work mode", () => {
  for (const phrase of ["Full-time role.", "Freelance work.", "Retainer basis.", "Internship."]) {
    const d = parseJobPost(`${BASE}${phrase}`).draft;
    assert.equal(d.workMode.status, "missing", phrase);
  }
});

test("'internal' never matches 'intern' (exact matching)", () => {
  const d = parseJobPost(`${BASE}You'll work with our internal review process.`).draft;
  assert.equal(d.employmentType.status, "missing");
});

test("first mention wins; other mentions are noted", () => {
  const d = parseJobPost(`${BASE}Full-time preferred, freelance possible.`).draft;
  assert.equal(d.employmentType.value, "full-time");
  assert.match(d.employmentType.note, /freelance/);
});

test("missing when the post says nothing about engagement", () => {
  const d = parseJobPost(`${BASE}Edit two videos a week.`).draft;
  assert.equal(d.employmentType.status, "missing");
});
