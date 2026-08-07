import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const {
  FIRST_MESSAGE_REQUIREMENTS,
  requirementsForContext,
  sanitizeRequirementKeys,
  emptyAnswerFor,
} = await import("../lib/firstMessageRequirements.ts");

/**
 * A recruiter must never be able to ask for something a candidate cannot give.
 *
 * The catalog is shared between job listings and talent listings, and not every
 * entry belongs to both. `reference_links` is talent-only — and the import
 * classifier was emitting it for jobs, where `sanitizeRequirementKeys(…, "job")`
 * silently discarded it. The payload looked correct, the candidate was never
 * asked, and the recruiter never received anything. A phantom requirement.
 *
 * Nothing about that failed loudly, which is why it survived several rounds. So
 * the guard is a contract: every key a job can end up holding must be one the
 * job context actually renders, and must have a declared answer shape.
 */

/** Keys the backend classifier can write onto an imported job. */
function classifierKeys() {
  const source = fs.readFileSync(
    new URL("../backend/app/core/job_application_classification.py", import.meta.url),
    "utf8"
  );
  const block = source.slice(
    source.indexOf("REQUIREMENT_KEYS: Final[tuple[str, ...]] = ("),
    source.indexOf(")", source.indexOf("REQUIREMENT_KEYS: Final[tuple[str, ...]] = ("))
  );
  return [...block.matchAll(/"([a-z_]+)"/g)].map((match) => match[1]);
}

test("every job-selectable requirement declares how a candidate answers it", () => {
  const jobKeys = requirementsForContext("job");
  assert.ok(jobKeys.length >= 8, "the job catalog should not be empty");

  for (const def of jobKeys) {
    assert.ok(def.answerType, `${def.key} has no answerType, so nothing can render it`);
    assert.ok(def.job?.owner, `${def.key} has no recruiter-facing label`);
    // An answer shape must be constructible, or the candidate form has nothing
    // to put on screen and nothing to submit.
    assert.notEqual(
      emptyAnswerFor(def.key, "job"),
      undefined,
      `${def.key} cannot produce an empty answer`
    );
  }
});

test("a requirement the job context drops can never be written by import", () => {
  const jobKeys = new Set(requirementsForContext("job").map((def) => def.key));

  for (const key of classifierKeys()) {
    assert.ok(
      jobKeys.has(key),
      `the import classifier can write "${key}", but the job context does not ` +
        `render it — sanitizeRequirementKeys would discard it and the candidate ` +
        `would never be asked`
    );
    // And it must survive sanitisation, which is the function that actually
    // decides what reaches the candidate.
    assert.deepEqual(
      sanitizeRequirementKeys([key], "job"),
      [key],
      `"${key}" is dropped by sanitizeRequirementKeys for jobs`
    );
  }
});

test("talent-only requirements stay out of the job side", () => {
  const jobKeys = new Set(requirementsForContext("job").map((def) => def.key));
  const talentOnly = FIRST_MESSAGE_REQUIREMENTS.filter((def) => !def.job).map((d) => d.key);

  assert.ok(talentOnly.length > 0, "the fixture assumes some talent-only keys exist");
  for (const key of talentOnly) {
    assert.ok(!jobKeys.has(key), `${key} is talent-only and must not be job-selectable`);
    assert.deepEqual(sanitizeRequirementKeys([key], "job"), []);
  }
});

test("work links are asked for through the job's portfolio mechanism", () => {
  // "links to previous work" is a real job requirement; the key that expresses
  // it on the job side is relevant_portfolio, not the talent-only
  // reference_links. This pins the remap rather than the phrasing.
  assert.ok(classifierKeys().includes("relevant_portfolio"));
  assert.ok(!classifierKeys().includes("reference_links"));
});
