import { hasProductionEnvironmentSignal } from "./runtimeEnvironment.ts";

export type QaRuntimeEnv = {
  APP_ENV?: string;
  NEXT_PUBLIC_APP_ENV?: string;
  VERCEL_ENV?: string;
  ENABLE_QA_PERSONA_SWITCHER?: string;
};

const truthy = (value?: string) => /^(1|true|yes|on)$/i.test(value || "");

export const evaluateQaPersonaUiAllowed = (env: QaRuntimeEnv): boolean => {
  if (hasProductionEnvironmentSignal(env)) return false;
  const environment = env.APP_ENV || env.NEXT_PUBLIC_APP_ENV;
  return (environment === "staging" || environment === "test") && truthy(env.ENABLE_QA_PERSONA_SWITCHER);
};

export const isQaPersonaUiAllowed = (): boolean =>
  evaluateQaPersonaUiAllowed({
    APP_ENV: process.env.APP_ENV,
    NEXT_PUBLIC_APP_ENV: process.env.NEXT_PUBLIC_APP_ENV,
    VERCEL_ENV: process.env.VERCEL_ENV,
    ENABLE_QA_PERSONA_SWITCHER: process.env.ENABLE_QA_PERSONA_SWITCHER,
  });

export type QaPersona = {
  key: string;
  label: string;
  displayName: string;
  accountType: "TALENT" | "EMPLOYER" | "BOTH" | "ADMIN";
  modes: string[];
  description: string;
  coverage: string[];
  startRoute: string;
  caution?: string | null;
};

export type QaScenario = {
  key: string;
  title: string;
  purpose: string;
  personas: string[];
  startRoute: string;
  confirmation: string;
  danger: boolean;
};

export type QaStatus = {
  enabled: boolean;
  environment: string;
  controllerEmail: string;
  activePersonaKey?: string | null;
  qaSessionId?: string | null;
  personaCount: number;
  scenarioCount: number;
  fixturesHealthy: boolean;
};

export type QaSessionAction = {
  qaPersonaAction?: "switch" | "exit";
  qaPersonaKey?: string;
};
