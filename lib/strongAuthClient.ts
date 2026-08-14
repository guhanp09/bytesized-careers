export type StrongAuthMethod = "totp" | "recovery_code";

export type StrongAuthStatus = {
  required: boolean;
  enrolled: boolean;
  enrollment_pending: boolean;
  enrollment_expires_at: string | null;
  recovery_codes_remaining: number;
  strong_auth_satisfied: boolean;
  strong_auth_method: StrongAuthMethod | "webauthn" | null;
  strong_auth_expires_at: string | null;
  available_methods: StrongAuthMethod[];
  google_reauthentication_available: boolean;
};

export type StrongAuthEnrollment = {
  secret: string;
  provisioning_uri: string;
  expires_at: string;
};

export type StrongAuthVerification = {
  status: string;
  method: StrongAuthMethod;
  expires_at: string;
  recovery_codes_remaining: number;
};

export type StrongAuthRecoveryCodes = {
  recovery_codes: string[];
  expires_at: string;
};

type FetchImplementation = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

const API_PATH = "/api/security/strong-auth";
const RECOVERY_CODE_PATTERN = /^[A-Z2-7]{4}(?:-[A-Z2-7]{4}){7}$/;

export class StrongAuthClientError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "StrongAuthClientError";
    this.status = status;
    this.code = code;
  }
}

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const optionalString = (value: unknown): string | null =>
  value === null || typeof value === "undefined"
    ? null
    : typeof value === "string"
      ? value
      : null;

const isOptionalString = (value: unknown): value is string | null =>
  value === null || typeof value === "string";

const method = (value: unknown): StrongAuthMethod | null =>
  value === "totp" || value === "recovery_code" ? value : null;

const boundedMessage = (value: unknown, fallback: string): string => {
  if (typeof value !== "string") return fallback;
  const clean = value.replace(/[\r\n\t]+/g, " ").trim();
  return clean && clean.length <= 240 ? clean : fallback;
};

const parseError = (status: number, payload: unknown) => {
  const body = record(payload);
  const code =
    typeof body?.error === "string" && /^[a-z0-9_]{1,64}$/.test(body.error)
      ? body.error
      : "strong_auth_request_failed";
  return new StrongAuthClientError(
    status,
    code,
    boundedMessage(body?.message, "Strong authentication could not be completed.")
  );
};

const request = async (
  body: Record<string, unknown> | null,
  fetchImpl: FetchImplementation = fetch
): Promise<unknown> => {
  const response = await fetchImpl(API_PATH, {
    method: body ? "POST" : "GET",
    credentials: "same-origin",
    cache: "no-store",
    headers: body
      ? { Accept: "application/json", "Content-Type": "application/json" }
      : { Accept: "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    // A typed error below avoids reflecting an untrusted HTML/text body.
  }
  if (!response.ok) throw parseError(response.status, payload);
  return payload;
};

const parseStatus = (value: unknown): StrongAuthStatus => {
  const body = record(value);
  const availableMethods = Array.isArray(body?.available_methods)
    ? body.available_methods.map(method)
    : [];
  if (
    !body ||
    typeof body.required !== "boolean" ||
    typeof body.enrolled !== "boolean" ||
    typeof body.enrollment_pending !== "boolean" ||
    !isOptionalString(body.enrollment_expires_at) ||
    typeof body.recovery_codes_remaining !== "number" ||
    !Number.isInteger(body.recovery_codes_remaining) ||
    body.recovery_codes_remaining < 0 ||
    typeof body.strong_auth_satisfied !== "boolean" ||
    !isOptionalString(body.strong_auth_expires_at) ||
    typeof body.google_reauthentication_available !== "boolean" ||
    !Array.isArray(body.available_methods) ||
    availableMethods.some((item) => item === null)
  ) {
    throw new StrongAuthClientError(502, "invalid_response", "Strong-authentication status was invalid.");
  }
  const assuranceMethod =
    body.strong_auth_method === "webauthn" ? "webauthn" : method(body.strong_auth_method);
  if (body.strong_auth_method != null && assuranceMethod === null) {
    throw new StrongAuthClientError(502, "invalid_response", "Strong-authentication status was invalid.");
  }
  return {
    required: body.required,
    enrolled: body.enrolled,
    enrollment_pending: body.enrollment_pending,
    enrollment_expires_at: optionalString(body.enrollment_expires_at),
    recovery_codes_remaining: body.recovery_codes_remaining,
    strong_auth_satisfied: body.strong_auth_satisfied,
    strong_auth_method: assuranceMethod,
    strong_auth_expires_at: optionalString(body.strong_auth_expires_at),
    available_methods: availableMethods as StrongAuthMethod[],
    google_reauthentication_available: body.google_reauthentication_available,
  };
};

const parseEnrollment = (value: unknown): StrongAuthEnrollment => {
  const body = record(value);
  if (
    !body ||
    typeof body.secret !== "string" ||
    !/^[A-Z2-7]{32}$/.test(body.secret) ||
    typeof body.provisioning_uri !== "string" ||
    !body.provisioning_uri.startsWith("otpauth://totp/") ||
    typeof body.expires_at !== "string"
  ) {
    throw new StrongAuthClientError(502, "invalid_response", "Authenticator setup returned invalid data.");
  }
  return {
    secret: body.secret,
    provisioning_uri: body.provisioning_uri,
    expires_at: body.expires_at,
  };
};

const parseVerification = (value: unknown): StrongAuthVerification => {
  const body = record(value);
  const verifiedMethod = method(body?.method);
  if (
    !body ||
    !verifiedMethod ||
    typeof body.status !== "string" ||
    typeof body.expires_at !== "string" ||
    typeof body.recovery_codes_remaining !== "number" ||
    !Number.isInteger(body.recovery_codes_remaining) ||
    body.recovery_codes_remaining < 0
  ) {
    throw new StrongAuthClientError(502, "invalid_response", "Strong-authentication verification was invalid.");
  }
  return {
    status: body.status,
    method: verifiedMethod,
    expires_at: body.expires_at,
    recovery_codes_remaining: body.recovery_codes_remaining,
  };
};

const recoveryCodesFrom = (value: unknown): string[] => {
  const body = record(value);
  if (
    !body ||
    !Array.isArray(body.recovery_codes) ||
    body.recovery_codes.length < 1 ||
    body.recovery_codes.length > 20 ||
    body.recovery_codes.some(
      (code) => typeof code !== "string" || !RECOVERY_CODE_PATTERN.test(code)
    ) ||
    new Set(body.recovery_codes).size !== body.recovery_codes.length
  ) {
    throw new StrongAuthClientError(502, "invalid_response", "Recovery codes returned invalid data.");
  }
  return [...body.recovery_codes] as string[];
};

export async function loadStrongAuthStatus(
  fetchImpl?: FetchImplementation
): Promise<StrongAuthStatus> {
  return parseStatus(await request(null, fetchImpl));
}

export async function startStrongAuthEnrollment(
  password?: string,
  fetchImpl?: FetchImplementation
): Promise<StrongAuthEnrollment> {
  return parseEnrollment(
    await request(
      { action: "enroll", ...(typeof password === "string" ? { password } : {}) },
      fetchImpl
    )
  );
}

export async function confirmStrongAuthEnrollment(
  code: string,
  fetchImpl?: FetchImplementation
): Promise<StrongAuthVerification & StrongAuthRecoveryCodes> {
  const payload = await request({ action: "confirm", code }, fetchImpl);
  return {
    ...parseVerification(payload),
    recovery_codes: recoveryCodesFrom(payload),
  };
}

export async function verifyStrongAuth(
  proofMethod: StrongAuthMethod,
  code: string,
  fetchImpl?: FetchImplementation
): Promise<StrongAuthVerification> {
  return parseVerification(
    await request({ action: "challenge", method: proofMethod, code }, fetchImpl)
  );
}

export async function regenerateStrongAuthRecoveryCodes(
  code: string,
  fetchImpl?: FetchImplementation
): Promise<StrongAuthRecoveryCodes> {
  const payload = await request(
    { action: "regenerate_recovery_codes", code },
    fetchImpl
  );
  const body = record(payload);
  if (!body || typeof body.expires_at !== "string") {
    throw new StrongAuthClientError(502, "invalid_response", "Recovery-code rotation returned invalid data.");
  }
  return { recovery_codes: recoveryCodesFrom(payload), expires_at: body.expires_at };
}

export async function disableStrongAuth(
  proofMethod: StrongAuthMethod,
  code: string,
  password?: string,
  fetchImpl?: FetchImplementation
): Promise<{ status: string; revoked_sessions: number }> {
  const payload = await request(
    {
      action: "disable",
      method: proofMethod,
      code,
      ...(typeof password === "string" ? { password } : {}),
    },
    fetchImpl
  );
  const body = record(payload);
  if (
    !body ||
    typeof body.status !== "string" ||
    typeof body.revoked_sessions !== "number" ||
    !Number.isInteger(body.revoked_sessions) ||
    body.revoked_sessions < 0
  ) {
    throw new StrongAuthClientError(502, "invalid_response", "Factor disablement returned invalid data.");
  }
  return { status: body.status, revoked_sessions: body.revoked_sessions };
}

export function describeStrongAuthError(error: unknown): string {
  if (error instanceof StrongAuthClientError) return error.message;
  return "Strong authentication could not be completed.";
}
