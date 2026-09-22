import { hasProductionEnvironmentSignal } from "./runtimeEnvironment.ts";

// Environment gate for the dev persona switcher + seed/reset tooling.
//
// Mirrors lib/devEmailInbox.ts: production is hard-denied, dev/test/local is
// allowed. The pure `evaluateDevToolsAllowed(env)` form is exported so the gate can
// be unit-tested without mutating `process.env`. The dev API proxies and the layout
// mount both go through `isDevToolsAllowed()`, so the tooling is absent (not merely
// hidden) in production builds.

// The shared dev-only password every seeded persona logs in with. This is not a
// secret: persona accounts only exist in dev/test databases (seeders are gated), and
// the value is surfaced by the backend GET /dev/personas response too.
export const DEV_PERSONA_PASSWORD = "DevPersona123!";

type DevEnv = {
  APP_ENV?: string;
  NEXT_PUBLIC_APP_ENV?: string;
  VERCEL_ENV?: string;
  NODE_ENV?: string;
  NEXTAUTH_URL?: string;
  NEXT_PUBLIC_BACKEND_URL?: string;
  FRONTEND_BASE_URL?: string;
  ENABLE_QA_PERSONA_SWITCHER?: string;
};

const isLocalUrl = (value?: string) => Boolean(value && /localhost|127\.0\.0\.1/.test(value));

export const evaluateDevToolsAllowed = (env: DevEnv): boolean => {
  // The authenticated QA drawer supersedes the shared-password local panel in
  // isolated QA runs. Keeping both visible would make the active identity
  // ambiguous and could route a tester through the wrong switching mechanism.
  if (/^(1|true|yes|on)$/i.test(env.ENABLE_QA_PERSONA_SWITCHER || "")) return false;
  // Any explicit production signal wins — never expose the tooling in production.
  if (hasProductionEnvironmentSignal(env)) {
    return false;
  }

  if (
    env.APP_ENV === "development" ||
    env.APP_ENV === "test" ||
    env.NEXT_PUBLIC_APP_ENV === "development" ||
    env.NEXT_PUBLIC_APP_ENV === "test" ||
    env.NODE_ENV === "development" ||
    env.NODE_ENV === "test"
  ) {
    return true;
  }

  return (
    isLocalUrl(env.NEXTAUTH_URL) ||
    isLocalUrl(env.NEXT_PUBLIC_BACKEND_URL) ||
    isLocalUrl(env.FRONTEND_BASE_URL)
  );
};

export const isDevToolsAllowed = (): boolean =>
  evaluateDevToolsAllowed({
    APP_ENV: process.env.APP_ENV,
    NEXT_PUBLIC_APP_ENV: process.env.NEXT_PUBLIC_APP_ENV,
    VERCEL_ENV: process.env.VERCEL_ENV,
    NODE_ENV: process.env.NODE_ENV,
    NEXTAUTH_URL: process.env.NEXTAUTH_URL,
    NEXT_PUBLIC_BACKEND_URL: process.env.NEXT_PUBLIC_BACKEND_URL,
    FRONTEND_BASE_URL: process.env.FRONTEND_BASE_URL,
    ENABLE_QA_PERSONA_SWITCHER: process.env.ENABLE_QA_PERSONA_SWITCHER,
  });
