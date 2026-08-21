import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3100";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "accessibility-matrix.spec.ts",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  workers: 1,
  fullyParallel: false,
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium-a11y",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "firefox-a11y",
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "webkit-a11y",
      use: { ...devices["Desktop Safari"] },
    },
  ],
  webServer: {
    command: "npm run test:e2e:server",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
