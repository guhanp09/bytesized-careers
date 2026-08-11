import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("post-job brand context field uses standardized About the brand copy", () => {
  const form = read("components/post-job/PostJobForm.tsx");
  const completion = read("lib/draftCompletion.ts");
  const detail = read("components/job-details/JobDescriptionSections.tsx");

  // The editor names the field once, and statically. It previously carried a
  // dynamic "About <Brand>" card heading *and* a "Candidate-facing
  // introduction" caption on the control beneath it, so a recruiter met two
  // names for one box. Naming the brand is useful to a candidate reading the
  // job, not to the person filling the field in.
  assert.match(form, /title="About the brand"/);
  assert.doesNotMatch(form, /Candidate-facing introduction/);
  assert.doesNotMatch(form, /title=\{aboutBrandLabel\(/);
  assert.match(form, /Share your brand’s voice, audience, and why this role matters\./);
  assert.match(form, /Share the content creator’s vision, audience, and why this role matters\./);
  assert.doesNotMatch(form, /Tell candidates about your vision in a way that is relevant to this role/);
  assert.doesNotMatch(form, /Describe the channel, the work/);

  assert.match(completion, /Add about the brand/);
  assert.doesNotMatch(completion, /Add description/);
  assert.doesNotMatch(completion, /Listing context/);

  // The candidate heading is the same field, so it uses the same helper: a
  // brand biography is not "the opportunity".
  assert.match(detail, /aboutBrandLabel\(/);
  assert.doesNotMatch(detail, /About the opportunity/);
  assert.doesNotMatch(detail, /About the channel/);
});
