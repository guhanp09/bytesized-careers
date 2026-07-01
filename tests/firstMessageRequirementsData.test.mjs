import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { requirementsForContext } from "../lib/firstMessageRequirements.ts";

// These tests guard the demo data that powers the Jobs and Talent listing pages:
// the listings shown there must carry first-message requirement metadata so the
// Apply / Hire requirements modal can be exercised immediately. They assert on
// the canonical registry keys (no invented keys) and on the mapping wiring that
// carries requirements from the data source into the detail-page action panels.

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (relPath) => readFileSync(join(repoRoot, relPath), "utf8");

const JOB_KEYS = requirementsForContext("job").map((def) => def.key);
const TALENT_KEYS = requirementsForContext("talent").map((def) => def.key);

// Pull every `<field>: [ ... ]` requirement array out of a data source file and
// return each as an array of the string keys it lists.
const extractKeyArrays = (source, field) =>
  [...source.matchAll(new RegExp(`${field}:\\s*\\[([^\\]]*)\\]`, "g"))].map((match) =>
    [...match[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1])
  );

const hasAll = (keys, required) => required.every((key) => keys.includes(key));

test("mock job listings declare first-message requirement metadata", () => {
  const source = read("lib/jobs.ts");
  const arrays = extractKeyArrays(source, "applicationRequirements");
  assert.ok(arrays.length >= 4, "expected several mock jobs to declare requirements");
});

test("at least one mock job exercises every job-context requirement", () => {
  const source = read("lib/jobs.ts");
  const arrays = extractKeyArrays(source, "applicationRequirements");
  const full = arrays.find((keys) => hasAll(keys, JOB_KEYS));
  assert.ok(full, `expected one mock job listing requiring all of: ${JOB_KEYS.join(", ")}`);
});

test("mock job requirements only use real job-context registry keys", () => {
  const source = read("lib/jobs.ts");
  for (const keys of extractKeyArrays(source, "applicationRequirements")) {
    for (const key of keys) {
      assert.ok(JOB_KEYS.includes(key), `unknown job requirement key: ${key}`);
    }
  }
});

test("mock talent listings declare first-message requirement metadata", () => {
  const source = read("lib/mockTalentListings.ts");
  const arrays = extractKeyArrays(source, "first_message_requirements");
  assert.ok(arrays.length >= 4, "expected several mock talent listings to declare requirements");
});

test("at least one mock talent exercises every talent-context requirement", () => {
  const source = read("lib/mockTalentListings.ts");
  const arrays = extractKeyArrays(source, "first_message_requirements");
  const full = arrays.find((keys) => hasAll(keys, TALENT_KEYS));
  assert.ok(full, `expected one mock talent listing requiring all of: ${TALENT_KEYS.join(", ")}`);
});

test("mock talent requirements only use real talent-context registry keys", () => {
  const source = read("lib/mockTalentListings.ts");
  for (const keys of extractKeyArrays(source, "first_message_requirements")) {
    for (const key of keys) {
      assert.ok(TALENT_KEYS.includes(key), `unknown talent requirement key: ${key}`);
    }
  }
});

test("job list/detail mapping preserves applicationRequirements", () => {
  // The local mock repository re-attaches requirements by id when mapping a stored
  // record back to a Job, so list and detail pages both receive the metadata.
  const source = read("lib/repositories/jobRepository.ts");
  assert.match(source, /applicationRequirements:\s*LOCAL_SAMPLE_JOB_REQUIREMENTS\.get/);
});

test("talent detail page forwards first_message_requirements to the hire panel", () => {
  // The detail page must hand the listing's requirements to the actions client as
  // requirementKeys, or the Hire modal would never see them.
  const source = read("app/talent/[id]/page.tsx");
  assert.match(source, /requirementKeys=\{listing\.first_message_requirements/);
});
