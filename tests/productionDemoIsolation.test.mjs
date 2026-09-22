import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import ts from "typescript";

import { isLocalMocksEnabled } from "../lib/backendClient.ts";
import { resolveMarketplaceDataSource } from "../lib/devDataSource.ts";
import { resolveDraftDataMode } from "../lib/draftDataSource.ts";
import { mapPublicJobToCanonical } from "../lib/publicProfileJobs.ts";
import { isTruthyEnvironmentFlag } from "../lib/runtimeEnvironment.ts";

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
  GOOGLE_OAUTH_EXCHANGE_SECRET: "test-only-google-exchange-secret-rotation",
  NEXT_PUBLIC_USE_LOCAL_MOCKS: "false",
  NEXT_PUBLIC_ENABLE_DEV_DATA_SWITCH: "false",
  ENABLE_QA_PERSONA_SWITCHER: "false",
  MEDIA_PUBLIC_BASE_URL: "https://media.creatorjobs.example",
  MEDIA_BASE_PATH: "/media",
};

const importProductionNextConfig = (overrides = {}) =>
  spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--input-type=module", "--eval", 'await import("./next.config.ts")'],
    {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, ...productionFrontendEnvironment, ...overrides },
    },
  );

const withRuntimeEnvironment = (environment, callback) => {
  const names = [
    "APP_ENV",
    "NEXT_PUBLIC_APP_ENV",
    "VERCEL_ENV",
    "NEXT_PUBLIC_USE_LOCAL_MOCKS",
  ];
  const previous = new Map(names.map((name) => [name, process.env[name]]));
  try {
    for (const name of names) delete process.env[name];
    Object.assign(process.env, environment);
    return callback();
  } finally {
    for (const name of names) {
      const value = previous.get(name);
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
};

function publicProfileLoader({
  backendProfile = null,
  canonicalProfile = null,
  mockProfile = null,
  fallbackAllowed = false,
  backendFails = false,
} = {}) {
  const source = ts.createSourceFile(
    "publicProfileFallback.ts",
    readFileSync(new URL("../lib/publicProfileFallback.ts", import.meta.url), "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const policy = source.statements.find(
    (node) =>
      ts.isVariableStatement(node) &&
      node.declarationList.declarations.some(
        (declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === "canUsePublicProfileFixtures",
      ),
  );
  const loader = source.statements.find(
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === "resolvePublicProfileWithTalentFallback",
  );
  assert.ok(policy, "the actual public-profile fixture policy must exist");
  assert.ok(loader, "the actual public-profile loader must exist");

  const executableSource = `${policy.getText(source)}\n${loader.getText(source)}`
    .replace(/\bexport\s+/g, "");
  const code = ts.transpileModule(executableSource, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const calls = { backend: 0, canonical: 0, mock: 0 };
  const functions = new Function(
    "canUseLocalMockFallback",
    "getPublicProfile",
    "getCanonicalPublicProfile",
    "getMockPublicTalentProfile",
    `${code}; return { canUsePublicProfileFixtures, resolvePublicProfileWithTalentFallback };`,
  )(
    () => fallbackAllowed,
    async () => {
      calls.backend += 1;
      if (backendFails) throw new Error("owned backend failure");
      return backendProfile;
    },
    async () => {
      calls.canonical += 1;
      return canonicalProfile;
    },
    () => {
      calls.mock += 1;
      return mockProfile;
    },
  );
  return { ...functions, calls };
}

test("truthy deployment flags have one shared spelling contract", () => {
  for (const value of ["1", "true", "yes", "on", "TRUE", " on "]) {
    assert.equal(isTruthyEnvironmentFlag(value), true, value);
  }
  for (const value of [undefined, "", "0", "false", "off", "enabled"]) {
    assert.equal(isTruthyEnvironmentFlag(value), false, String(value));
  }
});

test("production runtime refuses local mocks even when the public flag is truthy", () => {
  assert.equal(
    withRuntimeEnvironment({ NEXT_PUBLIC_USE_LOCAL_MOCKS: "true" }, isLocalMocksEnabled),
    true,
    "the test must prove local Mock mode still works outside production",
  );

  for (const productionSignal of [
    { APP_ENV: "production" },
    { NEXT_PUBLIC_APP_ENV: "production" },
    { VERCEL_ENV: "production" },
    { APP_ENV: "test", VERCEL_ENV: "production" },
  ]) {
    for (const value of ["1", "true", "yes", "on"]) {
      assert.equal(
        withRuntimeEnvironment(
          { ...productionSignal, NEXT_PUBLIC_USE_LOCAL_MOCKS: value },
          isLocalMocksEnabled,
        ),
        false,
        JSON.stringify({ ...productionSignal, value }),
      );
    }
  }
});

test("production frontend configuration rejects every demo control", () => {
  const valid = importProductionNextConfig();
  assert.equal(valid.status, 0, valid.stderr);

  for (const [name, values] of [
    ["NEXT_PUBLIC_USE_LOCAL_MOCKS", ["1", "true", "yes", "on"]],
    ["NEXT_PUBLIC_ENABLE_DEV_DATA_SWITCH", ["yes"]],
    ["ENABLE_QA_PERSONA_SWITCHER", ["on"]],
  ]) {
    for (const value of values) {
      const result = importProductionNextConfig({ [name]: value });
      assert.notEqual(result.status, 0, `${name}=${value}`);
      assert.match(`${result.stdout}\n${result.stderr}`, new RegExp(name));
    }
  }
});

test("production/backend profile resolution never substitutes a fixture person", async () => {
  const production = resolveMarketplaceDataSource({
    env: { APP_ENV: "production", NEXT_PUBLIC_USE_LOCAL_MOCKS: "true" },
    cookieValue: "mock",
  });
  const fixture = { username: "fixture-person" };
  const loader = publicProfileLoader({
    canonicalProfile: fixture,
    mockProfile: fixture,
    fallbackAllowed: false,
    backendFails: true,
  });

  assert.equal(await loader.resolvePublicProfileWithTalentFallback("fixture-person", production), null);
  assert.deepEqual(loader.calls, { backend: 1, canonical: 0, mock: 0 });
  assert.equal(loader.canUsePublicProfileFixtures(production), false);
});

test("private drafts require backend authority unless the server grants explicit demo data", () => {
  assert.equal(
    resolveDraftDataMode({
      allowDemo: false,
      demoRequested: true,
      localMocksEnabled: true,
      demoDataAvailable: true,
      hasBackendToken: false,
    }),
    "auth_error",
  );
  assert.equal(
    resolveDraftDataMode({
      allowDemo: false,
      demoRequested: false,
      localMocksEnabled: false,
      demoDataAvailable: false,
      hasBackendToken: true,
    }),
    "live",
  );
  assert.equal(
    resolveDraftDataMode({
      allowDemo: true,
      demoRequested: true,
      localMocksEnabled: false,
      demoDataAvailable: true,
      hasBackendToken: false,
    }),
    "demo",
  );
  assert.equal(
    resolveDraftDataMode({
      allowDemo: true,
      demoRequested: false,
      localMocksEnabled: true,
      demoDataAvailable: true,
      hasBackendToken: false,
    }),
    "demo",
  );
  assert.equal(
    resolveDraftDataMode({
      allowDemo: true,
      demoRequested: true,
      localMocksEnabled: false,
      demoDataAvailable: false,
      hasBackendToken: false,
    }),
    "auth_error",
    "a query parameter alone cannot manufacture a fixture capability",
  );
});

test("an explicit Backend override refuses fixtures while local Mock mode remains usable", async () => {
  const explicitBackend = resolveMarketplaceDataSource({
    env: { APP_ENV: "test", NEXT_PUBLIC_ENABLE_DEV_DATA_SWITCH: "true" },
    cookieValue: "backend",
  });
  const backendLoader = publicProfileLoader({
    canonicalProfile: { username: "fixture-person" },
    mockProfile: { username: "fixture-person" },
    fallbackAllowed: true,
  });
  assert.equal(
    await backendLoader.resolvePublicProfileWithTalentFallback("fixture-person", explicitBackend),
    null,
  );
  assert.deepEqual(backendLoader.calls, { backend: 1, canonical: 0, mock: 0 });

  const explicitMock = resolveMarketplaceDataSource({
    env: { APP_ENV: "test", NEXT_PUBLIC_ENABLE_DEV_DATA_SWITCH: "true" },
    cookieValue: "mock",
  });
  const mockLoader = publicProfileLoader({
    backendProfile: { username: "real-person" },
    canonicalProfile: { username: "fixture-person" },
    fallbackAllowed: true,
  });
  assert.deepEqual(
    await mockLoader.resolvePublicProfileWithTalentFallback("fixture-person", explicitMock),
    { username: "fixture-person" },
  );
  assert.deepEqual(mockLoader.calls, { backend: 0, canonical: 1, mock: 0 });
});

test("a backend job with a demo-like ID is not enriched without an explicit fixture lookup", () => {
  const fixtureJob = {
    id: "7",
    title: "Demo title",
    category: "Marketing",
    budget: "DEMO PAY",
    experience: "Demo experience",
    location: "Demo city",
    postedShort: "Local sample",
    views: 999,
    applicants: 999,
    responseRate: 99,
    channel: { name: "Demo channel", logoUrl: "/demo.png", subscribers: 99, verified: true },
    tags: ["Demo tag"],
    startTimeframe: "ASAP",
    type: "Full-time",
    status: "published",
  };
  const backendItem = {
    id: "7",
    title: "Real customer job",
    category: "Editing",
    location: "Real city",
    status: "published",
    created_at: "2026-09-22T00:00:00.000Z",
    channel_name: "Real customer",
  };

  const productionJob = mapPublicJobToCanonical(backendItem, "Fallback customer");
  assert.equal(productionJob.title, "Real customer job");
  assert.equal(productionJob.budget, "");
  assert.equal(productionJob.channel.name, "Real customer");
  assert.equal(productionJob.channel.logoUrl, "");
  assert.ok(!productionJob.tags?.includes("Demo tag"));

  const demoJob = mapPublicJobToCanonical(
    backendItem,
    "Fallback customer",
    new Map([["7", fixtureJob]]),
  );
  assert.equal(demoJob.title, "Real customer job");
  assert.equal(demoJob.budget, "DEMO PAY");
  assert.equal(demoJob.channel.logoUrl, "/demo.png");
  assert.ok(demoJob.tags?.includes("Demo tag"));
});

test("the production client profile component carries no implicit demo registry", () => {
  const component = readFileSync(
    new URL("../components/profile/PublicProfileTabs.tsx", import.meta.url),
    "utf8",
  );
  const page = readFileSync(new URL("../app/u/[slug]/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(component, /from ["']\.\.\/\.\.\/lib\/jobs["']/);
  assert.doesNotMatch(component, /\bJOBS\b/);
  assert.match(page, /canUsePublicProfileFixtures\(dataSource\)[\s\S]+import\("\.\.\/\.\.\/\.\.\/lib\/jobs"\)/);
});

test("client browse and drafts modules do not statically import fixture corpora", () => {
  const clientSources = [
    "components/JobGridClient.tsx",
    "components/jobs/JobFiltersDrawer.tsx",
    "components/drafts/DraftsPageClient.tsx",
  ].map((path) => [path, readFileSync(new URL(`../${path}`, import.meta.url), "utf8")]);

  for (const [path, source] of clientSources) {
    assert.doesNotMatch(source, /from ["'][^"']*(?:mockOwnerDrafts|lib\/jobs)["']/, path);
    assert.doesNotMatch(source, /\bMOCK_OWNER_DRAFTS\b/, path);
  }

  const ownerDrafts = readFileSync(new URL("../lib/ownerDrafts.ts", import.meta.url), "utf8");
  const draftsPage = readFileSync(new URL("../app/drafts/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(ownerDrafts, /mock-job-draft|mock-talent-draft/);
  assert.match(
    draftsPage,
    /allowDemo && \(demoRequested \|\| isLocalMocksEnabled\(\)\)[\s\S]+import\("\.\.\/\.\.\/lib\/mockOwnerDrafts"\)/,
  );
});

test("production applications ignore scenario selectors and hide development errors", () => {
  const source = readFileSync(
    new URL("../components/applications/ApplicationsPageClient.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /const seedParam = allowDemo \? searchParams\.get\("seed"\) : null/);
  assert.match(source, /setScenarioError\(allowDemo \? resolvedScenario\.error : null\)/);
  assert.match(source, /if \(!allowDemo \|\| !demoMode \|\| resolvedScenario\.error\)/);
});
