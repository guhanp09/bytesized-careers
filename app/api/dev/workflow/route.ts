import { NextResponse } from "next/server";

import { isDevToolsAllowed } from "../../../../lib/devTools";
import { proxyDevTools } from "../../../../lib/devToolsProxy";
import { WORKFLOW_ACTION_IDS } from "../../../../lib/devWorkflows";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  // Gate first — never expose dev workflow routes in production.
  if (!isDevToolsAllowed()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  const action = typeof body.action === "string" ? body.action : "";
  if (!WORKFLOW_ACTION_IDS.includes(action as never)) {
    return NextResponse.json({ error: `Unknown workflow action '${action}'.` }, { status: 400 });
  }

  const rest: Record<string, unknown> = { ...body };
  delete rest.action;
  return proxyDevTools(`/dev/workflows/${action}`, { method: "POST", body: rest });
}
