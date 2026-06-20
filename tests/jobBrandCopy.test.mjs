import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("post-job brand context field uses standardized About the brand copy", () => {
  const form = read("components/post-job/PostJobForm.tsx");
  const completion = read("lib/draftCompletion.ts");
  const detail = read("components/job-details/JobDescriptionSections.tsx");

  assert.match(form, /About the brand/);
  assert.match(form, /Share your brand’s voice, audience, and why this role matters\./);
  assert.match(form, /Share the content creator’s vision, audience, and why this role matters\./);
  assert.doesNotMatch(form, /Tell candidates about your vision in a way that is relevant to this role/);
  assert.doesNotMatch(form, /Describe the channel, the work/);

  assert.match(completion, /Add about the brand/);
  assert.doesNotMatch(completion, /Add description/);
  assert.doesNotMatch(completion, /Listing context/);

  assert.match(detail, /About the brand/);
  assert.doesNotMatch(detail, /About the channel/);
});
