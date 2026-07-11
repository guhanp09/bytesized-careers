import { proxyQaPersona } from "@/lib/qaPersonaProxy";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ key: string }> }) {
  const { key } = await context.params;
  const body = (await request.json()) as unknown;
  return proxyQaPersona(`/qa/scenarios/${encodeURIComponent(key)}/restore`, {
    method: "POST",
    body,
  });
}
