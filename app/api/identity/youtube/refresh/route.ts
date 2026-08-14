import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";

import { authOptions } from "../../../../../lib/auth";
import {
  BackendRequestError,
  refreshMyYouTubeChannels,
} from "../../../../../lib/backendClient";

type ErrorPayload = { error: string };

const noStoreJson = <T,>(payload: T, status = 200) => {
  const response = NextResponse.json(payload, { status });
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Pragma", "no-cache");
  return response;
};

const sameOrigin = (request: NextRequest): boolean => {
  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) return false;
  return request.headers.get("sec-fetch-site") !== "cross-site";
};

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) {
    return noStoreJson<ErrorPayload>({ error: "origin_rejected" }, 403);
  }
  const session = await getServerSession(authOptions);
  if (!session?.backendAccessToken || session.backendAuthError || session.qaPersona) {
    return noStoreJson<ErrorPayload>({ error: "backend_auth_required" }, 401);
  }

  try {
    const result = await refreshMyYouTubeChannels(session.backendAccessToken);
    return noStoreJson(result);
  } catch (error) {
    if (error instanceof BackendRequestError) {
      if (error.message.includes("youtube_reauth_required")) {
        return noStoreJson<ErrorPayload>({ error: "youtube_reauth_required" }, 401);
      }
      if (error.status === 401 || error.status === 403) {
        return noStoreJson<ErrorPayload>({ error: "backend_auth_required" }, 401);
      }
      if (error.status >= 500) {
        return noStoreJson<ErrorPayload>({ error: "youtube_provider_unavailable" }, 503);
      }
    }
    return noStoreJson<ErrorPayload>({ error: "youtube_refresh_failed" }, 502);
  }
}
