import { expect, test, type Page } from "@playwright/test";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { backendToken } from "./brand-about-helpers";

/**
 * The candidate-facing job surface, reached through the real product path.
 *
 * Two earlier attempts failed for the same reason, and the reason is worth
 * recording. `/jobs/[id]` is a *dual-purpose* route: it first asks whether the
 * segment is a curated SEO filter slug and, if so, renders a filtered listing;
 * only otherwise does it load a job by id. And the job cards on `/jobs` are not
 * anchors at all — they are `role="link"` divs that call `router.push`.
 *
 * So `a[href^="/jobs/"]` finds only SEO filter chips, and following one lands on
 * another listing. A sweep built on that selector asserted against the index it
 * started from and passed while proving nothing.
 *
 * This navigates to a job the backend actually returned, then proves the page is
 * that job by its own title before asserting anything about it.
 */

const SHOTS = "/tmp/creatorjobs-candidate-surface";
const BACKEND = "http://127.0.0.1:8100/api/v1";
const execute = promisify(execFile);
const QA_DATABASE = "sqlite+aiosqlite:///./.local-data/qa-playwright.db";

async function cleanPortfolioNamespace(namespace: string, env = {}, scenario: "portfolio" | "compensation" = "portfolio") {
  const args = ["scripts/qa_talent_portfolio_cleanup.py", namespace];
  if (scenario !== "portfolio") args.push("--scenario", scenario);
  return execute(resolve("backend/.venv/bin/python"), args, {
    cwd: resolve("backend"),
    env: { ...process.env, APP_ENV: "test", DATABASE_URL: QA_DATABASE, ...env },
    timeout: 10_000,
  });
}

const WIDTHS = [
  { name: "mobile-390", width: 390, height: 844 },
  { name: "mobile-430", width: 430, height: 932 },
  { name: "tablet-834", width: 834, height: 1112 },
  { name: "desktop-1280", width: 1280, height: 900 },
  { name: "wide-1680", width: 1680, height: 1000 },
];

async function login(page: Page) {
  await page.goto("/auth?mode=login", { waitUntil: "domcontentloaded" });
  await page.getByPlaceholder("Email").fill("qa-controller@example.com");
  await page.getByPlaceholder("Password").fill("LocalQaController123!");
  await page.locator("form").getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page).toHaveURL(/\/you/);
}

/** A published job the backend really has, so identity can be proved. */
async function aPublishedJob(page: Page): Promise<{ id: string; title: string }> {
  const response = await page.request.get(`${BACKEND}/jobs?limit=5`);
  expect(response.ok(), await response.text()).toBeTruthy();
  const payload = (await response.json()) as { items?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>;
  const items = Array.isArray(payload) ? payload : (payload.items ?? []);
  const job = items.find((row) => typeof row.id === "string" && typeof row.title === "string");
  expect(job, "the backend returned no published job to open").toBeTruthy();
  return { id: String(job!.id), title: String(job!.title) };
}

/** Open one job and prove the page belongs to it. */
async function openJob(page: Page, job: { id: string; title: string }) {
  await page.goto(`/jobs/${job.id}`, { waitUntil: "domcontentloaded" });

  // Identity, not a URL shape: this job's own title must be the page heading.
  await expect(
    page.getByRole("heading", { name: job.title, exact: false }).first()
  ).toBeVisible({ timeout: 30_000 });
  expect(page.url()).toContain(job.id);

  // And the listing grid must be gone — a filter route would still show cards.
  await expect(page.locator('[role="link"][title="Open job"]')).toHaveCount(0);
  const panels = page.getByTestId("job-apply-panel");
  await expect(panels).not.toHaveCount(0);
  // Both responsive copies must be free of the old claims, including the
  // currently hidden one. Do not silently inspect only the first panel.
  for (const panel of await panels.all()) {
    await expect(panel).not.toContainText(/Views|Response rate|Applicants/i);
  }
}

test("the candidate surface applies through CreatorJobs and nowhere else", async ({ page }) => {
  await login(page);
  const job = await aPublishedJob(page);
  await openJob(page, job);

  const body = await page.locator("body").innerText();
  expect(body).not.toMatch(/Apply on an external site/);
  expect(body).not.toMatch(/opens another site/i);
  expect(body).not.toMatch(/Continue to application/);
  expect(body).not.toMatch(/Application deadline:/);
  expect(body).not.toMatch(/whatsapp/i);
  expect(body).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
  // Screening questions belong to the application, never the public listing.
  // Singular as well as plural: the public page briefly printed "Screening
  // question" as a required-materials pill, and a plural-only check missed it.
  expect(body).not.toMatch(/Screening questions?/);

  // Nothing may leave the platform to apply.
  const leaving = await page
    .locator('a[target="_blank"][href^="http"]')
    .filter({ hasText: /appl/i })
    .count();
  expect(leaving).toBe(0);
});

test("the navigation helper cannot pass while still on the index", async ({ page }) => {
  await login(page);
  const job = await aPublishedJob(page);

  // The guard both earlier attempts lacked. A job's title is *not* enough on
  // its own — the index prints it on a card too, which is precisely how a
  // title-only assertion passes without ever leaving the listing. What
  // separates the two surfaces is the grid: the index has cards, the detail
  // page has none, and openJob asserts exactly that.
  await page.goto("/jobs", { waitUntil: "domcontentloaded" });
  // The card's actual navigation identity, not the retired fake-metric label.
  const cards = page.locator('[role="link"][title="Open job"]');
  await expect(cards.first()).toBeVisible({ timeout: 30_000 });
  await expect(cards).not.toHaveCount(0);

  // The title alone would have passed here, so the guard is real.
  await expect(
    page.getByRole("heading", { name: job.title, exact: false }).first()
  ).toBeVisible();

  // Opening the job leaves the grid behind.
  await openJob(page, job);
  await expect(cards).toHaveCount(0);
});

test("real talent cards and action panels omit unverified activity metrics without losing actions", async ({ page }) => {
  const response = await page.request.get(`${BACKEND}/talent-listings?limit=1`);
  expect(response.ok()).toBeTruthy();
  const listing = (await response.json()).items[0];
  expect(listing?.id).toBeTruthy();
  await page.goto("/talent");
  const card = page.getByRole("link").filter({ hasText: listing.title }).first();
  await expect(card).toBeVisible();
  await expect(card).not.toContainText(/Currently viewing|Interested recruiters|Response rate/i);
  await expect(card.getByRole("button", { name: "Save", exact: true })).toBeVisible();
  await expect(card.getByRole("button", { name: "Share", exact: true })).toBeVisible();

  await page.goto(`/talent/${listing.id}`);
  await expect(page.getByRole("heading", { name: listing.title, exact: true })).toBeVisible();
  const panels = page.getByTestId("talent-action-card");
  await expect(panels).not.toHaveCount(0);
  for (const panel of await panels.all()) {
    await expect(panel).not.toContainText(/Currently viewing|Interested recruiters|Response rate/i);
  }
  const actions = page.locator('[data-testid="talent-action-card"]:visible');
  await expect(actions).toBeVisible();
  await expect(actions.getByTestId("talent-hire-button")).toBeVisible();
  await expect(actions.getByRole("button", { name: "Save", exact: true })).toBeVisible();
  await expect(actions.getByRole("button", { name: "Share", exact: true })).toBeVisible();
});

test("foreign talent rates stay truthful on cards, details, and an edit round trip", async ({ page, browser }) => {
  await login(page);
  const headers = { Authorization: `Bearer ${await backendToken(page)}` };
  const namespace = randomUUID();
  const title = `USD compensation truth ${namespace}`;
  let listingId: string | undefined;
  const visitor = await browser.newContext({ baseURL: new URL(page.url()).origin });
  try {
    const created = await page.request.post(`${BACKEND}/talent-listings`, {
      headers,
      data: {
        title,
        primary_role: "Video editor",
        roles: ["Video editor"],
        work_mode: "remote",
        rate_min: 25,
        rate_max: 45,
        rate_currency: "USD",
        status: "published",
      },
    });
    expect(created.status(), await created.text()).toBe(201);
    listingId = (await created.json()).id;

    const publicPage = await visitor.newPage();
    await publicPage.goto("/talent");
    const card = publicPage.getByRole("link", { name: `Open talent listing: ${title}` });
    await expect(card).toBeVisible();
    await expect(card).toContainText("$25–$45");
    await expect(card).not.toContainText(/₹|20,000 per long-form video/);

    await publicPage.goto(`/talent/${listingId}`);
    await expect(publicPage.getByRole("heading", { name: title, exact: true })).toBeVisible();
    const detailRates = publicPage.getByText("$25–$45", { exact: true });
    await expect(detailRates.first()).toBeVisible();
    for (const rate of await detailRates.all()) await expect(rate).toHaveText("$25–$45");
    // Inspect the whole DOM so any hidden responsive copy carrying the old
    // fabricated INR value still fails the test.
    await expect(publicPage.locator("body")).not.toContainText("₹20,000 per long-form video");

    await page.goto(`/post-talent?draftId=${listingId}`);
    const rateControls = page.locator('[data-quality-target="talent-rate"]');
    await expect(rateControls).toContainText("USD");
    await expect(page.getByPlaceholder("Min")).toHaveValue("25");
    await page.getByPlaceholder("Min").fill("30");
    await page.getByRole("button", { name: "SAVE DRAFT", exact: true }).click();
    await expect(page).toHaveURL(/\/drafts\?saved=1&type=talent/);

    const mine = await page.request.get(`${BACKEND}/me/talent-listings`, { headers });
    expect(mine.ok(), await mine.text()).toBeTruthy();
    const saved = (await mine.json()).find((item: { id: string }) => item.id === listingId);
    expect(saved).toMatchObject({ rate_min: 30, rate_max: 45, rate_currency: "USD", status: "draft" });
  } finally {
    await visitor.close();
    if (listingId) expect((await page.request.delete(`${BACKEND}/talent-listings/${listingId}`, { headers })).ok()).toBeTruthy();
    const cleanup = JSON.parse((await cleanPortfolioNamespace(namespace, {}, "compensation")).stdout);
    expect(cleanup.notifications).toBe(1);
    expect(cleanup.talent_listings).toBe(1);
  }
});

test("backend talent portfolios show only real selected work without a developer cookie", async ({ page, browser }) => {
  await login(page);
  const headers = { Authorization: `Bearer ${await backendToken(page)}` };
  const namespace = randomUUID();
  const titles = [`Selected owned work ${namespace}`, `Unselected owned work ${namespace}`];
  const itemIds: string[] = [];
  let listingId: string | undefined;
  const visitor = await browser.newContext({ baseURL: new URL(page.url()).origin });
  try {
    for (const title of titles) {
      const created = await page.request.post(`${BACKEND}/portfolio/items`, {
        headers,
        data: {
          title, source_type: "custom", source_url: "https://example.com/owned-qa-work",
          thumbnail_url: new URL("/brand/logo-mark.png", page.url()).href,
          role_name: "Video Editor", contribution_summary: "Owned test contribution, never a synthetic platform claim.",
          visibility: "public", publish_status: "published",
        },
      });
      expect(created.status(), await created.text()).toBe(201);
      itemIds.push((await created.json()).id);
    }
    const created = await page.request.post(`${BACKEND}/talent-listings`, {
      headers,
      data: { title: `Portfolio provenance ${namespace}`, status: "published", portfolio_item_ids: [itemIds[0]] },
    });
    expect(created.status(), await created.text()).toBe(201);
    listingId = (await created.json()).id;
    const publicPage = await visitor.newPage();
    await publicPage.goto(`/talent/${listingId}`);
    await expect(publicPage.getByRole("heading", { name: /Portfolio provenance/i })).toBeVisible();
    await expect(publicPage.getByText(titles[0], { exact: true })).toBeVisible();
    await expect(publicPage.getByText(titles[1], { exact: true })).toHaveCount(0);
    expect((await visitor.cookies()).some((cookie) => cookie.name === "cj_data_source")).toBe(false);
    await expect(publicPage.locator("body")).not.toContainText(/18K views|Opening hook|Creator talent sample/);
  } finally {
    await visitor.close();
    if (listingId) expect((await page.request.delete(`${BACKEND}/talent-listings/${listingId}`, { headers })).ok()).toBeTruthy();
    for (const id of itemIds) expect((await page.request.delete(`${BACKEND}/portfolio/items/${id}`, { headers })).ok()).toBeTruthy();
    const cleanup = JSON.parse((await cleanPortfolioNamespace(namespace)).stdout);
    expect(cleanup.notifications).toBe(1);
    expect(cleanup.talent_listings).toBe(1);
    expect(cleanup.portfolio_items).toBe(0);
  }
});

test("portfolio QA cleanup refuses every database except the owned test file", async () => {
  const namespace = randomUUID();
  for (const env of [
    { APP_ENV: "production" },
    { DATABASE_URL: "sqlite+aiosqlite:///./dev.db" },
    { DATABASE_URL: "postgresql://invalid.example/never-contact" },
  ]) {
    await expect(cleanPortfolioNamespace(namespace, env)).rejects.toThrow(
      "Refusing anything except the explicit disposable QA database",
    );
  }
});

for (const vp of WIDTHS) {
  test(`the candidate surface holds together at ${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await login(page);
    const job = await aPublishedJob(page);
    await openJob(page, job);

    await page.screenshot({ path: `${SHOTS}/${vp.name}.png`, fullPage: true });

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow, `${vp.name} scrolls horizontally`).toBeLessThanOrEqual(1);
  });
}
