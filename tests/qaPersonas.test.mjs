import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { evaluateQaPersonaUiAllowed } from "../lib/qaPersonas.ts";

test("QA persona UI requires an explicit staging or test gate", () => {
  assert.equal(
    evaluateQaPersonaUiAllowed({ APP_ENV: "staging", ENABLE_QA_PERSONA_SWITCHER: "true" }),
    true
  );
  assert.equal(
    evaluateQaPersonaUiAllowed({ NEXT_PUBLIC_APP_ENV: "test", ENABLE_QA_PERSONA_SWITCHER: "1" }),
    true
  );
  assert.equal(evaluateQaPersonaUiAllowed({ APP_ENV: "staging" }), false);
  assert.equal(
    evaluateQaPersonaUiAllowed({ APP_ENV: "development", ENABLE_QA_PERSONA_SWITCHER: "true" }),
    false
  );
});

test("production always rejects QA UI even if the switch is set", () => {
  assert.equal(
    evaluateQaPersonaUiAllowed({ APP_ENV: "production", ENABLE_QA_PERSONA_SWITCHER: "true" }),
    false
  );
  assert.equal(
    evaluateQaPersonaUiAllowed({
      APP_ENV: "staging",
      NEXT_PUBLIC_APP_ENV: "production",
      ENABLE_QA_PERSONA_SWITCHER: "true",
    }),
    false
  );
  assert.equal(
    evaluateQaPersonaUiAllowed({
      APP_ENV: "test",
      VERCEL_ENV: "production",
      ENABLE_QA_PERSONA_SWITCHER: "true",
    }),
    false
  );
});

test("QA session overlay keeps the controller backend token separate", () => {
  const auth = readFileSync("lib/auth.ts", "utf8");
  assert.match(auth, /token\.qaPersonaAccessToken = payload\.access_token/);
  assert.match(auth, /session\.backendAccessToken = token\.qaPersonaAccessToken/);
  assert.match(auth, /accessToken: token\.backendAccessToken/);
  assert.doesNotMatch(auth, /qaPersonaRefreshToken/);
});

test("QA proxy requires an authenticated server session", () => {
  const proxy = readFileSync("lib/qaPersonaProxy.ts", "utf8");
  assert.match(proxy, /getServerSession\(authOptions\)/);
  assert.match(proxy, /if \(!session\?\.backendAccessToken\).*404/);
  assert.match(proxy, /Authorization: `Bearer \$\{session\.backendAccessToken\}`/);
});

test("shared-password dev tools are suppressed when QA mode is active", async () => {
  const { evaluateDevToolsAllowed } = await import("../lib/devTools.ts");
  assert.equal(
    evaluateDevToolsAllowed({
      APP_ENV: "test",
      ENABLE_QA_PERSONA_SWITCHER: "true",
      NEXTAUTH_URL: "http://127.0.0.1:3200",
    }),
    false
  );
});

test("QA environment examples are disabled by default and document the controller allowlist", () => {
  const frontend = readFileSync(".env.example", "utf8");
  const backend = readFileSync("backend/.env.example", "utf8");
  assert.match(frontend, /^ENABLE_QA_PERSONA_SWITCHER=false$/m);
  assert.match(backend, /^ENABLE_QA_PERSONA_SWITCHER=false$/m);
  assert.match(backend, /^QA_PERSONA_CONTROLLER_EMAILS=$/m);
  assert.match(backend, /^QA_PERSONA_ACCESS_TOKEN_MINUTES=30$/m);
  assert.doesNotMatch(frontend, /qa-controller@example\.com/);
  assert.doesNotMatch(backend, /LocalQaController123!/);
});

test("isolated QA browser harness never references hosted services", () => {
  const config = readFileSync("playwright.qa.config.ts", "utf8");
  assert.match(config, /sqlite\+aiosqlite:\/\/\/\.\/\.local-data\/qa-playwright\.db/);
  assert.match(config, /NEXT_PUBLIC_USE_LOCAL_MOCKS=false/);
  assert.doesNotMatch(config, /onrender\.com|vercel\.app|neon\.tech/);
});

test("testing guide documents every restore pack and marks hosted setup as unapplied", () => {
  const guide = readFileSync("QA_PERSONA_TESTING.md", "utf8");
  for (const phrase of [
    "RESTORE PROFILES",
    "RESTORE LISTINGS",
    "RESTORE APPLICATIONS",
    "RESTORE REQUESTS",
    "RESTORE INBOX",
    "RESTORE REVIEWS",
    "RESTORE SAVED",
    "RESTORE MODERATION",
    "RESTORE ALL QA DATA",
  ]) {
    assert.match(guide, new RegExp(phrase));
  }
  assert.match(guide, /Future Hosted Staging Setup \(Not Applied\)/);
  assert.match(guide, /production is always refused/i);
});
