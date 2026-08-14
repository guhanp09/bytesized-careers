import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";

import { authOptions } from "../../../../../lib/auth";
import {
  BackendRequestError,
  refreshMyYouTubeChannels,
} from "../../../../../lib/backendClient";

type ErrorPayload = { error: string };

const noStoreJson = <T,>(payload: T, status = 200) => {
  const response = NextResponse.json(payload, { status });
  response.headers.set("Cache-Control", "no-store");
  return response;
};

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.backendAccessToken || session.backendAuthError) {
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
