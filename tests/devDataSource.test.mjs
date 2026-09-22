import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

import {
  MARKETPLACE_DATA_SOURCE_COOKIE,
  evaluateDevDataSwitchAllowed,
  getDefaultMarketplaceDataSourceFromEnv,
  resolveMarketplaceDataSource,
} from "../lib/devDataSource.ts";

test("production signals hard-deny the marketplace data switch", () => {
  assert.equal(evaluateDevDataSwitchAllowed({ APP_ENV: "production" }), false);
  assert.equal(evaluateDevDataSwitchAllowed({ NEXT_PUBLIC_APP_ENV: "production" }), false);
  assert.equal(evaluateDevDataSwitchAllowed({ VERCEL_ENV: "production" }), false);
  assert.equal(
    evaluateDevDataSwitchAllowed({
      VERCEL_ENV: "production",
      NEXT_PUBLIC_ENABLE_DEV_DATA_SWITCH: "true",
      NODE_ENV: "development",
    }),
    false
  );
});

test("development, test, preview, and explicit opt-in enable the switch", () => {
  assert.equal(evaluateDevDataSwitchAllowed({ NODE_ENV: "development" }), true);
  assert.equal(evaluateDevDataSwitchAllowed({ NODE_ENV: "test" }), true);
  assert.equal(evaluateDevDataSwitchAllowed({ APP_ENV: "preview" }), true);
  assert.equal(evaluateDevDataSwitchAllowed({ NEXT_PUBLIC_APP_ENV: "preview" }), true);
  assert.equal(evaluateDevDataSwitchAllowed({ VERCEL_ENV: "preview" }), true);
  assert.equal(evaluateDevDataSwitchAllowed({ NEXT_PUBLIC_ENABLE_DEV_DATA_SWITCH: "1" }), true);
});

test("staging hides the marketplace data switch unless explicitly enabled", () => {
  assert.equal(evaluateDevDataSwitchAllowed({ APP_ENV: "staging" }), false);
  assert.equal(evaluateDevDataSwitchAllowed({ NEXT_PUBLIC_APP_ENV: "staging" }), false);
  assert.equal(
    evaluateDevDataSwitchAllowed({ APP_ENV: "staging", VERCEL_ENV: "preview" }),
    false
  );
  assert.equal(
    evaluateDevDataSwitchAllowed({
      APP_ENV: "staging",
      VERCEL_ENV: "preview",
      NEXT_PUBLIC_ENABLE_DEV_DATA_SWITCH: "true",
    }),
    true
  );
});

test("default marketplace data source follows NEXT_PUBLIC_USE_LOCAL_MOCKS", () => {
  assert.equal(getDefaultMarketplaceDataSourceFromEnv({}), "backend");
  assert.equal(getDefaultMarketplaceDataSourceFromEnv({ NEXT_PUBLIC_USE_LOCAL_MOCKS: "false" }), "backend");
  assert.equal(getDefaultMarketplaceDataSourceFromEnv({ NEXT_PUBLIC_USE_LOCAL_MOCKS: "true" }), "mock");
  assert.equal(getDefaultMarketplaceDataSourceFromEnv({ NEXT_PUBLIC_USE_LOCAL_MOCKS: "1" }), "mock");
});

test("valid cookies override the default only when the switch is enabled", () => {
  assert.deepEqual(
    resolveMarketplaceDataSource({
      env: { NODE_ENV: "development", NEXT_PUBLIC_USE_LOCAL_MOCKS: "false" },
      cookieValue: "mock",
    }),
    {
      enabled: true,
      source: "mock",
      defaultSource: "backend",
      overrideSource: "mock",
    }
  );

  assert.deepEqual(
    resolveMarketplaceDataSource({
      env: { NODE_ENV: "production", NEXT_PUBLIC_USE_LOCAL_MOCKS: "false" },
      cookieValue: "mock",
    }),
    {
      enabled: false,
      source: "backend",
      defaultSource: "backend",
      overrideSource: null,
    }
  );
});

test("invalid or missing cookies fall back to the env default", () => {
  assert.deepEqual(
    resolveMarketplaceDataSource({
      env: { APP_ENV: "preview", NEXT_PUBLIC_USE_LOCAL_MOCKS: "true" },
      cookieValue: "banana",
    }),
    {
      enabled: true,
      source: "mock",
      defaultSource: "mock",
      overrideSource: null,
    }
  );

  assert.equal(
    resolveMarketplaceDataSource({
      env: { APP_ENV: "preview", NEXT_PUBLIC_USE_LOCAL_MOCKS: "false" },
    }).source,
    "backend"
  );
});

test("the dev API route and header switch use the shared cookie/source contract", () => {
  const route = readFileSync("app/api/dev/data-source/route.ts", "utf8");
  const header = readFileSync("components/Header.tsx", "utf8");
  const switcher = readFileSync("components/dev/DevDataSourceSwitch.tsx", "utf8");

  assert.equal(MARKETPLACE_DATA_SOURCE_COOKIE, "cj_data_source");
  assert.match(route, /response\.cookies\.set\(MARKETPLACE_DATA_SOURCE_COOKIE/);
  assert.match(route, /sourceFromBody/);
  assert.match(header, /<DevDataSourceSwitch \/>/);
  assert.match(switcher, /\/api\/dev\/data-source/);
  assert.match(switcher, /if \(!CLIENT_SWITCH_ENABLED\) return/);
  assert.match(switcher, /router\.refresh\(\)/);
});

// Execute the actual page loader with controlled I/O. This tests the source
// branch and filtering together without importing a Next server or a second
// implementation of its decision. Comments cannot satisfy this boundary.
function portfolioLoader({ items = [], fail = false } = {}) {
  const source = ts.createSourceFile(
    "page.tsx", readFileSync("app/talent/[id]/page.tsx", "utf8"),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX,
  );
  const declaration = source.statements.find(
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === "getRelevantPortfolioItems",
  );
  assert.ok(declaration, "actual talent page loader must exist");
  const code = ts.transpileModule(declaration.getText(source), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const reads = [];
  let mocks = 0;
  const load = new Function("mockPortfolioItemsFor", "listPortfolioByUserId", `${code}; return getRelevantPortfolioItems;`)(
    () => { mocks++; return [{ id: "explicit-demo" }]; },
    async (owner) => {
      reads.push(owner);
      if (fail) throw new Error("owned test backend unavailable");
      return { items };
    },
  );
  return { load, reads, mockCalls: () => mocks };
}

for (const [name, env, cookieValue] of [
  ["production without a cookie", { APP_ENV: "production", NEXT_PUBLIC_USE_LOCAL_MOCKS: "false" }],
  ["production ignores a mock cookie", { APP_ENV: "production", NEXT_PUBLIC_USE_LOCAL_MOCKS: "false" }, "mock"],
  ["development defaults to backend", { APP_ENV: "development" }],
  ["explicit backend override", { APP_ENV: "test", NEXT_PUBLIC_USE_LOCAL_MOCKS: "true" }, "backend"],
]) {
  test(`talent portfolio uses real selected public work: ${name}`, async () => {
    const first = { id: "first", is_public: true, publish_status: "published" };
    const second = { id: "second", is_public: true, publish_status: "published" };
    const loader = portfolioLoader({ items: [
      first, second,
      { id: "private", is_public: false, publish_status: "published" },
      { id: "draft", is_public: true, publish_status: "draft" },
      { id: "unselected", is_public: true, publish_status: "published" },
    ] });
    const state = resolveMarketplaceDataSource({ env, cookieValue });
    const result = await loader.load({
      owner_user_id: "real-owner",
      portfolio_item_ids: ["second", "private", "missing", "first", "draft"],
    }, state);
    assert.deepEqual(result, [second, first]);
    assert.deepEqual(loader.reads, ["real-owner"]);
    assert.equal(loader.mockCalls(), 0);
  });
}

test("backend portfolio absence or outage never fabricates samples", async () => {
  const state = resolveMarketplaceDataSource({ env: { APP_ENV: "production" } });
  for (const options of [{ items: [] }, { fail: true }]) {
    const loader = portfolioLoader(options);
    assert.deepEqual(await loader.load({ owner_user_id: "real-owner", portfolio_item_ids: ["missing"] }, state), []);
    assert.equal(loader.mockCalls(), 0);
  }
});

test("an explicit demo source retains its portfolio samples without backend reads", async () => {
  for (const state of [
    resolveMarketplaceDataSource({ env: { APP_ENV: "test", NEXT_PUBLIC_USE_LOCAL_MOCKS: "true" } }),
    resolveMarketplaceDataSource({ env: { APP_ENV: "test" }, cookieValue: "mock" }),
  ]) {
    const loader = portfolioLoader({ fail: true });
    assert.deepEqual(await loader.load({ owner_user_id: "demo-owner", portfolio_item_ids: ["demo"] }, state), [{ id: "explicit-demo" }]);
    assert.equal(loader.mockCalls(), 1);
    assert.deepEqual(loader.reads, []);
  }
});
