import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import CredentialsProvider from "next-auth/providers/credentials";
import {
  BACKEND_TOKEN_REFRESH_BUFFER_MS,
  applyBackendLoginPayload,
  buildSafeBackendSessionFields,
  markBackendRefreshFailed,
  refreshBackendAccessToken,
  shouldRefreshBackendToken,
  type BackendLoginPayload,
} from "./backendTokenRefresh";
import { isQaPersonaUiAllowed } from "./qaPersonas";

/**
 * Same loopback rule as lib/backendClient.ts: `localhost` resolves to ::1 first
 * on macOS, and the dev backend binds IPv4 only, so sign-in would fail against a
 * backend that is running. Only the loopback name is rewritten.
 */
const preferIPv4Loopback = (url: string) =>
  url.replace(/^(https?:\/\/)localhost(?=[:/]|$)/i, "$1127.0.0.1");

const getBackendBaseUrl = () => {
  const raw =
    process.env.BACKEND_URL ||
    process.env.INTERNAL_BACKEND_URL ||
    process.env.NEXT_PUBLIC_BACKEND_URL ||
    "http://localhost:8000/api/v1";
  const normalized = preferIPv4Loopback(raw).replace(/\/+$/, "");
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

type BackendLoginResponse = BackendLoginPayload & {
  access_token: string;
  token_type: string;
  user: BackendAuthUser;
};

type BackendQaSessionResponse = {
  access_token: string;
  token_type: string;
  access_token_expires_at?: number | null;
  qa_session_id: string;
  persona_key: string;
  user: BackendAuthUser;
};

const requestQaPersonaSession = async ({
  path,
  accessToken,
  body,
}: {
  path: "/qa/session/switch" | "/qa/session/refresh" | "/qa/session/exit";
  accessToken: string;
  body: Record<string, unknown>;
}): Promise<BackendQaSessionResponse | null> => {
  const response = await fetch(`${getBackendBaseUrl()}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`QA session request failed with ${response.status}`);
  if (path === "/qa/session/exit") return null;
  return (await response.json()) as BackendQaSessionResponse;
};

const clearQaPersonaState = (token: Record<string, unknown>) => {
  delete token.qaPersonaAccessToken;
  delete token.qaPersonaAccessTokenExpiresAt;
  delete token.qaPersonaKey;
  delete token.qaPersonaSessionId;
  delete token.qaPersonaUser;
};

const applyQaPersonaState = (
  token: Record<string, unknown>,
  payload: BackendQaSessionResponse
) => {
  token.qaPersonaAccessToken = payload.access_token;
  token.qaPersonaAccessTokenExpiresAt =
    typeof payload.access_token_expires_at === "number"
      ? payload.access_token_expires_at * 1000
      : undefined;
  token.qaPersonaKey = payload.persona_key;
  token.qaPersonaSessionId = payload.qa_session_id;
  token.qaPersonaUser = payload.user;
  delete token.qaPersonaError;
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
  backendRefreshToken?: string | null;
  backendAccessTokenExpiresAt?: number | null;
  backendRefreshTokenExpiresAt?: number | null;
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
  idToken: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  scope?: string;
}): Promise<BackendLoginResponse> => {
  let response: Response;
  try {
    response = await fetch(`${getBackendBaseUrl()}/auth/oauth/google`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        id_token: params.idToken,
        access_token: params.accessToken || null,
        refresh_token: params.refreshToken || null,
        expires_at: params.expiresAt ?? null,
        scope: params.scope || null,
      }),
    });
  } catch (error) {
    if (process.env.NODE_ENV === "development") {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[auth] Backend Google OAuth exchange unreachable: ${message}`);
    }
    throw new Error("Backend Google authentication unavailable");
  }
  if (!response.ok) {
    if (process.env.NODE_ENV === "development") {
      console.warn(`[auth] Backend Google OAuth exchange failed with ${response.status}`);
    }
    throw new Error("Backend Google authentication failed");
  }
  return (await response.json()) as BackendLoginResponse;
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
          backendRefreshToken: payload.refresh_token || null,
          backendAccessTokenExpiresAt: payload.access_token_expires_at || null,
          backendRefreshTokenExpiresAt: payload.refresh_token_expires_at || null,
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
        applyBackendLoginPayload(token, {
          access_token: user.backendAccessToken,
          token_type:
            "backendTokenType" in user && typeof user.backendTokenType === "string"
              ? user.backendTokenType
              : "bearer",
          refresh_token:
            "backendRefreshToken" in user && typeof user.backendRefreshToken === "string"
              ? user.backendRefreshToken
              : null,
          access_token_expires_at:
            "backendAccessTokenExpiresAt" in user &&
            typeof user.backendAccessTokenExpiresAt === "number"
              ? user.backendAccessTokenExpiresAt
              : null,
          refresh_token_expires_at:
            "backendRefreshTokenExpiresAt" in user &&
            typeof user.backendRefreshTokenExpiresAt === "number"
              ? user.backendRefreshTokenExpiresAt
              : null,
        });
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
        const idToken = typeof account.id_token === "string" ? account.id_token : undefined;
        if (!idToken) {
          throw new Error("Google did not provide an identity token");
        }
        const exchange = await exchangeGoogleOAuthForBackendToken({
          idToken,
          accessToken: account.access_token,
          refreshToken: account.refresh_token,
          expiresAt: account.expires_at,
          scope: typeof account.scope === "string" ? account.scope : undefined,
        });
        applyBackendLoginPayload(token, exchange);
        token.backendUserId = exchange.user.id;
        if (exchange.user.username) token.username = exchange.user.username;
        if (exchange.user.display_name) token.displayName = exchange.user.display_name;
        token.accountType = exchange.user.account_type || "TALENT";
        token.accountTypeSelectedAt = exchange.user.account_type_selected_at || null;
        token.onboardingIntent = exchange.user.onboarding_intent || "DECIDE_LATER";
        token.onboardingIntentSelectedAt = exchange.user.onboarding_intent_selected_at || null;
      }

      if (
        token.backendRefreshToken &&
        shouldRefreshBackendToken({
          accessToken: token.backendAccessToken,
          expiresAt: token.backendAccessTokenExpiresAt,
        })
      ) {
        try {
          const refreshed = await refreshBackendAccessToken({
            backendBaseUrl: getBackendBaseUrl(),
            refreshToken: token.backendRefreshToken,
          });
          applyBackendLoginPayload(token, refreshed);
          if (refreshed.user?.id) token.backendUserId = refreshed.user.id;
          if (refreshed.user?.username) token.username = refreshed.user.username;
          if (refreshed.user?.display_name) token.displayName = refreshed.user.display_name;
          if (isCreatorJobsAccountType(refreshed.user?.account_type)) {
            token.accountType = refreshed.user.account_type;
          }
          token.accountTypeSelectedAt = refreshed.user?.account_type_selected_at || null;
          if (isCreatorJobsOnboardingIntent(refreshed.user?.onboarding_intent)) {
            token.onboardingIntent = refreshed.user.onboarding_intent;
          }
          token.onboardingIntentSelectedAt = refreshed.user?.onboarding_intent_selected_at || null;
        } catch (error) {
          if (process.env.NODE_ENV === "development") {
            const message = error instanceof Error ? error.message : String(error);
            console.warn(`[auth] Backend token refresh failed: ${message}`);
          }
          markBackendRefreshFailed(token);
          clearQaPersonaState(token);
        }
      }

      const qaAction =
        trigger === "update" && session?.qaPersonaAction
          ? session.qaPersonaAction
          : undefined;
      if (!isQaPersonaUiAllowed()) {
        clearQaPersonaState(token);
      } else if (qaAction === "exit") {
        try {
          if (
            typeof token.qaPersonaAccessToken === "string" &&
            typeof token.qaPersonaSessionId === "string" &&
            typeof token.qaPersonaKey === "string"
          ) {
            await requestQaPersonaSession({
              path: "/qa/session/exit",
              accessToken: token.qaPersonaAccessToken,
              body: {
                qa_session_id: token.qaPersonaSessionId,
                persona_key: token.qaPersonaKey,
              },
            });
          }
        } catch {
          // Exiting locally is still safer than trapping the controller in an
          // expired persona session. The backend token is short lived anyway.
        }
        clearQaPersonaState(token);
      } else if (
        qaAction === "switch" &&
        typeof session.qaPersonaKey === "string" &&
        typeof token.backendAccessToken === "string"
      ) {
        try {
          const payload = await requestQaPersonaSession({
            path: "/qa/session/switch",
            accessToken: token.backendAccessToken,
            body: { persona_key: session.qaPersonaKey },
          });
          if (payload) applyQaPersonaState(token, payload);
        } catch {
          clearQaPersonaState(token);
          token.qaPersonaError = "switch_failed";
        }
      } else if (
        typeof token.qaPersonaAccessToken === "string" &&
        typeof token.qaPersonaAccessTokenExpiresAt === "number" &&
        token.qaPersonaAccessTokenExpiresAt <= Date.now() + BACKEND_TOKEN_REFRESH_BUFFER_MS &&
        typeof token.qaPersonaSessionId === "string" &&
        typeof token.qaPersonaKey === "string" &&
        typeof token.backendAccessToken === "string"
      ) {
        try {
          const payload = await requestQaPersonaSession({
            path: "/qa/session/refresh",
            accessToken: token.backendAccessToken,
            body: {
              persona_key: token.qaPersonaKey,
              qa_session_id: token.qaPersonaSessionId,
            },
          });
          if (payload) applyQaPersonaState(token, payload);
        } catch {
          clearQaPersonaState(token);
          token.qaPersonaError = "session_expired";
        }
      }
      return token;
    },
    async session({ session, token }) {
      const backendSession = buildSafeBackendSessionFields(token);
      session.backendAccessToken = backendSession.backendAccessToken;
      session.backendTokenType = backendSession.backendTokenType;
      session.backendUserId = backendSession.backendUserId;
      session.backendAccessTokenExpiresAt = backendSession.backendAccessTokenExpiresAt;
      session.backendAuthError = backendSession.backendAuthError;
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

      const qaUser = token.qaPersonaUser as BackendAuthUser | undefined;
      if (
        qaUser?.id &&
        typeof token.qaPersonaAccessToken === "string" &&
        typeof token.qaPersonaKey === "string" &&
        typeof token.qaPersonaSessionId === "string"
      ) {
        session.qaController = {
          backendUserId: token.backendUserId as string | undefined,
          email: token.email as string | undefined,
          name:
            (token.displayName as string | undefined) ||
            (token.name as string | undefined) ||
            (token.email as string | undefined),
        };
        session.qaPersona = {
          key: token.qaPersonaKey,
          sessionId: token.qaPersonaSessionId,
          displayName: qaUser.display_name || qaUser.username || qaUser.email,
          accountType: qaUser.account_type || "TALENT",
        };
        session.qaPersonaError = token.qaPersonaError as
          | "switch_failed"
          | "session_expired"
          | undefined;
        session.backendAccessToken = token.qaPersonaAccessToken;
        session.backendUserId = qaUser.id;
        session.backendAccessTokenExpiresAt = token.qaPersonaAccessTokenExpiresAt as
          | number
          | undefined;
        session.backendAuthError = undefined;
        session.user = {
          ...session.user,
          userId: qaUser.id,
          backendUserId: qaUser.id,
          email: qaUser.email,
          username: qaUser.username || undefined,
          name: qaUser.display_name || qaUser.username || qaUser.email,
          accountType: qaUser.account_type || "TALENT",
          accountTypeSelectedAt: qaUser.account_type_selected_at || null,
          onboardingIntent: qaUser.onboarding_intent || "DECIDE_LATER",
          onboardingIntentSelectedAt: qaUser.onboarding_intent_selected_at || null,
        };
      } else {
        session.qaPersonaError = token.qaPersonaError as
          | "switch_failed"
          | "session_expired"
          | undefined;
      }
      return session;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
};
