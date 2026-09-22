import { expect, test, type Page } from "@playwright/test";

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
