import { cookies } from "next/headers";

import {
  MARKETPLACE_DATA_SOURCE_COOKIE,
  resolveMarketplaceDataSource,
  type MarketplaceDataSource,
  type MarketplaceDataSourceState,
} from "./devDataSource";

const env = () => ({
  APP_ENV: process.env.APP_ENV,
  NEXT_PUBLIC_APP_ENV: process.env.NEXT_PUBLIC_APP_ENV,
  VERCEL_ENV: process.env.VERCEL_ENV,
  NODE_ENV: process.env.NODE_ENV,
  NEXT_PUBLIC_USE_LOCAL_MOCKS: process.env.NEXT_PUBLIC_USE_LOCAL_MOCKS,
  NEXT_PUBLIC_ENABLE_DEV_DATA_SWITCH: process.env.NEXT_PUBLIC_ENABLE_DEV_DATA_SWITCH,
});

export const getMarketplaceDataSourceState = async (): Promise<MarketplaceDataSourceState> => {
  const cookieStore = await cookies();
  return resolveMarketplaceDataSource({
    env: env(),
    cookieValue: cookieStore.get(MARKETPLACE_DATA_SOURCE_COOKIE)?.value,
  });
};

export const getMarketplaceDataSource = async (): Promise<MarketplaceDataSource> =>
  (await getMarketplaceDataSourceState()).source;

export const isDevDataSwitchEnabled = async (): Promise<boolean> =>
  (await getMarketplaceDataSourceState()).enabled;

