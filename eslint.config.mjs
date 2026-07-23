import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Local Vercel CLI build output (git-ignored, never source).
    ".vercel/**",
    // Standalone Vite reference project provided for design inspiration only —
    // it is not part of the Next app and carries its own deps/lint baseline.
    "reference-homepage/**",
  ]),
]);

export default eslintConfig;
