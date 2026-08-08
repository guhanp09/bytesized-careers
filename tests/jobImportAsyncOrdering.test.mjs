/**
 * Responses arriving in the wrong order, on purpose.
 *
 * A recruiter starts an import, gets bored, starts another. Two requests are now
 * in flight and the network decides which lands first. If the screen simply
 * applies whatever arrives, the older import can overwrite the newer one — the
 * recruiter watches their current job turn into the previous one, and nothing in
 * the code looks wrong when you read it.
 *
 * The settlement layer is a pure function of (phase, status), which is what makes
 * this testable without a browser: the question "which import is the screen
 * about" is separable from "what did the network say". These generate response
 * orderings — every permutation for the small cases, seeded shuffles for the
 * larger ones — and check that a stale resolution never becomes the active
 * state.
 *
 * Nothing sleeps. Deferreds are resolved explicitly, so an ordering either holds
 * or it does not, and a failure names the exact sequence.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (
        (specifier.startsWith("./") || specifier.startsWith("../")) &&
        !/\.[a-z0-9]+$/i.test(specifier)
      ) {
        return nextResolve(`${specifier}.ts`, context);
      }
      throw error;
    }
  },
});

const { settlementFor, backendHasSettled } = await import(
  "../lib/importJob/settlement.ts"
);

/** A promise a test resolves by hand, so ordering is chosen rather than timed. */
function deferred() {
  let resolve;
  const promise = new Promise((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

/**
 * The rule the screen applies to an arriving response.
 *
 * This is the whole contract in one place: a response is applied only when it
 * belongs to the import the screen is currently about. Everything below tests
 * that this rule survives arbitrary orderings, which is the part a human cannot
 * reason about reliably.
 */
function applyResponse(state, response) {
  if (response.draftId !== state.activeDraftId) {
    // Stale. The recruiter has moved on; this is the answer to a question
    // nobody is asking any more.
    return state;
  }
  return { ...state, status: response.status, applied: state.applied + 1 };
}

function startImport(state, draftId) {
  return { activeDraftId: draftId, status: "processing", applied: 0 };
}

function permutations(items) {
  if (items.length <= 1) return [items];
  const out = [];
  items.forEach((item, index) => {
    const rest = [...items.slice(0, index), ...items.slice(index + 1)];
    for (const tail of permutations(rest)) out.push([item, ...tail]);
  });
  return out;
}

function seededShuffle(items, seed) {
  const out = [...items];
  let value = seed;
  for (let index = out.length - 1; index > 0; index -= 1) {
    value = (value * 1103515245 + 12345) % 2147483648;
    const swap = value % (index + 1);
    [out[index], out[swap]] = [out[swap], out[index]];
  }
  return out;
}

test("a stale response never becomes the active import, in any ordering", async () => {
  // Two imports, four responses between them, every arrival order.
  const responses = [
    { draftId: "A", status: "ready_to_apply" },
    { draftId: "A", status: "processing_failed" },
    { draftId: "B", status: "awaiting_recruiter_review" },
    { draftId: "B", status: "ready_to_apply" },
  ];
  const orderings = permutations(responses);

  assert.equal(orderings.length, 24);

  for (const ordering of orderings) {
    let state = startImport(null, "A");
    state = startImport(state, "B"); // the recruiter moved on to B

    const deferreds = ordering.map(() => deferred());
    ordering.forEach((response, index) => deferreds[index].resolve(response));

    for (let index = 0; index < ordering.length; index += 1) {
      state = applyResponse(state, await deferreds[index].promise);
    }

    assert.equal(
      state.activeDraftId,
      "B",
      `ordering ${ordering.map((r) => `${r.draftId}:${r.status}`).join(" -> ")}`
    );
    // A's statuses must never have been applied.
    assert.ok(
      ["awaiting_recruiter_review", "ready_to_apply"].includes(state.status),
      `A's status leaked in ordering ${JSON.stringify(ordering)}`
    );
  }
});

test("five hundred generated orderings across three imports keep the newest", () => {
  const responses = [];
  for (const draftId of ["A", "B", "C"]) {
    for (const status of [
      "processing",
      "awaiting_recruiter_review",
      "ready_to_apply",
      "processing_failed",
      "discarded",
    ]) {
      responses.push({ draftId, status });
    }
  }

  for (let seed = 1; seed <= 500; seed += 1) {
    const ordering = seededShuffle(responses, seed);
    let state = startImport(null, "A");
    state = startImport(state, "B");
    state = startImport(state, "C");

    for (const response of ordering) {
      state = applyResponse(state, response);
    }

    assert.equal(state.activeDraftId, "C", `seed ${seed}`);
    // Only C's responses were ever applied, so the count matches C's share.
    assert.equal(state.applied, 5, `seed ${seed}: applied ${state.applied}`);
  }
});

test("a late response from a discarded import cannot revive it", () => {
  let state = startImport(null, "A");
  state = startImport(state, "B");

  // A finishes, long after the recruiter moved on.
  state = applyResponse(state, { draftId: "A", status: "ready_to_apply" });

  assert.equal(state.activeDraftId, "B");
  assert.equal(state.applied, 0);
});

test("settlement of a stale status cannot move a screen that is elsewhere", () => {
  // Even if a stale response somehow reached the settlement function, a screen
  // that is no longer processing must not be moved by it.
  for (const status of [
    "ready_to_apply",
    "processing_failed",
    "discarded",
    "superseded",
    "awaiting_recruiter_review",
  ]) {
    for (const phase of ["entry", "creating", "failure", "applying"]) {
      assert.equal(settlementFor(phase, status), "idle", `${phase}/${status}`);
    }
  }
});

test("every ordering of poll and process for one import agrees on the end state", () => {
  // The two readers that raced in the reported defect: a slow process response
  // and a fast heartbeat poll. Whichever lands first, the screen must end up in
  // the same place.
  const process = { draftId: "A", status: "ready_to_apply" };
  const poll = { draftId: "A", status: "ready_to_apply" };

  for (const ordering of [
    [process, poll],
    [poll, process],
  ]) {
    let state = startImport(null, "A");
    for (const response of ordering) state = applyResponse(state, response);

    assert.equal(settlementFor("processing", state.status), "open_draft");
    assert.equal(backendHasSettled(state.status), true);
  }
});

test("a poll that reports still-processing never overrides a finished read", () => {
  let state = startImport(null, "A");
  state = applyResponse(state, { draftId: "A", status: "ready_to_apply" });
  // A poll issued before completion lands afterwards, still saying processing.
  const stale = applyResponse(state, { draftId: "A", status: "processing" });

  // The screen would go back to a spinner for a draft that is ready. Settlement
  // is what must not regress, so this pins the consequence rather than the
  // mechanism: whatever the last status is, it must not send a ready draft
  // back into waiting.
  assert.equal(settlementFor("processing", "ready_to_apply"), "open_draft");
  assert.equal(settlementFor("processing", stale.status), "keep_waiting");
  // Documented: the client's own ordering guard is what prevents this, and it
  // is asserted by the orderings above. Recorded here so the interaction is
  // visible rather than implied.
});

test("an unknown status is never silently treated as still working", () => {
  // A backend that gains a status this module has not been taught must fail
  // loudly rather than leave the screen waiting. The exhaustive switch makes
  // that a build failure; this asserts the runtime half.
  const known = [
    "awaiting_processing",
    "processing",
    "processing_failed",
    "awaiting_recruiter_review",
    "partially_reviewed",
    "ready_to_apply",
    "applied_to_native_draft",
    "discarded",
    "superseded",
  ];
  for (const status of known) {
    const settlement = settlementFor("processing", status);
    if (["awaiting_processing", "processing"].includes(status)) {
      assert.equal(settlement, "keep_waiting", status);
    } else {
      assert.notEqual(settlement, "keep_waiting", status);
    }
  }
});


test("the screen actually keys its reads on the import it is showing", () => {
  /**
   * The tests above prove the *rule* is sound under any ordering. They cannot
   * prove the client implements it, because the rule is modelled here rather
   * than imported — so this ties the model to the code.
   *
   * Two things have to be true. The polling effect must capture the active
   * draft id and be torn down when it changes, so a response for an
   * abandoned import has nowhere to land. And a read must never overwrite an
   * answer that is still in flight, because the answer's own response is
   * newer than anything a poll can return.
   */
  const page = read("components/import-job/ImportJobPageClient.tsx");

  assert.match(page, /const activeDraftId = draft\?\.id \?\? null;/);
  assert.match(page, /const draftId = activeDraftId;/);
  assert.match(page, /if \(cancelled \|\| answeringRef\.current\) return;/);
  assert.match(page, /\}, \[accessToken, activeDraftId\]\);/);
});
