import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(repoRoot, path), "utf8");

test("Inbox replaces legacy unarchive with an explicit current-stage choice", () => {
  const source = read("components/you/ApplicationsWorkspace.tsx");
  assert.match(source, /isArchivedInteraction\(item\) && !item\.legacyArchiveResolutionRequired/);
  assert.match(source, /\? "Choose current stage"/);
  assert.match(source, /target\.legacyArchiveResolutionRequired\s*\? false/);
});

test("Pipeline supports single-record resolution and excludes it from bulk moves", () => {
  const source = read("components/you/PipelineBoard.tsx");
  assert.match(source, /triggerLabel=\{[\s\S]*?"Choose current stage"/);
  assert.match(
    source,
    /selectedItems\.every\(\(item\) => !item\.legacyArchiveResolutionRequired\)/
  );
  assert.match(
    source,
    /draggedItems\.length > 1 && draggedItems\.some\(\(item\) => item\.legacyArchiveResolutionRequired\)/
  );
});
