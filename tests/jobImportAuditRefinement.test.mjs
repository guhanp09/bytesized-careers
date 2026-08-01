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
  assert.match(page, /getJobImportDraft\(accessToken, draft\.id\)/);
  assert.match(page, /terminalDraftStatuses\.has\(next\.processing_status\)/);
  assert.match(page, /setError\(""\)/);
  assert.match(page, /Resume draft preparation/);
});

test("loading is calm, honest, cancellable, and accessible", () => {
  const page = read("components/import-job/ImportJobPageClient.tsx");
  const loading = page.match(/function PreparingSurface[\s\S]*?\n}\n\nexport default/);
  assert.ok(loading);
  for (const stage of [
    "Opening the public job post",
    "Reading the supplied job information",
    "Matching details to CreatorJobs",
    "Preparing the private draft",
  ]) {
    assert.match(loading[0], new RegExp(stage));
  }
  assert.match(page, /window\.setTimeout\(\(\) => setDelayed\(true\), 8_000\)/);
  assert.match(page, /aria-live="polite"/);
  assert.match(loading[0], /data-testid="job-import-cancel"/);
  assert.match(loading[0], /motion-reduce:animate-none/);
  assert.match(loading[0], /Candidate preview being prepared/);
  assert.match(loading[0], /checking the information carefully instead of guessing/);
  assert.doesNotMatch(loading[0], /\d+%|evidence spans|normalization|schema mapping|model provider/i);
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
