import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

/**
 * Order matters here because the wrong order produced the wrong data.
 *
 * Screening questions used to sit in the hiring-process card, before the
 * application section entirely. A recruiter reaching them first had nowhere yet
 * to say "send a portfolio and your rate", so those went in as questions — and a
 * question is answered in prose in the Inbox rather than collected as a standard
 * detail every applicant supplies.
 *
 * So the materials come first and the questions immediately after, with copy
 * saying plainly what each is for.
 */

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("the note, then what applicants must include, then screening questions", () => {
  const form = read("components/post-job/JobDomainFields.tsx");

  const note = form.indexOf('label="Public how-to-apply note"');
  const materials = form.indexOf("What applicants must include");
  const screening = form.indexOf(">Screening questions<");

  assert.ok(note > 0 && materials > 0 && screening > 0, "all three sections exist");
  assert.ok(note < materials, "the note comes before the materials");
  assert.ok(materials < screening, "materials come before screening questions");

  // Immediately after: nothing else may be inserted between them, because the
  // gap is what let requirements drift into the wrong one.
  const between = form.slice(materials, screening);
  assert.doesNotMatch(between, /<DomainCard/, "no other card separates them");
});

test("each section says what it is for", () => {
  const form = read("components/post-job/JobDomainFields.tsx");

  assert.match(form, /standard materials and details every applicant supplies/);
  assert.match(
    form,
    /Add questions that help you evaluate candidates after choosing the materials/
  );
  // Screening answers are private to the Inbox, and the copy says so.
  assert.match(form, /never shown on the public listing/);
});

test("screening questions left the hiring-process card entirely", () => {
  const form = read("components/post-job/JobDomainFields.tsx");
  const process = form.indexOf('label="Process note"');
  const screening = form.indexOf(">Screening questions<");

  assert.ok(process > 0 && screening > process, "screening no longer precedes the process note");
});

test("the application card no longer offers a route or a deadline", () => {
  const form = read("components/post-job/JobDomainFields.tsx");

  for (const gone of [
    "Application route",
    "Apply on another site",
    "External application URL",
    "Application deadline",
  ]) {
    assert.doesNotMatch(form, new RegExp(gone), `${gone} should be gone`);
  }
});

test("no candidate-facing surface offers an external application", () => {
  for (const path of [
    "components/job-details/JobDescriptionSections.tsx",
    "components/job-details/JobActionsPanelClient.tsx",
    "components/post-job/RecruiterJobPreview.tsx",
  ]) {
    const source = read(path);
    assert.doesNotMatch(source, /Apply on an external site/, path);
    assert.doesNotMatch(source, /Continue to application/, path);
    assert.doesNotMatch(source, /Open application page/, path);
    assert.doesNotMatch(source, /externalApplyUrl/, path);
  }
});

test("Add timeline cannot reappear in Improve your listing", () => {
  const completion = read("lib/draftCompletion.ts");

  assert.doesNotMatch(completion, /Add timeline/);
  // Nor as a group heading with nothing under it.
  assert.doesNotMatch(completion, /G\.timeline,/);
});
