import type { BackendYouTubeRefreshResponse } from "../backendClient";

type FetchImplementation = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

export class YouTubeConnectionError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "YouTubeConnectionError";
    this.status = status;
  }
}

const errorMessageFrom = (payload: unknown, status: number): string => {
  if (payload && typeof payload === "object") {
    const error = (payload as { error?: unknown }).error;
    if (typeof error === "string" && error.trim()) return error;
  }
  return `YouTube connection request failed (${status})`;
};

const isRefreshResponse = (payload: unknown): payload is BackendYouTubeRefreshResponse =>
  Boolean(
    payload &&
      typeof payload === "object" &&
      typeof (payload as { status?: unknown }).status === "string" &&
      Array.isArray((payload as { channels?: unknown }).channels)
  );

/**
 * Refreshes YouTube through a same-origin server route. Provider credentials
 * never enter this request or its response; the backend uses its stored OAuth
 * account after NextAuth established it during verified Google sign-in.
 */
export async function refreshYouTubeConnection(
  fetchImpl: FetchImplementation = fetch
): Promise<BackendYouTubeRefreshResponse> {
  const response = await fetchImpl("/api/identity/youtube/refresh", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { Accept: "application/json" },
  });

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    // The typed fallback below avoids reflecting an untrusted HTML/text body.
  }

  if (!response.ok) {
    throw new YouTubeConnectionError(errorMessageFrom(payload, response.status), response.status);
  }
  if (!isRefreshResponse(payload)) {
    throw new YouTubeConnectionError("YouTube connection returned an invalid response.", 502);
  }
  return payload;
}
