import { getServerSession } from "next-auth";
import { getToken, type JWT } from "next-auth/jwt";
import { NextRequest, NextResponse } from "next/server";

import { authOptions } from "../../../../lib/auth";
import {
  BackendRequestError,
  challengeBackendStrongAuth,
  confirmBackendStrongAuthEnrollment,
  disableBackendStrongAuth,
  getBackendStrongAuthStatus,
  regenerateBackendStrongAuthRecoveryCodes,
  startBackendStrongAuthEnrollment,
  type BackendStrongAuthMethod,
  type BackendStrongAuthPrimaryCredential,
} from "../../../../lib/backendClient";
import { readStrongAuthGoogleReauthentication } from "../../../../lib/strongAuthReauthentication";

const MAX_REQUEST_BODY_BYTES = 16 * 1024;

type StrongAuthAction =
  | "enroll"
  | "confirm"
  | "challenge"
  | "regenerate_recovery_codes"
  | "disable";

type JsonRecord = Record<string, unknown>;

const noStoreJson = <T,>(payload: T, status = 200) => {
  const response = NextResponse.json(payload, { status });
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Pragma", "no-cache");
  return response;
};

const errorJson = (error: string, message: string, status: number) =>
  noStoreJson({ error, message }, status);

const stringField = (
  payload: JsonRecord,
  field: string,
  { min = 1, max }: { min?: number; max: number }
): string | null => {
  const value = payload[field];
  return typeof value === "string" && value.length >= min && value.length <= max
    ? value
    : null;
};

const methodField = (payload: JsonRecord): BackendStrongAuthMethod | null => {
  const method = payload.method;
  return method === "totp" || method === "recovery_code" ? method : null;
};

const actionField = (payload: JsonRecord): StrongAuthAction | null => {
  const action = payload.action;
  return action === "enroll" ||
    action === "confirm" ||
    action === "challenge" ||
    action === "regenerate_recovery_codes" ||
    action === "disable"
    ? action
    : null;
};

const isSameOriginBrowserRequest = (request: NextRequest): boolean => {
  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) return false;
  const fetchSite = request.headers.get("sec-fetch-site");
  return fetchSite !== "cross-site";
};

const readBody = async (request: NextRequest): Promise<JsonRecord | null> => {
  const contentType = request.headers.get("content-type")?.toLowerCase() || "";
  if (!contentType.startsWith("application/json")) return null;
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BODY_BYTES) {
    return null;
  }
  const text = await request.text();
  if (
    !text ||
    text.length > MAX_REQUEST_BODY_BYTES ||
    new TextEncoder().encode(text).byteLength > MAX_REQUEST_BODY_BYTES
  ) {
    return null;
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as JsonRecord)
      : null;
  } catch {
    return null;
  }
};

const backendErrorResponse = (error: unknown) => {
  if (!(error instanceof BackendRequestError)) {
    return errorJson(
      "strong_auth_unavailable",
      "Strong authentication is temporarily unavailable.",
      503
    );
  }
  if (error.status === 401) {
    return errorJson("session_expired", "Your session has expired. Sign in again.", 401);
  }
  if (error.status === 403) {
    return errorJson("strong_auth_failed", "The authentication proof was not accepted.", 403);
  }
  if (error.status === 409) {
    return errorJson(
      "strong_auth_conflict",
      "The factor state changed. Reload and try again.",
      409
    );
  }
  if (error.status === 410) {
    return errorJson(
      "enrollment_expired",
      "The authenticator setup expired. Start again.",
      410
    );
  }
  if (error.status === 429) {
    return errorJson(
      "strong_auth_locked",
      "Too many attempts. Wait before trying again.",
      429
    );
  }
  if (error.status === 400 || error.status === 422) {
    return errorJson("invalid_request", "Check the submitted authentication details.", 400);
  }
  return errorJson(
    "strong_auth_unavailable",
    "Strong authentication is temporarily unavailable.",
    503
  );
};

const adminSession = async () => {
  const session = await getServerSession(authOptions);
  if (!session?.backendAccessToken || session.backendAuthError) {
    return { error: errorJson("session_expired", "Sign in again.", 401) } as const;
  }
  if (session.user?.accountType !== "ADMIN" || session.qaPersona) {
    return { error: errorJson("not_found", "Not found.", 404) } as const;
  }
  return { session } as const;
};

const encryptedSessionToken = async (request: NextRequest): Promise<JWT | null> =>
  getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });

const recentGoogleIdToken = (
  token: JWT | null,
  backendUserId: string | undefined
): string | undefined => {
  if (!token || !backendUserId || token.backendUserId !== backendUserId) return undefined;
  return readStrongAuthGoogleReauthentication(token);
};

const primaryCredential = async (
  request: NextRequest,
  payload: JsonRecord,
  provider: string | undefined,
  backendUserId: string | undefined
): Promise<BackendStrongAuthPrimaryCredential | null> => {
  if (provider === "credentials") {
    const password = stringField(payload, "password", { min: 1, max: 128 });
    return password ? { password } : null;
  }
  if (provider === "google") {
    const idToken = recentGoogleIdToken(
      await encryptedSessionToken(request),
      backendUserId
    );
    return idToken ? { google_id_token: idToken } : null;
  }
  return null;
};

export async function GET(request: NextRequest) {
  const access = await adminSession();
  if ("error" in access) return access.error;
  const accessToken = access.session.backendAccessToken;
  if (!accessToken) return errorJson("session_expired", "Sign in again.", 401);
  try {
    const status = await getBackendStrongAuthStatus(accessToken);
    const googleReauthenticationAvailable =
      access.session.user?.provider === "google" &&
      Boolean(
        recentGoogleIdToken(
          await encryptedSessionToken(request),
          access.session.backendUserId
        )
      );
    return noStoreJson({
      ...status,
      google_reauthentication_available: googleReauthenticationAvailable,
    });
  } catch (error) {
    return backendErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  if (!isSameOriginBrowserRequest(request)) {
    return errorJson("origin_rejected", "Request origin was not accepted.", 403);
  }
  const access = await adminSession();
  if ("error" in access) return access.error;
  const accessToken = access.session.backendAccessToken;
  if (!accessToken) return errorJson("session_expired", "Sign in again.", 401);
  const payload = await readBody(request);
  const action = payload ? actionField(payload) : null;
  if (!payload || !action) {
    return errorJson("invalid_request", "Invalid strong-authentication request.", 400);
  }

  try {
    if (action === "enroll") {
      const primary = await primaryCredential(
        request,
        payload,
        access.session.user?.provider,
        access.session.backendUserId
      );
      if (!primary) {
        const google = access.session.user?.provider === "google";
        return errorJson(
          google ? "google_reauthentication_required" : "primary_reauthentication_required",
          google
            ? "Reauthenticate with Google before setting up an authenticator."
            : "Enter your current password.",
          409
        );
      }
      return noStoreJson(
        await startBackendStrongAuthEnrollment(
          accessToken,
          primary
        )
      );
    }

    if (action === "confirm") {
      const code = stringField(payload, "code", { min: 6, max: 6 });
      if (!code || !/^[0-9]{6}$/.test(code)) {
        return errorJson("invalid_request", "Enter the six-digit authenticator code.", 400);
      }
      return noStoreJson(
        await confirmBackendStrongAuthEnrollment(
          accessToken,
          code
        )
      );
    }

    if (action === "regenerate_recovery_codes") {
      const code = stringField(payload, "code", { min: 6, max: 6 });
      if (!code || !/^[0-9]{6}$/.test(code)) {
        return errorJson("invalid_request", "Enter the six-digit authenticator code.", 400);
      }
      return noStoreJson(
        await regenerateBackendStrongAuthRecoveryCodes(
          accessToken,
          code
        )
      );
    }

    const method = methodField(payload);
    const code = stringField(payload, "code", { min: 6, max: 128 });
    if (!method || !code) {
      return errorJson("invalid_request", "Enter a valid authentication code.", 400);
    }
    if (action === "challenge") {
      return noStoreJson(
        await challengeBackendStrongAuth(
          accessToken,
          method,
          code
        )
      );
    }

    const primary = await primaryCredential(
      request,
      payload,
      access.session.user?.provider,
      access.session.backendUserId
    );
    if (!primary) {
      const google = access.session.user?.provider === "google";
      return errorJson(
        google ? "google_reauthentication_required" : "primary_reauthentication_required",
        google
          ? "Reauthenticate with Google before disabling the authenticator."
          : "Enter your current password.",
        409
      );
    }
    return noStoreJson(
      await disableBackendStrongAuth(accessToken, {
        method,
        code,
        primary,
      })
    );
  } catch (error) {
    return backendErrorResponse(error);
  }
}
