import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";

const execute = promisify(execFile);
const backend = "http://127.0.0.1:8100/api/v1";
const database = "sqlite+aiosqlite:///./.local-data/qa-playwright.db";

async function fixture(action: string, namespace: string, args: string[] = [], env = {}) {
  return execute(resolve("backend/.venv/bin/python"), [
    "scripts/qa_sitemap_fixtures.py", action, namespace, ...args,
  ], {
    cwd: resolve("backend"),
    env: { ...process.env, APP_ENV: "test", DATABASE_URL: database, ...env },
    timeout: 10_000,
  });
}

test("sitemap fixture refuses non-test environments and non-owned database URLs", async () => {
  for (const env of [
    { APP_ENV: "production" },
    { DATABASE_URL: "sqlite+aiosqlite:///./dev.db" },
    { DATABASE_URL: "postgresql://invalid.example/never-contact" },
  ]) {
    await expect(fixture("remove", randomUUID(), [], env)).rejects.toThrow(
      "Refusing anything except the explicit disposable QA database",
    );
  }
});

test("the real sitemap includes every page, preserves lastmod, excludes drafts, and refreshes", async ({ page }) => {
  const namespace = randomUUID();
  const jobResponse = await page.request.get(`${backend}/jobs?limit=1`);
  const talentResponse = await page.request.get(`${backend}/talent-listings?limit=1`);
  expect(jobResponse.ok()).toBeTruthy();
  expect(talentResponse.ok()).toBeTruthy();
  const job = (await jobResponse.json()).items[0];
  const talent = (await talentResponse.json()).items[0];
  expect(job?.id).toBeTruthy();
  expect(talent?.id).toBeTruthy();
  const ownedDetailPaths: string[] = [];
  const readPublicRecord = async (path: string) => {
    const [endpoint, id] = path.split("/");
    // Detail GETs can increment views and therefore updated_at. Read the same
    // non-mutating public list representation that the sitemap consumes.
    for (let offset = 0; offset < 1_000; offset += 100) {
      const response = await page.request.get(`${backend}/${endpoint}?limit=100&offset=${offset}`);
      expect(response.ok()).toBeTruthy();
      const { items } = await response.json();
      const record = items.find((item: { id: string }) => item.id === id);
      if (record) return record;
      if (items.length < 100) break;
    }
    throw new Error(`Owned public fixture missing: ${path}`);
  };
  try {
    const created = await fixture("create", namespace, ["--job", job.id, "--talent", talent.id]);
    const ids = JSON.parse(created.stdout) as { jobs: string[]; talent_listings: string[] };
    ownedDetailPaths.push(`jobs/${ids.jobs[0]}`, `talent-listings/${ids.talent_listings[0]}`);
    for (const endpoint of ["jobs", "talent-listings"]) {
      const response = await page.request.get(`${backend}/${endpoint}?limit=100&offset=100`);
      expect(response.ok()).toBeTruthy();
      expect((await response.json()).items.length, `${endpoint} must span multiple real API pages`).toBeGreaterThan(0);
    }
    const readSitemap = async () => {
      const response = await page.goto("/sitemap.xml");
      expect(response?.status()).toBe(200);
      return page.locator("urlset > url").evaluateAll((nodes) => nodes.map((node) => ({
        url: node.querySelector("loc")?.textContent ?? "",
        lastmod: node.querySelector("lastmod")?.textContent ?? null,
      })));
    };
    const first = await readSitemap();
    expect(new Set(first.map((entry) => entry.url)).size).toBe(first.length);
    for (const [table, path] of [["jobs", "jobs"], ["talent_listings", "talent"]] as const) {
      for (const id of ids[table].slice(0, 105)) {
        const entry = first.find((row) => row.url === `http://127.0.0.1:3200/${path}/${id}`);
        expect(entry, `${path}/${id} omitted from paginated sitemap`).toBeTruthy();
        expect(entry?.lastmod).toBeTruthy();
      }
      expect(first.some((entry) => entry.url.endsWith(`/${ids[table][105]}`))).toBe(false);
    }
    for (const path of ownedDetailPaths) {
      const entry = first.find((row) => row.url.endsWith(`/${path.split("/")[1]}`))!;
      const record = await readPublicRecord(path);
      expect(Date.parse(entry.lastmod!)).toBe(Date.parse(record.updated_at));
    }

    await fixture("update", namespace);
    const second = await readSitemap();
    for (const path of ownedDetailPaths) {
      const suffix = `/${path.split("/")[1]}`;
      const previous = first.find((entry) => entry.url.endsWith(suffix))!;
      const updated = second.find((entry) => entry.url.endsWith(suffix))!;
      const record = await readPublicRecord(path);
      expect(updated.lastmod).not.toBe(previous.lastmod);
      expect(Date.parse(updated.lastmod!)).toBe(Date.parse(record.updated_at));
    }
    expect(second.map((entry) => entry.url).sort()).toEqual(first.map((entry) => entry.url).sort());
  } finally {
    // Only UUIDs derived from this test's random namespace; never reset the QA corpus.
    await fixture("remove", namespace);
  }
  for (const path of ownedDetailPaths) {
    expect((await page.request.get(`${backend}/${path}`)).status()).toBe(404);
  }
  for (const path of [`jobs/${job.id}`, `talent-listings/${talent.id}`]) {
    expect((await page.request.get(`${backend}/${path}`)).status()).toBe(200);
  }
});
