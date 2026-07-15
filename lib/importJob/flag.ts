// Server-only feature flag for the Import Hiring Post feature (plan D9).
//
// ENABLE_JOB_IMPORT is deliberately NOT a NEXT_PUBLIC_ variable: both gates (the
// /post chooser card and the /post-job/import route) are server components, so the
// flag never ships in client bundles and flipping it needs a redeploy but no code
// change. Explicit "true"/"false" wins; otherwise the feature defaults ON outside
// production and OFF in production (mirrors the evaluate* pattern in
// lib/devTools.ts / lib/qaPersonas.ts).

type JobImportEnv = {
  ENABLE_JOB_IMPORT?: string;
  APP_ENV?: string;
  NEXT_PUBLIC_APP_ENV?: string;
  VERCEL_ENV?: string;
  NODE_ENV?: string;
};

const TRUE_RE = /^(1|true|yes|on)$/i;
const FALSE_RE = /^(0|false|no|off)$/i;

export const evaluateJobImportAllowed = (env: JobImportEnv): boolean => {
  const explicit = env.ENABLE_JOB_IMPORT ?? "";
  if (TRUE_RE.test(explicit)) return true;
  if (FALSE_RE.test(explicit)) return false;

  const production =
    env.APP_ENV === "production" ||
    env.NEXT_PUBLIC_APP_ENV === "production" ||
    env.VERCEL_ENV === "production";
  return !production;
};

export const isJobImportAllowed = (): boolean =>
  evaluateJobImportAllowed({
    ENABLE_JOB_IMPORT: process.env.ENABLE_JOB_IMPORT,
    APP_ENV: process.env.APP_ENV,
    NEXT_PUBLIC_APP_ENV: process.env.NEXT_PUBLIC_APP_ENV,
    VERCEL_ENV: process.env.VERCEL_ENV,
    NODE_ENV: process.env.NODE_ENV,
  });
