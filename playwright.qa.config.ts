import { defineConfig, devices } from "@playwright/test";

const frontendUrl = "http://127.0.0.1:3200";
const backendUrl = "http://127.0.0.1:8100/api/v1";

export default defineConfig({
  testDir: "./tests/e2e/qa",
  timeout: 45_000,
  expect: { timeout: 12_000 },
  workers: 1,
  fullyParallel: false,
  use: {
    baseURL: frontendUrl,
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: [
    {
      command:
        "APP_ENV=test YOUTUBE_API_KEY= YOUTUBE_DATA_API_KEY= ENABLE_QA_PERSONA_SWITCHER=true QA_PERSONA_CONTROLLER_EMAILS=qa-controller@example.com QA_PERSONA_ACCESS_TOKEN_MINUTES=30 QA_TEST_CONTROLLER_EMAIL=qa-controller@example.com QA_TEST_CONTROLLER_PASSWORD=LocalQaController123! DATABASE_URL=sqlite+aiosqlite:///./.local-data/qa-playwright.db CORS_ORIGINS='[\"http://127.0.0.1:3200\"]' MEDIA_ROOT=.local-data/qa-playwright-media PORT=8100 .venv/bin/python scripts/start_qa_test_server.py",
      cwd: "./backend",
      url: `${backendUrl}/health`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command:
        "APP_ENV=test NEXT_PUBLIC_APP_ENV=test ENABLE_QA_PERSONA_SWITCHER=true NEXT_PUBLIC_USE_LOCAL_MOCKS=false NEXT_PUBLIC_ENABLE_DEV_DATA_SWITCH=false NEXT_PUBLIC_ENABLE_EMAIL_AUTH=true NEXTAUTH_URL=http://127.0.0.1:3200 NEXT_PUBLIC_SITE_URL=http://127.0.0.1:3200 NEXTAUTH_SECRET=qa-playwright-local-secret BACKEND_URL=http://127.0.0.1:8100/api/v1 NEXT_PUBLIC_BACKEND_URL=http://127.0.0.1:8100/api/v1 DATABASE_URL=file:./qa-playwright-prisma.db npm run build && APP_ENV=test NEXT_PUBLIC_APP_ENV=test ENABLE_QA_PERSONA_SWITCHER=true NEXT_PUBLIC_USE_LOCAL_MOCKS=false NEXT_PUBLIC_ENABLE_DEV_DATA_SWITCH=false NEXT_PUBLIC_ENABLE_EMAIL_AUTH=true NEXTAUTH_URL=http://127.0.0.1:3200 NEXT_PUBLIC_SITE_URL=http://127.0.0.1:3200 NEXTAUTH_SECRET=qa-playwright-local-secret BACKEND_URL=http://127.0.0.1:8100/api/v1 NEXT_PUBLIC_BACKEND_URL=http://127.0.0.1:8100/api/v1 DATABASE_URL=file:./qa-playwright-prisma.db npx next start --hostname 127.0.0.1 --port 3200",
      url: frontendUrl,
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
});
