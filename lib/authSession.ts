type CreatorJobsAccountType = "TALENT" | "EMPLOYER" | "BOTH" | "ADMIN";
type CreatorJobsOnboardingIntent =
  | "LOOKING_FOR_WORK"
  | "HIRING_CREATOR_TALENT"
  | "BOTH"
  | "DECIDE_LATER";

type ExistingSessionUser = {
  name?: string | null;
  email?: string | null;
  image?: string | null;
};

export type SafeAuthSessionUser = ExistingSessionUser & {
  provider?: string;
  userId?: string;
  backendUserId?: string;
  username?: string;
  accountType?: CreatorJobsAccountType;
  accountTypeSelectedAt?: string | null;
  onboardingIntent?: CreatorJobsOnboardingIntent;
  onboardingIntentSelectedAt?: string | null;
};

const LEGACY_PROVIDER_FIELDS = [
  "accessToken",
  "refreshToken",
  "providerAccountId",
  "oauthExpiresAt",
  "oauthScope",
  "profile",
] as const;

const stringValue = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

const nullableStringValue = (value: unknown): string | null | undefined =>
  value === null ? null : stringValue(value);

const accountTypeValue = (value: unknown): CreatorJobsAccountType | undefined =>
  value === "TALENT" || value === "EMPLOYER" || value === "BOTH" || value === "ADMIN"
    ? value
    : undefined;

const onboardingIntentValue = (value: unknown): CreatorJobsOnboardingIntent | undefined =>
  value === "LOOKING_FOR_WORK" ||
  value === "HIRING_CREATOR_TALENT" ||
  value === "BOTH" ||
  value === "DECIDE_LATER"
    ? value
    : undefined;

/**
 * Removes provider material written by the pre-Phase-1B JWT callback. This is
 * run on every JWT callback so existing encrypted session cookies are upgraded
 * in place instead of retaining a second copy of Google credentials. Their
 * provider-derived JWT subject is also replaced by the canonical backend user
 * ID when available.
 */
export const clearLegacyProviderCredentialState = <T extends Record<string, unknown>>(
  token: T
): T => {
  for (const field of LEGACY_PROVIDER_FIELDS) {
    delete token[field];
  }
  const backendUserId = stringValue(token.backendUserId);
  if (backendUserId) {
    (token as Record<string, unknown>).sub = backendUserId;
  }
  return token;
};

/**
 * Builds the complete browser-visible user object from an explicit allowlist.
 * Google access/refresh tokens, provider subject, scopes, expiry metadata, and
 * raw provider profile claims are intentionally not representable here.
 */
export const buildSafeAuthSessionUser = (
  token: Record<string, unknown>,
  currentUser?: ExistingSessionUser
): SafeAuthSessionUser => {
  const backendUserId = stringValue(token.backendUserId);
  return {
    name: stringValue(token.displayName) || currentUser?.name || undefined,
    email: currentUser?.email || stringValue(token.email) || undefined,
    image: currentUser?.image || stringValue(token.picture) || undefined,
    provider: stringValue(token.provider),
    userId: backendUserId || stringValue(token.sub),
    backendUserId,
    username: stringValue(token.username),
    accountType: accountTypeValue(token.accountType),
    accountTypeSelectedAt: nullableStringValue(token.accountTypeSelectedAt),
    onboardingIntent: onboardingIntentValue(token.onboardingIntent),
    onboardingIntentSelectedAt: nullableStringValue(token.onboardingIntentSelectedAt),
  };
};
