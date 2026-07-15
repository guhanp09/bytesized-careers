import test from "node:test";
import assert from "node:assert/strict";

import {
  importFlowReducer,
  initialImportFlowState,
  seedCategory,
  suggestedCategory,
} from "../lib/importJob/flowMachine.ts";
import { parseJobPost } from "../lib/importJob/parseJobPost.ts";
import { MAX_IMPORT_CHARS } from "../lib/importJob/normalize.ts";

const reduce = (state, ...events) => events.reduce(importFlowReducer, state);

const CONFIDENT_POST = "Hiring a video editor for our YouTube channel.\nPay: ₹20,000–₹30,000 per month\nRemote.";
const UNCERTAIN_POST = "Looking for a podcast producer for our weekly show. ₹30,000 per month. Remote.";
const CONFLICT_POST = "Hiring a video editor and a thumbnail designer.\n₹30,000 per month. Remote.";
const NOT_A_JOB = "The mountains were quiet that morning. Tea helped a lot.";

test("TEXT_CHANGED truncates codepoint-safe at 20k and sets a sticky flag; ANALYZE stays enabled", () => {
  const big = "🎬".repeat(MAX_IMPORT_CHARS + 50);
  let state = reduce(initialImportFlowState, { type: "TEXT_CHANGED", text: big });
  assert.equal(state.truncatedAtLimit, true);
  assert.equal(Array.from(state.text).length, MAX_IMPORT_CHARS);
  // The flag is sticky through later edits below the limit.
  state = reduce(state, { type: "TEXT_CHANGED", text: "shorter now" });
  assert.equal(state.truncatedAtLimit, true);
  // ANALYZE is not blocked by truncation (truncate-and-retain, D20).
  state = reduce(state, { type: "ANALYZE" });
  assert.equal(state.phase, "analyzing");
});

test("ANALYZE requires non-empty text and only fires from paste", () => {
  assert.equal(reduce(initialImportFlowState, { type: "ANALYZE" }).phase, "paste");
  const whitespace = reduce(initialImportFlowState, { type: "TEXT_CHANGED", text: "   " }, { type: "ANALYZE" });
  assert.equal(whitespace.phase, "paste");
});

test("RESTORE_SOURCE only fills an empty paste state", () => {
  const restored = reduce(initialImportFlowState, { type: "RESTORE_SOURCE", text: "old paste" });
  assert.equal(restored.text, "old paste");
  assert.equal(restored.restoredFromSession, true);
  const notOverwritten = reduce(
    initialImportFlowState,
    { type: "TEXT_CHANGED", text: "fresh" },
    { type: "RESTORE_SOURCE", text: "old paste" }
  );
  assert.equal(notOverwritten.text, "fresh");
});

test("ANALYZE_DONE routes to review for job posts and notJobLikely otherwise", () => {
  const toAnalyzing = (text) =>
    reduce(initialImportFlowState, { type: "TEXT_CHANGED", text }, { type: "ANALYZE" });
  const review = reduce(toAnalyzing(CONFIDENT_POST), { type: "ANALYZE_DONE", result: parseJobPost(CONFIDENT_POST) });
  assert.equal(review.phase, "review");
  const rejected = reduce(toAnalyzing(NOT_A_JOB), { type: "ANALYZE_DONE", result: parseJobPost(NOT_A_JOB) });
  assert.equal(rejected.phase, "notJobLikely");
  // PARSE_ANYWAY overrides the classifier.
  const overridden = reduce(rejected, { type: "PARSE_ANYWAY" });
  assert.equal(overridden.phase, "review");
});

test("confident mapping seeds chosenCategory; uncertain mapping seeds null", () => {
  assert.equal(seedCategory(parseJobPost(CONFIDENT_POST)), "Editing");
  assert.equal(seedCategory(parseJobPost(UNCERTAIN_POST)), null);
  assert.equal(seedCategory(parseJobPost(CONFLICT_POST)), null); // conflict → unconfirmed
  // The suggestion is still available for the outlined "Suggested" chip.
  assert.equal(suggestedCategory(parseJobPost(UNCERTAIN_POST), null), "Channel Manager");
});

test("CONTINUE_TO_EDITOR is blocked while chosenCategory is null and unblocked by SELECT_CATEGORY", () => {
  const result = parseJobPost(UNCERTAIN_POST);
  let state = reduce(
    initialImportFlowState,
    { type: "TEXT_CHANGED", text: UNCERTAIN_POST },
    { type: "ANALYZE" },
    { type: "ANALYZE_DONE", result }
  );
  assert.equal(state.phase, "review");
  assert.equal(state.chosenCategory, null);
  // Blocked until an explicit selection.
  assert.equal(reduce(state, { type: "CONTINUE_TO_EDITOR" }).phase, "review");
  state = reduce(state, { type: "SELECT_CATEGORY", category: "Channel Manager" });
  assert.equal(state.chosenCategory, "Channel Manager");
  state = reduce(state, { type: "CONTINUE_TO_EDITOR" });
  assert.equal(state.phase, "handingOff");
});

test("CONTINUE_TO_EDITOR is idempotent in handingOff", () => {
  const result = parseJobPost(CONFIDENT_POST);
  const handingOff = reduce(
    initialImportFlowState,
    { type: "TEXT_CHANGED", text: CONFIDENT_POST },
    { type: "ANALYZE" },
    { type: "ANALYZE_DONE", result },
    { type: "CONTINUE_TO_EDITOR" }
  );
  assert.equal(handingOff.phase, "handingOff");
  assert.equal(reduce(handingOff, { type: "CONTINUE_TO_EDITOR" }), handingOff);
});

test("title-choice recomputes the category suggestion; uncertain still needs confirmation", () => {
  const result = parseJobPost(CONFLICT_POST);
  let state = reduce(
    initialImportFlowState,
    { type: "TEXT_CHANGED", text: CONFLICT_POST },
    { type: "ANALYZE" },
    { type: "ANALYZE_DONE", result }
  );
  assert.equal(state.chosenTitleIndex, 0);
  assert.equal(state.chosenCategory, null);
  const alts = result.draft.title.alternatives.map((a) => a.value);
  const idx = alts.indexOf("Thumbnail Designer");
  state = reduce(state, { type: "SELECT_TITLE_ALTERNATIVE", index: idx });
  assert.equal(state.chosenTitleIndex, idx);
  assert.equal(suggestedCategory(result, idx), "Thumbnails");
  // Out-of-range index is ignored.
  assert.equal(reduce(state, { type: "SELECT_TITLE_ALTERNATIVE", index: 99 }).chosenTitleIndex, idx);
});

test("BACK_TO_EDIT keeps the text from review, notJobLikely, and parseError", () => {
  const result = parseJobPost(CONFIDENT_POST);
  const review = reduce(
    initialImportFlowState,
    { type: "TEXT_CHANGED", text: CONFIDENT_POST },
    { type: "ANALYZE" },
    { type: "ANALYZE_DONE", result }
  );
  const back = reduce(review, { type: "BACK_TO_EDIT" });
  assert.equal(back.phase, "paste");
  assert.equal(back.text, CONFIDENT_POST);
  const failed = reduce(
    initialImportFlowState,
    { type: "TEXT_CHANGED", text: "x" },
    { type: "ANALYZE" },
    { type: "ANALYZE_FAILED", message: "boom" }
  );
  assert.equal(failed.phase, "parseError");
  assert.equal(reduce(failed, { type: "BACK_TO_EDIT" }).text, "x");
});

test("RESET returns to a clean paste state and clears the truncation flag", () => {
  const big = "a".repeat(MAX_IMPORT_CHARS + 10);
  const state = reduce(initialImportFlowState, { type: "TEXT_CHANGED", text: big }, { type: "RESET" });
  assert.deepEqual(state, initialImportFlowState);
});
