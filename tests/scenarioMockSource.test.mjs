import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { resolveScenario, SCENARIO_NAMES, DEFAULT_SCENARIO } from "../lib/seed/scenarioNames.ts";

/**
 * The hand-written Mock dataset is retired.
 *
 * Deleting the file is not the guarantee — someone can add another one next
 * week. What has to hold is that Mock *product* mode has exactly one source of
 * sample interactions: the canonical manifests. These tests assert that
 * property against the real modules rather than against a memory of the change.
 */

const read = (relPath) => fs.readFileSync(path.join(process.cwd(), relPath), "utf8");

test("the retired hand-written fixture is gone, and nothing imports it", () => {
  assert.equal(
    fs.existsSync(path.join(process.cwd(), "lib/seed/ownerInteractionFixtures.ts")),
    false,
    "the hand-written fixture is back"
  );
  const roots = ["lib", "components", "app", "tests", "scripts"];
  const offenders = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      // This file names the module in order to forbid it; it is not a reference.
      else if (/\.(ts|tsx|mjs|js)$/.test(entry.name) && entry.name !== "scenarioMockSource.test.mjs") {
        if (fs.readFileSync(full, "utf8").includes("ownerInteractionFixtures")) offenders.push(full);
      }
    }
  };
  for (const root of roots) walk(path.join(process.cwd(), root));
  assert.deepEqual(offenders, [], `still referencing the retired fixture:\n${offenders.join("\n")}`);
});

test("the workspace holds no sample dataset of its own", () => {
  const source = read("components/you/ApplicationsWorkspace.tsx");
  // The workspace receives sample rows as a prop. A literal fallback array of
  // interactions inside the component would be a second corpus by another name.
  assert.doesNotMatch(source, /MOCK_OWNER_INTERACTIONS/);
  assert.match(
    source,
    /interactions \?\? \[\]/,
    "the workspace should fall back to nothing, not to a bundled dataset"
  );
});

test("Mock mode loads a manifest without needing a seed parameter", () => {
  const source = read("components/applications/ApplicationsPageClient.tsx");
  // The gate that made scenario loading opt-in existed only while the fixture
  // was still the default. Its removal is the retirement.
  assert.doesNotMatch(
    source,
    /if \(!seedParam \|\|/,
    "scenario loading is still gated behind an explicit ?seed="
  );
  assert.match(source, /toOwnerInteractions\(/, "Mock mode must adapt a manifest");
});

test("with no seed, Mock mode resolves to the canonical default", () => {
  const resolved = resolveScenario({});
  assert.equal(resolved.scenario, DEFAULT_SCENARIO);
  assert.equal(resolved.scenario, "default");
  assert.equal(resolved.source, "default");
  assert.equal(resolved.error, null);
});

test("every documented seed name resolves to its own manifest", () => {
  for (const name of SCENARIO_NAMES) {
    const resolved = resolveScenario({ query: name });
    assert.equal(resolved.scenario, name);
    assert.equal(resolved.source, "query");
    assert.equal(resolved.error, null);
    assert.ok(
      fs.existsSync(path.join(process.cwd(), "fixtures/creator_scenarios/generated", `${name}.json`)),
      `${name} has no manifest`
    );
  }
});

test("an explicit seed beats a stored preference, which beats the default", () => {
  // Three inputs can disagree. The URL is the most deliberate and the one people
  // paste to each other, so it wins.
  assert.equal(resolveScenario({ query: "edge", stored: "busy" }).scenario, "edge");
  assert.equal(resolveScenario({ stored: "busy" }).scenario, "busy");
  assert.equal(resolveScenario({ stored: "busy" }).source, "stored");
  assert.equal(resolveScenario({}).scenario, "default");
});

test("an unknown seed is an error, not a silent fallback", () => {
  const resolved = resolveScenario({ query: "staging" });
  assert.ok(resolved.error, "an unknown scenario must be reported");
  assert.match(resolved.error, /staging/);
  // The known list is named, so the message is actionable rather than a refusal.
  for (const name of SCENARIO_NAMES) assert.ok(resolved.error.includes(name));
  // And it must not quietly load `default` as though it had been asked for: the
  // page renders the error instead, so nobody tests a dataset they did not pick.
  assert.equal(resolved.source, "default");
});

test("a stored preference that is no longer a scenario falls back cleanly", () => {
  // A retired name in localStorage must not become a permanent error state.
  const resolved = resolveScenario({ stored: "retired-scenario" });
  assert.equal(resolved.scenario, DEFAULT_SCENARIO);
  assert.equal(resolved.error, null);
});

test("a seed parameter never triggers a database restore", () => {
  // Backend scenario restoration stays behind the existing confirmation gate. A
  // URL that rewrote the database would make every shared link destructive.
  const source = read("components/applications/ApplicationsPageClient.tsx");
  // Asserted against calls, not prose: the file explains the rule in a comment,
  // and matching the word would fail on its own explanation.
  const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
  assert.doesNotMatch(code, /restoreScenario|\/qa\/scenario|restore\(/i);
  // Reading a manifest is a GET against a dev-only route, and that is all.
  assert.match(code, /fetch\(`\/api\/dev\/scenario\//);
  assert.doesNotMatch(code, /method: "(POST|PUT|PATCH|DELETE)"/);
});

test("the scenario route is the only manifest reader, and it is server-only", () => {
  const route = read("app/api/dev/scenario/[scenario]/route.ts");
  assert.match(route, /node:fs\/promises/);
  assert.match(route, /isProductionRuntime\(\)/);
});
