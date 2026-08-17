#!/usr/bin/env node
/**
 * Production dependency audit with analysed exceptions.
 *
 * `npm audit --omit=dev` cannot express "this advisory has been examined and is
 * not reachable in the deployed runtime". The choices it offers are to fail, or
 * to raise the severity threshold and stop seeing whole classes of finding. The
 * second is suppression wearing a threshold's clothes.
 *
 * So this compares the advisories npm reports against a committed list of ones
 * that have been analysed, each with its reasoning. An advisory that is not on
 * the list fails the gate — which is the property that matters, because the
 * danger is not the finding somebody already understands.
 *
 * Adding an entry requires writing down why it does not apply. That is
 * deliberately more effort than raising a threshold.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const allowlistPath = join(here, "..", "security", "npm-audit-allowlist.json");

function auditReport() {
  try {
    // npm audit exits non-zero when it finds anything, so the output is the
    // interesting part and the status code is not.
    const output = execFileSync(
      "npm",
      ["audit", "--omit=dev", "--json"],
      { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
    );
    return JSON.parse(output);
  } catch (error) {
    if (error.stdout) {
      return JSON.parse(error.stdout);
    }
    throw error;
  }
}

const allowlist = JSON.parse(readFileSync(allowlistPath, "utf8"));
const analysed = new Map(allowlist.advisories.map((entry) => [entry.package, entry]));

const report = auditReport();
const found = Object.entries(report.vulnerabilities ?? {}).filter(
  ([, value]) => value.severity === "high" || value.severity === "critical",
);

const unanalysed = [];
const permitted = [];

for (const [name, value] of found) {
  const entry = analysed.get(name);
  if (entry === undefined) {
    unanalysed.push(`${name} (${value.severity}) — range ${value.range}`);
    continue;
  }
  permitted.push(`${name} (${value.severity}) — ${entry.reason}`);
}

for (const line of permitted) {
  console.log(`analysed: ${line}`);
}

// An allowlist entry for an advisory npm no longer reports is stale, and a stale
// exception is how a real finding gets waved through later.
const stale = [...analysed.keys()].filter(
  (name) => !found.some(([foundName]) => foundName === name),
);
for (const name of stale) {
  console.log(
    `stale exception: ${name} is allowlisted but no longer reported — remove it`,
  );
}

if (unanalysed.length > 0) {
  console.error("\nProduction dependency advisories with no recorded analysis:");
  for (const line of unanalysed) {
    console.error(`  ${line}`);
  }
  console.error(
    "\nEither remediate, or add an entry to security/npm-audit-allowlist.json " +
      "explaining why the vulnerable code is not reachable in the deployed " +
      "runtime. Raising the severity threshold is not an answer.",
  );
  process.exit(1);
}

console.log(
  `\nProduction audit: ${permitted.length} analysed, 0 unanalysed high/critical advisories.`,
);
