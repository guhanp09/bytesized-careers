import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { SCENARIO_NAMES } from "../lib/seed/scenarioNames.ts";
import { toOwnerInteractions } from "../lib/seed/scenarioManifest.ts";

/**
 * The machine-readable scenario index.
 *
 * Every manifest carries an `index`: the records worth looking at, with the
 * route, persona and condition that make each one worth looking at. It exists so
 * a human does not have to search hundreds of rows to find "the one with a
 * disputed payment", and so SCENARIOS.md can be assembled from data rather than
 * maintained by hand — a hand-maintained second map would go stale the first
 * time the generator changed.
 *
 * These tests prove the index is worth trusting: every entry points at something
 * real, the coverage claims are true, and the identifiers survive regeneration.
 */

const MANIFEST_DIR = path.join(process.cwd(), "fixtures", "creator_scenarios", "generated");

const manifests = Object.fromEntries(
  SCENARIO_NAMES.map((name) => [
    name,
    JSON.parse(fs.readFileSync(path.join(MANIFEST_DIR, `${name}.json`), "utf8")),
  ])
);

const withRecords = SCENARIO_NAMES.filter((name) => (manifests[name].relationships ?? []).length > 0);

test("every scenario that has records has an index", () => {
  for (const name of withRecords) {
    assert.ok(
      (manifests[name].index ?? []).length > 0,
      `${name} carries records but no index, so nothing in it is findable`
    );
  }
  // `empty` is the deliberate exception: nothing to index is the whole point.
  assert.equal((manifests.empty.index ?? []).length, 0);
});

test("every indexed entity exists", () => {
  const problems = [];
  for (const name of withRecords) {
    const data = manifests[name];
    const relationships = new Map((data.relationships ?? []).map((rel) => [rel.id, rel]));
    const jobs = new Set((data.jobs ?? []).map((job) => job.id));
    const conversations = new Set(
      (data.relationships ?? []).map((rel) => rel.conversation_id).filter(Boolean)
    );
    for (const entry of data.index ?? []) {
      const rel = relationships.get(entry.relationship_id);
      if (!rel) {
        problems.push(`${name}: index points at missing relationship ${entry.relationship_id}`);
        continue;
      }
      if (entry.job_id && !jobs.has(entry.job_id)) {
        problems.push(`${name}: index entry ${entry.relationship_id} points at missing job ${entry.job_id}`);
      }
      if (entry.conversation_id && !conversations.has(entry.conversation_id)) {
        problems.push(
          `${name}: index entry ${entry.relationship_id} points at missing conversation`
        );
      }
      if (entry.scenario !== name) {
        problems.push(`${name}: index entry claims scenario ${entry.scenario}`);
      }
    }
  }
  assert.deepEqual(problems, [], `broken index references:\n${problems.join("\n")}`);
});

test("an indexed entry says enough to act on without searching", () => {
  // An index whose entries lack a route or a condition is a list of ids, which
  // is exactly what it exists to save someone from.
  const problems = [];
  for (const name of withRecords) {
    for (const entry of manifests[name].index ?? []) {
      for (const field of ["persona", "route", "expected_stage", "expected_condition", "action_to_test"]) {
        if (!entry[field]) problems.push(`${name} ${entry.relationship_id}: no ${field}`);
      }
      if (entry.action_to_test && entry.action_to_test.length < 15) {
        problems.push(`${name} ${entry.relationship_id}: action is too short to be an instruction`);
      }
    }
  }
  assert.deepEqual(problems, [], `unusable index entries:\n${problems.join("\n")}`);
});

test("every indexed route resolves to a real page and a real scenario", () => {
  const problems = [];
  for (const name of withRecords) {
    const handles = new Set((manifests[name].actors ?? []).map((actor) => actor.username));
    for (const entry of manifests[name].index ?? []) {
      const [pathname, query = ""] = entry.route.split("?");
      // A profile route is addressed by handle, so "resolves" means the handle
      // is one this scenario actually contains — pointing QA at /u/ someone who
      // is not in the dataset is worse than not indexing the condition at all.
      if (pathname.startsWith("/u/")) {
        const slug = pathname.slice(3);
        if (!handles.has(slug)) {
          problems.push(`${name}: route ${entry.route} names a handle this scenario does not have`);
        }
      } else if (pathname !== "/applications") {
        problems.push(`${name}: unexpected route ${entry.route}`);
      }
      const params = new URLSearchParams(query);
      const view = params.get("view");
      const mode = params.get("mode");
      if (view && !["inbox", "pipeline"].includes(view)) {
        problems.push(`${name}: route names unknown view "${view}"`);
      }
      if (mode && !["talent", "recruiter", "hiring"].includes(mode)) {
        problems.push(`${name}: route names unknown mode "${mode}"`);
      }
      const seed = params.get("seed");
      if (seed && !SCENARIO_NAMES.includes(seed)) {
        problems.push(`${name}: route names unknown seed "${seed}"`);
      }
    }
  }
  assert.deepEqual(problems, [], `unusable routes:\n${problems.join("\n")}`);
});

test("the persona an entry names is a side that record actually has", () => {
  const problems = [];
  for (const name of withRecords) {
    const data = manifests[name];
    const actors = new Map((data.actors ?? []).map((actor) => [actor.id, actor]));
    for (const entry of data.index ?? []) {
      const rel = (data.relationships ?? []).find((item) => item.id === entry.relationship_id);
      if (!rel) continue;
      const side = entry.persona === "recruiter" ? rel.recruiter_id : rel.talent_id;
      if (!actors.has(side)) {
        problems.push(`${name} ${entry.relationship_id}: ${entry.persona} side has no actor`);
      }
    }
  }
  assert.deepEqual(problems, [], `index personas that do not exist:\n${problems.join("\n")}`);
});

test("the stage an entry claims is the stage the record is in", () => {
  // An index that describes a record inaccurately is worse than no index: it
  // sends someone to check a state that is not there and they report a bug.
  const problems = [];
  for (const name of withRecords) {
    const data = manifests[name];
    for (const entry of data.index ?? []) {
      const rel = (data.relationships ?? []).find((item) => item.id === entry.relationship_id);
      if (!rel) continue;
      const stages = new Set([rel.stage, rel.participant_stage].filter(Boolean));
      if (!stages.has(entry.expected_stage)) {
        problems.push(
          `${name} ${entry.relationship_id}: index says ${entry.expected_stage}, record is ${rel.stage}`
        );
      }
    }
  }
  assert.deepEqual(problems, [], `index entries that misdescribe their record:\n${problems.join("\n")}`);
});

test("both viewing directions are indexed", () => {
  // A corpus indexed only from the managing side would leave every
  // participant-facing state undocumented, which is half the product.
  const personas = new Set();
  for (const name of withRecords) {
    for (const entry of manifests[name].index ?? []) personas.add(entry.persona);
  }
  assert.ok(personas.has("recruiter"), "no indexed recruiter example");
  assert.ok(personas.has("talent"), "no indexed talent example");
});

test("every indexed record is reachable through the frontend consumer", () => {
  // The index is only useful if following it lands on something. This walks the
  // same adaptation Mock mode performs and looks for each indexed id.
  const problems = [];
  for (const name of withRecords) {
    const data = manifests[name];
    const rendered = new Set(
      [
        ...toOwnerInteractions(data, { mode: "recruiter", anchorMode: "fixed" }),
        ...toOwnerInteractions(data, { mode: "talent", anchorMode: "fixed" }),
      ].map((item) => item.id)
    );
    for (const entry of data.index ?? []) {
      if (!rendered.has(entry.relationship_id)) {
        problems.push(`${name}: ${entry.relationship_id} is indexed but never rendered`);
      }
    }
  }
  assert.deepEqual(problems, [], `indexed records the workspace never shows:\n${problems.join("\n")}`);
});

test("every lifecycle stage has at least five records to look at", () => {
  // The coverage claim this corpus is built on. Asserted rather than described,
  // because "we covered every stage" is the kind of claim that quietly stops
  // being true.
  const counts = {};
  for (const name of withRecords) {
    for (const rel of manifests[name].relationships ?? []) {
      counts[rel.stage] = (counts[rel.stage] ?? 0) + 1;
    }
  }
  const thin = Object.entries(counts).filter(([, count]) => count < 5);
  assert.deepEqual(thin, [], `stages with fewer than five records: ${JSON.stringify(thin)}`);
  // And the vocabulary is the real one, not a subset someone found convenient.
  for (const stage of ["new", "reviewing", "interviewing", "hired", "rejected", "withdrawn", "archived"]) {
    assert.ok(counts[stage] >= 5, `${stage} has only ${counts[stage] ?? 0} records`);
  }
});

test("the legacy Shortlisted state is represented in both of its forms", () => {
  const shortlisted = [];
  for (const name of withRecords) {
    for (const rel of manifests[name].relationships ?? []) {
      if (rel.stage === "shortlisted" || rel.participant_stage === "shortlisted") shortlisted.push(rel);
    }
  }
  assert.ok(shortlisted.length > 0, "no legacy Shortlisted record at all");
  // Private: the manager holds it and the participant was never told.
  assert.ok(
    shortlisted.some((rel) => rel.stage === "shortlisted" && rel.participant_stage !== "shortlisted"),
    "no privately-held legacy Shortlisted record"
  );
  // Communicated: the participant genuinely was told, and reads it as
  // "Under consideration" rather than being regressed.
  assert.ok(
    shortlisted.some((rel) => rel.participant_stage === "shortlisted"),
    "no communicated legacy Shortlisted record"
  );
});

test("the retired jobs are present and closed", () => {
  const retired = [];
  for (const name of withRecords) {
    for (const job of manifests[name].jobs ?? []) {
      if (job.legacy_key === "job_25" || job.legacy_key === "job_26") retired.push([name, job]);
    }
  }
  const keys = new Set(retired.map(([, job]) => job.legacy_key));
  assert.ok(keys.has("job_25"), "job_25 is missing");
  assert.ok(keys.has("job_26"), "job_26 is missing");
  for (const [name, job] of retired) {
    assert.equal(job.status, "closed", `${name}: ${job.legacy_key} is not closed`);
  }
  // And each retired job still has applicants waiting on it, which is the state
  // worth testing: a closed listing with people still in the pipeline.
  for (const [name, job] of retired) {
    const pending = (manifests[name].relationships ?? []).filter((rel) => rel.job_id === job.id);
    assert.ok(pending.length > 0, `${name}: ${job.legacy_key} is closed with nobody on it`);
  }
});

test("every payment state has records, and none of them claims funds are held", () => {
  const counts = {};
  for (const name of withRecords) {
    for (const rel of manifests[name].relationships ?? []) {
      const state = rel.engagement?.payment_state;
      if (state) counts[state] = (counts[state] ?? 0) + 1;
    }
  }
  assert.ok(Object.keys(counts).length >= 5, `only ${Object.keys(counts).length} payment states present`);
  for (const [state, count] of Object.entries(counts)) {
    assert.ok(count >= 3, `payment state ${state} has only ${count} records`);
  }
  // The separate plane is read-only and descriptive. No scenario may assert
  // custody of money, because the product does not have custody of money.
  //
  // Checked over content a user could read — message bodies, notes, titles — and
  // deliberately not over the index, whose instructions say things like "confirm
  // the card does not imply funds are held". Scanning the whole file flagged
  // those, which is a check failing on its own reason for existing.
  const forbidden = /escrow|funds are (safe|secure|held)|guaranteed|protected by/i;
  const offenders = [];
  for (const name of withRecords) {
    const data = manifests[name];
    const readable = [];
    for (const rel of data.relationships ?? []) {
      readable.push(rel.cover_note, rel.manager_note, rel.historical);
      for (const message of rel.messages ?? []) readable.push(message.body);
      readable.push(rel.engagement?.payment_note);
    }
    for (const job of data.jobs ?? []) readable.push(job.title);
    for (const text of readable.filter(Boolean)) {
      if (forbidden.test(text)) offenders.push(`${name}: ${JSON.stringify(text)}`);
    }
  }
  assert.deepEqual(offenders, [], `payment-custody claims in readable content:\n${offenders.join("\n")}`);
});

test("the edge identity and portfolio cases are indexed, not merely present", () => {
  const conditions = (manifests.edge.index ?? []).map((entry) => entry.expected_condition.toLowerCase());
  const joined = conditions.join(" | ");
  for (const needle of ["portfolio", "name"]) {
    assert.ok(joined.includes(needle), `the edge index never mentions ${needle}`);
  }
  assert.ok(conditions.length >= 20, `edge indexes only ${conditions.length} cases`);
});

test("hero identifiers are stable, so documentation and deep links keep working", () => {
  // Identifiers are UUID5 keyed by meaning rather than by position. A record
  // added to a scenario must not renumber the ones already there — that is what
  // makes a written-down id safe to write down.
  for (const name of withRecords) {
    for (const entry of manifests[name].index ?? []) {
      assert.match(
        entry.relationship_id,
        /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        `${name}: ${entry.relationship_id} is not a deterministic UUID5`
      );
    }
  }
});

test("no indexed condition is listed against the same record twice", () => {
  // A record may carry more than one condition — an edge row is often both an
  // identity case and a transient-state case — so the rule is one *entry* per
  // (record, condition), not one entry per record. Duplicating a pair would
  // make one example look like two.
  for (const name of withRecords) {
    const pairs = (manifests[name].index ?? []).map(
      (entry) => `${entry.relationship_id}::${entry.expected_condition}`
    );
    assert.equal(new Set(pairs).size, pairs.length, `${name} lists a condition twice on one record`);
  }
});
