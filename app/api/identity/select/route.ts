import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../../lib/auth";
import { listMyYouTubeChannels } from "../../../../lib/backendClient";
import { linkUserToIdentity } from "../../../../lib/auth/store";
import { IdentityPlatform } from "../../../../lib/identity/types";

export async function POST(req: Request) {
  let payload: { platform?: IdentityPlatform; brandId?: string } = {};
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const platform = payload.platform;
  const brandId = payload.brandId;
  if (!platform || !brandId || (platform !== "youtube" && platform !== "instagram")) {
    return NextResponse.json({ error: "Invalid platform or brandId." }, { status: 400 });
  }

  const session = await getServerSession(authOptions);
  const userId = session?.user?.userId;
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const backendToken = session?.backendAccessToken;
  if (!backendToken || session.backendAuthError) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  let channels;
  try {
    channels = (await listMyYouTubeChannels(backendToken)).channels;
  } catch {
    return NextResponse.json({ error: "Could not load verified channels." }, { status: 502 });
  }
  const channel = channels.find((item) => item.channel_id === brandId);
  const identity = channel
    ? {
        platform: "youtube" as const,
        brandId: channel.channel_id,
        name: channel.title,
        imageUrl: channel.thumbnail_url || null,
        followersCount: null,
        handle: null,
        verifiedAt: new Date().toISOString(),
      }
    : null;
  if (!identity) {
    return NextResponse.json({ error: "Identity not found." }, { status: 404 });
  }

  const result = linkUserToIdentity(userId, identity);
  if (!result.ok) {
    return NextResponse.json({ error: "Channel already linked." }, { status: 409 });
  }

  return NextResponse.json({ identity });
}
