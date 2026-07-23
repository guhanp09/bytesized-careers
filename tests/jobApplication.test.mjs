import test from "node:test";
import assert from "node:assert/strict";

import {
  applicationPreflightForJob,
  buildScreeningQuestionAnswers,
  partitionJobApplicationRequirements,
  validateScreeningQuestionAnswers,
  validateUnknownRequirementAnswers,
} from "../lib/jobApplication.ts";

const baseJob = (overrides = {}) => ({
  id: "1",
  title: "Job",
  category: "Editing",
  budget: "",
  experience: "",
  location: "",
  postedShort: "",
  views: 0,
  applicants: 0,
  responseRate: 0,
  channel: { name: "Channel", logoUrl: "", subscribers: null },
  tags: [],
  startTimeframe: "",
  ...overrides,
});

test("application requirements retain known registry fields and unknown legacy fields", () => {
  const partition = partitionJobApplicationRequirements(["expected_rate", "legacy_showreel_note", "expected_rate"]);
  assert.deepEqual(partition.known, ["expected_rate"]);
  assert.deepEqual(partition.unknown, ["legacy_showreel_note"]);
  assert.deepEqual(validateUnknownRequirementAnswers(partition.unknown, {}), { legacy_showreel_note: "Legacy Showreel Note is required." });
  assert.deepEqual(validateUnknownRequirementAnswers(partition.unknown, { legacy_showreel_note: "Attached" }), {});
});

test("screening validation distinguishes required and optional questions and snapshots responses by index", () => {
  const questions = [
    { prompt: "Why this role?", required: true },
    { prompt: "Anything else?", required: false },
  ];
  assert.deepEqual(validateScreeningQuestionAnswers(questions, {}), { "screening-question-0": "Answer this required question." });
  assert.deepEqual(validateScreeningQuestionAnswers(questions, { 0: "Relevant experience" }), {});
  assert.deepEqual(buildScreeningQuestionAnswers(questions, { 0: "  Relevant experience  ", 1: "" }), [
    { question_index: 0, prompt: "Why this role?", required: true, response: "Relevant experience" },
  ]);
});

test("preflight makes external routing, tracking limits, deadline, materials, and trial explicit", () => {
  const preflight = applicationPreflightForJob(baseJob({
    applicationMode: "external",
    externalApplyUrl: "https://jobs.example.test/apply",
    deadlineAt: "2027-01-01T00:00:00Z",
    applicationRequirements: ["relevant_portfolio"],
    screeningQuestions: [{ prompt: "Share context", required: true }],
    trialStatus: "unpaid",
  }));
  assert.equal(preflight.mode, "external");
  assert.equal(preflight.externalUrl, "https://jobs.example.test/apply");
  assert.deepEqual(preflight.materialLabels, ["Relevant portfolio"]);
  // Screening questions are never collected before applying, so preflight never carries
  // them regardless of what the job configures.
  assert.equal(preflight.screeningQuestions.length, 0);
  assert.equal(preflight.trial.title, "Unpaid trial");
  assert.equal(preflight.hasPreflightDetails, true);

  const invalid = applicationPreflightForJob(baseJob({ applicationMode: "external", externalApplyUrl: "javascript:alert(1)" }));
  assert.equal(invalid.externalUrl, null);
});
