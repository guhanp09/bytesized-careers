import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../../lib/auth";
import { fetchYouTubeChannels } from "../../../../lib/identity/youtube";
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

  const accessToken = session?.user?.accessToken;
  if (!accessToken) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const channels = await fetchYouTubeChannels(accessToken);
  const identity = channels.find((c) => c.brandId === brandId);
  if (!identity) {
    return NextResponse.json({ error: "Identity not found." }, { status: 404 });
  }

  const result = linkUserToIdentity(userId, identity);
  if (!result.ok) {
    return NextResponse.json({ error: "Channel already linked." }, { status: 409 });
  }

  return NextResponse.json({ identity });
}
