import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("post-job brand context field uses standardized About the brand copy", () => {
  const form = read("components/post-job/PostJobForm.tsx");
  const completion = read("lib/draftCompletion.ts");
  const detail = read("components/job-details/JobDescriptionSections.tsx");

  // The literal moved into a shared helper so the editor, the recruiter
  // preview and the candidate heading cannot drift apart — they had already,
  // with the same field labelled "About the brand" in one place and "About the
  // opportunity" in another. The standard copy is still exactly this; it is now
  // the helper's fallback, asserted in jobPresentation.test.mjs.
  assert.match(form, /aboutBrandLabel\(/);
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
