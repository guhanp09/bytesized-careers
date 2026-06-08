import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import CredentialsProvider from "next-auth/providers/credentials";

const getBackendBaseUrl = () => {
  const raw =
    process.env.BACKEND_URL ||
    process.env.INTERNAL_BACKEND_URL ||
    process.env.NEXT_PUBLIC_BACKEND_URL ||
    "http://localhost:8000/api/v1";
  const normalized = raw.replace(/\/+$/, "");
  return normalized.endsWith("/api/v1") ? normalized : `${normalized}/api/v1`;
};

type BackendAuthUser = {
  id: string;
  email: string;
  username?: string | null;
  display_name?: string | null;
  account_type?: "TALENT" | "EMPLOYER" | "BOTH" | "ADMIN";
  account_type_selected_at?: string | null;
  onboarding_intent?: "LOOKING_FOR_WORK" | "HIRING_CREATOR_TALENT" | "BOTH" | "DECIDE_LATER";
  onboarding_intent_selected_at?: string | null;
};

type CreatorJobsAccountType = NonNullable<BackendAuthUser["account_type"]>;
type CreatorJobsOnboardingIntent = NonNullable<BackendAuthUser["onboarding_intent"]>;

const isCreatorJobsAccountType = (value: unknown): value is CreatorJobsAccountType =>
  value === "TALENT" || value === "EMPLOYER" || value === "BOTH" || value === "ADMIN";

const isCreatorJobsOnboardingIntent = (
  value: unknown
): value is CreatorJobsOnboardingIntent =>
  value === "LOOKING_FOR_WORK" ||
  value === "HIRING_CREATOR_TALENT" ||
  value === "BOTH" ||
  value === "DECIDE_LATER";

type BackendLoginResponse = {
  access_token: string;
  token_type: string;
  user: BackendAuthUser;
};

type CredentialsAuthUser = {
  id: string;
  email: string;
  name?: string | null;
  username?: string | null;
  displayName?: string | null;
  accountType?: "TALENT" | "EMPLOYER" | "BOTH" | "ADMIN";
  accountTypeSelectedAt?: string | null;
  onboardingIntent?: "LOOKING_FOR_WORK" | "HIRING_CREATOR_TALENT" | "BOTH" | "DECIDE_LATER";
  onboardingIntentSelectedAt?: string | null;
  backendAccessToken: string;
  backendTokenType: string;
  backendUserId: string;
};

const loginWithBackendCredentials = async (
  email: string,
  password: string
): Promise<BackendLoginResponse> => {
  const response = await fetch(`${getBackendBaseUrl()}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) {
    throw new Error("Invalid credentials");
  }
  return (await response.json()) as BackendLoginResponse;
};

const exchangeGoogleOAuthForBackendToken = async (params: {
  email: string;
  providerAccountId: string;
  displayName?: string;
  youtubeHandle?: string;
  youtubeChannelTitle?: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  scope?: string;
}): Promise<BackendLoginResponse | null> => {
  try {
    const response = await fetch(`${getBackendBaseUrl()}/auth/oauth/google`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        email: params.email,
        provider_account_id: params.providerAccountId,
        display_name: params.displayName || null,
        youtube_handle: params.youtubeHandle || null,
        youtube_channel_title: params.youtubeChannelTitle || null,
        access_token: params.accessToken || null,
        refresh_token: params.refreshToken || null,
        expires_at: params.expiresAt ?? null,
        scope: params.scope || null,
      }),
    });
    if (!response.ok) {
      if (process.env.NODE_ENV === "development") {
        console.warn(`[auth] Backend Google OAuth exchange failed with ${response.status}`);
      }
      return null;
    }
    return (await response.json()) as BackendLoginResponse;
  } catch (error) {
    if (process.env.NODE_ENV === "development") {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[auth] Backend Google OAuth exchange unreachable: ${message}`);
    }
    return null;
  }
};

const providers = [
  GoogleProvider({
    clientId: process.env.GOOGLE_CLIENT_ID || "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    authorization: {
      params: {
        scope: "openid email profile https://www.googleapis.com/auth/youtube.readonly",
        access_type: "offline",
        prompt: "consent",
      },
    },
  }),
  CredentialsProvider({
    name: "Email and password",
    credentials: {
      email: { label: "Email", type: "email" },
      password: { label: "Password", type: "password" },
    },
    async authorize(credentials) {
      const email = credentials?.email?.trim();
      const password = credentials?.password;
      if (!email || !password) return null;

      try {
        const payload = await loginWithBackendCredentials(email, password);
        return {
          id: payload.user.id,
          email: payload.user.email,
          name: payload.user.display_name || payload.user.username || payload.user.email,
          username: payload.user.username || undefined,
          displayName: payload.user.display_name || undefined,
          accountType: payload.user.account_type || "TALENT",
          accountTypeSelectedAt: payload.user.account_type_selected_at || null,
          onboardingIntent: payload.user.onboarding_intent || "DECIDE_LATER",
          onboardingIntentSelectedAt: payload.user.onboarding_intent_selected_at || null,
          backendAccessToken: payload.access_token,
          backendTokenType: payload.token_type,
          backendUserId: payload.user.id,
        } as CredentialsAuthUser;
      } catch {
        return null;
      }
    },
  }),
];

export const authOptions: NextAuthOptions = {
  providers,
  session: { strategy: "jwt" },
  debug: process.env.NODE_ENV === "development",
  pages: {
    signIn: "/auth",
    error: "/auth",
  },
  callbacks: {
    async jwt({ token, account, profile, user, trigger, session }) {
      if (account) {
        token.accessToken = account.access_token;
        token.refreshToken = account.refresh_token;
        token.provider = account.provider;
        token.providerAccountId = account.providerAccountId;
        token.oauthExpiresAt = account.expires_at;
        if (typeof account.scope === "string") {
          token.oauthScope = account.scope;
        }
      }
      if (profile) {
        token.profile = profile as Record<string, unknown>;
      }

      // Keep the JWT in sync when client-side onboarding updates account type.
      if (trigger === "update" && session?.user) {
        if (isCreatorJobsAccountType(session.user.accountType)) {
          token.accountType = session.user.accountType;
        }
        if (isCreatorJobsOnboardingIntent(session.user.onboardingIntent)) {
          token.onboardingIntent = session.user.onboardingIntent;
        }
        if ("accountTypeSelectedAt" in session.user) {
          token.accountTypeSelectedAt =
            typeof session.user.accountTypeSelectedAt === "string"
              ? session.user.accountTypeSelectedAt
              : null;
        }
        if ("onboardingIntentSelectedAt" in session.user) {
          token.onboardingIntentSelectedAt =
            typeof session.user.onboardingIntentSelectedAt === "string"
              ? session.user.onboardingIntentSelectedAt
              : null;
        }
      }

      // Credentials login path: backend token is returned directly.
      if (user && "backendAccessToken" in user && typeof user.backendAccessToken === "string") {
        token.backendAccessToken = user.backendAccessToken;
        token.backendTokenType =
          "backendTokenType" in user && typeof user.backendTokenType === "string"
            ? user.backendTokenType
            : "bearer";
        token.backendUserId =
          "backendUserId" in user && typeof user.backendUserId === "string"
            ? user.backendUserId
            : undefined;
        token.username =
          "username" in user && typeof user.username === "string"
            ? user.username
            : undefined;
        token.displayName =
          "displayName" in user && typeof user.displayName === "string"
            ? user.displayName
            : undefined;
        token.accountType =
          "accountType" in user && isCreatorJobsAccountType(user.accountType)
            ? user.accountType
            : "TALENT";
        token.accountTypeSelectedAt =
          "accountTypeSelectedAt" in user && typeof user.accountTypeSelectedAt === "string"
            ? user.accountTypeSelectedAt
            : null;
        token.onboardingIntent =
          "onboardingIntent" in user && isCreatorJobsOnboardingIntent(user.onboardingIntent)
            ? user.onboardingIntent
            : "DECIDE_LATER";
        token.onboardingIntentSelectedAt =
          "onboardingIntentSelectedAt" in user && typeof user.onboardingIntentSelectedAt === "string"
            ? user.onboardingIntentSelectedAt
            : null;
      }

      // Google login path: exchange provider identity for backend JWT.
      if (account?.provider === "google") {
        const emailFromProfile =
          typeof profile?.email === "string"
            ? profile.email
            : typeof token.email === "string"
              ? token.email
              : undefined;
        const providerAccountId =
          typeof account.providerAccountId === "string"
            ? account.providerAccountId
            : undefined;
        if (emailFromProfile && providerAccountId) {
          const rawProfile = profile as Record<string, unknown> | undefined;
          const profileName =
            typeof rawProfile?.name === "string"
              ? rawProfile.name
              : typeof token.name === "string"
                ? token.name
                : undefined;
          const profileHandle =
            typeof rawProfile?.["preferred_username"] === "string"
              ? rawProfile["preferred_username"]
              : typeof rawProfile?.["custom_url"] === "string"
                ? rawProfile["custom_url"]
                : undefined;
          const profileChannelTitle =
            typeof rawProfile?.["channel_title"] === "string"
              ? rawProfile["channel_title"]
              : undefined;
          const exchange = await exchangeGoogleOAuthForBackendToken({
            email: emailFromProfile,
            providerAccountId,
            displayName: profileName,
            youtubeHandle: profileHandle,
            youtubeChannelTitle: profileChannelTitle,
            accessToken: account.access_token,
            refreshToken: account.refresh_token,
            expiresAt: account.expires_at,
            scope: typeof account.scope === "string" ? account.scope : undefined,
          });
          if (exchange) {
            token.backendAccessToken = exchange.access_token;
            token.backendTokenType = exchange.token_type;
            token.backendUserId = exchange.user.id;
            if (exchange.user.username) token.username = exchange.user.username;
            if (exchange.user.display_name) token.displayName = exchange.user.display_name;
            token.accountType = exchange.user.account_type || "TALENT";
            token.accountTypeSelectedAt = exchange.user.account_type_selected_at || null;
            token.onboardingIntent = exchange.user.onboarding_intent || "DECIDE_LATER";
            token.onboardingIntentSelectedAt = exchange.user.onboarding_intent_selected_at || null;
          }
        }
      }
      return token;
    },
    async session({ session, token }) {
      session.backendAccessToken = token.backendAccessToken as string | undefined;
      session.backendTokenType = token.backendTokenType as string | undefined;
      session.backendUserId = token.backendUserId as string | undefined;
      session.user = {
        ...session.user,
        accessToken: token.accessToken as string | undefined,
        refreshToken: token.refreshToken as string | undefined,
        provider: token.provider as string | undefined,
        providerAccountId: token.providerAccountId as string | undefined,
        oauthExpiresAt: token.oauthExpiresAt as number | undefined,
        oauthScope: token.oauthScope as string | undefined,
        profile: token.profile as Record<string, unknown> | undefined,
        userId: token.sub as string | undefined,
        backendUserId: token.backendUserId as string | undefined,
        username: token.username as string | undefined,
        accountType: token.accountType as "TALENT" | "EMPLOYER" | "BOTH" | "ADMIN" | undefined,
        accountTypeSelectedAt: token.accountTypeSelectedAt as string | null | undefined,
        onboardingIntent: token.onboardingIntent as
          | "LOOKING_FOR_WORK"
          | "HIRING_CREATOR_TALENT"
          | "BOTH"
          | "DECIDE_LATER"
          | undefined,
        onboardingIntentSelectedAt: token.onboardingIntentSelectedAt as string | null | undefined,
        name: (token.displayName as string | undefined) || session.user?.name || undefined,
      };
      return session;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
};
