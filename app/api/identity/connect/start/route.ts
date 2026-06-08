import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../../../lib/auth";
import { IdentityConnectResponse, IdentityPlatform } from "../../../../../lib/identity/types";
import { fetchYouTubeChannels } from "../../../../../lib/identity/youtube";

export async function POST(req: Request) {
  let payload: { platform?: IdentityPlatform } = {};
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ options: [] } satisfies IdentityConnectResponse, { status: 400 });
  }

  const platform = payload.platform;
  if (!platform || (platform !== "youtube" && platform !== "instagram")) {
    return NextResponse.json({ options: [] } satisfies IdentityConnectResponse, { status: 400 });
  }

  const session = await getServerSession(authOptions);
  const accessToken = session?.user?.accessToken;
  if (!accessToken) {
    return NextResponse.json({ options: [] } satisfies IdentityConnectResponse, { status: 401 });
  }

  if (platform !== "youtube") {
    return NextResponse.json({ options: [] } satisfies IdentityConnectResponse, { status: 400 });
  }

  if (platform === "youtube") {
    const options = await fetchYouTubeChannels(accessToken);
    if (!options.length) {
      return NextResponse.json({ options: [] } satisfies IdentityConnectResponse, { status: 404 });
    }
    return NextResponse.json({ options } satisfies IdentityConnectResponse);
  }

  return NextResponse.json({ options: [] } satisfies IdentityConnectResponse, { status: 404 });
}
