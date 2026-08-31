import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));
const source = (path) => readFileSync(join(root, path), "utf8");

const productionFrontendEnvironment = {
  APP_ENV: "production",
  NEXT_PUBLIC_APP_ENV: "production",
  NEXTAUTH_URL: "https://creatorjobs.example",
  NEXT_PUBLIC_SITE_URL: "https://creatorjobs.example",
  NEXT_PUBLIC_BACKEND_URL: "https://api.creatorjobs.example/api/v1",
  BACKEND_URL: "https://api.creatorjobs.example/api/v1",
  NEXTAUTH_SECRET: "test-only-strong-nextauth-secret",
  GOOGLE_CLIENT_ID: "test-client.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "test-only-strong-google-secret",
  GOOGLE_OAUTH_EXCHANGE_SECRET: "test-only-google-exchange-secret-rotation",
  NEXT_PUBLIC_USE_LOCAL_MOCKS: "false",
  MEDIA_PUBLIC_BASE_URL: "https://media.creatorjobs.example",
  MEDIA_BASE_PATH: "/media",
};

const importProductionNextConfig = (overrides = {}) =>
  spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--input-type=module",
      "--eval",
      'await import("./next.config.ts")',
    ],
    {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, ...productionFrontendEnvironment, ...overrides },
    },
  );

test("the credential registry inventories every application credential family", () => {
  const runbook = source("docs/CREDENTIAL_ROTATION.md");
  const rows = [...runbook.matchAll(/^\| CR-(\d+) \|/gm)];
  assert.equal(rows.length, 18);
  assert.deepEqual(
    rows.map((match) => Number(match[1])),
    Array.from({ length: 18 }, (_, index) => index + 1),
  );

  for (const setting of [
    "NEXTAUTH_SECRET",
    "JWT_SECRET",
    "GOOGLE_CLIENT_SECRET",
    "GOOGLE_OAUTH_EXCHANGE_SECRET",
    "GOOGLE_OAUTH_EXCHANGE_PREVIOUS_SECRET",
    "OAUTH_CREDENTIAL_KEYS",
    "OAUTH_CREDENTIAL_ACTIVE_KEY_ID",
    "STRONG_AUTH_SECRET_KEYS",
    "STRONG_AUTH_SECRET_ACTIVE_KEY_ID",
    "DATABASE_URL",
    "REDIS_URL",
    "SMTP_PASSWORD",
    "EMAIL_WEBHOOK_SECRET",
    "EMAIL_WEBHOOK_PREVIOUS_SECRET",
    "UNSUBSCRIBE_TOKEN_SECRET",
    "OPENAI_API_KEY",
    "YOUTUBE_DATA_API_KEY",
    "GOOGLE_PLACES_API_KEY",
  ]) {
    assert.match(runbook, new RegExp(`\\b${setting}\\b`), setting);
  }
  assert.match(runbook, /Declaration → enforcement → consumer/);
  assert.match(runbook, /Live\/provider exercises remain `BLOCKED_EXTERNAL`/);
});

test("planned overlap has declarations, enforcement, consumers, and retirement checks", () => {
  const config = source("backend/app/core/config.py");
  const auth = source("backend/app/api/v1/routers/auth.py");
  const webhook = source("backend/app/services/email_webhook_signature.py");
  const webhookRoute = source("backend/app/api/v1/routers/email_webhooks.py");

  assert.match(config, /GOOGLE_OAUTH_EXCHANGE_PREVIOUS_SECRET/);
  assert.match(auth, /google_oauth_exchange_previous_secret/);
  assert.match(auth, /secrets\.compare_digest/);
  assert.match(config, /EMAIL_WEBHOOK_PREVIOUS_SECRET/);
  assert.match(webhookRoute, /email_webhook_previous_secret/);
  assert.match(webhook, /previous_secret[\s\S]+hmac\.compare_digest/);

  const backendTests = [
    source("backend/tests/test_google_oauth_scope_disconnect.py"),
    source("backend/tests/test_email_suppression.py"),
  ].join("\n");
  assert.match(backendTests, /overlap\.status_code == 200/);
  assert.match(backendTests, /retired\.status_code == 401/);
});

test("both application-encryption keyrings have dry-run, bounded rewrap commands", () => {
  for (const path of [
    "backend/scripts/rotate_oauth_credentials.py",
    "backend/scripts/rotate_strong_auth_secrets.py",
  ]) {
    const command = source(path);
    assert.match(command, /dry-run by default/i);
    assert.match(command, /--apply/);
    assert.match(command, /--confirm/);
    assert.match(command, /batch_size < 1 or batch_size > 1000/);
    assert.match(command, /with_for_update\(\)/);
    assert.match(command, /await session\.rollback\(\)/);
    assert.doesNotMatch(command, /print\([^\n]*(?:secret|keyring_json)/i);
  }
});

test("production frontend refuses a missing or short credential-authority secret", () => {
  const valid = importProductionNextConfig();
  assert.equal(valid.status, 0, valid.stderr);

  for (const value of ["", "too-short", "replace-me"]) {
    const rejected = importProductionNextConfig({
      GOOGLE_OAUTH_EXCHANGE_SECRET: value,
    });
    assert.notEqual(rejected.status, 0, value);
    assert.match(rejected.stderr, /GOOGLE_OAUTH_EXCHANGE_SECRET/);
  }

  const frontend = [source("next.config.ts"), source("lib/auth.ts")].join("\n");
  assert.match(frontend, /GOOGLE_OAUTH_EXCHANGE_SECRET/);
  assert.doesNotMatch(frontend, /NEXT_PUBLIC_GOOGLE_OAUTH_EXCHANGE_SECRET/);
});

test("the runbook distinguishes maintenance from compromise and rewrap from revocation", () => {
  const runbook = source("docs/CREDENTIAL_ROTATION.md");
  assert.match(runbook, /Never keep a[\s\S]+compromised value in a `\*_PREVIOUS_SECRET`/);
  assert.match(runbook, /Re-encryption is not revocation/);
  assert.match(runbook, /rewrap\s+alone\s+is\s+not\s+containment/i);
  assert.match(runbook, /re-encrypting\s+the\s+same\s+seed\s+does\s+not\s+recover\s+it/i);

  const commandBlocks = [...runbook.matchAll(/```bash\n([\s\S]*?)```/g)]
    .map((match) => match[1])
    .join("\n");
  assert.doesNotMatch(commandBlocks, /(?:sk-|Bearer |BEGIN PRIVATE KEY|postgresql:\/\/)/);
  assert.doesNotMatch(commandBlocks, /(?:reset --hard|git push|--force|DROP DATABASE)/i);
});
