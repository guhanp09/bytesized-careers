import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

/**
 * The editor's experience control must be able to hold what the field holds.
 *
 * `experience_level` is a plain string: `str | None, max_length=64` in the API,
 * `String(64)` in the database, no enum, no validator, nothing in search or
 * matching reading it. The editor nevertheless presented it as two numeric
 * dropdowns capped at ten, which could not express "25 years", "10+ years" or
 * "Experience preferred" — and quietly discarded anything the pair could not
 * represent, because saving required both a minimum and a maximum.
 *
 * These are source contracts rather than rendered-DOM tests: they pin the shape
 * of the wiring, which is where each of those defects actually lived. The
 * rendered behaviour is covered by the Playwright editor flow.
 */

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("the experience control is a combobox over suggestions, not a closed picker", () => {
  const form = read("components/post-job/PostJobForm.tsx");

  // A real combobox: free entry plus a suggestion list, keyboard reachable.
  assert.match(form, /id="job-experience"[\s\S]{0,400}role="combobox"/);
  assert.match(form, /aria-autocomplete="list"/);
  assert.match(form, /aria-controls="job-experience-options"/);
  assert.match(form, /aria-activedescendant=/);
  assert.match(form, /role="listbox"/);

  // Presented as suggestions rather than as the complete domain.
  assert.match(form, /Suggestions/);
  assert.match(form, /EXPERIENCE_SUGGESTIONS/);
  assert.match(form, /helper="Pick a suggestion or write your own/);

  // The two numeric dropdowns, and the helper that widened them, are gone.
  assert.doesNotMatch(form, /Min years/);
  assert.doesNotMatch(form, /Max years/);
  assert.doesNotMatch(form, /experienceYearOptions/);
});

test("the combobox never coerces a typed value into a suggestion", () => {
  const form = read("components/post-job/PostJobForm.tsx");

  // The city field beside it snaps to its closest match on blur. Doing that
  // here would turn a recruiter's "25 years" into a band on the way out.
  const experienceBlur = form.match(/onBlur=\{\(\) => window\.setTimeout\(\(\) => setExperienceOpen\(false\), 120\)\}/);
  assert.ok(experienceBlur, "experience blur should only close the list");
  assert.doesNotMatch(form, /experienceMatch/);

  // Length is bounded to the column, and that is the only shaping applied.
  assert.match(form, /EXPERIENCE_MAX_LENGTH = 64/);
  assert.match(form, /maxLength=\{EXPERIENCE_MAX_LENGTH\}/);
});

test("keyboard selection works and Escape leaves what was typed", () => {
  const form = read("components/post-job/PostJobForm.tsx");
  const block = form.slice(form.indexOf('id="job-experience"'));

  for (const key of ["ArrowDown", "ArrowUp", "Enter", "Escape"]) {
    assert.match(block, new RegExp(`event\\.key === "${key}"`));
  }
  // Escape closes the list; it does not write a suggestion over the input.
  assert.match(block, /event\.key === "Escape"\) setExperienceOpen\(false\)/);
});

test("the editor carries one free-form value, not a numeric pair", () => {
  const page = read("components/PostJobPage.tsx");

  assert.match(page, /const \[experienceLevel, setExperienceLevel\] = useState\(""\)/);
  // Every trace of the min/max pair is gone: state, snapshot, dirty check,
  // hydration parsing, and the formatter that rebuilt a string from two numbers.
  for (const ghost of ["expMin", "expMax", "experienceParts", "formatExperiencePreview"]) {
    assert.doesNotMatch(page, new RegExp(ghost), `${ghost} should be gone`);
  }

  // Saved exactly as typed, and cleared to null rather than to an empty string.
  assert.match(page, /experience_level: experienceText \|\| null/);
  assert.match(page, /const experienceText = experienceLevel\.trim\(\)/);
});

test("both hydration paths restore the stored wording verbatim", () => {
  const page = read("components/PostJobPage.tsx");

  // Reopening a draft must show what was saved. Parsing it into numbers first
  // is how "25 years" used to come back as an empty control.
  assert.match(
    page,
    /typeof draft\.experience_level === "string" \? draft\.experience_level : ""/
  );
  assert.match(
    page,
    /typeof values\.experience_level === "string" \? values\.experience_level : ""/
  );
  assert.match(page, /setExperienceLevel\(nextExperience\)/);
});

test("the preview shows the wording rather than reformatting it", () => {
  const page = read("components/PostJobPage.tsx");

  // Reformatting here is how the rail once claimed a narrower requirement than
  // the field held. "Any" remains the existing neutral empty behaviour.
  assert.match(page, /const nextExperience = experienceLevel\.trim\(\) \|\| "Any"/);
  // Nothing re-derives a number from the prose for display.
  assert.doesNotMatch(page, /formatExperiencePreview/);
});

test("no leftover helper rebuilds experience text from two numbers", () => {
  const format = read("lib/format.ts");

  assert.doesNotMatch(format, /formatExperiencePreview/);
});

test("candidate-facing surfaces print the wording, never a re-derived number", () => {
  const preview = read("components/post-job/PreviewCard.tsx");
  const details = read("components/job-details/JobDescriptionSections.tsx");

  // Shown as stored. "25 years" prints "25 years"; "Experience preferred"
  // prints naturally; neither gets a unit appended or a figure parsed back out.
  assert.match(preview, /const showExperience = experienceText\.trim\(\)/);
  assert.match(details, /<span className="text-subtle">Experience:<\/span> \{experience\}/);

  for (const source of [preview, details]) {
    assert.doesNotMatch(source, /\$\{[^}]*experience[^}]*\}\s*years/i);
    assert.doesNotMatch(source, /experience[A-Za-z]*\s*\+\s*" years"/i);
  }
});
