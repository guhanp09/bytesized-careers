import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("backend Dockerfile uses the Render-safe startup script", () => {
  const dockerfile = readFileSync("backend/Dockerfile", "utf8");
  assert.match(dockerfile, /CMD \["sh", "scripts\/start_render\.sh"\]/);
});

test("deployment guide uses backend health endpoints and exact staging settings", () => {
  const guide = readFileSync("DEPLOYMENT.md", "utf8");
  assert.match(guide, /Health Check Path:\*\* `\/api\/v1\/health`/);
  assert.match(guide, /\/api\/v1\/health\/db/);
  assert.match(guide, /Root Directory:\*\* `backend`/);
  assert.match(guide, /Dockerfile Path:\*\* `Dockerfile`/);
  assert.match(guide, /NEXT_PUBLIC_USE_LOCAL_MOCKS=false/);
  assert.doesNotMatch(guide, /\/api\/health/);
});

test("env examples document investor staging without real secrets", () => {
  const frontend = readFileSync(".env.example", "utf8");
  const backend = readFileSync("backend/.env.example", "utf8");

  assert.match(frontend, /NEXT_PUBLIC_ENABLE_EMAIL_AUTH=false/);
  assert.match(frontend, /NEXT_PUBLIC_ENABLE_DEV_DATA_SWITCH=false/);
  assert.match(frontend, /NEXT_PUBLIC_USE_LOCAL_MOCKS=false/);
  assert.match(backend, /APP_ENV=staging/);
  assert.match(backend, /CORS_ORIGINS=\["https:\/\/your-vercel-url"\]/);
  assert.match(backend, /EMAIL_MODE=log/);
  assert.match(backend, /MEDIA_ROOT=\/var\/data\/media/);
  assert.match(backend, /RUN_DB_MIGRATIONS=true/);
  assert.match(backend, /RUN_STAGING_SEED=true/);
  assert.match(backend, /RUN_DB_MIGRATIONS=false/);
  assert.match(backend, /RUN_STAGING_SEED=false/);
});

test("deployment guide explains Render Free automatic migrations and seed", () => {
  const guide = readFileSync("DEPLOYMENT.md", "utf8");
  assert.match(guide, /Render Free: Migrations And Staging Seed Without Shell Access/);
  assert.match(guide, /RUN_DB_MIGRATIONS=true/);
  assert.match(guide, /RUN_STAGING_SEED=true/);
  assert.match(guide, /RUN_STAGING_SEED=false/);
  assert.match(guide, /APP_ENV=production/);
  assert.match(guide, /you do not need to run a manual seed\s+command/);
});
