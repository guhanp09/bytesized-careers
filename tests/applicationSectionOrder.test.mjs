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
  const card = read("components/post-job/JobDomainFields.tsx");
  const form = read("components/post-job/PostJobForm.tsx");

  // The requirements editor lives in the parent form because it needs props
  // from there, and is passed in as a slot. What matters is where the slot
  // renders: between the note and the questions, in the DOM the recruiter gets.
  const note = card.indexOf('label="Public how-to-apply note"');
  const slot = card.indexOf("{requirementsSlot}");
  const screening = card.indexOf(">Screening questions<");

  assert.ok(note > 0 && slot > 0 && screening > 0, "all three positions exist");
  assert.ok(note < slot, "the note comes before the requirements editor");
  assert.ok(slot < screening, "requirements come before screening questions");

  // Nothing else may separate them; the gap is what let requirements drift.
  assert.doesNotMatch(card.slice(slot, screening), /<DomainCard/);

  // Exactly one requirements editor exists, and it is the real one.
  assert.equal(card.match(/What applicants must include/g), null);
  assert.equal(form.match(/What applicants must include/g).length, 1);
  assert.match(form, /<RequirementSelector/);
});

test("each section says what it is for", () => {
  const card = read("components/post-job/JobDomainFields.tsx");
  const form = read("components/post-job/PostJobForm.tsx");

  assert.match(form, /Choose the standard materials and details every applicant should provide/);
  assert.match(
    card,
    /Add questions that help you evaluate candidates after choosing the materials/
  );
  // Screening answers are private to the Inbox, and the copy says so.
  assert.match(card, /never shown on the public listing/);
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
