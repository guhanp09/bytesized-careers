export type RuntimeEnvironment = Readonly<{
  APP_ENV?: string;
  NEXT_PUBLIC_APP_ENV?: string;
  VERCEL_ENV?: string;
  NODE_ENV?: string;
}>;

/**
 * Environment flags are accepted consistently everywhere they form a safety
 * boundary. Deployment systems and local shells commonly use all four forms;
 * treating only the literal string `true` as enabled makes a production guard
 * depend on spelling rather than intent.
 */
export const isTruthyEnvironmentFlag = (value?: string): boolean =>
  /^(?:1|true|yes|on)$/i.test((value || "").trim());

/**
 * Any production signal wins over every development/test signal.
 *
 * APP_ENV and NEXT_PUBLIC_APP_ENV are expected to agree, but a disagreement
 * must fail closed. Vercel's production marker is equally authoritative. We do
 * not infer this from NODE_ENV: `next build`/`next start` also power isolated
 * local and QA builds, which supply an explicit APP_ENV when they need one.
 */
export const hasProductionEnvironmentSignal = (
  environment: RuntimeEnvironment,
): boolean =>
  environment.APP_ENV === "production" ||
  environment.NEXT_PUBLIC_APP_ENV === "production" ||
  environment.VERCEL_ENV === "production";
