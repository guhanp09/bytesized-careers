import test from "node:test";
import assert from "node:assert/strict";

import {
  buildTalentChecklist,
  buildRecruiterChecklist,
  checklistProgress,
} from "../lib/profileChecklist.ts";

const allTalentFalse = {
  hasAvatar: false,
  hasHeadline: false,
  hasWorkSample: false,
  hasRole: false,
  hasTools: false,
  hasBio: false,
  hasNiche: false,
  hasExperience: false,
  hasAvailabilityDetails: false,
};

const allRecruiterFalse = {
  hasAvatar: false,
  hasHeadline: false,
  hasJob: false,
  hasBio: false,
  hasHiringFocus: false,
  hasCollaborationDetails: false,
};

test("talent checklist leads with the highest hiring-signal items (avatar, headline, work sample, role)", () => {
  const items = buildTalentChecklist(allTalentFalse);
  assert.deepEqual(
    items.slice(0, 4).map((i) => i.key),
    ["avatar", "headline", "work_sample", "role"]
  );
  // Every item starts incomplete and tiers are non-decreasing (essentials first).
  assert.ok(items.every((i) => i.done === false));
  const tiers = items.map((i) => i.tier);
  assert.deepEqual(tiers, [...tiers].sort((a, b) => a - b));
});

test("talent checklist has a single work-sample item and no channel/verify rows", () => {
  const items = buildTalentChecklist(allTalentFalse);
  assert.equal(items.length, 9);
  assert.equal(items.filter((i) => i.key === "work_sample").length, 1);
  assert.equal(items.some((i) => i.key === "work_sample_proof"), false);
  assert.equal(items.some((i) => i.key === "channel"), false);
});

test("recruiter checklist leads with essentials and has no channel/verify/website rows", () => {
  const items = buildRecruiterChecklist(allRecruiterFalse);
  assert.deepEqual(
    items.slice(0, 4).map((i) => i.key),
    ["avatar", "headline", "post_job", "bio"]
  );
  for (const removed of ["verify", "website", "channels_managed"]) {
    assert.equal(items.some((i) => i.key === removed), false);
  }
  const tiers = items.map((i) => i.tier);
  assert.deepEqual(tiers, [...tiers].sort((a, b) => a - b));
});

test("talent and recruiter checklists are genuinely different lists", () => {
  const talentKeys = buildTalentChecklist(allTalentFalse).map((i) => i.key);
  const recruiterKeys = buildRecruiterChecklist(allRecruiterFalse).map((i) => i.key);
  assert.ok(talentKeys.includes("work_sample") && !recruiterKeys.includes("work_sample"));
  assert.ok(recruiterKeys.includes("post_job") && !talentKeys.includes("post_job"));
});

test("done flags map straight from signals", () => {
  const items = buildTalentChecklist({ ...allTalentFalse, hasAvatar: true, hasWorkSample: true });
  assert.equal(items.find((i) => i.key === "avatar")?.done, true);
  assert.equal(items.find((i) => i.key === "work_sample")?.done, true);
  assert.equal(items.find((i) => i.key === "headline")?.done, false);
});

test("checklistProgress counts completed items and rounds the percent", () => {
  assert.deepEqual(checklistProgress([]), { completed: 0, total: 0, percent: 100 });

  const none = buildRecruiterChecklist(allRecruiterFalse);
  assert.deepEqual(checklistProgress(none), { completed: 0, total: 6, percent: 0 });

  const some = buildRecruiterChecklist({ ...allRecruiterFalse, hasAvatar: true, hasHeadline: true, hasJob: true });
  const p = checklistProgress(some);
  assert.equal(p.completed, 3);
  assert.equal(p.total, 6);
  assert.equal(p.percent, 50); // 3/6 = 50
});
