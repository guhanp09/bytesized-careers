import { hasProductionEnvironmentSignal } from "./runtimeEnvironment.ts";

const isLocalUrl = (value?: string) => Boolean(value && /localhost|127\.0\.0\.1/.test(value));

export const isDevEmailInboxAllowed = () => {
  if (hasProductionEnvironmentSignal(process.env)) {
    return false;
  }

  if (
    process.env.APP_ENV === "development" ||
    process.env.APP_ENV === "test" ||
    process.env.NEXT_PUBLIC_APP_ENV === "development" ||
    process.env.NEXT_PUBLIC_APP_ENV === "test" ||
    process.env.NODE_ENV === "development"
  ) {
    return true;
  }

  return (
    isLocalUrl(process.env.NEXTAUTH_URL) ||
    isLocalUrl(process.env.NEXT_PUBLIC_BACKEND_URL) ||
    isLocalUrl(process.env.FRONTEND_BASE_URL)
  );
};

export const shouldShowDevEmailInboxLink = () => {
  if (hasProductionEnvironmentSignal(process.env)) return false;
  return (
    process.env.NODE_ENV === "development" ||
    process.env.NEXT_PUBLIC_APP_ENV === "development" ||
    process.env.NEXT_PUBLIC_APP_ENV === "test" ||
    isLocalUrl(process.env.NEXT_PUBLIC_BACKEND_URL)
  );
};
