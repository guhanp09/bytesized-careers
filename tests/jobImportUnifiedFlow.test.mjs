import assert from "node:assert/strict";
import test from "node:test";

const { nativeFieldForImport } = await import("../lib/importedDraftGuidance.ts");
const {
  jobImportValueWasRemoved,
  setJobImportAnalyticsSink,
  trackJobImportEvent,
} = await import("../lib/jobImportAnalytics.ts");

test("import-to-native mapping retains the canonical creator role bridge", () => {
  assert.equal(nativeFieldForImport("primary_role_key"), "primary_role_id");
  assert.equal(nativeFieldForImport("title"), "title");
  assert.equal(nativeFieldForImport("provider_private_field"), null);
});

test("analytics emits only the bounded event payload and cannot break product behavior", () => {
  const events = [];
  setJobImportAnalyticsSink((event) => events.push(event));
  trackJobImportEvent("job_import.completed", {
    sourceType: "url",
    durationMs: 1250,
    explicitCount: 4,
    inferredCount: 2,
    suggestedCount: 1,
    reviewCount: 1,
    missingCount: 3,
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].name, "job_import.completed");
  assert.deepEqual(Object.keys(events[0].payload).sort(), [
    "durationMs",
    "explicitCount",
    "inferredCount",
    "missingCount",
    "reviewCount",
    "sourceType",
    "suggestedCount",
  ]);

  setJobImportAnalyticsSink(() => {
    throw new Error("analytics unavailable");
  });
  assert.doesNotThrow(() => trackJobImportEvent("job_import.failed", { sourceType: "text" }));
  setJobImportAnalyticsSink(null);
});

test("analytics classifies removed imported values without inspecting their content", () => {
  assert.equal(jobImportValueWasRemoved(null), true);
  assert.equal(jobImportValueWasRemoved("   "), true);
  assert.equal(jobImportValueWasRemoved([]), true);
  assert.equal(jobImportValueWasRemoved("USD"), false);
  assert.equal(jobImportValueWasRemoved(["youtube"]), false);
  assert.equal(jobImportValueWasRemoved(0), false);
  assert.equal(jobImportValueWasRemoved(false), false);
});
