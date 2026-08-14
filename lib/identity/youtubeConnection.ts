import type { BackendYouTubeRefreshResponse } from "../backendClient";
import type { IdentityDisconnectResponse } from "./types";

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

const REVOCATION_STATUSES = new Set([
  "confirmed",
  "already_invalid",
  "rejected",
  "unavailable",
  "not_applicable",
]);

const isDisconnectResponse = (payload: unknown): payload is IdentityDisconnectResponse => {
  if (!payload || typeof payload !== "object") return false;
  const value = payload as Record<string, unknown>;
  return (
    value.ok === true &&
    value.disconnected === true &&
    typeof value.provider_revocation === "string" &&
    REVOCATION_STATUSES.has(value.provider_revocation) &&
    typeof value.channel_links_removed === "number" &&
    Number.isInteger(value.channel_links_removed) &&
    value.channel_links_removed >= 0
  );
};

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

/** Disconnect all YouTube authority through the authenticated server boundary. */
export async function disconnectYouTubeConnection(
  fetchImpl: FetchImplementation = fetch
): Promise<IdentityDisconnectResponse> {
  const response = await fetchImpl("/api/identity/disconnect", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ platform: "youtube" }),
  });

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    // The fixed fallback below never reflects an upstream body.
  }
  if (!response.ok) {
    throw new YouTubeConnectionError(
      response.status === 401
        ? "Sign in again before disconnecting YouTube."
        : "YouTube could not be disconnected right now.",
      response.status
    );
  }
  if (!isDisconnectResponse(payload)) {
    throw new YouTubeConnectionError("YouTube returned an invalid disconnect response.", 502);
  }
  return payload;
}
