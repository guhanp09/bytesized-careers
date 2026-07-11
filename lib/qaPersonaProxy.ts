import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";

import { authOptions } from "./auth";
import { getBackendApiBaseUrl } from "./backendClient";
import { isQaPersonaUiAllowed } from "./qaPersonas";

const json = (payload: unknown, status = 200) => {
  const response = NextResponse.json(payload, { status });
  response.headers.set("Cache-Control", "no-store");
  return response;
};

export async function proxyQaPersona(
  path: string,
  init?: { method?: "GET" | "POST"; body?: unknown }
) {
  if (!isQaPersonaUiAllowed()) return json({ error: "Not found" }, 404);
  const session = await getServerSession(authOptions);
  if (!session?.backendAccessToken) return json({ error: "Not found" }, 404);

  try {
    const response = await fetch(`${getBackendApiBaseUrl()}${path}`, {
      method: init?.method || "GET",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${session.backendAccessToken}`,
        ...(init?.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    const text = await response.text();
    let payload: unknown = {};
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { error: "QA backend returned an unreadable response." };
      }
    }
    return json(payload, response.status);
  } catch {
    return json({ error: "QA backend is unavailable." }, 503);
  }
}
