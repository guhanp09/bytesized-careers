import test from "node:test";
import assert from "node:assert/strict";

import {
  formatProjectTypePreference,
  formatRevisionsPreference,
  formatTurnaroundPreference,
  formatWorkingHoursPreference,
  normalizeRevisionsPreferenceForSave,
  validateRevisionsPreference,
  validateTurnaroundPreference,
} from "../lib/workPreferences.ts";

test("project type preferences render as recruiter-friendly phrases", () => {
  assert.equal(formatProjectTypePreference("oneOff"), "Project type: One-off projects");
  assert.equal(formatProjectTypePreference("retainer"), "Project type: Retainer / ongoing work");
  assert.equal(formatProjectTypePreference("either"), "Project type: Open to one-off projects and retainers");
  assert.equal(formatProjectTypePreference("Both"), "Project type: Open to one-off projects and retainers");
});

test("turnaround preferences never expose bare numbers", () => {
  assert.equal(formatTurnaroundPreference("2–3 days"), "Turnaround: within 2–3 days");
  assert.equal(formatTurnaroundPreference("5 days"), "Turnaround: 5 days");
  assert.equal(formatTurnaroundPreference("48 hours"), "Turnaround: 48 hours");
  assert.equal(formatTurnaroundPreference("Flexible / depends on scope"), "Turnaround: flexible / depends on scope");
  const legacyRoleSpecificTurnaround = ["First", "cut in 5 days"].join(" ");
  assert.equal(formatTurnaroundPreference(legacyRoleSpecificTurnaround), "Turnaround: 5 days");
  assert.equal(formatTurnaroundPreference("5"), null);
  assert.equal(validateTurnaroundPreference("5"), "Add a turnaround with a unit, like 5 days or 48 hours.");
  assert.equal(validateTurnaroundPreference(legacyRoleSpecificTurnaround), "Use role-neutral turnaround wording, like 5 days or 48 hours.");
});

test("revision preferences render complete phrases", () => {
  assert.equal(formatRevisionsPreference("2 rounds"), "Revisions: 2 rounds included");
  assert.equal(formatRevisionsPreference("Unlimited"), "Revisions: unlimited within agreed scope");
  assert.equal(formatRevisionsPreference("Case by case"), "Revisions: case by case");
  assert.equal(formatRevisionsPreference("5"), "Revisions: 5 rounds included");
  assert.equal(normalizeRevisionsPreferenceForSave("5"), "5 rounds");
  assert.equal(validateRevisionsPreference("some changes"), "Describe revisions as rounds, like 2 rounds, or choose Case by case.");
});

test("working hours preferences render with clear context", () => {
  assert.equal(formatWorkingHoursPreference("Flexible working hours"), "Availability: Flexible working hours");
  assert.equal(formatWorkingHoursPreference("09:00 to 18:00 IST"), "Availability: 09:00 to 18:00 IST");
  assert.equal(formatWorkingHoursPreference("5"), null);
});
