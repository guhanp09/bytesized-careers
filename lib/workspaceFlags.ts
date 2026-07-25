/**
 * Independent feature flags for the applications-workspace redesign.
 *
 * Each flag gates one mechanism and must be switchable on its own: disabling any
 * one of them restores the previous behaviour for that mechanism alone, with no
 * hidden dependency on the others and no data loss (every flag here gates
 * presentation only — none of them changes what the backend stores).
 *
 * Defaults follow the `authVisibility` precedent: explicit env wins, otherwise
 * staging/production stay off while local and test environments stay on, so QA
 * exercises the new surfaces before they reach real users.
 */

export type WorkspaceFlagEnv = {
  APP_ENV?: string;
  NEXT_PUBLIC_APP_ENV?: string;
  /** Primary next-best action promoted out of the overflow menu. */
  NEXT_PUBLIC_ENABLE_NEXT_ACTION?: string;
  /** Skippable first-open decision strip. */
  NEXT_PUBLIC_ENABLE_DECISION_STRIP?: string;
  /** Derived work-state indicator on rows and cards. */
  NEXT_PUBLIC_ENABLE_WORK_STATE?: string;
  /** Private New -> Reviewing on a deliberate open. */
  NEXT_PUBLIC_ENABLE_AUTO_REVIEWING?: string;
  /** Visible-dwell threshold in ms before a deliberate open counts. */
  NEXT_PUBLIC_AUTO_REVIEWING_DWELL_MS?: string;
};

const truthy = (value?: string) =>
  Boolean(value && ["1", "true", "yes", "on"].includes(value.trim().toLowerCase()));

const falsy = (value?: string) =>
  Boolean(value && ["0", "false", "no", "off"].includes(value.trim().toLowerCase()));

/** Shared resolution so every flag behaves identically and stays independent. */
function resolve(explicit: string | undefined, env: WorkspaceFlagEnv): boolean {
  if (truthy(explicit)) return true;
  if (falsy(explicit)) return false;
  const appEnv = env.NEXT_PUBLIC_APP_ENV || env.APP_ENV;
  return !(appEnv === "staging" || appEnv === "production");
}

export function isNextActionEnabled(env: WorkspaceFlagEnv): boolean {
  return resolve(env.NEXT_PUBLIC_ENABLE_NEXT_ACTION, env);
}

export function isDecisionStripEnabled(env: WorkspaceFlagEnv): boolean {
  return resolve(env.NEXT_PUBLIC_ENABLE_DECISION_STRIP, env);
}

export function isWorkStateEnabled(env: WorkspaceFlagEnv): boolean {
  return resolve(env.NEXT_PUBLIC_ENABLE_WORK_STATE, env);
}

export function isAutoReviewingEnabled(env: WorkspaceFlagEnv): boolean {
  return resolve(env.NEXT_PUBLIC_ENABLE_AUTO_REVIEWING, env);
}

/**
 * How long the detail must stay visibly open before an open counts as
 * deliberate. An instrumented experiment value, not settled product truth —
 * configurable without a deploy-time code change so it can be tuned from the
 * measured reversal rate.
 */
export const DEFAULT_AUTO_REVIEWING_DWELL_MS = 800;

export function autoReviewingDwellMs(env: WorkspaceFlagEnv): number {
  const raw = Number.parseInt(env.NEXT_PUBLIC_AUTO_REVIEWING_DWELL_MS ?? "", 10);
  return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_AUTO_REVIEWING_DWELL_MS;
}

export type WorkspaceFlags = {
  nextAction: boolean;
  decisionStrip: boolean;
  workState: boolean;
  autoReviewing: boolean;
  autoReviewingDwellMs: number;
};

/**
 * Read all three at once. `process.env` is inlined by the bundler, so the keys
 * are referenced literally rather than through a computed lookup.
 */
export function workspaceFlagsFromEnv(): WorkspaceFlags {
  const env: WorkspaceFlagEnv = {
    APP_ENV: process.env.APP_ENV,
    NEXT_PUBLIC_APP_ENV: process.env.NEXT_PUBLIC_APP_ENV,
    NEXT_PUBLIC_ENABLE_NEXT_ACTION: process.env.NEXT_PUBLIC_ENABLE_NEXT_ACTION,
    NEXT_PUBLIC_ENABLE_DECISION_STRIP: process.env.NEXT_PUBLIC_ENABLE_DECISION_STRIP,
    NEXT_PUBLIC_ENABLE_WORK_STATE: process.env.NEXT_PUBLIC_ENABLE_WORK_STATE,
    NEXT_PUBLIC_ENABLE_AUTO_REVIEWING: process.env.NEXT_PUBLIC_ENABLE_AUTO_REVIEWING,
    NEXT_PUBLIC_AUTO_REVIEWING_DWELL_MS: process.env.NEXT_PUBLIC_AUTO_REVIEWING_DWELL_MS,
  };
  return {
    nextAction: isNextActionEnabled(env),
    decisionStrip: isDecisionStripEnabled(env),
    workState: isWorkStateEnabled(env),
    autoReviewing: isAutoReviewingEnabled(env),
    autoReviewingDwellMs: autoReviewingDwellMs(env),
  };
}
