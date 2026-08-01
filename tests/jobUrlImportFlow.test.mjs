import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("public URL entry joins the private source, draft, process, and canonical Post Job flow", () => {
  const page = read("components/import-job/ImportJobPageClient.tsx");
  const client = read("lib/jobImportReadiness.ts");
  assert.match(page, /\["url", "Public URL"\]/);
  assert.match(page, /createJobImportUrlSource/);
  assert.match(page, /initializeJobImportDraft/);
  assert.match(page, /processDraft\(initialized, controller\.signal\)/);
  assert.match(page, /applyJobImportDraft/);
  assert.match(page, /\/post-job\?draftId=/);
  assert.match(client, /"\/job-imports\/url-sources"/);
  assert.doesNotMatch(page, /URLReview|UrlReview|applyUrlImport|ImportReviewWorkspace/);
});

test("URL entry explains the public retrieval boundary and keeps a paste fallback", () => {
  const page = read("components/import-job/ImportJobPageClient.tsx");
  for (const phrase of [
    "anyone can open without signing in",
    "paste the text instead",
  ]) {
    assert.match(page, new RegExp(phrase, "i"));
  }
  assert.match(page, /Some sites block automated\s+reading/i);
  assert.match(page, /type="url"/);
  assert.match(page, /aria-label="Import source"/);
  assert.match(page, /Enter a public HTTP or HTTPS URL without sign-in credentials/);
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
