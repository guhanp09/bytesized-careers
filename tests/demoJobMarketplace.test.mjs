import assert from "node:assert/strict";
import test from "node:test";

import fixture from "../fixtures/demo_job_marketplace.json" with { type: "json" };
import { JOBS, OWNER_JOB_FIXTURES } from "../lib/jobs.ts";

test("shared demo marketplace exposes public jobs and keeps owner statuses separate", () => {
  assert.equal(fixture.jobs.length, 24);
  assert.equal(JOBS.length, 21);
  assert.equal(OWNER_JOB_FIXTURES.length, 3);
  assert.ok(JOBS.every((job) => job.status === "published"));
  assert.deepEqual(
    new Set(OWNER_JOB_FIXTURES.map((job) => job.status)),
    new Set(["draft", "paused", "closed"])
  );
});

test("frontend mock mapping carries complete V3 card and detail data", () => {
  for (const job of JOBS) {
    assert.equal(job.listingSchemaVersion, 3);
    assert.ok(job.primaryRoleName);
    assert.ok(job.hiringDisplayName);
    assert.ok(job.engagementType);
    assert.ok(job.compensationMode);
    assert.ok(job.budgetUnit);
    assert.ok(job.deliverables?.length);
    assert.ok(job.requiredSkillKeys?.length);
    assert.ok(job.requiredToolKeys?.length);
    assert.ok(job.revisionPolicy);
    assert.ok(job.sourceInputs);
    assert.ok(job.creativeAutonomy);
    assert.ok(job.trialStatus);
    assert.ok(job.startTiming);
    assert.ok(job.durationType);
    assert.ok(job.hiringProcess?.length);
    assert.ok(job.applicationRequirements);
    assert.ok(job.deadlineAt && new Date(job.deadlineAt) > new Date());
  }
});

test("demo hiring identities never invent third-party avatar imagery", () => {
  assert.ok(JOBS.every((job) => job.channel.logoUrl === ""));
});

test("frontend portfolio covers meaningful filters and candidate states", () => {
  const values = (field) => new Set(JOBS.map((job) => job[field]).filter(Boolean));
  assert.deepEqual(values("workMode"), new Set(["remote", "hybrid", "onsite"]));
  assert.ok(values("engagementType").size >= 6);
  assert.ok(values("budgetUnit").size >= 14);
  assert.deepEqual(values("applicationMode"), new Set(["internal", "external"]));
  assert.deepEqual(values("trialStatus"), new Set(["none", "paid", "unpaid", "undecided"]));
  assert.ok(JOBS.some((job) => job.primaryRoleName === "Other Creator Role" && job.roleSpecialization));
  assert.ok(JOBS.some((job) => job.sourceInputsNotes?.includes("credentials are never requested")));
});
