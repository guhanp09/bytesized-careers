/**
 * Every field the importer can fill, and how the editor represents it.
 *
 * The round-trip suites prove that a value survives the API. They cannot see an
 * orphan: a field the importer populates that the Post Job editor has no way to
 * show or save. That value is not lost noisily — it is written to the draft,
 * never rendered, and then overwritten by whatever the form serializes on the
 * recruiter's first save. Nobody is told.
 *
 * So this crosses the two registries. The backend's import policy says what an
 * import can populate; `lib/jobFieldRegistry.ts` says how the editor represents
 * each field. Every importable field must land in one of four classes, and the
 * unacceptable case — populated by import, represented by nothing — fails here.
 *
 * The classes are deliberately explicit rather than inferred, so that
 * classifying a field as display-only or system-owned is a decision somebody
 * made and can be argued with, not a gap that happens to pass.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";

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

const { JOB_FIELD_REGISTRY } = await import("../lib/jobFieldRegistry.ts");

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

/**
 * What the backend importer can populate.
 *
 * Read from a manifest the backend generates, not parsed out of Python. The
 * policy dict is built dynamically from a field set, so text-scraping it
 * returned nothing at all — and every assertion below passed while checking an
 * empty list. A backend contract test regenerates this file and fails when it
 * drifts, so the two halves cannot disagree silently.
 */
const MANIFEST = JSON.parse(read("lib/importJob/importableFields.json"));
const IMPORTABLE = MANIFEST.importable;

/**
 * Fields the importer fills that the editor deliberately does not present as a
 * control, with the reason. Anything not listed here must have one.
 */
const DELIBERATELY_NOT_A_CONTROL = {
  // The importer names the role by catalog key; the payload carries the id.
  // Same concept, two names, and `primary_role_id` is a control.
  primary_role_key: "ALIAS_OF_A_CONTROL",
  // Legacy free-text requirements, preserved verbatim beside the structured
  // skills that replaced them.
  requirements: "LEGACY_PRESERVED",
  // Private, and handled by the Inbox rather than the job form.
  screening_questions: "PRIVATE_SEPARATE_SYSTEM",
  // Platform-decided. A recruiter cannot choose to route applicants away.
  application_mode: "SYSTEM_OWNED",
  external_apply_url: "SYSTEM_OWNED",
  // Deadlines were removed from the editor deliberately; an imported one
  // becomes a sentence in the public note instead of a field.
  deadline_at: "DISPLAY_ONLY_BY_DESIGN",
  // Superseded by start_timing; kept so old rows still read.
  start_timeframe: "LEGACY_PRESERVED",
};

test("the importer's field list is discovered rather than restated", () => {
  // A guard on the guard. If the parse silently returned nothing, every
  // assertion below would pass while checking nothing at all.
  // The guard that caught the empty parse: without it, an oracle returning
  // nothing looks exactly like an oracle finding no problems.
  assert.ok(IMPORTABLE.length >= 60, `only found ${IMPORTABLE.length} importable fields`);
  assert.ok(IMPORTABLE.includes("title"));
  assert.ok(IMPORTABLE.includes("budget_amount"));
  assert.ok(IMPORTABLE.includes("experience_level"));
});

test("every importable field has an explicit representation in the editor", () => {
  const missing = IMPORTABLE.filter(
    (field) => !(field in JOB_FIELD_REGISTRY) && !(field in DELIBERATELY_NOT_A_CONTROL)
  );

  // A field the importer fills and the registry has never heard of is the
  // orphan case: written to the draft, shown nowhere, and overwritten on save.
  assert.deepEqual(missing, [], `importable fields absent from the registry: ${missing}`);
});

test("every importable field is either editable or explicitly excused", () => {
  const orphans = [];
  for (const field of IMPORTABLE) {
    if (field in DELIBERATELY_NOT_A_CONTROL) continue;
    const entry = JOB_FIELD_REGISTRY[field];
    if (!entry) continue; // reported by the test above
    if (["control", "conditional-control", "confirmation"].includes(entry.representation)) {
      continue;
    }
    orphans.push(`${field} (${entry.representation})`);
  }

  assert.deepEqual(
    orphans,
    [],
    `importer-populated fields with no way to review or edit them: ${orphans}`
  );
});

/**
 * The fields the browser round-trip actually drives.
 *
 * Not every control needs its own target: compensation currency and unit live
 * inside one control whose target sits on the group, and demanding a target per
 * field would over-specify the markup. What must be true is that the fields a
 * test drives can be found, and that every step carrying controls is reachable
 * at all.
 */
const BROWSER_DRIVEN = [
  "title",
  "primary_role_id",
  "location",
  "work_mode",
  "experience_level",
  "about_channel",
  "responsibilities",
  "application_requirements",
  "how_to_apply",
];

test("every field the browser round-trip drives can be found", () => {
  const untargeted = BROWSER_DRIVEN.filter((field) => !JOB_FIELD_REGISTRY[field]?.target);

  // Without a stable target a browser test can only assert that some text
  // appears somewhere on the page, which is how a hydration defect hides.
  assert.deepEqual(untargeted, [], `driven fields with no test target: ${untargeted}`);
});

test("every step that carries controls is reachable", () => {
  const steps = new Map();
  for (const [field, entry] of Object.entries(JOB_FIELD_REGISTRY)) {
    if (!["control", "conditional-control"].includes(entry.representation)) continue;
    const step = steps.get(entry.step) ?? { fields: [], targeted: 0 };
    step.fields.push(field);
    if (entry.target) step.targeted += 1;
    steps.set(entry.step, step);
  }

  const unreachable = [...steps.entries()]
    .filter(([, step]) => step.targeted === 0)
    .map(([name]) => name);

  // A step with controls and no target anywhere in it cannot be driven at all.
  assert.deepEqual(unreachable, [], `steps with no reachable control: ${unreachable}`);
});

test("the excused list is honest about what it excuses", () => {
  for (const [field, reason] of Object.entries(DELIBERATELY_NOT_A_CONTROL)) {
    assert.ok(
      IMPORTABLE.includes(field),
      `${field} is excused from being a control but the importer cannot fill it`
    );
    if (reason === "ALIAS_OF_A_CONTROL") {
      // An alias is only excusable if the thing it aliases really is a control.
      assert.ok(
        Object.values(JOB_FIELD_REGISTRY).some(
          (entry) => entry.target === JOB_FIELD_REGISTRY.primary_role_id?.target
        )
      );
    }
    assert.ok(
      [
        "PRIVATE_SEPARATE_SYSTEM",
        "SYSTEM_OWNED",
        "DISPLAY_ONLY_BY_DESIGN",
        "LEGACY_PRESERVED",
        "ALIAS_OF_A_CONTROL",
      ].includes(reason),
      `${field} has an unrecognised excuse: ${reason}`
    );
  }
});

test("the classification covers every importable field exactly once", () => {
  const classified = new Map();
  for (const field of IMPORTABLE) {
    if (field in DELIBERATELY_NOT_A_CONTROL) {
      classified.set(field, DELIBERATELY_NOT_A_CONTROL[field]);
      continue;
    }
    const entry = JOB_FIELD_REGISTRY[field];
    classified.set(field, entry ? `FULL_ROUNDTRIP:${entry.representation}` : "ORPHAN");
  }

  assert.equal(classified.size, IMPORTABLE.length);
  assert.deepEqual(
    [...classified.entries()].filter(([, value]) => value === "ORPHAN"),
    []
  );
});
