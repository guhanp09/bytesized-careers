import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  FIXED_ANCHOR_MS,
  ManifestVersionError,
  anchorFor,
  checkManifestVersion,
  toOwnerInteractions,
} from "../lib/seed/scenarioManifest.ts";
import {
  DEFAULT_SCENARIO,
  SCENARIO_NAMES,
  isScenarioName,
  resolveScenario,
} from "../lib/seed/scenarioNames.ts";

const DIR = path.join(process.cwd(), "fixtures", "creator_scenarios", "generated");
const load = (name) => JSON.parse(fs.readFileSync(path.join(DIR, `${name}.json`), "utf8"));

/* --- the manifests are readable from the frontend ------------------------- */

test("every generated manifest parses and declares the version this build expects", () => {
  for (const name of SCENARIO_NAMES) {
    const manifest = load(name);
    assert.equal(manifest.scenario, name);
    checkManifestVersion(manifest.version);
  }
});

test("a manifest from a future build is refused, not read optimistically", () => {
  // A newer manifest may have moved a field; reading it anyway would seed
  // subtly wrong data that looks fine.
  assert.throws(() => checkManifestVersion(99), ManifestVersionError);
  assert.throws(() => toOwnerInteractions({ ...load("edge"), version: 99 }, { mode: "recruiter" }), ManifestVersionError);
});

/* --- time ----------------------------------------------------------------- */

test("offsets become real instants, and a fixed anchor is reproducible", () => {
  const manifest = load("default");
  const first = toOwnerInteractions(manifest, { mode: "recruiter", anchorMode: "fixed" });
  const second = toOwnerInteractions(manifest, { mode: "recruiter", anchorMode: "fixed" });
  assert.deepEqual(
    first.map((item) => item.updatedAt),
    second.map((item) => item.updatedAt)
  );
  assert.equal(anchorFor("fixed"), FIXED_ANCHOR_MS);
});

test("a record dated from the anchor is never stale, whenever it is read", () => {
  // The whole reason offsets exist: a stored ISO date would read a year old by
  // next summer. Anchored to now, "4 hours ago" stays 4 hours ago.
  const manifest = load("default");
  const now = Date.parse("2031-03-02T12:00:00.000Z");
  const items = toOwnerInteractions(manifest, { mode: "recruiter", anchorMode: "now", now });
  const newest = Math.max(...items.map((item) => Date.parse(item.updatedAt)));
  assert.ok(Math.abs(newest - now) < 40 * 24 * 3600 * 1000, "the newest record should be recent");
});

test("a scheduled interview is still in the future", () => {
  const manifest = load("default");
  const now = Date.parse("2031-03-02T12:00:00.000Z");
  const future = manifest.relationships.filter(
    (rel) => rel.interview && rel.interview.scheduled_offset > 0
  );
  assert.ok(future.length > 0, "at least one interview should be ahead");
  for (const rel of future) {
    assert.ok(now + rel.interview.scheduled_offset * 1000 > now);
  }
});

test("timestamps are ordered as the conversation was", () => {
  const items = toOwnerInteractions(load("default"), { mode: "recruiter", anchorMode: "fixed" });
  for (const item of items) {
    const sent = (item.thread ?? []).map((message) => Date.parse(message.sentAt));
    const sorted = [...sent].sort((a, b) => a - b);
    assert.deepEqual(sent, sorted, `${item.id} has messages out of order`);
  }
});

/* --- direction ------------------------------------------------------------ */

test("the same record reads as received by one side and sent by the other", () => {
  const manifest = load("default");
  const asRecruiter = toOwnerInteractions(manifest, { mode: "recruiter", anchorMode: "fixed" });
  const asTalent = toOwnerInteractions(manifest, { mode: "talent", anchorMode: "fixed" });
  const application = asRecruiter.find((item) => item.kind === "application");
  const mirrored = asTalent.find((item) => item.id === application.id);
  assert.equal(application.direction, "received");
  assert.equal(mirrored.direction, "sent");
  // And the *display* status differs accordingly: what is waiting for you is
  // not the same as what you are waiting on.
  assert.notEqual(application.status, mirrored.status);
});

test("a hiring request is sent by the recruiter and received by the talent", () => {
  const manifest = load("default");
  const asRecruiter = toOwnerInteractions(manifest, { mode: "recruiter", anchorMode: "fixed" });
  const request = asRecruiter.find((item) => item.kind === "hiring_request");
  assert.equal(request.direction, "sent");
  const asTalent = toOwnerInteractions(manifest, { mode: "talent", anchorMode: "fixed" });
  assert.equal(asTalent.find((item) => item.id === request.id).direction, "received");
});

/* --- privacy -------------------------------------------------------------- */

test("a manager's private note never crosses to the other side", () => {
  const manifest = load("default");
  const withNote = manifest.relationships.find((rel) => rel.manager_note);
  assert.ok(withNote, "the fixture should carry at least one private note");
  const asTalent = toOwnerInteractions(manifest, { mode: "talent", anchorMode: "fixed" });
  const seen = asTalent.find((item) => item.id === withNote.id);
  assert.equal(seen.managerNote, null);
});

test("a private decision is not shown to the participant", () => {
  const manifest = load("default");
  const priv = manifest.relationships.find(
    (rel) => rel.participant_stage && rel.participant_stage !== rel.stage
  );
  assert.ok(priv, "the fixture should carry a decision that was not shared");
  const items = toOwnerInteractions(manifest, { mode: "recruiter", anchorMode: "fixed" });
  const found = items.find((item) => item.id === priv.id);
  assert.equal(found.backendStatus, priv.stage);
  assert.equal(found.participantBackendStatus, priv.participant_stage);
  assert.notEqual(found.backendStatus, found.participantBackendStatus);
});

/* --- content -------------------------------------------------------------- */

test("creator facts survive the adaptation structurally", () => {
  const items = toOwnerInteractions(load("default"), { mode: "recruiter", anchorMode: "fixed" });
  const withJob = items.find((item) => item.job?.creator?.platforms?.length);
  assert.ok(withJob, "jobs should carry platforms through");
  const creator = withJob.job.creator;
  assert.ok(creator.formats.length > 0);
  assert.ok(creator.niches.length > 0);
  assert.ok(creator.compensation.currency, "currency must survive, never converted");
  assert.equal(typeof creator.compensation.minimum, "number");
});

test("no preformatted amount is carried, so the projection has to do the work", () => {
  const items = toOwnerInteractions(load("default"), { mode: "recruiter", anchorMode: "fixed" });
  for (const item of items) {
    if (!item.job) continue;
    assert.equal(item.job.budget, "", `${item.id} carries a preformatted budget string`);
  }
});

test("portfolio arrives with durations as numbers, not as formatted strings", () => {
  const items = toOwnerInteractions(load("edge"), { mode: "recruiter", anchorMode: "fixed" });
  const withPortfolio = items.filter((item) => (item.portfolio ?? []).length > 0);
  assert.ok(withPortfolio.length > 0);
  for (const item of withPortfolio) {
    for (const entry of item.portfolio) {
      if (entry.duration !== null) assert.equal(typeof entry.duration, "number");
    }
  }
});

test("the empty scenario really is empty on both sides", () => {
  const manifest = load("empty");
  assert.deepEqual(toOwnerInteractions(manifest, { mode: "recruiter", anchorMode: "fixed" }), []);
  assert.deepEqual(toOwnerInteractions(manifest, { mode: "talent", anchorMode: "fixed" }), []);
});

test("the busy scenario adapts its whole volume without loss", () => {
  const manifest = load("busy");
  const items = toOwnerInteractions(manifest, { mode: "recruiter", anchorMode: "fixed" });
  assert.equal(items.length, manifest.relationships.length);
});

/* --- scenario selection --------------------------------------------------- */

test("the query parameter wins over a stored preference", () => {
  const resolved = resolveScenario({ query: "edge", stored: "busy" });
  assert.equal(resolved.scenario, "edge");
  assert.equal(resolved.source, "query");
  assert.equal(resolved.error, null);
});

test("a stored preference is used when the URL says nothing", () => {
  assert.equal(resolveScenario({ stored: "busy" }).scenario, "busy");
  assert.equal(resolveScenario({ stored: "busy" }).source, "stored");
});

test("nothing specified falls to the default", () => {
  const resolved = resolveScenario({});
  assert.equal(resolved.scenario, DEFAULT_SCENARIO);
  assert.equal(resolved.source, "default");
});

test("an unknown scenario is an error, never a silent fallback", () => {
  // Silently serving `default` would have someone reporting a bug against a
  // dataset they never asked to see.
  const resolved = resolveScenario({ query: "staging" });
  assert.match(resolved.error, /Unknown scenario "staging"/);
  assert.match(resolved.error, /empty, default, busy, edge, talent, recruiter/);
});

test("a stored value that is no longer a scenario is ignored rather than fatal", () => {
  const resolved = resolveScenario({ stored: "retired-scenario" });
  assert.equal(resolved.scenario, DEFAULT_SCENARIO);
  assert.equal(resolved.error, null);
});

test("only the six names are scenarios", () => {
  assert.equal(SCENARIO_NAMES.length, 6);
  for (const name of SCENARIO_NAMES) assert.ok(isScenarioName(name));
  assert.ok(!isScenarioName("Default"));
  assert.ok(!isScenarioName(null));
});
