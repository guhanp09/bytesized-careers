import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Post Job has one native About label while candidate copy keeps the brand heading", () => {
  const form = read("components/post-job/PostJobForm.tsx");
  const candidate = read("components/job-details/JobDescriptionSections.tsx");

  assert.match(form, /<label htmlFor="job-about-brand">About the brand<\/label>/);
  assert.match(form, /aria-label="About the brand"/);
  assert.doesNotMatch(form, /Candidate-facing introduction/);
  assert.doesNotMatch(form, /title=\{aboutBrandLabel\(hiringDisplayName\)\}/);
  assert.match(candidate, /aboutBrandLabel\(/);
});

test("the editor only reads persisted background state and never starts enrichment", () => {
  const page = read("components/PostJobPage.tsx");
  const client = read("lib/backendClient.ts");

  assert.match(page, /getBrandAboutState\(token, draftId\)/);
  assert.match(page, /dirtyPayloadKeysRef\.current\.has\("about_channel"\)/);
  assert.match(page, /dirtyPayloadKeysRef\.current\.has\("hiring_identity_id"\)/);
  assert.doesNotMatch(page, /requestBrandAboutEnrichment/);
  assert.doesNotMatch(page, /brand-about\/enrich/);
  assert.doesNotMatch(client, /requestBrandAboutEnrichment/);
  assert.doesNotMatch(client, /brand-about\/enrich/);
  assert.match(client, /export async function getBrandAboutState/);
  assert.match(
    client,
    /`\/jobs\/\$\{encodeURIComponent\(jobId\)\}\/brand-about\/state`/
  );
});

test("persisted server events own the automatic trigger", () => {
  const jobs = read("backend/app/api/v1/routers/jobs.py");
  const imports = read("backend/app/api/v1/routers/job_imports.py");

  assert.match(jobs, /async def schedule_brand_about_enrichment/);
  assert.match(
    jobs,
    /async def create_job[\s\S]*await schedule_brand_about_enrichment\(background, job=job/
  );
  assert.match(
    jobs,
    /async def update_job[\s\S]*await schedule_brand_about_enrichment\(background, job=job/
  );
  assert.match(
    imports,
    /async def apply_import_draft[\s\S]*await schedule_brand_about_enrichment\(background, job=job/
  );
  assert.match(
    imports,
    /async def attach_import_draft[\s\S]*await schedule_brand_about_enrichment\(background, job=job/
  );
});

test("the private hydration route exposes no discovery or provider provenance", () => {
  const jobs = read("backend/app/api/v1/routers/jobs.py");
  const response = jobs.match(
    /class BrandAboutStateResponse\(BaseModel\):([\s\S]*?)\n\nasync def schedule_brand_about_enrichment/
  );

  assert.ok(response, "private state response not found");
  assert.match(response[1], /status: str/);
  assert.match(response[1], /about_channel: str \| None/);
  assert.doesNotMatch(
    response[1],
    /^\s*(?:evidence|provider|query|official_url|attempt_id)\w*\s*:/m
  );
  assert.match(
    jobs,
    /async def get_brand_about_state\([\s\S]*owned_job: Job = Depends\(require_job_owner\)/
  );
  const stateRoute = jobs.match(
    /async def get_brand_about_state\(([\s\S]*?)\n\n@router\.post\(/
  );
  assert.ok(stateRoute, "brand About state route not found");
  assert.doesNotMatch(stateRoute[1], /schedule_brand_about_enrichment|add_task/);
});

test("optional automation never becomes a recruiter-facing provider state", () => {
  const page = read("components/PostJobPage.tsx");
  const form = read("components/post-job/PostJobForm.tsx");
  const productSurface = `${page}\n${form}`.toLowerCase();

  for (const phrase of [
    "ai is researching",
    "searching the web",
    "gpt is generating",
    "enrich your brand",
    "accept ai suggestion",
  ]) {
    assert.doesNotMatch(productSurface, new RegExp(phrase));
  }
});

test("browser assurance observes the product trigger and never calls enrichment itself", () => {
  const specs = [
    "tests/e2e/qa/brand-about-trigger.spec.ts",
    "tests/e2e/qa/brand-about-races.spec.ts",
    "tests/e2e/qa/brand-about-candidate.spec.ts",
  ].map(read).join("\n");

  assert.doesNotMatch(specs, /request\.(?:post|fetch)\([^\n]*brand-about\/enrich/);
  assert.doesNotMatch(specs, /route\([^\n]*brand-about\/enrich/);
  assert.match(specs, /countClientEnrichmentMutations/);
  assert.match(specs, /importBrandDiscoveryDraft/);
  assert.match(specs, /hiring_identity_id/);
});
