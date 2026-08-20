import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  analyzeClientBundles,
  formatBundleReport,
  parseClientReferenceManifest,
} from "../scripts/report-client-bundles.mjs";

const manifestSource = (route, manifest) =>
  `globalThis.__RSC_MANIFEST = globalThis.__RSC_MANIFEST || {};\n` +
  `globalThis.__RSC_MANIFEST[${JSON.stringify(`${route === "/" ? "" : route}/page`)}] = ` +
  `${JSON.stringify(manifest)};\n`;

const writeManifest = (buildDirectory, routeDirectory, route, manifest) => {
  const directory = join(buildDirectory, "server", "app", routeDirectory);
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, "page_client-reference-manifest.js"),
    manifestSource(route, manifest),
  );
};

test("client-reference parsing reads the route and the final JSON assignment", () => {
  const parsed = parseClientReferenceManifest(
    manifestSource("/jobs/[id]", { entryJSFiles: {}, entryCSSFiles: {} }),
  );
  assert.equal(parsed.route, "/jobs/[id]");
  assert.deepEqual(parsed.manifest, { entryJSFiles: {}, entryCSSFiles: {} });
  assert.throws(
    () => parseClientReferenceManifest("globalThis.__RSC_MANIFEST = {};"),
    /does not contain one readable/,
  );
});

test("the report measures and deduplicates the actual cold route entry artifacts", (t) => {
  const root = mkdtempSync(join(tmpdir(), "creatorjobs-bundle-report-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const buildDirectory = join(root, ".next");
  const chunkDirectory = join(buildDirectory, "static", "chunks");
  mkdirSync(chunkDirectory, { recursive: true });
  writeFileSync(join(buildDirectory, "BUILD_ID"), "fixture-build\n");
  writeFileSync(join(chunkDirectory, "shared.js"), "shared".repeat(100));
  writeFileSync(join(chunkDirectory, "alpha.js"), "alpha".repeat(80));
  writeFileSync(join(chunkDirectory, "beta.js"), "beta".repeat(60));
  writeFileSync(join(chunkDirectory, "app.css"), ".app{color:white}".repeat(20));

  writeManifest(buildDirectory, "alpha", "/alpha", {
    entryJSFiles: {
      layout: ["static/chunks/shared.js"],
      page: ["static/chunks/shared.js", "static/chunks/alpha.js"],
    },
    entryCSSFiles: { layout: [{ path: "static/chunks/app.css" }] },
  });
  writeManifest(buildDirectory, "beta", "/beta", {
    entryJSFiles: {
      layout: ["static/chunks/shared.js"],
      page: ["static/chunks/beta.js"],
    },
    entryCSSFiles: { layout: [{ path: "static/chunks/app.css" }] },
  });

  const report = analyzeClientBundles(buildDirectory);
  const alpha = report.routes.find((route) => route.route === "/alpha");
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.buildId, "fixture-build");
  assert.equal(report.routeCount, 2);
  assert.equal(alpha.javascript.files, 2, "the shared chunk is counted once within the route");
  assert.equal(alpha.stylesheets.files, 1);
  assert.equal(report.uniqueClientFiles.files, 4);
  assert.equal(report.files.find((file) => file.path.endsWith("shared.js")).routeCount, 2);
  assert.equal(report.files.find((file) => file.path.endsWith("app.css")).routeCount, 2);

  const text = formatBundleReport(report);
  assert.match(text, /Cold route entry payloads/);
  assert.match(text, /This is measurement, not an invented pass\/fail budget/);
  assert.match(text, /\/alpha/);
  assert.match(text, /\/beta/);
});

test("a manifest cannot escape the build artifact root", (t) => {
  const root = mkdtempSync(join(tmpdir(), "creatorjobs-bundle-path-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const buildDirectory = join(root, ".next");
  writeManifest(buildDirectory, "unsafe", "/unsafe", {
    entryJSFiles: { page: ["../private.js"] },
    entryCSSFiles: {},
  });
  assert.throws(
    () => analyzeClientBundles(buildDirectory),
    /Unsafe client artifact path/,
  );
});

test("package.json exposes the report without an analyzer dependency", () => {
  const packageJson = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.equal(packageJson.scripts["report:bundle"], "node scripts/report-client-bundles.mjs");
  assert.equal(packageJson.dependencies["@next/bundle-analyzer"], undefined);
  assert.equal(packageJson.devDependencies["@next/bundle-analyzer"], undefined);
});
