import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("public URL entry joins the existing private source, draft, process, and review flow", () => {
  const page = read("components/import-job/ImportJobPageClient.tsx");
  const client = read("lib/jobImportReadiness.ts");
  assert.match(page, /\["url", "Public URL"\]/);
  assert.match(page, /createJobImportUrlSource/);
  assert.match(page, /initializeJobImportDraft/);
  assert.match(page, /processDraft\(initialized\)/);
  assert.match(page, /<ImportReviewWorkspace/);
  assert.match(client, /"\/job-imports\/url-sources"/);
  assert.doesNotMatch(page, /URLReview|UrlReview|applyUrlImport/);
});

test("URL entry explains the public-only, no-browser-session retrieval boundary", () => {
  const page = read("components/import-job/ImportJobPageClient.tsx");
  for (const phrase of [
    "anyone can open without signing in",
    "without cookies",
    "browser sessions",
    "JavaScript",
    "forms",
    "linked",
    "Some websites may not be supported",
  ]) {
    assert.match(page, new RegExp(phrase, "i"));
  }
  assert.match(page, /type="url"/);
  assert.match(page, /aria-label="Import source"/);
});

test("server URL retrieval owns SSRF, redirect, content, timeout, and size policy", () => {
  const fetcher = read("backend/app/services/job_url_fetcher.py");
  for (const boundary of [
    "is_global",
    "username",
    "password",
    "MAX_URL_REDIRECTS",
    "MAX_URL_RESPONSE_BYTES",
    "URL_CONNECT_TIMEOUT_SECONDS",
    "URL_TOTAL_TIMEOUT_SECONDS",
    "ALLOWED_URL_CONTENT_TYPES",
    "trust_env=False",
    "follow_redirects=False",
    "User-Agent",
  ]) {
    assert.match(fetcher, new RegExp(boundary));
  }
  assert.doesNotMatch(fetcher, /Cookie|Authorization/);
  assert.match(fetcher, /await self\._validate_destination\(current_url\)/);
});
