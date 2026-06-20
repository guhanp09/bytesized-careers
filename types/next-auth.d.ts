import "next-auth";
import "next-auth/jwt";

type CreatorJobsAccountType = "TALENT" | "EMPLOYER" | "BOTH" | "ADMIN";
type CreatorJobsOnboardingIntent =
  | "LOOKING_FOR_WORK"
  | "HIRING_CREATOR_TALENT"
  | "BOTH"
  | "DECIDE_LATER";

declare module "next-auth" {
  interface Session {
    backendAccessToken?: string;
    backendTokenType?: string;
    backendUserId?: string;
    backendAccessTokenExpiresAt?: number;
    backendAuthError?: "refresh_failed";
    user?: {
      name?: string | null;
      email?: string | null;
      image?: string | null;
      accessToken?: string;
      refreshToken?: string;
      provider?: string;
      providerAccountId?: string;
      oauthExpiresAt?: number;
      oauthScope?: string;
      profile?: Record<string, unknown>;
      userId?: string;
      backendUserId?: string;
      username?: string;
      accountType?: CreatorJobsAccountType;
      accountTypeSelectedAt?: string | null;
      onboardingIntent?: CreatorJobsOnboardingIntent;
      onboardingIntentSelectedAt?: string | null;
      youtubeChannelId?: string;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    accessToken?: string;
    refreshToken?: string;
    provider?: string;
    providerAccountId?: string;
    oauthExpiresAt?: number;
    oauthScope?: string;
    backendAccessToken?: string;
    backendTokenType?: string;
    backendRefreshToken?: string;
    backendAccessTokenExpiresAt?: number;
    backendRefreshTokenExpiresAt?: number;
    backendAuthError?: "refresh_failed";
    backendUserId?: string;
    username?: string;
    displayName?: string;
    accountType?: CreatorJobsAccountType;
    accountTypeSelectedAt?: string | null;
    onboardingIntent?: CreatorJobsOnboardingIntent;
    onboardingIntentSelectedAt?: string | null;
    profile?: Record<string, unknown>;
  }
}
