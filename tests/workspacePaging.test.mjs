import test from "node:test";
import assert from "node:assert/strict";

import {
  INBOX_PAGE_SIZE,
  PIPELINE_FOCUSED_PAGE_SIZE,
  PIPELINE_STAGE_PAGE_SIZE,
  boundedPage,
  loadMoreLabel,
  loadedAnnouncement,
  nextLimit,
  showingLabel,
} from "../lib/workspacePaging.ts";

const list = (n) => Array.from({ length: n }, (_, index) => ({ id: `r${index}` }));

test("a page renders at most its limit but reports the true total", () => {
  // The whole point: two different numbers, and the smaller one must never be
  // mistaken for the larger.
  const page = boundedPage(list(329), 40);
  assert.equal(page.rendered.length, 40);
  assert.equal(page.total, 329);
  assert.equal(page.remaining, 289);
  assert.equal(page.hasMore, true);
});

test("a list shorter than the limit renders whole and says there is no more", () => {
  const page = boundedPage(list(7), 40);
  assert.equal(page.rendered.length, 7);
  assert.equal(page.total, 7);
  assert.equal(page.remaining, 0);
  assert.equal(page.hasMore, false);
});

test("an empty list is a page, not a crash", () => {
  const page = boundedPage([], 40);
  assert.deepEqual(page.rendered, []);
  assert.equal(page.total, 0);
  assert.equal(page.hasMore, false);
});

test("ordering is preserved exactly", () => {
  const all = list(100);
  const page = boundedPage(all, 40);
  assert.deepEqual(page.rendered.map((item) => item.id), all.slice(0, 40).map((item) => item.id));
});

test("the window grows to reach a record that must stay rendered", () => {
  // A deep link or a remembered conversation can point at row 137. Rendering the
  // detail while hiding its row reads as a bug.
  const all = list(329);
  const page = boundedPage(all, 40, { mustInclude: (item) => item.id === "r137", pageSize: 40 });
  assert.ok(page.rendered.some((item) => item.id === "r137"));
  // Expanded to the page boundary containing it, not to exactly that row.
  assert.equal(page.limit, 160);
  assert.equal(page.rendered.length, 160);
  assert.equal(page.total, 329);
});

test("the window grows far enough for every record that must stay rendered", () => {
  // A bulk selection, or a set of cards just moved into a stage, is several
  // records at once. Expanding only as far as the first would drop the rest.
  const all = list(329);
  const keep = new Set(["r45", "r118", "r201"]);
  const page = boundedPage(all, 12, { mustInclude: (item) => keep.has(item.id), pageSize: 12 });
  for (const id of keep) {
    assert.ok(page.rendered.some((item) => item.id === id), `${id} was dropped`);
  }
  assert.ok(page.rendered.length < all.length, "expansion should still be bounded");
});

test("a record already inside the window does not grow it", () => {
  const page = boundedPage(list(329), 40, { mustInclude: (item) => item.id === "r3", pageSize: 40 });
  assert.equal(page.rendered.length, 40);
});

test("a record that is not in the list at all leaves the window alone", () => {
  // A stale remembered id must not expand the page to everything.
  const page = boundedPage(list(329), 40, { mustInclude: (item) => item.id === "nope", pageSize: 40 });
  assert.equal(page.rendered.length, 40);
});

test("expansion never renders more than exists", () => {
  const page = boundedPage(list(45), 40, { mustInclude: (item) => item.id === "r44", pageSize: 40 });
  assert.equal(page.rendered.length, 45);
  assert.equal(page.hasMore, false);
});

test("loading more advances by a fixed step and stops at the total", () => {
  // Doubling would reach "everything" in three presses, which is the behaviour
  // this exists to prevent.
  assert.equal(nextLimit(40, 40, 329), 80);
  assert.equal(nextLimit(320, 40, 329), 329);
  assert.equal(nextLimit(329, 40, 329), 329);
});

test("loading more twice does not skip or repeat records", () => {
  const all = list(329);
  let limit = INBOX_PAGE_SIZE;
  const first = boundedPage(all, limit);
  limit = nextLimit(limit, INBOX_PAGE_SIZE, first.total);
  const second = boundedPage(all, limit);
  limit = nextLimit(limit, INBOX_PAGE_SIZE, second.total);
  const third = boundedPage(all, limit);

  assert.equal(third.rendered.length, 120);
  const ids = third.rendered.map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length, "a record was rendered twice");
  // Each page is a prefix of the next, so nothing is skipped in between.
  assert.deepEqual(first.rendered.map((i) => i.id), ids.slice(0, 40));
  assert.deepEqual(second.rendered.map((i) => i.id), ids.slice(0, 80));
});

test("every record is reachable by loading repeatedly", () => {
  const all = list(329);
  let limit = INBOX_PAGE_SIZE;
  let page = boundedPage(all, limit);
  let presses = 0;
  while (page.hasMore) {
    limit = nextLimit(limit, INBOX_PAGE_SIZE, page.total);
    page = boundedPage(all, limit);
    presses += 1;
    assert.ok(presses < 100, "loading more stopped making progress");
  }
  assert.equal(page.rendered.length, 329);
  assert.equal(page.remaining, 0);
  assert.deepEqual(page.rendered.map((i) => i.id), all.map((i) => i.id));
});

test("the control names what pressing it will add, and clamps at the end", () => {
  assert.equal(loadMoreLabel({ remaining: 289 }, 40, "conversation"), "Load 40 more conversations");
  assert.equal(loadMoreLabel({ remaining: 9 }, 40, "conversation"), "Load 9 more conversations");
  assert.equal(loadMoreLabel({ remaining: 1 }, 40, "conversation"), "Load 1 more conversation");
  assert.equal(loadMoreLabel({ remaining: 3 }, 12, "card"), "Load 3 more cards");
});

test("the announcement is past tense and carries both numbers", () => {
  // "Loading…" on a control that has already finished is noise, and "more items"
  // does not tell someone whether the press worked.
  assert.equal(
    loadedAnnouncement(40, 80, 329, "conversation"),
    "40 more conversations loaded. Showing 80 of 329."
  );
  assert.equal(loadedAnnouncement(1, 41, 41, "conversation"), "1 more conversation loaded. Showing 41 of 41.");
});

test("the showing line never conflates rendered with total", () => {
  assert.equal(showingLabel({ rendered: list(40), total: 329 }, "conversation"), "Showing 40 of 329 conversations");
  assert.equal(showingLabel({ rendered: list(1), total: 1 }, "conversation"), "Showing 1 of 1 conversation");
});

test("the default limits are bounded and ordered sensibly", () => {
  // A focused stage may show more than a stage on the full board, but focusing
  // is not permission to render everything — that is how 214 cards happened.
  assert.ok(PIPELINE_STAGE_PAGE_SIZE < PIPELINE_FOCUSED_PAGE_SIZE);
  assert.ok(PIPELINE_FOCUSED_PAGE_SIZE < 214, "a focused stage must still bound the 214-applicant job");
  assert.ok(INBOX_PAGE_SIZE < 329, "the inbox page must bound the busy scenario");
  for (const size of [INBOX_PAGE_SIZE, PIPELINE_STAGE_PAGE_SIZE, PIPELINE_FOCUSED_PAGE_SIZE]) {
    assert.ok(size > 0 && Number.isInteger(size));
  }
});

test("the 214-applicant stage renders a bounded first page", () => {
  const page = boundedPage(list(214), PIPELINE_STAGE_PAGE_SIZE);
  assert.equal(page.rendered.length, PIPELINE_STAGE_PAGE_SIZE);
  assert.equal(page.total, 214);
  assert.equal(page.remaining, 214 - PIPELINE_STAGE_PAGE_SIZE);
  const focused = boundedPage(list(214), PIPELINE_FOCUSED_PAGE_SIZE);
  assert.equal(focused.rendered.length, PIPELINE_FOCUSED_PAGE_SIZE);
  assert.equal(focused.total, 214);
});
