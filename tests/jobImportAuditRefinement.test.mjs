import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("import entry, processing, review, and apply mutations reject duplicate clicks", () => {
  const page = read("components/import-job/ImportJobPageClient.tsx");

  for (const guard of [
    "entrySubmissionRef.current",
    "processingRequestRef.current",
    "reviewMutationRef.current",
    "applyRequestRef.current",
  ]) {
    assert.match(page, new RegExp(guard.replace(".", "\\.")));
  }
  assert.match(page, /disabled=\{processingRequest\}/);
  assert.match(page, /interactionsLocked=\{busyField !== null \|\| applying\}/);
});

test("review actions lock together so stale concurrent responses cannot replace newer state", () => {
  const review = read("components/import-job/ImportReviewWorkspace.tsx");

  assert.match(review, /busy=\{busyField !== null\}/g);
  assert.match(review, /disabled=\{interactionsLocked\}/);
  assert.match(
    review,
    /!draft\.can_apply_to_native_draft[\s\S]+interactionsLocked/,
  );
});

test("a transient processing-status failure retries and clears stale errors on success", () => {
  const page = read("components/import-job/ImportJobPageClient.tsx");

  assert.match(page, /setPollRetry\(\(attempt\) => attempt \+ 1\)/);
  assert.match(page, /\[accessToken, draft, phase, pollRetry\]/);
  assert.match(
    page,
    /setPhase\("review"\);\s+setError\(""\);\s+setAnnouncement\("Draft prepared/,
  );
});

test("import source tabs expose a complete keyboard-operated tab pattern", () => {
  const page = read("components/import-job/ImportJobPageClient.tsx");

  assert.match(page, /role="tablist"/);
  assert.match(page, /aria-controls=\{`import-panel-\$\{mode\}`\}/);
  assert.match(page, /tabIndex=\{entryMode === mode \? 0 : -1\}/);
  assert.match(page, /"ArrowLeft", "ArrowRight", "Home", "End"/);
  assert.match(page, /role="tabpanel"/g);
  assert.match(page, /motion-reduce:transition-none/);
});

test("shared secondary import actions visibly expose their disabled state", () => {
  const primitives = read("components/import-job/importPrimitives.tsx");
  assert.match(primitives, /disabled:cursor-not-allowed/);
  assert.match(primitives, /disabled:opacity-40/);
});
