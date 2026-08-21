import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildClientErrorReport,
  sendClientErrorReport,
} from "../lib/clientErrorReporter.ts";
import { collectPrivateSourceMaps } from "../scripts/collect-private-source-maps.mjs";

test("browser reports keep only source-map coordinates and finite labels", () => {
  const secretEmail = "private-customer@example.com";
  const secretMessage = `Could not save ${secretEmail} with token top-secret`;
  const error = {
    name: "TypeError",
    digest: "digest_123456",
    message: secretMessage,
    stack: [
      `TypeError: ${secretMessage}`,
      "    at renderJob (https://creatorjobs.example/_next/static/chunks/app/jobs/page-a1b2.js?token=private:12:34)",
      "unsafe user function (https://creatorjobs.example/_next/static/chunks/app/jobs/other.js:56:78)",
      "    at userPage (https://creatorjobs.example/u/private-customer:90:12)",
    ].join("\n"),
  };

  const report = buildClientErrorReport(error, "route", "0123456789abcdef");
  const serialized = JSON.stringify(report);

  assert.deepEqual(report, {
    boundary: "route",
    name: "TypeError",
    digest: "digest_123456",
    release: "0123456789abcdef",
    frames: [
      {
        file: "/_next/static/chunks/app/jobs/page-a1b2.js",
        line: 12,
        column: 34,
        function: "renderJob",
      },
      {
        file: "/_next/static/chunks/app/jobs/other.js",
        line: 56,
        column: 78,
      },
    ],
  });
  assert.equal(serialized.includes(secretEmail), false);
  assert.equal(serialized.includes("top-secret"), false);
  assert.equal(serialized.includes("private-customer"), false);
  assert.equal(serialized.includes("token="), false);
});

test("invalid names, digests, releases, and non-errors fail closed", () => {
  assert.deepEqual(
    buildClientErrorReport(
      {
        name: "Error customer@example.com",
        digest: "private/customer",
        stack: "customer@example.com at https://example.com/u/private",
      },
      "unhandled_rejection",
      "unsafe release with spaces",
    ),
    {
      boundary: "unhandled_rejection",
      name: "Error",
      frames: [],
    },
  );
});

test("a failed ingestion request is swallowed and carries no credentials", async () => {
  const previous = process.env.NEXT_PUBLIC_BACKEND_URL;
  process.env.NEXT_PUBLIC_BACKEND_URL = "https://api.creatorjobs.example/api/v1";
  let request;
  try {
    const accepted = await sendClientErrorReport(
      {
        boundary: "global",
        name: "Error",
        frames: [],
      },
      async (input, init) => {
        request = { input: String(input), init };
        throw new Error("network unavailable");
      },
    );
    assert.equal(accepted, false);
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_BACKEND_URL;
    else process.env.NEXT_PUBLIC_BACKEND_URL = previous;
  }

  assert.equal(request.input, "https://api.creatorjobs.example/api/v1/telemetry/client-errors");
  assert.equal(request.init.credentials, "omit");
  assert.equal(request.init.keepalive, true);
  assert.equal("Authorization" in request.init.headers, false);
});

test("private source maps are archived, checksummed, and stripped from the runtime", async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), "creatorjobs-source-maps-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const build = join(temporary, ".next");
  const chunk = join(build, "static", "chunks", "app", "page-a1b2.js");
  const publicMap = `${chunk}.map`;
  const serverMap = join(build, "server", "app", "page.js.map");
  const destination = join(temporary, "private", "0123456789abcdef");
  await mkdir(join(build, "static", "chunks", "app"), { recursive: true });
  await mkdir(join(build, "server", "app"), { recursive: true });
  await writeFile(chunk, "throw new Error('x');\n//# sourceMappingURL=page-a1b2.js.map\n");
  await writeFile(publicMap, JSON.stringify({ version: 3, sources: ["app/page.tsx"] }));
  await writeFile(serverMap, JSON.stringify({ version: 3, sources: ["app/page.tsx"] }));

  const result = await collectPrivateSourceMaps({
    buildDirectory: build,
    destinationDirectory: destination,
    release: "0123456789abcdef",
  });

  assert.equal(result.mapCount, 2);
  assert.equal(result.publicMapCount, 1);
  await assert.rejects(access(publicMap));
  assert.equal((await readFile(chunk, "utf8")).includes("sourceMappingURL"), false);
  await access(join(destination, "static", "chunks", "app", "page-a1b2.js.map"));
  await access(join(destination, "server", "app", "page.js.map"));
  const manifest = JSON.parse(await readFile(join(destination, "manifest.json"), "utf8"));
  assert.equal(manifest.release, "0123456789abcdef");
  assert.equal(manifest.files.length, 2);
  assert.match(manifest.files[0].sha256, /^[a-f0-9]{64}$/);
});

test("the release map path fails closed without maps or on overwrite", async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), "creatorjobs-source-map-refusal-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const build = join(temporary, ".next");
  const destination = join(temporary, "private", "release123");
  await mkdir(build, { recursive: true });

  await assert.rejects(
    collectPrivateSourceMaps({
      buildDirectory: build,
      destinationDirectory: destination,
      release: "release123",
    }),
    /No source maps were produced/,
  );
  await mkdir(destination, { recursive: true });
  await assert.rejects(
    collectPrivateSourceMaps({
      buildDirectory: build,
      destinationDirectory: destination,
      release: "release123",
    }),
    /Refusing to overwrite/,
  );
});

test("error boundaries, release build, and CI use the owned reporting contract", async () => {
  const [routeError, globalError, layout, config, packageJson, workflow] = await Promise.all([
    readFile(new URL("../app/error.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/global-error.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../next.config.ts", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8"),
  ]);

  assert.match(routeError, /reportClientError\(error, "route"\)/);
  assert.match(globalError, /reportClientError\(error, "global"\)/);
  assert.match(layout, /<ClientErrorReporter \/>/);
  assert.match(config, /productionBrowserSourceMaps: process\.env\.CREATORJOBS_PRIVATE_SOURCE_MAPS === "true"/);
  assert.match(packageJson, /"build:release"/);
  assert.match(workflow, /Upload private browser source maps/);
  assert.match(workflow, /\.private-artifacts\/source-maps\/\$\{\{ github\.sha \}\}/);
});
