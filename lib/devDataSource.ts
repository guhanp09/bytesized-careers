import {
  hasProductionEnvironmentSignal,
  isTruthyEnvironmentFlag,
} from "./runtimeEnvironment.ts";

export type MarketplaceDataSource = "backend" | "mock";

export const MARKETPLACE_DATA_SOURCE_COOKIE = "cj_data_source";

type Env = {
  APP_ENV?: string;
  NEXT_PUBLIC_APP_ENV?: string;
  VERCEL_ENV?: string;
  NODE_ENV?: string;
  NEXT_PUBLIC_USE_LOCAL_MOCKS?: string;
  NEXT_PUBLIC_ENABLE_DEV_DATA_SWITCH?: string;
};

export type MarketplaceDataSourceState = {
  enabled: boolean;
  source: MarketplaceDataSource;
  defaultSource: MarketplaceDataSource;
  overrideSource: MarketplaceDataSource | null;
};

const normalizeSource = (value?: string | null): MarketplaceDataSource | null => {
  if (value === "backend" || value === "mock") return value;
  return null;
};

export const evaluateDevDataSwitchAllowed = (env: Env): boolean => {
  const appEnv = env.APP_ENV || env.NEXT_PUBLIC_APP_ENV;

  if (hasProductionEnvironmentSignal(env)) {
    return false;
  }

  if (isTruthyEnvironmentFlag(env.NEXT_PUBLIC_ENABLE_DEV_DATA_SWITCH)) return true;

  if (appEnv === "staging") return false;

  if (
    env.NODE_ENV === "development" ||
    env.NODE_ENV === "test" ||
    appEnv === "development" ||
    appEnv === "test" ||
    appEnv === "preview" ||
    env.VERCEL_ENV === "preview"
  ) {
    return true;
  }

  return false;
};

export const getDefaultMarketplaceDataSourceFromEnv = (env: Env): MarketplaceDataSource => {
  if (hasProductionEnvironmentSignal(env)) return "backend";
  return isTruthyEnvironmentFlag(env.NEXT_PUBLIC_USE_LOCAL_MOCKS) ? "mock" : "backend";
};

export const resolveMarketplaceDataSource = ({
  env,
  cookieValue,
}: {
  env: Env;
  cookieValue?: string | null;
}): MarketplaceDataSourceState => {
  const enabled = evaluateDevDataSwitchAllowed(env);
  const defaultSource = getDefaultMarketplaceDataSourceFromEnv(env);
  const overrideSource = enabled ? normalizeSource(cookieValue) : null;

  return {
    enabled,
    source: overrideSource ?? defaultSource,
    defaultSource,
    overrideSource,
  };
};
