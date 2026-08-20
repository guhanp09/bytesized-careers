import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import ts from "typescript";

import {
  isTrustedStoredMediaUrl,
  trustedMediaConfiguration,
} from "../lib/trustedMedia.ts";

const root = fileURLToPath(new URL("../", import.meta.url));

const productionFrontendEnvironment = {
  APP_ENV: "production",
  NEXT_PUBLIC_APP_ENV: "production",
  NEXTAUTH_URL: "https://creatorjobs.example",
  NEXT_PUBLIC_SITE_URL: "https://creatorjobs.example",
  NEXT_PUBLIC_BACKEND_URL: "https://api.creatorjobs.example/api/v1",
  BACKEND_URL: "https://api.creatorjobs.example/api/v1",
  NEXTAUTH_SECRET: "test-only-strong-nextauth-secret",
  GOOGLE_CLIENT_ID: "test-client.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "test-only-strong-google-secret",
  NEXT_PUBLIC_USE_LOCAL_MOCKS: "false",
  MEDIA_PUBLIC_BASE_URL: "https://media.creatorjobs.example",
  MEDIA_BASE_PATH: "/media",
};

const importProductionNextConfig = (overrides = {}) =>
  spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--input-type=module",
      "--eval",
      'await import("./next.config.ts")',
    ],
    {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, ...productionFrontendEnvironment, ...overrides },
    },
  );

const tsxFilesBelow = (directory) => {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...tsxFilesBelow(path));
    else if (entry.isFile() && entry.name.endsWith(".tsx")) files.push(path);
  }
  return files;
};

const jsxAttribute = (node, name) =>
  node.attributes.properties.find(
    (attribute) =>
      ts.isJsxAttribute(attribute) && attribute.name.getText(node.getSourceFile()) === name,
  );

const stringAttributeValue = (attribute) =>
  attribute?.initializer && ts.isStringLiteral(attribute.initializer)
    ? attribute.initializer.text
    : null;

test("the optimizer accepts only canonical CreatorJobs avatar and banner keys", () => {
  const configuration = trustedMediaConfiguration({
    APP_ENV: "production",
    MEDIA_PUBLIC_BASE_URL: "https://media.creatorjobs.example/assets/",
    MEDIA_BASE_PATH: "/media/",
  });

  assert.ok(configuration);
  assert.deepEqual(
    configuration.remotePatterns,
    ["avatars", "banners"].flatMap((kind) =>
      ["gif", "jpg", "png", "webp"].map((extension) => ({
        protocol: "https",
        hostname: "media.creatorjobs.example",
        port: "",
        pathname: `/assets/media/${kind}/*/*.${extension}`,
        search: "",
      })),
    ),
  );

  const owner = "a".repeat(32);
  const token = "b".repeat(16);
  assert.equal(
    isTrustedStoredMediaUrl(
      `https://media.creatorjobs.example/assets/media/avatars/${owner}/${token}.webp`,
      configuration,
    ),
    true,
  );
  assert.equal(
    isTrustedStoredMediaUrl(
      `https://media.creatorjobs.example/assets/media/banners/${owner}/${token}.jpg`,
      configuration,
    ),
    true,
  );

  for (const url of [
    `https://evil.example/assets/media/avatars/${owner}/${token}.webp`,
    `https://media.creatorjobs.example.evil.test/assets/media/avatars/${owner}/${token}.webp`,
    `https://media.creatorjobs.example/assets/media-other/avatars/${owner}/${token}.webp`,
    `https://media.creatorjobs.example/assets/media/projects/${owner}/${token}.webp`,
    `https://media.creatorjobs.example/assets/media/avatars/${owner}/${token}.svg`,
    `https://media.creatorjobs.example/assets/media/avatars/${owner}/${token}.webp?redirect=evil`,
    `https://media.creatorjobs.example/assets/media/avatars/${owner}/${token}.webp#fragment`,
    `https://user:password@media.creatorjobs.example/assets/media/avatars/${owner}/${token}.webp`,
    `http://media.creatorjobs.example/assets/media/avatars/${owner}/${token}.webp`,
  ]) {
    assert.equal(isTrustedStoredMediaUrl(url, configuration), false, url);
  }
});

test("unsafe optimizer configuration fails closed", () => {
  assert.equal(trustedMediaConfiguration({}), null);

  for (const environment of [
    {
      APP_ENV: "production",
      MEDIA_PUBLIC_BASE_URL: "http://media.creatorjobs.example",
    },
    { MEDIA_PUBLIC_BASE_URL: "https://*.creatorjobs.example" },
    { MEDIA_PUBLIC_BASE_URL: "https://user:password@media.creatorjobs.example" },
    { MEDIA_PUBLIC_BASE_URL: "https://media.creatorjobs.example?next=evil" },
    { MEDIA_PUBLIC_BASE_URL: "https://media.creatorjobs.example/#fragment" },
    { MEDIA_PUBLIC_BASE_URL: "javascript:alert(1)" },
    {
      MEDIA_PUBLIC_BASE_URL: "https://media.creatorjobs.example",
      MEDIA_BASE_PATH: "/",
    },
    {
      MEDIA_PUBLIC_BASE_URL: "https://media.creatorjobs.example",
      MEDIA_BASE_PATH: "/media/**",
    },
    {
      MEDIA_PUBLIC_BASE_URL: "https://media.creatorjobs.example",
      MEDIA_BASE_PATH: "relative/media",
    },
  ]) {
    assert.throws(
      () => trustedMediaConfiguration(environment),
      /Unsafe media optimizer configuration/,
      JSON.stringify(environment),
    );
  }
});

test("Next image fetching is exact-origin, no-redirect, public-only, and byte-bounded", () => {
  const source = readFileSync(join(root, "next.config.ts"), "utf8");
  const environmentExample = readFileSync(join(root, ".env.example"), "utf8");
  const deploymentGuide = readFileSync(join(root, "DEPLOYMENT.md"), "utf8");

  assert.match(source, /requireValue\("MEDIA_PUBLIC_BASE_URL"\)/);
  assert.match(source, /remotePatterns: trustedMedia\?\.remotePatterns \?\? \[\]/);
  assert.match(source, /maximumRedirects: 0/);
  assert.match(source, /maximumResponseBody: MAX_OPTIMIZED_MEDIA_RESPONSE_BYTES/);
  assert.match(source, /MAX_OPTIMIZED_MEDIA_RESPONSE_BYTES = 10 \* 1024 \* 1024/);
  assert.match(source, /dangerouslyAllowLocalIP: false/);
  assert.match(source, /dangerouslyAllowSVG: false/);
  assert.doesNotMatch(source, /\bdomains\s*:/);
  assert.doesNotMatch(source, /hostname:\s*["'`]\*\*?/);
  assert.match(environmentExample, /^MEDIA_PUBLIC_BASE_URL=$/m);
  assert.match(environmentExample, /^MEDIA_BASE_PATH=\/media$/m);
  assert.match(deploymentGuide, /MEDIA_PUBLIC_BASE_URL=https:\/\/your-media-origin/);
  assert.match(deploymentGuide, /Do not make it a `NEXT_PUBLIC_\*` value/);
});

test("production frontend boot requires the same safe media origin", () => {
  const valid = importProductionNextConfig();
  assert.equal(valid.status, 0, valid.stderr);

  const missing = importProductionNextConfig({ MEDIA_PUBLIC_BASE_URL: "" });
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /MEDIA_PUBLIC_BASE_URL is required in production/);

  const insecure = importProductionNextConfig({
    MEDIA_PUBLIC_BASE_URL: "http://media.creatorjobs.example",
  });
  assert.notEqual(insecure.status, 0);
  assert.match(insecure.stderr, /MEDIA_PUBLIC_BASE_URL must use HTTPS in production/);
});

test("public profile optimization is gated by the trusted stored-media classifier", () => {
  const source = readFileSync(join(root, "app/u/[slug]/page.tsx"), "utf8");

  assert.match(source, /const optimizeBanner = isTrustedStoredMediaUrl/);
  assert.match(source, /const optimizeAvatar = isTrustedStoredMediaUrl/);
  assert.match(source, /optimizeBanner \? \([\s\S]*?<Image/);
  assert.match(source, /optimizeAvatar \? \([\s\S]*?<Image/);
  assert.doesNotMatch(source, /\bpriority\b/);
  assert.doesNotMatch(source, /\bpreload\b/);
});

test("every raw image makes its eager/lazy and decoding behavior explicit", () => {
  const failures = [];
  const loadingCounts = { eager: 0, lazy: 0 };
  let imageCount = 0;

  for (const file of [...tsxFilesBelow(join(root, "app")), ...tsxFilesBelow(join(root, "components"))]) {
    const source = readFileSync(file, "utf8");
    const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

    const visit = (node) => {
      if (
        (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) &&
        node.tagName.getText(parsed) === "img"
      ) {
        imageCount += 1;
        const loading = stringAttributeValue(jsxAttribute(node, "loading"));
        const decoding = stringAttributeValue(jsxAttribute(node, "decoding"));
        const line = parsed.getLineAndCharacterOfPosition(node.getStart(parsed)).line + 1;
        const location = `${relative(root, file)}:${line}`;
        if (loading !== "eager" && loading !== "lazy") {
          failures.push(`${location} has no literal eager/lazy decision`);
        } else {
          loadingCounts[loading] += 1;
        }
        if (decoding !== "async") {
          failures.push(`${location} does not decode asynchronously`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(parsed);
  }

  assert.ok(imageCount >= 30, `image inventory unexpectedly fell to ${imageCount}`);
  assert.ok(loadingCounts.eager > 0, "the inventory contains no deliberate eager image");
  assert.ok(loadingCounts.lazy > 0, "the inventory contains no deliberate lazy image");
  assert.deepEqual(failures, []);
});
