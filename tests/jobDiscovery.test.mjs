import test from "node:test";
import assert from "node:assert/strict";

import {
  clearJobDiscoveryQuery,
  jobMatchesDiscovery,
  parseJobDiscovery,
  toggleJobDiscoveryQuery,
  updateJobDiscoveryQuery,
} from "../lib/jobDiscovery.ts";

const job = (overrides = {}) => ({
  id: "1",
  title: "Job",
  category: "Editing",
  legacyCategory: "Editing",
  budget: "",
  experience: "",
  location: "Remote",
  postedShort: "",
  views: 0,
  applicants: 0,
  responseRate: 0,
  channel: { name: "Channel", logoUrl: "", subscribers: null },
  tags: [],
  startTimeframe: "ASAP",
  ...overrides,
});

test("discovery parsing deduplicates comma values and URL updates preserve unrelated search state", () => {
  const source = new URLSearchParams("q=finance&platform=YouTube,youtube,Instagram&workMode=remote");
  const state = parseJobDiscovery(source);
  assert.deepEqual(state.platform, ["YouTube", "Instagram"]);
  assert.deepEqual(state.workMode, ["remote"]);

  const toggled = toggleJobDiscoveryQuery(source, "platform", "TikTok");
  assert.equal(toggled.get("q"), "finance");
  assert.equal(toggled.get("platform"), "YouTube,Instagram,TikTok");
  const cleared = clearJobDiscoveryQuery(toggled);
  assert.equal(cleared.get("q"), "finance");
  assert.equal(cleared.has("platform"), false);
});

test("canonical role and legacy category filters are mutually exclusive without category-to-role inference", () => {
  const legacy = new URLSearchParams("filter=Editing");
  const canonical = updateJobDiscoveryQuery(legacy, "role", ["video-editor"]);
  assert.equal(canonical.get("role"), "video-editor");
  assert.equal(canonical.has("filter"), false);

  const roleState = parseJobDiscovery(canonical);
  assert.equal(jobMatchesDiscovery(job(), roleState), false);
  assert.equal(jobMatchesDiscovery(job({ primaryRoleName: "Video Editor" }), roleState), true);
});

test("structured dimensions compose with OR within a filter and AND across filters", () => {
  const state = parseJobDiscovery(new URLSearchParams("platform=YouTube,Instagram&workMode=remote&engagement=retainer&compensationUnit=per month&format=Long-form video"));
  const complete = job({
    primaryRoleName: "Video Editor",
    platform: "YouTube",
    platforms: ["YouTube"],
    workMode: "remote",
    engagementType: "retainer",
    budgetUnit: "per month",
    formatsHiredFor: ["Long-form video"],
  });
  assert.equal(jobMatchesDiscovery(complete, state), true);
  assert.equal(jobMatchesDiscovery({ ...complete, engagementType: "full_time" }, state), false);
});

test("language is no longer a discovery dimension and obsolete ?language= params are ignored", () => {
  // The obsolete parameter is not parsed into discovery state, so it never filters and
  // unrelated parameters are preserved.
  const state = parseJobDiscovery(new URLSearchParams("language=English&platform=youtube"));
  assert.equal("language" in state, false);
  assert.deepEqual(state.platform, ["youtube"]);
  // A job that would previously have been excluded by a language filter now matches.
  assert.equal(
    jobMatchesDiscovery(job({ languageRequirements: [{ language: "Hindi", priority: "required", purposes: ["writing"] }], platforms: ["youtube"] }), state),
    true,
  );
});
