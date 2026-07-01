import { NextResponse } from "next/server";

import { getBackendApiBaseUrl } from "./backendClient";
import { isDevToolsAllowed } from "./devTools";

// Server-side proxy from the Next `/api/dev/*` routes to the backend `/dev/*`
// endpoints. Both layers are gated: this returns 404 outside dev/test even before
// touching the backend, and the backend re-checks too. Never cached.

const makeJson = (payload: unknown, status = 200) => {
  const response = NextResponse.json(payload, { status });
  response.headers.set("Cache-Control", "no-store");
  return response;
};

export async function proxyDevTools(
  backendPath: string,
  init?: { method?: "GET" | "POST"; body?: unknown }
) {
  if (!isDevToolsAllowed()) {
    return makeJson({ error: "Not found" }, 404);
  }

  const method = init?.method ?? "GET";
  try {
    const response = await fetch(`${getBackendApiBaseUrl()}${backendPath}`, {
      method,
      cache: "no-store",
      headers: init?.body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    const text = await response.text();
    const payload = text ? JSON.parse(text) : {};
    if (response.status === 404) {
      return makeJson(
        {
          error:
            "Dev tools backend route was not found. Restart the backend so it loads the latest code, and ensure APP_ENV=development.",
        },
        503
      );
    }
    return makeJson(payload, response.status);
  } catch {
    return makeJson(
      { error: "Dev tools backend is unavailable. Start the backend (APP_ENV=development)." },
      503
    );
  }
}
