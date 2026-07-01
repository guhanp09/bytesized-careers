import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

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
  assert.match(switcher, /router\.refresh\(\)/);
});

