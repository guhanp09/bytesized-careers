import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  WORK_CATEGORY_ORDER,
  deriveWorkCategory,
  deriveWorkQueue,
  workCategoryByKey,
  workCategoryCounts,
} from "../lib/workQueues.ts";
import { toOwnerInteractions } from "../lib/seed/scenarioManifest.ts";

/**
 * Work categories have to explain the whole list.
 *
 * The selector used to be built on `deriveWorkQueue`, which answers "what needs
 * me?" and so returns null for everything that needs nothing. That is the right
 * answer to that question and the wrong basis for a menu: it showed 162
 * applicants beside 24 "Decision needed" and 32 "New to review" and left 106
 * records in no category at all, which reads as data going missing.
 *
 * These tests hold the property that fixes it — one category per record, and the
 * parts add up to the whole.
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

const noSignals = () => ({});

test("every record lands in exactly one category", () => {
  for (const scenario of ["default", "busy", "edge", "talent", "recruiter"]) {
    for (const mode of ["recruiter", "talent"]) {
      const items = interactionsFor(scenario, mode);
      for (const item of items) {
        const key = deriveWorkCategory(item, {}, undefined);
        assert.ok(key, `${scenario}/${mode} ${item.id} has no category`);
        assert.ok(
          WORK_CATEGORY_ORDER.some((entry) => entry.key === key),
          `${scenario}/${mode} ${item.id} has unknown category ${key}`
        );
      }
    }
  }
});

test("category counts sum exactly to the population", () => {
  // The invariant the redesign exists for. Asserted across every scenario and
  // both personas, because a partition that only holds for one dataset is a
  // coincidence.
  for (const scenario of ["default", "busy", "edge", "talent", "recruiter"]) {
    for (const mode of ["recruiter", "talent"]) {
      const items = interactionsFor(scenario, mode);
      const { total, counts } = workCategoryCounts(items, noSignals);
      const summed = [...counts.values()].reduce((a, b) => a + b, 0);
      assert.equal(total, items.length);
      assert.equal(
        summed,
        total,
        `${scenario}/${mode}: categories sum to ${summed} but there are ${total} records`
      );
    }
  }
});

test("no record is counted under two categories", () => {
  const items = interactionsFor("busy", "recruiter");
  const seen = new Map();
  for (const item of items) {
    const key = deriveWorkCategory(item, {}, undefined);
    assert.ok(!seen.has(item.id), `${item.id} categorised twice`);
    seen.set(item.id, key);
  }
  assert.equal(seen.size, items.length);
});

test("a record needing nothing is accounted for rather than dropped", () => {
  // This is the 106 records the old menu lost.
  const items = interactionsFor("default", "recruiter");
  const unqueued = items.filter((item) => deriveWorkQueue(item, {}, undefined) === null);
  assert.ok(unqueued.length > 0, "no record was outside an actionable queue to check");
  for (const item of unqueued) {
    const key = deriveWorkCategory(item, {}, undefined);
    assert.ok(
      ["up_to_date", "snoozed", "no_reply_needed"].includes(key),
      `${item.id} needs nothing but was categorised ${key}`
    );
  }
});

test("snoozing moves a record to Snoozed rather than to Up to date", () => {
  // Otherwise hiding something would report it as fine, which is a different
  // claim entirely.
  const item = interactionsFor("default", "recruiter")[0];
  const snoozed = {
    isDismissed: () => false,
    snoozedUntil: (id) => (id === item.id ? Date.now() + 60_000 : null),
  };
  assert.equal(deriveWorkCategory(item, {}, snoozed), "snoozed");
  const expired = {
    isDismissed: () => false,
    snoozedUntil: () => Date.now() - 60_000,
  };
  assert.notEqual(deriveWorkCategory(item, {}, expired), "snoozed");
});

test("dismissing a record reads as No reply needed, not Up to date", () => {
  const item = interactionsFor("default", "recruiter")[0];
  const dismissed = { isDismissed: () => true, snoozedUntil: () => null };
  assert.equal(deriveWorkCategory(item, {}, dismissed), "no_reply_needed");
});

test("snooze outranks dismissal, so a hidden record is never double-explained", () => {
  const item = interactionsFor("default", "recruiter")[0];
  const both = { isDismissed: () => true, snoozedUntil: () => Date.now() + 60_000 };
  assert.equal(deriveWorkCategory(item, {}, both), "snoozed");
});

test("the actionable categories still agree with the queue derivation", () => {
  // The category model extends the queues; it must not quietly re-decide them.
  const items = interactionsFor("recruiter", "recruiter");
  for (const item of items) {
    const queue = deriveWorkQueue(item, {}, undefined);
    if (!queue) continue;
    assert.equal(deriveWorkCategory(item, {}, undefined), queue, `${item.id} disagrees`);
  }
});

test("every category can explain itself", () => {
  // A menu row that names a state without saying what it means is a label, not
  // an explanation — "Decision needed" in particular has to state its criteria.
  for (const category of WORK_CATEGORY_ORDER) {
    assert.ok(category.label.length > 2, `${category.key} has no label`);
    assert.ok(
      category.description.length > 20,
      `${category.key} has no real description`
    );
    assert.equal(workCategoryByKey(category.key).key, category.key);
  }
  const decision = workCategoryByKey("decision_needed");
  assert.match(decision.description, /unclear|choose|close/i);
});

test("the busy scenario's applicants are fully explained", () => {
  // The concrete case from the report: a large population where the visible
  // categories previously covered barely a third of it.
  const items = interactionsFor("busy", "recruiter").filter(
    (item) => item.kind === "application" && item.direction === "received"
  );
  const { total, counts } = workCategoryCounts(items, noSignals);
  assert.ok(total > 100, `expected a large population, got ${total}`);
  assert.equal([...counts.values()].reduce((a, b) => a + b, 0), total);
});
