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

test("resume and cover-letter imports use their own fulfillable candidate controls", () => {
  const byKey = new Map(requirementsForContext("job").map((def) => [def.key, def]));
  assert.equal(byKey.get("resume")?.answerType, "link");
  assert.equal(byKey.get("cover_letter")?.answerType, "longText");
  assert.ok(classifierKeys().includes("resume"));
  assert.ok(classifierKeys().includes("cover_letter"));
});

test("every job-selectable requirement has a candidate control that renders it", () => {
  // The catalog declares an answerType; this proves something actually draws
  // one. A key whose type has no branch would render nothing, so the recruiter
  // would be asking for something the candidate is never shown.
  const fields = fs.readFileSync(
    new URL("../components/first-message/FirstMessageFields.tsx", import.meta.url),
    "utf8"
  );
  const rendered = new Set(
    [...fields.matchAll(/def\.answerType === "([A-Za-z]+)"/g)].map((m) => m[1])
  );
  // The final branch treats longText and experience as a multiline control.
  rendered.add("longText");
  rendered.add("experience");

  for (const def of requirementsForContext("job")) {
    assert.ok(
      rendered.has(def.answerType),
      `${def.key} is selectable for jobs but no candidate control renders ` +
        `answerType "${def.answerType}"; recruiters could request something ` +
        `candidates cannot provide`
    );
  }
});

test("the screening concept has exactly one recruiter control", () => {
  // custom_instruction predates the dedicated Screening questions section and
  // is labelled "Screening question". Leaving it in the standard selector would
  // give recruiters two controls for one concept — the precise distinction this
  // work exists to draw — so Post Job hides it.
  const form = fs.readFileSync(
    new URL("../components/post-job/PostJobForm.tsx", import.meta.url),
    "utf8"
  );
  assert.match(form, /hideCustomInstruction/);

  const selector = fs.readFileSync(
    new URL("../components/first-message/RequirementSelector.tsx", import.meta.url),
    "utf8"
  );
  // The filter must key off the canonical constant, not a copied string.
  assert.match(selector, /definition\.key !== CUSTOM_INSTRUCTION_REQUIREMENT_KEY/);

  // Historical values are still readable and removable rather than dropped.
  assert.match(form, /Previously saved first-message prompt/);
});

test("selected requirements are genuinely required, on both sides", () => {
  // "What applicants must include" is only truthful if something enforces it.
  const panel = fs.readFileSync(
    new URL("../components/job-details/JobActionsPanelClient.tsx", import.meta.url),
    "utf8"
  );
  assert.match(panel, /validateAnswers\(requirementKeys, "job", normalizedAnswers\)/);
  assert.match(panel, /setAnswerErrors\(errors\)/);

  // And the server does not trust the client to have done it.
  const router = fs.readFileSync(
    new URL("../backend/app/api/v1/routers/marketplace.py", import.meta.url),
    "utf8"
  );
  assert.match(router, /_assert_first_message_complete\(job\.application_requirements/);
  assert.match(router, /Missing required first-message details/);
});

test("the screening key never renders as a public application material", () => {
  // Browser QA caught this: the public listing printed "Screening question" in
  // its required-materials pills. The key is a legacy standard-requirement
  // entry whose label happens to read that way, so it published the private
  // evaluative section on the public page — the one thing screening must never
  // be. An earlier assertion looked for the plural and missed it.
  const sections = fs.readFileSync(
    new URL("../components/job-details/JobDescriptionSections.tsx", import.meta.url),
    "utf8"
  );
  assert.match(sections, /filter\(\(key\) => key !== CUSTOM_INSTRUCTION_REQUIREMENT_KEY\)/);
});
