type AuthVisibilityEnv = {
  APP_ENV?: string;
  NEXT_PUBLIC_APP_ENV?: string;
  NEXT_PUBLIC_ENABLE_EMAIL_AUTH?: string;
};

const truthy = (value?: string) =>
  Boolean(value && ["1", "true", "yes", "on"].includes(value.trim().toLowerCase()));

const falsy = (value?: string) =>
  Boolean(value && ["0", "false", "no", "off"].includes(value.trim().toLowerCase()));

export function isEmailAuthEnabled(env: AuthVisibilityEnv): boolean {
  const explicit = env.NEXT_PUBLIC_ENABLE_EMAIL_AUTH;
  if (truthy(explicit)) return true;
  if (falsy(explicit)) return false;

  const appEnv = env.NEXT_PUBLIC_APP_ENV || env.APP_ENV;
  if (appEnv === "staging" || appEnv === "production") return false;

  return true;
}

