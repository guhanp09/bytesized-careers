export const BACKEND_TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

export type BackendAuthError = "refresh_failed";

export type BackendLoginPayload = {
  access_token: string;
  token_type?: string | null;
  refresh_token?: string | null;
  access_token_expires_at?: number | null;
  refresh_token_expires_at?: number | null;
  user?: {
    id?: string | null;
    email?: string | null;
    username?: string | null;
    display_name?: string | null;
    account_type?: string | null;
    account_type_selected_at?: string | null;
    onboarding_intent?: string | null;
    onboarding_intent_selected_at?: string | null;
  } | null;
};

export type BackendTokenState = {
  backendAccessToken?: string;
  backendTokenType?: string;
  backendRefreshToken?: string;
  backendAccessTokenExpiresAt?: number;
  backendRefreshTokenExpiresAt?: number;
  backendAuthError?: BackendAuthError;
};

export type SafeBackendSessionFields = {
  backendAccessToken?: string;
  backendTokenType?: string;
  backendUserId?: string;
  backendAccessTokenExpiresAt?: number;
  backendAuthError?: BackendAuthError;
};

type RefreshFetch = (
  input: string,
  init: {
    method: "POST";
    headers: { "Content-Type": "application/json" };
    cache: "no-store";
    body: string;
  }
) => Promise<Pick<Response, "ok" | "json" | "status">>;

export function jwtExpiresAtMs(token?: string | null): number | undefined {
  if (!token) return undefined;
  const parts = token.split(".");
  if (parts.length < 2 || !parts[1]) return undefined;

  try {
    const payload = JSON.parse(base64UrlDecode(parts[1])) as { exp?: unknown };
    return typeof payload.exp === "number" && Number.isFinite(payload.exp)
      ? payload.exp * 1000
      : undefined;
  } catch {
    return undefined;
  }
}

export function backendAccessTokenExpiresAtMs(payload: BackendLoginPayload): number | undefined {
  if (
    typeof payload.access_token_expires_at === "number" &&
    Number.isFinite(payload.access_token_expires_at)
  ) {
    return payload.access_token_expires_at * 1000;
  }
  return jwtExpiresAtMs(payload.access_token);
}

export function backendRefreshTokenExpiresAtMs(payload: BackendLoginPayload): number | undefined {
  if (
    typeof payload.refresh_token_expires_at === "number" &&
    Number.isFinite(payload.refresh_token_expires_at)
  ) {
    return payload.refresh_token_expires_at * 1000;
  }
  return jwtExpiresAtMs(payload.refresh_token);
}

export function shouldRefreshBackendToken({
  accessToken,
  expiresAt,
  now = Date.now(),
  bufferMs = BACKEND_TOKEN_REFRESH_BUFFER_MS,
}: {
  accessToken?: string | null;
  expiresAt?: number | null;
  now?: number;
  bufferMs?: number;
}): boolean {
  if (!accessToken) return false;
  if (typeof expiresAt !== "number" || !Number.isFinite(expiresAt)) return true;
  return expiresAt <= now + bufferMs;
}

export function applyBackendLoginPayload<T extends BackendTokenState>(
  token: T,
  payload: BackendLoginPayload
): T {
  token.backendAccessToken = payload.access_token;
  token.backendTokenType = payload.token_type || "bearer";
  token.backendAccessTokenExpiresAt = backendAccessTokenExpiresAtMs(payload);
  token.backendAuthError = undefined;

  if (payload.refresh_token) {
    token.backendRefreshToken = payload.refresh_token;
    token.backendRefreshTokenExpiresAt = backendRefreshTokenExpiresAtMs(payload);
  }

  return token;
}

export function markBackendRefreshFailed<T extends BackendTokenState>(token: T): T {
  token.backendRefreshToken = undefined;
  token.backendRefreshTokenExpiresAt = undefined;
  token.backendAuthError = "refresh_failed";
  return token;
}

export function buildSafeBackendSessionFields(token: SafeBackendSessionFields): SafeBackendSessionFields {
  return {
    backendAccessToken: token.backendAccessToken,
    backendTokenType: token.backendTokenType,
    backendUserId: token.backendUserId,
    backendAccessTokenExpiresAt: token.backendAccessTokenExpiresAt,
    backendAuthError: token.backendAuthError,
  };
}

export async function refreshBackendAccessToken({
  backendBaseUrl,
  refreshToken,
  fetchImpl = fetch,
}: {
  backendBaseUrl: string;
  refreshToken: string;
  fetchImpl?: RefreshFetch;
}): Promise<BackendLoginPayload> {
  const response = await fetchImpl(`${backendBaseUrl.replace(/\/+$/, "")}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  if (!response.ok) {
    throw new Error(`Backend token refresh failed with ${response.status}`);
  }
  return (await response.json()) as BackendLoginPayload;
}

function base64UrlDecode(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  if (typeof Buffer !== "undefined") {
    return Buffer.from(padded, "base64").toString("utf8");
  }
  return atob(padded);
}
