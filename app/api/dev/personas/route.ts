import { proxyDevTools } from "../../../../lib/devToolsProxy";

export const dynamic = "force-dynamic";

export async function GET() {
  return proxyDevTools("/dev/personas");
}
