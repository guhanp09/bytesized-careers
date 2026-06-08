import { NextResponse } from "next/server";

import { getBackendApiBaseUrl } from "../../../../lib/backendClient";
import { isDevEmailInboxAllowed } from "../../../../lib/devEmailInbox";

const makeJson = (payload: unknown, status = 200) => {
  const response = NextResponse.json(payload, { status });
  response.headers.set("Cache-Control", "no-store");
  return response;
};

async function proxyDevEmails(method: "GET" | "DELETE") {
  if (!isDevEmailInboxAllowed()) {
    return makeJson({ error: "Not found" }, 404);
  }

  try {
    const response = await fetch(`${getBackendApiBaseUrl()}/dev/emails`, {
      method,
      cache: "no-store",
    });
    const text = await response.text();
    const payload = text ? JSON.parse(text) : {};
    if (response.status === 404) {
      return makeJson(
        {
          items: [],
          error: "Development email inbox backend route was not found. Restart the backend server so it loads the latest code.",
        },
        503
      );
    }
    return makeJson(payload, response.status);
  } catch {
    return makeJson(
      {
        items: [],
        error: "Development email inbox is unavailable. Start the backend with EMAIL_MODE=log.",
      },
      503
    );
  }
}

export async function GET() {
  return proxyDevEmails("GET");
}

export async function DELETE() {
  return proxyDevEmails("DELETE");
}
