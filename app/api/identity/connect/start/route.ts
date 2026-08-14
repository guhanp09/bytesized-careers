import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../../../lib/auth";
import {
  BackendRequestError,
  refreshMyYouTubeChannels,
} from "../../../../../lib/backendClient";
import { IdentityConnectResponse, IdentityPlatform } from "../../../../../lib/identity/types";

const json = (payload: IdentityConnectResponse, status = 200) => {
  const response = NextResponse.json(payload, { status });
  response.headers.set("Cache-Control", "no-store");
  return response;
};

export async function POST(req: Request) {
  let payload: { platform?: IdentityPlatform } = {};
  try {
    payload = await req.json();
  } catch {
    return json({ options: [] }, 400);
  }

  const platform = payload.platform;
  if (!platform || (platform !== "youtube" && platform !== "instagram")) {
    return json({ options: [] }, 400);
  }

  const session = await getServerSession(authOptions);
  const backendToken = session?.backendAccessToken;
  if (!backendToken || session.backendAuthError) {
    return json({ options: [], error: "backend_auth_required" }, 401);
  }

  if (platform !== "youtube") {
    return json({ options: [] }, 400);
  }

  try {
    const refreshed = await refreshMyYouTubeChannels(backendToken);
    const verifiedAt = new Date().toISOString();
    const options = refreshed.channels.map((channel) => ({
      platform: "youtube" as const,
      brandId: channel.channel_id,
      name: channel.title,
      imageUrl: channel.thumbnail_url || null,
      followersCount: null,
      handle: null,
      verifiedAt,
    }));
    if (!options.length) return json({ options: [] }, 404);
    return json({ options });
  } catch (error) {
    if (
      error instanceof BackendRequestError &&
      error.message.includes("youtube_reauth_required")
    ) {
      return json({ options: [], error: "youtube_reauth_required" }, 401);
    }
    return json({ options: [], error: "youtube_refresh_failed" }, 502);
  }
}
