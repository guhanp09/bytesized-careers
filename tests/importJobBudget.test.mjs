import test from "node:test";
import assert from "node:assert/strict";

import { parseJobPost } from "../lib/importJob/parseJobPost.ts";

const budgetOf = (text) => parseJobPost(text).draft.budget;
const warningsOf = (text) => parseJobPost(text).warnings.map((w) => w.code);

const BASE = "Hiring a video editor for our YouTube channel.\n";

test("monthly range with currency and unit", () => {
  const b = budgetOf(`${BASE}Pay: ₹20,000–₹30,000/month`);
  assert.deepEqual(b.value, { min: "20000", max: "30000", unit: "per month", intent: "range" });
  assert.equal(b.status, "imported");
});

test("informal 'Rs 20k to 30k pm' range", () => {
  const b = budgetOf(`${BASE}Rs 20k to 30k pm`);
  assert.deepEqual(b.value, { min: "20000", max: "30000", unit: "per month", intent: "range" });
});

test("k-suffix distributes across a range (20-30k)", () => {
  const b = budgetOf(`${BASE}Budget: 20-30k per month`);
  assert.deepEqual(b.value, { min: "20000", max: "30000", unit: "per month", intent: "range" });
});

test("single per-project amount becomes a reviewed min=max range", () => {
  const b = budgetOf(`${BASE}₹15k per project`);
  assert.equal(b.status, "review");
  assert.deepEqual(b.value, { min: "15000", max: "15000", unit: "per project", intent: "range" });
  assert.match(b.note, /minimum and maximum/);
});

test("salary context without a unit defaults to monthly", () => {
  const b = budgetOf(`${BASE}Salary: 25k`);
  assert.equal(b.value.unit, "per month");
  assert.equal(b.value.min, "25000");
  assert.equal(b.status, "review"); // single amount
});

test("annual LPA is never converted — empty amounts, hint only in the note", () => {
  const post = `${BASE}Compensation is 3–3.6 LPA.`;
  const b = budgetOf(post);
  assert.equal(b.status, "review");
  assert.equal(b.value.min, "");
  assert.equal(b.value.max, "");
  assert.match(b.note, /annual compensation/i);
  assert.match(b.note, /₹25,000–₹30,000 if treated as monthly/);
  assert.ok(warningsOf(post).includes("annual-compensation"));
});

test("CTC context reads as annual, not monthly", () => {
  const post = `${BASE}CTC 4 LPA`;
  const b = budgetOf(post);
  assert.equal(b.value.min, "");
  assert.ok(warningsOf(post).includes("annual-compensation"));
});

test("per-video pay is coerced to per project with a warning", () => {
  const post = `${BASE}₹500 per video`;
  const b = budgetOf(post);
  assert.equal(b.status, "review");
  assert.deepEqual(b.value, { min: "500", max: "500", unit: "per project", intent: "range" });
  assert.ok(warningsOf(post).includes("per-unit-coerced"));
});

test("digit-adjacent lakh suffix (1.5L) scales; spaced 'l' does not", () => {
  const b = budgetOf(`${BASE}Budget: ₹1.5L per month`);
  assert.equal(b.value.min, "150000");
});

test("'DM your rates' maps to contact-for-pricing", () => {
  const b = budgetOf(`${BASE}DM your rates to apply.`);
  assert.equal(b.status, "imported");
  assert.deepEqual(b.value, { min: "", max: "", unit: "per project", intent: "contact" });
});

test("'negotiable' and 'depends on experience' map to contact-for-pricing", () => {
  for (const phrase of ["Rates negotiable.", "Budget depends on experience."]) {
    const b = budgetOf(`${BASE}${phrase}`);
    assert.equal(b.value.intent, "contact", phrase);
  }
});

test("'flexible budget' maps to the flexible intent", () => {
  const b = budgetOf(`${BASE}Flexible budget for the right person.`);
  assert.equal(b.value.intent, "flexible");
});

test("foreign currency is unsupported and never converted", () => {
  for (const money of ["$500/month", "USD 800 per month", "€600 monthly", "£450 per month"]) {
    const post = `${BASE}Pay: ${money}`;
    const b = budgetOf(post);
    assert.equal(b.status, "unsupported", money);
    assert.equal(b.value, null, money);
    assert.ok(warningsOf(post).includes("non-inr-currency"), money);
  }
});

test("two distinct amounts in different lines become a conflict", () => {
  const post = `${BASE}Pay: ₹25,000 per month\nAlso doing one-off edits at ₹800 per video.`;
  const b = budgetOf(post);
  assert.equal(b.status, "conflict");
  assert.equal(b.value.min, "25000");
  assert.ok(b.alternatives.length >= 1);
  assert.ok(warningsOf(post).includes("multiple-budgets"));
});

test("subscriber counts are never money", () => {
  const b = budgetOf(`${BASE}We have 800k subscribers and 40,000 views per video.`);
  assert.equal(b.status, "missing");
});

test("reversed ranges swap", () => {
  const b = budgetOf(`${BASE}Pay: ₹30,000-₹20,000 per month`);
  assert.equal(b.value.min, "20000");
  assert.equal(b.value.max, "30000");
});

test("amounts outside sanity bounds are ignored", () => {
  const b = budgetOf(`${BASE}Call ₹99 for details`);
  assert.equal(b.status, "missing");
});

test("range without any billing word is flagged for unit review", () => {
  const b = budgetOf(`${BASE}Budget: ₹20,000–₹30,000`);
  assert.equal(b.status, "review");
  assert.match(b.note, /billing period/);
});

// ---- Explicit-unit precedence over employment-type hints (plan D19) ----

test("explicit per-project unit beats a full-time employment hint", () => {
  const r = parseJobPost(`${BASE}This is a full-time role. Budget: ₹50,000 per project`);
  assert.equal(r.draft.budget.value.unit, "per project");
  assert.equal(r.draft.employmentType.value, "full-time");
  // The employment note must not claim it set the unit.
  assert.doesNotMatch(r.draft.employmentType.note ?? "", /we set the budget/);
});

test("full-time supplies per-month only when the post has no explicit unit", () => {
  const r = parseJobPost(`${BASE}Full-time role. Compensation: ₹50,000`);
  assert.equal(r.draft.budget.value.unit, "per month");
  assert.match(r.draft.employmentType.note ?? "", /we set the budget to per month/);
});

test("freelance supplies per-project only when the post has no explicit unit", () => {
  const withExplicit = parseJobPost(`${BASE}Freelance gig. ₹25,000 per month retainer`);
  assert.equal(withExplicit.draft.budget.value.unit, "per month");
  const withoutExplicit = parseJobPost(`${BASE}Freelance gig. Budget ₹25,000`);
  assert.equal(withoutExplicit.draft.budget.value.unit, "per project");
});
