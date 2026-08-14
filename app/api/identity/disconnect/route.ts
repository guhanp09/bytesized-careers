import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";

import { authOptions } from "../../../../lib/auth";
import {
  BackendRequestError,
  disconnectMyYouTube,
} from "../../../../lib/backendClient";

const MAX_REQUEST_BODY_BYTES = 512;

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

const readPlatform = async (request: NextRequest): Promise<"youtube" | null> => {
  const contentType = request.headers.get("content-type")?.toLowerCase() || "";
  if (!contentType.startsWith("application/json")) return null;
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BODY_BYTES) {
    return null;
  }
  const body = await request.text();
  if (
    !body ||
    body.length > MAX_REQUEST_BODY_BYTES ||
    new TextEncoder().encode(body).byteLength > MAX_REQUEST_BODY_BYTES
  ) {
    return null;
  }
  try {
    const payload = JSON.parse(body) as unknown;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
    const record = payload as Record<string, unknown>;
    if (Object.keys(record).some((key) => key !== "platform")) return null;
    return record.platform === "youtube" ? "youtube" : null;
  } catch {
    return null;
  }
};

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) {
    return noStoreJson({ error: "origin_rejected" }, 403);
  }
  const platform = await readPlatform(request);
  if (platform !== "youtube") {
    return noStoreJson({ error: "unsupported_platform" }, 400);
  }

  const session = await getServerSession(authOptions);
  if (!session?.backendAccessToken || session.backendAuthError || session.qaPersona) {
    return noStoreJson({ error: "backend_auth_required" }, 401);
  }

  try {
    const result = await disconnectMyYouTube(session.backendAccessToken);
    return noStoreJson({
      ok: true as const,
      disconnected: true as const,
      provider_revocation: result.provider_revocation,
      channel_links_removed: result.channel_links_removed,
    });
  } catch (error) {
    if (error instanceof BackendRequestError) {
      if (error.status === 401 || error.status === 403) {
        return noStoreJson({ error: "backend_auth_required" }, 401);
      }
    }
    return noStoreJson({ error: "youtube_disconnect_failed" }, 503);
  }
}
