import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  CLASSIFICATION_PLANES,
  NEEDS_YOU,
  attentionOf,
  classificationCounts,
  classify,
  countActiveFilters,
  describeFilter,
  isActiveRecord,
  matchesFilter,
  planeForAttention,
  queueToAttention,
  reviewProgressOf,
  stageOf,
} from "../lib/reviewClassification.ts";
import { pipelineStagesFor } from "../lib/applicationPipeline.ts";
import { toOwnerInteractions } from "../lib/seed/scenarioManifest.ts";

/**
 * One partition, and some flags.
 *
 * The menu before this had three exhaustive sections, and the measurements are
 * what condemned it: "No action needed" held 102 of 155 records, "New to read"
 * and "Not opened yet" were the *same* 35 records under two names, and the
 * stage section covered only opened records while the Pipeline board gave all
 * of them a column.
 *
 * These hold the shape that replaced it. Stage partitions everything and says
 * so. Flags do not partition anything — that is the point — so the properties
 * worth testing are that no flag means "nothing matched", that the duplicate is
 * gone, and that a quiet record carries no flag at all.
 */

const manifest = (name) =>
  JSON.parse(
    fs.readFileSync(
      path.join(process.cwd(), "fixtures", "creator_scenarios", "generated", `${name}.json`),
      "utf8"
    )
  );

const interactionsFor = (name, mode) =>
  toOwnerInteractions(manifest(name), { mode, anchorMode: "fixed" });

const SCENARIOS = ["default", "busy", "edge", "talent", "recruiter"];
const MODES = ["recruiter", "talent"];

/* ---- the one partition --------------------------------------------------- */

test("stage accounts for every active record, in every scenario", () => {
  for (const scenario of SCENARIOS) {
    for (const mode of MODES) {
      const items = interactionsFor(scenario, mode);
      const { total, stage } = classificationCounts(items);
      const summed = [...stage.values()].reduce((a, b) => a + b, 0);
      assert.equal(summed, total, `${scenario}/${mode}: stage sums to ${summed} of ${total}`);
    }
  }
});

test("an unopened record has a stage, because the board gives it one", () => {
  // The previous model returned null here, so the same record sat in the
  // board's New column and nowhere at all in this menu.
  const items = interactionsFor("default", "recruiter").filter(
    (item) => item.direction === "received" && isActiveRecord(item)
  );
  const untouched = items.filter((item) => reviewProgressOf(item) === "unopened");
  assert.ok(untouched.length > 0, "no untouched record to check");
  for (const item of untouched) assert.equal(stageOf(item), "new");
});

test("the menu's stages are the board's stages", () => {
  // A state that reads "Interviewing" on the board must not read as something
  // else here. `closed` is the one deliberate summary — it stands for the
  // board's terminal columns, and its description says which.
  const board = new Set(pipelineStagesFor("application", "received").map((stage) => stage.key));
  const plane = CLASSIFICATION_PLANES.find((entry) => entry.key === "stage");
  for (const option of plane.options) {
    if (option.key === "closed") {
      assert.match(option.description, /declined|withdrawn/i);
      continue;
    }
    assert.ok(board.has(option.key), `the board has no ${option.key} column`);
  }
  // And the board's first column is offered, which it was not before.
  assert.ok(plane.options.some((option) => option.key === "new"));
});

test("stage is the only partition", () => {
  const partitions = CLASSIFICATION_PLANES.filter((plane) => plane.kind === "partition");
  assert.deepEqual(
    partitions.map((plane) => plane.key),
    ["stage"],
    "three exhaustive sections is what made the menu unreadable"
  );
});

/* ---- the flags, and the residual that is gone ---------------------------- */

test("no flag means 'nothing matched'", () => {
  /*
    The defect this replaced. "No action needed" was 102 of 155 — two thirds of
    the menu's own population in a row that meant nothing — which is the same
    disease as the "Decision needed" grab-bag it had itself replaced.
  */
  for (const plane of CLASSIFICATION_PLANES) {
    for (const option of plane.options) {
      assert.doesNotMatch(option.key, /^(no_action_needed|other|everything_else|none)$/);
      assert.doesNotMatch(option.label, /^(no action needed|nothing|other|up to date)$/i);
    }
  }
});

test("a quiet record carries no flag at all", () => {
  // The mechanism behind the property above: `attentionOf` returns null rather
  // than routing everything unmatched into a bucket.
  const items = interactionsFor("default", "recruiter").filter(isActiveRecord);
  const quiet = items.filter((item) => attentionOf(item) === null);
  assert.ok(quiet.length > 0, "no quiet record — the residual is back");
  for (const item of quiet) {
    assert.equal(classify(item).attention, null);
    // And it is reachable by stage, so it is not invisible.
    assert.ok(classify(item).stage);
  }
});

test("the flags do not add up to the population, and are not supposed to", () => {
  for (const scenario of SCENARIOS) {
    const items = interactionsFor(scenario, "recruiter");
    const { total, attention } = classificationCounts(items);
    const flagged = [...attention.values()].reduce((a, b) => a + b, 0);
    assert.ok(flagged <= total, `${scenario}: more flags than records`);
  }
});

test("'Not opened yet' and 'New to read' are different records now", () => {
  /*
    They were the same 35. A record at stage `new` derives a `needs_review`
    work state by construction, so the attention section was restating the
    review section under a second name. `attentionOf` checks unopened first.
  */
  const items = interactionsFor("default", "recruiter").filter(isActiveRecord);
  const notOpened = items.filter((item) => attentionOf(item) === "not_opened");
  const newToRead = items.filter((item) => attentionOf(item) === "unread_activity");
  assert.ok(notOpened.length > 0, "no unopened record to check");
  const overlap = notOpened.filter((item) => newToRead.includes(item));
  assert.equal(overlap.length, 0, "the two flags still name the same records");
});

test("every flag lands in exactly one of the two flag sections", () => {
  const plane = (key) => CLASSIFICATION_PLANES.find((entry) => entry.key === key);
  const needsYou = new Set(plane("attention").options.map((option) => option.key));
  const notYours = new Set(plane("waiting").options.map((option) => option.key));
  for (const key of needsYou) {
    assert.ok(NEEDS_YOU.has(key), `${key} is rendered under "Needs you" but is not one`);
    assert.equal(planeForAttention(key), "attention");
    assert.equal(notYours.has(key), false, `${key} is in both sections`);
  }
  for (const key of notYours) {
    assert.equal(NEEDS_YOU.has(key), false, `${key} is rendered under "Not your move" but needs you`);
    assert.equal(planeForAttention(key), "waiting");
  }
});

test("the needs-you count is the flags that mean the next move is yours", () => {
  const items = interactionsFor("default", "recruiter");
  const { attention, needsYou, total } = classificationCounts(items);
  let expected = 0;
  for (const [key, count] of attention) if (NEEDS_YOU.has(key)) expected += count;
  assert.equal(needsYou, expected);
  assert.ok(needsYou <= total);
});

/* ---- what each option actually says -------------------------------------- */

test("Ready for decision means the interview happened and nothing was recorded", () => {
  // Objective evidence, not "we could not think of anything else".
  const [item] = interactionsFor("default", "recruiter").filter(
    (entry) =>
      entry.direction === "received" && isActiveRecord(entry) && reviewProgressOf(entry) === "opened"
  );
  assert.equal(
    attentionOf(item, { interviewFollowUpDue: true, interviewScheduled: true }),
    "ready_for_decision"
  );
});

test("an unread message of unclear intent is something to read, not a decision", () => {
  const [item] = interactionsFor("default", "recruiter").filter(
    (entry) =>
      entry.direction === "received" && isActiveRecord(entry) && reviewProgressOf(entry) === "opened"
  );
  const attention = attentionOf(item, { unreadCount: 2 });
  assert.notEqual(attention, "ready_for_decision");
  assert.ok(["unread_activity", "needs_your_reply"].includes(attention), `got ${attention}`);
});

test("nothing claims the recruiter has everything they need", () => {
  // The original sin, still forbidden: the old copy asserted exactly that, on
  // the evidence that nothing else had matched.
  for (const plane of CLASSIFICATION_PLANES) {
    for (const option of plane.options) {
      assert.doesNotMatch(option.description, /everything you need/i);
      assert.ok(option.description.length > 15, `${option.key} explains nothing`);
    }
  }
});

test("a partition says what it sums to; a flag list does not pretend to", () => {
  for (const plane of CLASSIFICATION_PLANES) {
    assert.ok(["partition", "flags"].includes(plane.kind));
    if (plane.kind === "partition") {
      assert.ok(plane.denominator, `${plane.key} does not say what it reconciles against`);
    }
    assert.ok(plane.options.length >= 2);
    for (const option of plane.options) {
      assert.ok(option.label.length > 2);
      assert.ok(option.description.length > 15, `${plane.key}/${option.key} has no description`);
    }
  }
});

test("archived records are outside the menu, because Archived is a scope", () => {
  const items = interactionsFor("default", "recruiter");
  const archived = items.filter((item) => !isActiveRecord(item));
  assert.ok(archived.length > 0, "no archived record to check");
  const { total } = classificationCounts(items);
  assert.equal(total, items.length - archived.length);
});

test("a record you sent is never 'not opened' — there is nothing for you to open", () => {
  const items = interactionsFor("talent", "talent").filter(
    (item) => item.direction === "sent" && isActiveRecord(item)
  );
  assert.ok(items.length > 0, "no sent record to check");
  for (const item of items) assert.notEqual(attentionOf(item), "not_opened");
});

/* ---- combining ----------------------------------------------------------- */

test("a stage and a flag combine to narrow", () => {
  const items = interactionsFor("busy", "recruiter").filter(isActiveRecord);
  const newOnes = items.filter((item) => matchesFilter(item, { stage: "new" }));
  const newAndUnopened = items.filter((item) =>
    matchesFilter(item, { stage: "new", attention: "not_opened" })
  );
  assert.ok(newAndUnopened.length > 0, "no new+unopened record");
  assert.ok(newAndUnopened.length <= newOnes.length, "combining must never widen");
  for (const item of newAndUnopened) {
    assert.equal(classify(item).stage, "new");
    assert.equal(classify(item).attention, "not_opened");
  }
});

test("an impossible combination returns nothing rather than lying", () => {
  const items = interactionsFor("busy", "recruiter");
  // Nobody has looked at it, and it is already hired.
  const impossible = items.filter((item) =>
    matchesFilter(item, { stage: "hired", attention: "not_opened" })
  );
  assert.equal(impossible.length, 0);
});

test("Starred cuts across the menu rather than being part of it", () => {
  const items = interactionsFor("default", "recruiter").filter(isActiveRecord);
  const starredIds = new Set([items[0].id, items[1].id]);
  const isStarred = (item) => starredIds.has(item.id);
  const found = items.filter((item) => matchesFilter(item, { starred: true }, {}, undefined, isStarred));
  assert.equal(found.length, 2);
  assert.equal(countActiveFilters({ starred: true, stage: "reviewing" }), 2);
});

test("the active selection can be read back in words", () => {
  assert.deepEqual(describeFilter({ stage: "reviewing", attention: "waiting_on_them" }), [
    "Reviewing",
    "Waiting on them",
  ]);
  assert.deepEqual(describeFilter({ starred: true }), ["Starred"]);
  assert.deepEqual(describeFilter({}), []);
});

test("a queue that means nothing outstanding selects no flag", () => {
  // It used to map to "no action needed", which no longer exists. Returning
  // null clears the filter instead of selecting a row that is not there.
  assert.equal(queueToAttention("up_to_date"), null);
  assert.equal(queueToAttention("anything_unknown"), null);
  assert.equal(queueToAttention("interview_follow_up"), "ready_for_decision");
  assert.equal(queueToAttention("decision_needed"), "decision_not_sent");
});
