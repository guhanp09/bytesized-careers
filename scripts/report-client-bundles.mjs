#!/usr/bin/env node

import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const MANIFEST_NAME = "page_client-reference-manifest.js";

function walk(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

function routeFromManifestKey(key) {
  if (!key.endsWith("/page")) {
    throw new Error(`Unsupported client-reference manifest key: ${key}`);
  }
  return key === "/page" ? "/" : key.slice(0, -"/page".length);
}

export function parseClientReferenceManifest(source, label = "client manifest") {
  const assignment = source.match(
    /globalThis\.__RSC_MANIFEST\[((?:"(?:\\.|[^"\\])*")|(?:'(?:\\.|[^'\\])*'))\]\s*=\s*(\{[\s\S]*\});?\s*$/,
  );
  if (!assignment) {
    throw new Error(`${label} does not contain one readable __RSC_MANIFEST assignment.`);
  }

  let key;
  let manifest;
  try {
    const quotedKey = assignment[1];
    key = quotedKey.startsWith("\"")
      ? JSON.parse(quotedKey)
      : quotedKey.slice(1, -1).replaceAll("\\'", "'");
    manifest = JSON.parse(assignment[2]);
  } catch (error) {
    throw new Error(`${label} contains invalid manifest JSON.`, { cause: error });
  }

  return { route: routeFromManifestKey(key), manifest };
}

function entryFiles(manifest) {
  const javascript = new Set();
  const stylesheets = new Set();

  for (const value of Object.values(manifest.entryJSFiles ?? {})) {
    if (!Array.isArray(value)) continue;
    for (const path of value) {
      if (typeof path === "string") javascript.add(path);
    }
  }

  for (const value of Object.values(manifest.entryCSSFiles ?? {})) {
    if (!Array.isArray(value)) continue;
    for (const entry of value) {
      if (entry && typeof entry.path === "string") stylesheets.add(entry.path);
    }
  }

  return {
    javascript: [...javascript].sort(),
    stylesheets: [...stylesheets].sort(),
  };
}

function artifactPath(buildDirectory, manifestPath) {
  if (
    !manifestPath.startsWith("static/") ||
    manifestPath.includes("\\") ||
    manifestPath.split("/").includes("..")
  ) {
    throw new Error(`Unsafe client artifact path in manifest: ${manifestPath}`);
  }

  const buildRoot = resolve(buildDirectory);
  const absolute = resolve(buildRoot, manifestPath);
  if (!absolute.startsWith(`${buildRoot}${sep}`) || !existsSync(absolute)) {
    throw new Error(`Client artifact named by manifest does not exist: ${manifestPath}`);
  }
  return absolute;
}

function addMetrics(files, metricFor) {
  return files.reduce(
    (total, path) => {
      const metric = metricFor(path);
      total.rawBytes += metric.rawBytes;
      total.gzipBytes += metric.gzipBytes;
      return total;
    },
    { rawBytes: 0, gzipBytes: 0 },
  );
}

export function analyzeClientBundles(buildDirectory = resolve(".next")) {
  const appDirectory = resolve(buildDirectory, "server", "app");
  if (!existsSync(appDirectory)) {
    throw new Error(
      `No production App Router artifact found at ${relative(process.cwd(), appDirectory)}. ` +
        "Run `npm run build` first.",
    );
  }

  const manifestPaths = walk(appDirectory)
    .filter((path) => path.endsWith(`${sep}${MANIFEST_NAME}`))
    .sort();
  if (manifestPaths.length === 0) {
    throw new Error("The production build contains no page client-reference manifests.");
  }

  const fileMetrics = new Map();
  const routeUsage = new Map();
  const metricFor = (manifestPath) => {
    const existing = fileMetrics.get(manifestPath);
    if (existing) return existing;
    const absolute = artifactPath(buildDirectory, manifestPath);
    const bytes = readFileSync(absolute);
    const metric = {
      path: manifestPath,
      rawBytes: statSync(absolute).size,
      gzipBytes: gzipSync(bytes, { level: 9 }).byteLength,
    };
    fileMetrics.set(manifestPath, metric);
    return metric;
  };

  const routes = manifestPaths.map((manifestPath) => {
    const source = readFileSync(manifestPath, "utf8");
    const { route, manifest } = parseClientReferenceManifest(
      source,
      relative(process.cwd(), manifestPath),
    );
    const files = entryFiles(manifest);
    const allFiles = [...new Set([...files.javascript, ...files.stylesheets])];
    for (const path of allFiles) {
      const users = routeUsage.get(path) ?? new Set();
      users.add(route);
      routeUsage.set(path, users);
    }

    const javascript = addMetrics(files.javascript, metricFor);
    const stylesheets = addMetrics(files.stylesheets, metricFor);
    return {
      route,
      javascript: { files: files.javascript.length, ...javascript },
      stylesheets: { files: files.stylesheets.length, ...stylesheets },
      total: {
        rawBytes: javascript.rawBytes + stylesheets.rawBytes,
        gzipBytes: javascript.gzipBytes + stylesheets.gzipBytes,
      },
    };
  });

  routes.sort((left, right) =>
    right.total.gzipBytes - left.total.gzipBytes || left.route.localeCompare(right.route),
  );

  const files = [...fileMetrics.values()]
    .map((metric) => ({
      ...metric,
      routeCount: routeUsage.get(metric.path)?.size ?? 0,
    }))
    .sort((left, right) =>
      right.gzipBytes - left.gzipBytes || left.path.localeCompare(right.path),
    );

  const buildIdPath = resolve(buildDirectory, "BUILD_ID");
  return {
    schemaVersion: 1,
    buildId: existsSync(buildIdPath) ? readFileSync(buildIdPath, "utf8").trim() : null,
    routeCount: routes.length,
    routes,
    uniqueClientFiles: {
      files: files.length,
      rawBytes: files.reduce((sum, file) => sum + file.rawBytes, 0),
      gzipBytes: files.reduce((sum, file) => sum + file.gzipBytes, 0),
    },
    files,
  };
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

function table(rows, columns) {
  const widths = columns.map(({ heading, value }) =>
    Math.max(heading.length, ...rows.map((row) => value(row).length)),
  );
  const render = (values) =>
    values.map((value, index) => value.padEnd(widths[index])).join("  ").trimEnd();
  return [
    render(columns.map((column) => column.heading)),
    render(widths.map((width) => "-".repeat(width))),
    ...rows.map((row) => render(columns.map((column) => column.value(row)))),
  ].join("\n");
}

export function formatBundleReport(report) {
  const routeTable = table(report.routes, [
    { heading: "Route", value: (row) => row.route },
    { heading: "JS gzip", value: (row) => formatBytes(row.javascript.gzipBytes) },
    { heading: "CSS gzip", value: (row) => formatBytes(row.stylesheets.gzipBytes) },
    { heading: "Total gzip", value: (row) => formatBytes(row.total.gzipBytes) },
    { heading: "JS files", value: (row) => String(row.javascript.files) },
  ]);
  const fileTable = table(report.files.slice(0, 15), [
    { heading: "Client artifact", value: (row) => row.path },
    { heading: "Raw", value: (row) => formatBytes(row.rawBytes) },
    { heading: "Gzip", value: (row) => formatBytes(row.gzipBytes) },
    { heading: "Routes", value: (row) => String(row.routeCount) },
  ]);

  return [
    `Client bundle report${report.buildId ? ` for build ${report.buildId}` : ""}`,
    "Cold route entry payloads; files are deduplicated within each route and gzip uses level 9.",
    "This is measurement, not an invented pass/fail budget.",
    "",
    routeTable,
    "",
    `Unique client entry artifacts: ${report.uniqueClientFiles.files} files, ` +
      `${formatBytes(report.uniqueClientFiles.rawBytes)} raw, ` +
      `${formatBytes(report.uniqueClientFiles.gzipBytes)} gzip`,
    "",
    "Largest client entry artifacts",
    fileTable,
  ].join("\n");
}

function main() {
  const unexpected = process.argv.slice(2).filter((argument) => argument !== "--json");
  if (unexpected.length > 0) {
    throw new Error(`Unknown argument: ${unexpected[0]}`);
  }
  const report = analyzeClientBundles();
  process.stdout.write(
    process.argv.includes("--json")
      ? `${JSON.stringify(report, null, 2)}\n`
      : `${formatBundleReport(report)}\n`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
