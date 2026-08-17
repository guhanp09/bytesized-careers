/**
 * What the production dependency tree actually contains.
 *
 * This exists because a manifest argument turned out to be wrong. The reasoning
 * was: `prisma` is a devDependency and `@prisma/client` declares no runtime
 * dependencies, therefore the CLI's vulnerable config chain does not ship. The
 * artifact disagreed — a clean `npm ci --omit=dev` install contained `prisma`,
 * `@prisma/config` and `deepmerge-ts`, because npm installs the PEER
 * dependencies of production packages and `@prisma/client` declares `prisma` as
 * a peer.
 *
 * The lesson is the test: reason about what installs, not about what the
 * manifest implies. A dependency's classification in package.json does not
 * determine whether it reaches a production install.
 *
 * These assertions read the lockfile rather than running an install, so they are
 * fast enough to keep. The full artifact check — an actual `npm ci --omit=dev`
 * in a scratch directory — is documented in the handoff and is what produced
 * this finding.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import test from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));

function major(version) {
  return Number.parseInt(version.replace(/^[^0-9]*/, "").split(".")[0], 10);
}

test("deepmerge-ts resolves to a version without the known advisory", () => {
  // The advisory covers <8.0.0. This package reaches a production install
  // through @prisma/config, itself pulled in as a peer of @prisma/client — so
  // its version is a production concern even though the CLI is a devDependency.
  const entry = lock.packages["node_modules/deepmerge-ts"];

  assert.ok(entry, "expected deepmerge-ts in the lockfile");
  assert.ok(
    major(entry.version) >= 8,
    `deepmerge-ts resolved to ${entry.version}; the advisory covers <8.0.0. ` +
      "This is what a production install ships, whatever package.json says.",
  );
});

test("the override that pins it is still declared", () => {
  // Without the override, npm resolves the exact version @prisma/config pins
  // (7.1.5) and the advisory returns. Removing this is not a refactor.
  assert.ok(packageJson.overrides, "expected an overrides block");
  assert.ok(
    packageJson.overrides["deepmerge-ts"],
    "the deepmerge-ts override was removed; the advisory it fixes will return",
  );
  assert.match(packageJson.overrides["deepmerge-ts"], /8/);
});

test("the Prisma CLI stays out of production dependencies", () => {
  // It is a build and generate tool. It still reaches a production install as a
  // peer of the client, which is exactly the thing this file records — but it
  // must not be there deliberately as well.
  assert.ok(
    !("prisma" in (packageJson.dependencies ?? {})),
    "the Prisma CLI belongs in devDependencies",
  );
  assert.ok("prisma" in (packageJson.devDependencies ?? {}));
});

test("the runtime client is a production dependency", () => {
  // The other half of the same boundary: the client IS runtime and must not
  // drift into devDependencies while the app imports it.
  assert.ok("@prisma/client" in (packageJson.dependencies ?? {}));
});

test("the audit allowlist claims no Prisma-chain exception", () => {
  // These advisories were remediated, not excepted. An exception left behind
  // would be a stale permission for a finding that no longer exists — and the
  // next real advisory in that package would inherit it.
  const allowlist = JSON.parse(
    readFileSync(join(root, "security", "npm-audit-allowlist.json"), "utf8"),
  );
  const packages = allowlist.advisories.map((entry) => entry.package);

  for (const name of ["prisma", "@prisma/config", "deepmerge-ts"]) {
    assert.ok(
      !packages.includes(name),
      `${name} is allowlisted but the advisory was fixed by an override; ` +
        "a stale exception would cover the next real finding too",
    );
  }
});
