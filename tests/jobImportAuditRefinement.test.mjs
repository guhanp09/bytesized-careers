import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("import creation, processing, and apply guard duplicate mutations", () => {
  const page = read("components/import-job/ImportJobPageClient.tsx");

  assert.match(page, /if \(!accessToken \|\| processingRef\.current\) return/);
  assert.match(page, /if \(!accessToken \|\| finishingRef\.current\) return/);
  assert.match(page, /requestIdRef\.current \?\? crypto\.randomUUID\(\)/);
  assert.match(page, /idempotency_key: `url-source-\$\{requestId\}`/);
  assert.match(page, /idempotency_key: `text-source-\$\{requestId\}`/);
  assert.match(page, /requestControllerRef\.current\?\.abort\(\)/);
});

test("manual edits cannot be overwritten by repeated partial-draft hydration", () => {
  const page = read("components/PostJobPage.tsx");

  assert.match(page, /partialImportAppliedRef\.current === partialImportDraftId/);
  assert.match(page, /partialImportAppliedRef\.current = partialImportDraftId/);
  assert.match(page, /dirtyPayloadKeysRef\.current\.add\(key\)/);
  assert.match(page, /setManuallyChangedImportFields/);
  assert.match(page, /manuallyChangedImportFields\.has\(nativeField\)/);
  assert.match(page, /trackPersistedImportEdits\(completePayload\)/);
  assert.match(page, /jobImportValueWasRemoved\(payload\[nativeField\]\)/);
  assert.match(page, /partialImportTargetJobRef/);
  assert.match(page, /attachJobImportDraft/);
});

test("processing recovery polls retained drafts and clears user-facing failures", () => {
  const page = read("components/import-job/ImportJobPageClient.tsx");

  assert.match(page, /phase !== "processing"/);
  assert.match(page, /getJobImportDraft\(accessToken, draftId\)/);
  assert.match(page, /setError\(""\)/);
  assert.match(page, /Resume draft preparation/);

  // Settlement is decided from the status, not from inside the poll that
  // fetched it. This assertion replaces one that pinned the opposite shape —
  // `terminalDraftStatuses.has(next.processing_status)` *within* the timer
  // guarded on the draft still processing. That structure was the bug: the
  // branch that opens a finished draft only existed while it was unfinished,
  // so whichever reader delivered the finished status first decided whether
  // the screen ever left the spinner.
  assert.match(page, /settlementFor\(phase, draft\.processing_status\)/);
  assert.doesNotMatch(page, /terminalDraftStatuses\.has\(next\.processing_status\)/);
});

test("preparation is calm, honest, cancellable, and accessible", () => {
  // The three-stage PreparingSurface was replaced by the assistant canvas. The
  // product intent it protected is unchanged, so the assertions moved with it.
  const page = read("components/import-job/ImportJobPageClient.tsx");
  const canvas = read("components/import-job/assistant/DraftAssistantCanvas.tsx");

  // Stage wording is owned by the progress model, which is where it is asserted.
  assert.match(page, /window\.setTimeout\(\(\) => setDelayed\(true\), 8_000\)/);
  assert.match(page, /delayed=\{delayed\}/);

  assert.match(canvas, /aria-live="polite"/);
  assert.match(canvas, /data-testid="draft-assistant-cancel"/);
  assert.match(canvas, /motion-reduce:animate-none/);
  assert.match(canvas, /Candidate preview being prepared/);

  // Reassurance is gated on a real elapsed wait rather than shown immediately.
  assert.match(canvas, /delayed\s*\?\s*jobImportDelayMessage/);

  // No engineering vocabulary and no invented percentage in the copy.
  assert.doesNotMatch(canvas, /evidence spans|normalization|schema mapping|model provider/i);
});

test("recoverable and partial failures retain successful work and offer clear next steps", () => {
  const page = read("components/import-job/ImportJobPageClient.tsx");
  assert.match(page, /Retry/);
  assert.match(page, /Continue manually/);
  assert.match(page, /Paste text instead/);
  assert.match(page, /\/post-job\?importDraftId=/);
  assert.match(page, /Your source is still here/);
});

test("source tabs expose a complete keyboard-operated tab pattern", () => {
  const page = read("components/import-job/ImportJobPageClient.tsx");

  assert.match(page, /role="tablist"/);
  assert.match(page, /aria-controls=\{`import-panel-\$\{mode\}`\}/);
  assert.match(page, /tabIndex=\{entryMode === mode \? 0 : -1\}/);
  assert.match(page, /"ArrowLeft"[\s\S]+"ArrowRight"[\s\S]+"Home"[\s\S]+"End"/);
  assert.match(page, /role="tabpanel"/g);
  assert.match(page, /motion-reduce:transition-none/);
});

test("shared secondary import actions visibly expose their disabled state", () => {
  const primitives = read("components/import-job/importPrimitives.tsx");
  assert.match(primitives, /disabled:cursor-not-allowed/);
  assert.match(primitives, /disabled:opacity-40/);
});
