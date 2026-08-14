/**
 * CreatorJobs' Google authorization policy.
 *
 * Authentication asks only for OpenID identity. YouTube access is requested
 * later, in context, after the user chooses a channel feature. Keeping these
 * parameter sets centralized prevents an ordinary login button from silently
 * growing data-access or offline scopes.
 */
export const GOOGLE_IDENTITY_SCOPE = "openid email profile";

export const GOOGLE_YOUTUBE_READONLY_SCOPE =
  "https://www.googleapis.com/auth/youtube.readonly";

export const GOOGLE_IDENTITY_AUTHORIZATION_PARAMS = Object.freeze({
  scope: GOOGLE_IDENTITY_SCOPE,
});

export const GOOGLE_ACCOUNT_SELECTION_PARAMS = Object.freeze({
  prompt: "select_account",
});

export const googleYouTubeAuthorizationParams = ({
  selectAccount = false,
}: {
  selectAccount?: boolean;
} = {}) =>
  Object.freeze({
    scope: `${GOOGLE_IDENTITY_SCOPE} ${GOOGLE_YOUTUBE_READONLY_SCOPE}`,
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: selectAccount ? "consent select_account" : "consent",
  });

export const hasGoogleYouTubeReadScope = (scope: string | null | undefined): boolean =>
  Boolean(scope?.split(/\s+/).includes(GOOGLE_YOUTUBE_READONLY_SCOPE));
