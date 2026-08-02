import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const {
  activeJobImportStage,
  jobImportDelayMessage,
  jobImportProgressRatio,
  jobImportStageOrder,
  jobImportStages,
} = await import("../lib/jobImportProgress.ts");

const draft = (overrides = {}) => ({
  id: "draft-1",
  processing_status: "processing",
  validation_status: "not_validated",
  confirmation_state: "unreviewed",
  can_apply_to_native_draft: false,
  can_publish_directly: false,
  fields: [],
  recruiter_prefill: {},
  early_question_fields: [],
  ...overrides,
});

const input = (overrides = {}) => ({
  sourceType: "pasted_text",
  draft: null,
  sourceCreated: false,
  nativeDraftReady: false,
  ...overrides,
});

const idsWithStatus = (stages, status) =>
  stages.filter((stage) => stage.status === status).map((stage) => stage.id);

test("nothing is claimed before any state has been observed", () => {
  const stages = jobImportStages(input());
  assert.equal(idsWithStatus(stages, "complete").length, 0);
  assert.equal(jobImportProgressRatio(input()), 0);
  assert.equal(activeJobImportStage(input())?.id, "source_accepted");
});

test("a URL import reports the extra retrieval stage; pasted text does not", () => {
  assert.ok(jobImportStageOrder("public_url").includes("page_retrieved"));
  assert.ok(!jobImportStageOrder("pasted_text").includes("page_retrieved"));
});

test("creating the source completes exactly one stage and no more", () => {
  const state = input({ sourceCreated: true });
  assert.deepEqual(idsWithStatus(jobImportStages(state), "complete"), [
    "source_accepted",
  ]);
});

test("the unmeasurable extraction stage is active and indeterminate, never partial", () => {
  const state = input({
    sourceCreated: true,
    draft: draft({ processing_status: "processing" }),
  });
  const active = activeJobImportStage(state);
  assert.equal(active?.id, "structuring");
  assert.equal(active?.indeterminate, true);

  // The bar holds what has been earned. The in-flight stage contributes nothing,
  // because contributing a fraction of unmeasurable work is a fake percentage.
  const order = jobImportStageOrder("pasted_text");
  const completed = idsWithStatus(jobImportStages(state), "complete").length;
  assert.equal(jobImportProgressRatio(state), completed / order.length);
  assert.ok(jobImportProgressRatio(state) < 1);
});

test("progress does not advance while the draft merely sits in processing", () => {
  const first = input({ sourceCreated: true, draft: draft() });
  const later = input({ sourceCreated: true, draft: draft() });
  // Same observed state, so the same claim. There is no elapsed-time input to
  // this module, which is what makes a creeping percentage impossible.
  assert.equal(jobImportProgressRatio(first), jobImportProgressRatio(later));
});

test("extraction returning is what completes the structuring and merge stages", () => {
  const before = input({ sourceCreated: true, draft: draft() });
  const after = input({
    sourceCreated: true,
    draft: draft({ processing_status: "awaiting_recruiter_review" }),
  });
  assert.ok(jobImportProgressRatio(after) > jobImportProgressRatio(before));
  const completed = idsWithStatus(jobImportStages(after), "complete");
  assert.ok(completed.includes("structuring"));
  assert.ok(completed.includes("provider_returned"));
  assert.ok(completed.includes("validated"));
  assert.ok(completed.includes("answers_merged"));
  // The native draft does not exist yet, so the final stage stays unclaimed.
  assert.ok(!completed.includes("draft_prepared"));
  assert.ok(jobImportProgressRatio(after) < 1);
});

test("only a real native draft completes the bar", () => {
  const state = input({
    sourceCreated: true,
    draft: draft({ processing_status: "ready_to_apply" }),
    nativeDraftReady: true,
  });
  assert.equal(jobImportProgressRatio(state), 1);
  assert.equal(activeJobImportStage(state), null);
});

test("completed stages never regress when a later stage fails", () => {
  const working = input({
    sourceCreated: true,
    draft: draft({ processing_status: "processing" }),
  });
  const failed = { ...working, failed: true };
  assert.equal(jobImportProgressRatio(failed), jobImportProgressRatio(working));
  assert.deepEqual(
    idsWithStatus(jobImportStages(failed), "complete"),
    idsWithStatus(jobImportStages(working), "complete")
  );
});

test("failure stops progress instead of continuing to advance", () => {
  const state = input({
    sourceCreated: true,
    draft: draft({ processing_status: "processing" }),
    failed: true,
  });
  const stages = jobImportStages(state);
  assert.equal(activeJobImportStage(state), null);
  assert.deepEqual(idsWithStatus(stages, "failed"), ["structuring"]);
});

test("delay reassurance is only offered while extraction is genuinely running", () => {
  const running = input({
    sourceCreated: true,
    draft: draft({ processing_status: "processing" }),
  });
  assert.ok(jobImportDelayMessage(running, 400));

  const done = input({
    sourceCreated: true,
    draft: draft({ processing_status: "ready_to_apply" }),
    nativeDraftReady: true,
  });
  // Nothing is in flight, so there is nothing truthful to reassure about.
  assert.equal(jobImportDelayMessage(done, 400), null);
});

test("the long-source reassurance is only used when the source really is long", () => {
  const running = input({
    sourceCreated: true,
    draft: draft({ processing_status: "processing" }),
  });
  assert.match(jobImportDelayMessage(running, 20_000), /detailed post/i);
  assert.doesNotMatch(jobImportDelayMessage(running, 200), /detailed post/i);
});

test("the module cannot invent progress: it reads no clock and holds no state", () => {
  const source = readFileSync(new URL("../lib/jobImportProgress.ts", import.meta.url), "utf8");
  for (const forbidden of [
    "Date.now",
    "setTimeout",
    "setInterval",
    "performance.now",
    "Math.random",
  ]) {
    assert.ok(
      !source.includes(forbidden),
      `jobImportProgress must not use ${forbidden}: progress has to come from observed state`
    );
  }
});

test("stage labels stay recruiter-facing and expose no internals", () => {
  const labels = jobImportStages(
    input({ sourceType: "public_url", sourceCreated: true })
  ).map((stage) => stage.label.toLowerCase());
  for (const leak of [
    "provider",
    "openai",
    "schema",
    "json",
    "parse",
    "parsing",
    "evidence-span",
    "lifecycle",
    "token",
  ]) {
    assert.ok(
      labels.every((label) => !label.includes(leak)),
      `stage labels must not expose "${leak}"`
    );
  }
});

// ---------------------------------------------------------------------------
// Checkpointed waiting
// ---------------------------------------------------------------------------

test("waiting pauses the bar instead of animating it", async () => {
  const { pausedJobImportStage } = await import("../lib/jobImportProgress.ts");
  const running = input({
    sourceCreated: true,
    draft: draft({ processing_status: "awaiting_recruiter_review" }),
  });
  const waiting = { ...running, waitingForRecruiter: true };

  // The stage that would have been active is paused, not running.
  assert.equal(activeJobImportStage(waiting), null);
  assert.ok(pausedJobImportStage(waiting));
  assert.equal(pausedJobImportStage(running), null);

  // A paused stage is never "indeterminate": nothing is in flight to be
  // uncertain about, so there is nothing to animate.
  assert.equal(pausedJobImportStage(waiting).indeterminate, false);
});

test("progress holds exactly where it was when the question opened", () => {
  const running = input({
    sourceCreated: true,
    draft: draft({ processing_status: "awaiting_recruiter_review" }),
  });
  const waiting = { ...running, waitingForRecruiter: true };
  // Everything earned is kept; nothing further is claimed.
  assert.equal(jobImportProgressRatio(waiting), jobImportProgressRatio(running));
  assert.ok(jobImportProgressRatio(waiting) < 1);
});

test("no slow-run reassurance is offered while nothing is running", () => {
  const waiting = input({
    sourceCreated: true,
    draft: draft({ processing_status: "processing" }),
    waitingForRecruiter: true,
  });
  // Saying "this is taking a while" when the assistant is idle would be a lie.
  assert.equal(jobImportDelayMessage(waiting, 20_000), null);
});

test("waiting and failure are different states, not two words for stopped", () => {
  const base = input({
    sourceCreated: true,
    draft: draft({ processing_status: "processing" }),
  });
  const waitingStages = jobImportStages({ ...base, waitingForRecruiter: true });
  const failedStages = jobImportStages({ ...base, failed: true });

  assert.ok(waitingStages.some((stage) => stage.status === "waiting"));
  assert.ok(!waitingStages.some((stage) => stage.status === "failed"));
  assert.ok(failedStages.some((stage) => stage.status === "failed"));
  assert.ok(!failedStages.some((stage) => stage.status === "waiting"));
});
