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

export type WorkspaceFlags = {
  nextAction: boolean;
  decisionStrip: boolean;
  workState: boolean;
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
  };
  return {
    nextAction: isNextActionEnabled(env),
    decisionStrip: isDecisionStripEnabled(env),
    workState: isWorkStateEnabled(env),
  };
}
