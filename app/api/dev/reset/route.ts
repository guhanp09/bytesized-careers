import { proxyDevTools } from "../../../../lib/devToolsProxy";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  return proxyDevTools("/dev/reset", { method: "POST", body });
}
