import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("candidate detail exposes decision, qualification, workflow, trial, process, and application facts before Apply", () => {
  const hero = read("components/job-details/JobHero.tsx");
  const body = read("components/job-details/JobDescriptionSections.tsx");

  for (const signal of ["Compensation", "Engagement", "Work setup", "Platform / format"]) {
    assert.match(hero, new RegExp(signal.replace("/", "\\/")));
  }
  for (const section of [
    "Deliverables and volume",
    "Responsibilities",
    "Must have",
    "Additional listing requirements",
    "Required tools",
    "Nice to have",
    "Creative workflow",
    "Trial terms",
    "Hiring process",
    "How to apply",
  ]) {
    assert.match(body, new RegExp(section));
  }
  assert.match(body, /Sensitive access required/);
  // Screening questions are no longer public listing content — they are sent into the
  // Inbox conversation after a successful application.
  assert.doesNotMatch(body, /Screening questions/);
  assert.doesNotMatch(body, /Required languages/);
  assert.doesNotMatch(body, /Preferred languages/);
  // The external-submission warning is gone because the state it described is
  // gone: applications run through CreatorJobs, so no listing sends a candidate
  // to a submission the platform cannot see.
  assert.doesNotMatch(body, /CreatorJobs does not receive or track that submission/);
  assert.doesNotMatch(body, /Apply on an external site/);
  assert.match(body, /Apply through CreatorJobs/);
});

test("cards remain decision-first and do not expose technical legacy terminology", () => {
  const card = read("components/JobCard.tsx");
  assert.match(card, /compensationForJob/);
  assert.match(card, /engagementForJob/);
  assert.match(card, /workSetupForJob/);
  // A closing date is part of the application instructions now, not a row on a
  // card. Showing it here made it a separate promise the listing had to keep.
  assert.doesNotMatch(card, /deadlineForJob/);
  assert.match(card, /Verified hiring identity/);
  assert.doesNotMatch(card, />\s*legacy category\s*</i);
});

test("candidate and recruiter views share domain presentation helpers", () => {
  const detail = read("components/job-details/JobDescriptionSections.tsx");
  const preview = read("components/post-job/RecruiterJobPreview.tsx");
  for (const helper of ["formatJobCompensation", "formatTurnaround", "formatWeeklyHours", "revisionForJob", "startForJob"]) {
    assert.match(preview, new RegExp(helper));
  }
  for (const helper of ["formatJobDeliverable", "formatTurnaround", "formatWeeklyHours", "revisionForJob", "startForJob"]) {
    assert.match(detail, new RegExp(helper));
  }
});

test("unavailable public jobs use a native opaque state", () => {
  const unavailable = read("app/jobs/[id]/not-found.tsx");
  assert.match(unavailable, /Job no longer available/);
  assert.match(unavailable, /not currently available to candidates/);
  assert.match(unavailable, /Browse open jobs/);
  assert.doesNotMatch(unavailable, /draft|suspended owner|deleted_at/i);
});
