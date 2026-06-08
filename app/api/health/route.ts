import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    {
      status: "ok",
      service: "creatorjobs-web",
      env: process.env.NEXT_PUBLIC_APP_ENV || process.env.APP_ENV || process.env.NODE_ENV || "development",
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}
