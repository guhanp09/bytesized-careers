import { NextRequest, NextResponse } from "next/server";

import {
  MARKETPLACE_DATA_SOURCE_COOKIE,
  resolveMarketplaceDataSource,
  type MarketplaceDataSource,
} from "../../../../lib/devDataSource";

export const dynamic = "force-dynamic";

const env = () => ({
  APP_ENV: process.env.APP_ENV,
  NEXT_PUBLIC_APP_ENV: process.env.NEXT_PUBLIC_APP_ENV,
  VERCEL_ENV: process.env.VERCEL_ENV,
  NODE_ENV: process.env.NODE_ENV,
  NEXT_PUBLIC_USE_LOCAL_MOCKS: process.env.NEXT_PUBLIC_USE_LOCAL_MOCKS,
  NEXT_PUBLIC_ENABLE_DEV_DATA_SWITCH: process.env.NEXT_PUBLIC_ENABLE_DEV_DATA_SWITCH,
});

const sourceFromBody = (value: unknown): MarketplaceDataSource | null => {
  if (value === "backend" || value === "mock") return value;
  return null;
};

const disabled = () => NextResponse.json({ error: "Not found" }, { status: 404 });

const shouldSetSecureCookie = () =>
  process.env.VERCEL_ENV === "preview" ||
  process.env.VERCEL_ENV === "production" ||
  process.env.NEXTAUTH_URL?.startsWith("https://") ||
  process.env.NEXT_PUBLIC_SITE_URL?.startsWith("https://");

export function GET(request: NextRequest) {
  const state = resolveMarketplaceDataSource({
    env: env(),
    cookieValue: request.cookies.get(MARKETPLACE_DATA_SOURCE_COOKIE)?.value,
  });

  if (!state.enabled) return disabled();

  return NextResponse.json(state);
}

export async function POST(request: NextRequest) {
  const state = resolveMarketplaceDataSource({
    env: env(),
    cookieValue: request.cookies.get(MARKETPLACE_DATA_SOURCE_COOKIE)?.value,
  });

  if (!state.enabled) return disabled();

  let body: { source?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const source = sourceFromBody(body.source);
  if (!source) {
    return NextResponse.json({ error: "Invalid data source." }, { status: 400 });
  }

  const response = NextResponse.json({
    ...state,
    source,
    overrideSource: source,
  });
  response.cookies.set(MARKETPLACE_DATA_SOURCE_COOKIE, source, {
    httpOnly: true,
    sameSite: "lax",
    secure: shouldSetSecureCookie(),
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });

  return response;
}
