import { NextResponse } from "next/server";
import { IdentityPlatform } from "../../../../lib/identity/types";

const COOKIE_PREFIX = "cj_identity_";

export async function POST(req: Request) {
  let payload: { platform?: IdentityPlatform } = {};
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const platform = payload.platform;
  if (!platform || (platform !== "youtube" && platform !== "instagram")) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(`${COOKIE_PREFIX}${platform}`, "", { path: "/", maxAge: 0 });
  return res;
}
