import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  CLASSIFICATION_PLANES,
  attentionOf,
  classificationCounts,
  classify,
  countActiveFilters,
  describeFilter,
  isActiveRecord,
  matchesFilter,
  openedStatusOf,
  reviewProgressOf,
} from "../lib/reviewClassification.ts";
import { toOwnerInteractions } from "../lib/seed/scenarioManifest.ts";

/**
 * Three questions, asked separately — and each answered exactly once.
 *
 * The old menu reconciled numerically and was still unreadable, because its
 * three names answered three different questions and a flat list had to pick
 * one. These hold the property that replaces it: every plane is a partition of
 * a *stated* denominator, so the reader never has to guess which numbers are
 * supposed to agree.
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

/* ---- the partitions ------------------------------------------------------ */

test("review progress accounts for every active record", () => {
  for (const scenario of SCENARIOS) {
    for (const mode of MODES) {
      const items = interactionsFor(scenario, mode);
      const { total, review } = classificationCounts(items);
      const summed = [...review.values()].reduce((a, b) => a + b, 0);
      assert.equal(
        summed,
        total,
        `${scenario}/${mode}: review progress sums to ${summed} of ${total}`
      );
    }
  }
});

test("where-it-stands accounts for every opened record, and only those", () => {
  for (const scenario of SCENARIOS) {
    for (const mode of MODES) {
      const items = interactionsFor(scenario, mode);
      const { opened, review, status } = classificationCounts(items);
      const summed = [...status.values()].reduce((a, b) => a + b, 0);
      assert.equal(summed, opened, `${scenario}/${mode}: status sums to ${summed} of ${opened} opened`);
      // And "opened" is the same number the first plane reports.
      assert.equal(review.get("opened") ?? 0, opened);
    }
  }
});

test("attention accounts for every active record", () => {
  for (const scenario of SCENARIOS) {
    for (const mode of MODES) {
      const items = interactionsFor(scenario, mode);
      const { total, attention } = classificationCounts(items);
      const summed = [...attention.values()].reduce((a, b) => a + b, 0);
      assert.equal(summed, total, `${scenario}/${mode}: attention sums to ${summed} of ${total}`);
    }
  }
});

test("everything = not opened + opened", () => {
  const items = interactionsFor("busy", "recruiter");
  const { total, review } = classificationCounts(items);
  assert.equal((review.get("unopened") ?? 0) + (review.get("opened") ?? 0), total);
});

test("no record answers a plane twice", () => {
  const items = interactionsFor("busy", "recruiter").filter(isActiveRecord);
  for (const item of items) {
    const seen = classify(item);
    assert.equal(typeof seen.review, "string");
    assert.equal(typeof seen.attention, "string");
    // Status is the one plane that may legitimately be absent.
    if (seen.review === "unopened") assert.equal(seen.status, null);
    else assert.ok(seen.status, `${item.id} is opened but has no position`);
  }
});

test("archived records are outside every plane, because Archived is a scope", () => {
  const items = interactionsFor("default", "recruiter");
  const archived = items.filter((item) => !isActiveRecord(item));
  assert.ok(archived.length > 0, "no archived record to check");
  const { total } = classificationCounts(items);
  assert.equal(total, items.length - archived.length);
});

/* ---- what each plane actually says --------------------------------------- */

test("a record you sent is never 'not opened' — there is nothing for you to open", () => {
  const items = interactionsFor("talent", "talent").filter(
    (item) => item.direction === "sent" && isActiveRecord(item)
  );
  assert.ok(items.length > 0, "no sent record to check");
  for (const item of items) assert.equal(reviewProgressOf(item), "opened");
});

test("an untouched received record is not opened, and has no position yet", () => {
  const items = interactionsFor("busy", "recruiter").filter(
    (item) => item.direction === "received" && item.backendStatus === "new" && isActiveRecord(item)
  );
  assert.ok(items.length > 0, "no untouched record to check");
  for (const item of items) {
    assert.equal(reviewProgressOf(item), "unopened");
    // Inventing a management position for something nobody has read would be
    // the product asserting a judgement no one made.
    assert.equal(openedStatusOf(item), null);
  }
});

test("Ready for decision means the interview happened and nothing was recorded", () => {
  // Objective evidence, not "we could not think of anything else".
  const [item] = interactionsFor("default", "recruiter").filter(
    (entry) => entry.direction === "received" && isActiveRecord(entry)
  );
  assert.equal(attentionOf(item, { interviewFollowUpDue: true, interviewScheduled: true }), "ready_for_decision");
});

test("an unread message of unclear intent is something to read, not a decision", () => {
  const [item] = interactionsFor("default", "recruiter").filter(
    (entry) => entry.direction === "received" && isActiveRecord(entry)
  );
  const attention = attentionOf(item, { unreadCount: 2 });
  assert.notEqual(attention, "ready_for_decision");
  assert.ok(["unread_activity", "needs_your_reply"].includes(attention), `got ${attention}`);
});

test("nothing claims the recruiter has everything they need", () => {
  // The old copy asserted exactly that on the evidence that nothing else had
  // matched. Every description now states an observable fact.
  const attention = CLASSIFICATION_PLANES.find((plane) => plane.key === "attention");
  for (const option of attention.options) {
    assert.doesNotMatch(option.description, /everything you need/i);
    assert.ok(option.description.length > 15, `${option.key} explains nothing`);
  }
});

test("every plane states what its counts add up to", () => {
  for (const plane of CLASSIFICATION_PLANES) {
    assert.ok(plane.denominator, `${plane.key} does not say what it reconciles against`);
    assert.ok(plane.options.length >= 2);
    for (const option of plane.options) {
      assert.ok(option.label.length > 2);
      assert.ok(option.description.length > 15, `${plane.key}/${option.key} has no description`);
    }
  }
});

/* ---- combining ----------------------------------------------------------- */

test("planes combine to narrow, because they answer different questions", () => {
  const items = interactionsFor("busy", "recruiter").filter(isActiveRecord);
  const opened = items.filter((item) => matchesFilter(item, { review: "opened" }));
  const openedReviewing = items.filter((item) =>
    matchesFilter(item, { review: "opened", status: "reviewing" })
  );
  assert.ok(openedReviewing.length > 0, "no opened+reviewing record");
  assert.ok(openedReviewing.length <= opened.length, "combining a plane must never widen");
  for (const item of openedReviewing) {
    assert.equal(classify(item).review, "opened");
    assert.equal(classify(item).status, "reviewing");
  }
});

test("an impossible combination returns nothing rather than lying", () => {
  const items = interactionsFor("busy", "recruiter");
  const impossible = items.filter((item) =>
    matchesFilter(item, { review: "unopened", status: "hired" })
  );
  assert.equal(impossible.length, 0);
});

test("Starred cuts across the planes rather than being one of them", () => {
  const items = interactionsFor("default", "recruiter").filter(isActiveRecord);
  const starredIds = new Set([items[0].id, items[1].id]);
  const isStarred = (item) => starredIds.has(item.id);
  const found = items.filter((item) => matchesFilter(item, { starred: true }, {}, undefined, isStarred));
  assert.equal(found.length, 2);
  assert.equal(countActiveFilters({ starred: true, review: "opened" }), 2);
});

test("the active selection can be read back in words", () => {
  assert.deepEqual(describeFilter({ review: "opened", attention: "waiting_on_them" }), [
    "Opened",
    "Waiting on them",
  ]);
  assert.deepEqual(describeFilter({ starred: true }), ["Starred"]);
  assert.deepEqual(describeFilter({}), []);
});
