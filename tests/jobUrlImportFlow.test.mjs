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
  assert.match(page, /If a site blocks access/i);
  assert.match(page, /type="url"/);
  assert.match(page, /aria-label="Import source"/);
  assert.match(page, /Enter a public HTTP or HTTPS URL without sign-in credentials/);
});

test("server URL retrieval uses the shared pinned SSRF and bounded-content policy", () => {
  const wrapper = read("backend/app/services/job_url_fetcher.py");
  const boundary = read("backend/app/services/safe_outbound_fetch.py");
  for (const contract of [
    "is_global",
    "is_multicast",
    "username",
    "password",
    "DEFAULT_ALLOWED_PORTS",
    "_PinnedNetworkBackend",
    "PEER_MISMATCH",
    "validate_destination\\(current_url",
    "trust_env=False",
    "follow_redirects=False",
    "User-Agent",
  ]) {
    assert.match(boundary, new RegExp(contract));
  }
  assert.match(boundary, /"authorization"/);
  assert.match(boundary, /"cookie"/);
  assert.match(boundary, /_FORBIDDEN_REQUEST_HEADERS/);
  for (const productPolicy of [
    "MAX_URL_REDIRECTS",
    "MAX_URL_RESPONSE_BYTES",
    "URL_CONNECT_TIMEOUT_SECONDS",
    "URL_TOTAL_TIMEOUT_SECONDS",
    "ALLOWED_URL_CONTENT_TYPES",
  ]) {
    assert.match(wrapper, new RegExp(productPolicy));
  }
  assert.match(wrapper, /SafeOutboundFetcher/);
  assert.match(wrapper, /await self\._outbound_fetcher\.fetch\(raw_url, policy\)/);
});
