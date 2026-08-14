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
    qaPersonaAction?: "switch" | "exit";
    qaPersonaKey?: string;
    qaPersona?: {
      key: string;
      sessionId: string;
      displayName: string;
      accountType: CreatorJobsAccountType;
    };
    qaController?: {
      backendUserId?: string;
      email?: string;
      name?: string;
    };
    qaPersonaError?: "switch_failed" | "session_expired";
    user?: {
      name?: string | null;
      email?: string | null;
      image?: string | null;
      provider?: string;
      userId?: string;
      backendUserId?: string;
      username?: string;
      accountType?: CreatorJobsAccountType;
      accountTypeSelectedAt?: string | null;
      onboardingIntent?: CreatorJobsOnboardingIntent;
      onboardingIntentSelectedAt?: string | null;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    provider?: string;
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
    qaPersonaAccessToken?: string;
    qaPersonaAccessTokenExpiresAt?: number;
    qaPersonaKey?: string;
    qaPersonaSessionId?: string;
    qaPersonaUser?: {
      id: string;
      email: string;
      username?: string | null;
      display_name?: string | null;
      account_type?: CreatorJobsAccountType;
      account_type_selected_at?: string | null;
      onboarding_intent?: CreatorJobsOnboardingIntent;
      onboarding_intent_selected_at?: string | null;
    };
    qaPersonaError?: "switch_failed" | "session_expired";
  }
}
