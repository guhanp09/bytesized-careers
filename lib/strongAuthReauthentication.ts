export const STRONG_AUTH_GOOGLE_REAUTH_MAX_AGE_MS = 5 * 60 * 1000;

type StrongAuthGoogleReauthenticationState = {
  strongAuthGoogleReauthIdToken?: unknown;
  strongAuthGoogleReauthExpiresAt?: unknown;
};

export function clearStrongAuthGoogleReauthentication<
  T extends StrongAuthGoogleReauthenticationState,
>(token: T): T {
  delete token.strongAuthGoogleReauthIdToken;
  delete token.strongAuthGoogleReauthExpiresAt;
  return token;
}

export function rememberStrongAuthGoogleReauthentication<
  T extends StrongAuthGoogleReauthenticationState,
>(
  token: T,
  {
    idToken,
    idTokenExpiresAt,
    now = Date.now(),
  }: {
    idToken: string;
    idTokenExpiresAt?: number;
    now?: number;
  }
): T {
  if (
    !idToken ||
    typeof idTokenExpiresAt !== "number" ||
    !Number.isFinite(idTokenExpiresAt)
  ) {
    return clearStrongAuthGoogleReauthentication(token);
  }
  const policyExpiry = now + STRONG_AUTH_GOOGLE_REAUTH_MAX_AGE_MS;
  const expiresAt = Math.min(policyExpiry, idTokenExpiresAt);
  if (expiresAt <= now) return clearStrongAuthGoogleReauthentication(token);
  token.strongAuthGoogleReauthIdToken = idToken;
  token.strongAuthGoogleReauthExpiresAt = expiresAt;
  return token;
}

export function readStrongAuthGoogleReauthentication(
  token: StrongAuthGoogleReauthenticationState,
  now = Date.now()
): string | undefined {
  const idToken = token.strongAuthGoogleReauthIdToken;
  const expiresAt = token.strongAuthGoogleReauthExpiresAt;
  if (
    typeof idToken !== "string" ||
    !idToken ||
    typeof expiresAt !== "number" ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= now
  ) {
    clearStrongAuthGoogleReauthentication(token);
    return undefined;
  }
  return idToken;
}
