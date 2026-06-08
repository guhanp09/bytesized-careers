import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../../lib/auth";
import { getBackendApiBaseUrl } from "../../../../lib/backendClient";
import { IdentityStatusResponse } from "../../../../lib/identity/types";

const makeNoStoreJson = (payload: IdentityStatusResponse, status = 200) => {
  const response = NextResponse.json(payload, { status });
  response.headers.set("Cache-Control", "no-store");
  return response;
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const platform = searchParams.get("platform");
  if (platform !== "youtube" && platform !== "instagram") {
    return makeNoStoreJson({ verified: false }, 400);
  }
  if (platform !== "youtube") {
    return makeNoStoreJson({ verified: false });
  }

  const session = await getServerSession(authOptions);
  const backendToken = session?.backendAccessToken;
  if (!backendToken) {
    return makeNoStoreJson({ verified: false });
  }

  try {
    const response = await fetch(`${getBackendApiBaseUrl()}/me/youtube/channels`, {
      method: "GET",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${backendToken}`,
      },
    });
    if (!response.ok) {
      return makeNoStoreJson({ verified: false });
    }

    const data = (await response.json()) as {
      channels?: Array<{
        channel_id?: string;
        title?: string;
        thumbnail_url?: string | null;
      }>;
    };
    const channel = Array.isArray(data.channels) ? data.channels[0] : null;
    if (!channel?.channel_id) {
      return makeNoStoreJson({ verified: false });
    }

    return makeNoStoreJson({
      verified: true,
      identity: {
        platform: "youtube",
        brandId: channel.channel_id,
        name: channel.title || "YouTube Channel",
        imageUrl: channel.thumbnail_url || null,
        followersCount: null,
        handle: null,
        verifiedAt: new Date().toISOString(),
      },
    });
  } catch {
    return makeNoStoreJson({ verified: false });
  }
}
