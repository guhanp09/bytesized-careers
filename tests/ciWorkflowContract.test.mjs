/**
 * Do the workflows reference things that exist?
 *
 * A CI file cannot be executed here — nothing is pushed, and no GitHub runner
 * has ever run these. What can be checked is the class of mistake that would
 * waste a real run: a script that is not in package.json, a path that does not
 * exist, a Postgres version that disagrees with the local harness, or the two
 * Playwright suites arranged to run at once against a shared build directory.
 *
 * These are cheap and they catch the failures that only appear minutes into a
 * remote run, when the feedback is slowest.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import test from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const ci = readFileSync(join(root, ".github", "workflows", "ci.yml"), "utf8");
const security = readFileSync(join(root, ".github", "workflows", "security.yml"), "utf8");
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

function code(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

test("every npm script the workflows call exists", () => {
  const called = new Set();
  for (const source of [ci, security]) {
    for (const match of source.matchAll(/npm run ([a-z0-9:_-]+)/g)) {
      called.add(match[1]);
    }
  }

  assert.ok(called.size > 0, "expected the workflows to call npm scripts");
  for (const script of called) {
    assert.ok(
      script in packageJson.scripts,
      `workflow calls "npm run ${script}" which package.json does not define`,
    );
  }
});

test("every backend test path the workflows name exists", () => {
  const paths = new Set();
  for (const source of [ci, security]) {
    for (const match of source.matchAll(/(tests\/[a-z0-9_]+\.py)/g)) {
      paths.add(match[1]);
    }
  }

  assert.ok(paths.size > 0, "expected the workflows to name backend test files");
  for (const relative of paths) {
    assert.ok(
      existsSync(join(root, "backend", relative)),
      `workflow runs backend/${relative} which does not exist`,
    );
  }
});

test("the fixture script the migration job runs exists", () => {
  assert.match(ci, /tests\/interaction_migration_fixtures\.py/);
  assert.ok(
    existsSync(join(root, "backend", "tests", "interaction_migration_fixtures.py")),
  );
});

test("CI uses the same PostgreSQL version as the local harness", () => {
  const compose = readFileSync(
    join(root, "backend", "docker-compose.interaction-test.yml"),
    "utf8",
  );
  const localImage = compose.match(/image:\s*(postgres:[^\s]+)/)?.[1];
  const ciImage = ci.match(/image:\s*(postgres:[^\s]+)/)?.[1];

  assert.ok(localImage, "expected the local harness to declare a postgres image");
  assert.equal(
    ciImage,
    localImage,
    "CI and the local harness must exercise the same database version, or one " +
      "of them is testing something the other cannot reproduce",
  );
});

test("the migration downgrade target matches the local harness", () => {
  const script = readFileSync(
    join(root, "backend", "scripts", "test_interaction_status_postgres.sh"),
    "utf8",
  );
  const localTarget = script.match(/alembic downgrade (\S+)/)?.[1];
  const ciTarget = ci.match(/alembic downgrade (\S+)/)?.[1];

  assert.ok(localTarget);
  assert.equal(ciTarget, localTarget);
});

test("CI migrates the way a deployment migrates", () => {
  // A deployment runs scripts/release_migrate — head checking, an advisory lock
  // so concurrent instances serialise, and an already-at-head no-op. If CI
  // proved `alembic upgrade head` instead, every one of those would be untested
  // against a real PostgreSQL, which is the only place they behave at all.
  assert.match(ci, /uv run python -m scripts\.release_migrate/);
  assert.ok(
    !/run: uv run alembic upgrade head/.test(ci),
    "CI upgrades with raw alembic; production does not, so the difference is untested",
  );

  // Twice in a row, because that is what the second and later instances of a
  // real deploy do, and "nothing to apply" is a distinct code path.
  const runs = ci.match(/uv run python -m scripts\.release_migrate/g) ?? [];
  assert.ok(runs.length >= 2, `expected the release step to run more than once, saw ${runs.length}`);
});

test("the Playwright suites are not run concurrently", () => {
  // They build from the same .next directory and the QA suite binds fixed
  // ports. Running them together is faster and the evidence is worthless.
  const browserJob = ci.slice(ci.indexOf("  browser:"));
  const standardAt = browserJob.indexOf("npm run test:e2e\n");
  const qaAt = browserJob.indexOf("npm run test:e2e:qa");
  const a11yAt = browserJob.indexOf("npm run test:e2e:a11y");

  assert.ok(
    standardAt > 0 && qaAt > 0 && a11yAt > 0,
    "expected standard, QA, and accessibility suites in the browser job",
  );
  // Separate steps in one job run in order; a matrix or separate jobs would not.
  assert.ok(standardAt < qaAt, "the standard suite must precede the QA suite");
  assert.ok(qaAt < a11yAt, "the QA suite must precede the accessibility suite");
  assert.ok(!browserJob.includes("strategy:"), "the browser job must not fan out");
});

test("the accessibility gate is direct, cross-browser, and fail-closed", () => {
  const config = code(readFileSync(join(root, "playwright.a11y.config.ts"), "utf8"));
  const audit = code(readFileSync(join(root, "tests", "e2e", "axeAudit.ts"), "utf8"));

  assert.equal(
    packageJson.devDependencies["axe-core"],
    "4.13.0",
    "axe-core must be an exact direct dependency, not an accidental transitive tool",
  );
  for (const browser of ["Desktop Chrome", "Desktop Firefox", "Desktop Safari"]) {
    assert.match(config, new RegExp(`devices\\[\\"${browser}\\"\\]`));
  }
  for (const tag of ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"]) {
    assert.match(audit, new RegExp(`\\"${tag}\\"`));
  }
  assert.match(
    audit,
    /if\s*\(violations\.length\s*>\s*0\)\s*throw new Error/,
    "every selected WCAG violation must fail the gate regardless of impact label",
  );
  assert.match(
    audit,
    /resultTypes:\s*\["violations"\]/,
    "axe may omit unused result detail, but never violation detail",
  );
});

test("backend and postgres suites run as separate jobs", () => {
  // Two pytest processes against one database produce failures that describe
  // the harness rather than the product.
  assert.match(ci, /^ {2}backend:$/m);
  assert.match(ci, /^ {2}backend-postgres:$/m);
});

test("no artifact upload includes secrets or databases", () => {
  for (const source of [ci, security]) {
    const uploads = [...source.matchAll(/path: \|?([\s\S]*?)(?=\n {6}[a-z-]+:|\n {4}- |\n {2}[a-z-]+:)/g)]
      .map((match) => match[1]);
    for (const block of uploads) {
      assert.ok(!/\.env/.test(block), `artifact path includes .env: ${block}`);
      assert.ok(!/\.db\b/.test(block), `artifact path includes a database: ${block}`);
      assert.ok(!/\.pem|\.key\b/.test(block), `artifact path includes a key: ${block}`);
    }
  }
});

test("the production dependency audit installs without dev dependencies", () => {
  // Auditing a developer environment reports advisories for tooling that never
  // ships, and can miss what does ship if the sets have drifted.
  // The backend audit lives in security.yml; the frontend one in ci.yml.
  assert.match(security, /uv sync --locked --no-dev/);
  assert.match(
    security,
    /\.venv\/bin\/python -m scripts\.audit_production_dependencies/,
  );
  // The frontend gate runs through the analysed-exception script rather than
  // bare npm audit; the script itself asserts the --omit=dev flag.
  assert.match(ci, /npm run audit:production/);
  const gate = readFileSync(join(root, "scripts", "audit-production-dependencies.mjs"), "utf8");
  assert.match(gate, /"--omit=dev"/);
  // A severity threshold would be suppression by another name.
  assert.ok(!/--audit-level/.test(gate));

  const backendGate = readFileSync(
    join(root, "backend", "scripts", "audit_production_dependencies.py"),
    "utf8",
  );
  assert.match(backendGate, /"--no-dev"/);
  assert.match(backendGate, /"--require-hashes"/);
  assert.match(backendGate, /PIP_AUDIT_VERSION = "2\.10\.1"/);
  assert.ok(!/--ignore-vuln/.test(backendGate));
});

test("the README does not claim remote CI has run", () => {
  const readme = readFileSync(join(root, ".github", "workflows", "README.md"), "utf8");

  assert.match(readme, /NOT REMOTELY EXECUTED/);
  assert.ok(!/CI is green/i.test(readme));
  assert.ok(!/actions passed/i.test(readme));
});
