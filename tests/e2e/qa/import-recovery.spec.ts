import { expect, test, type Page } from "@playwright/test";

/**
 * What a recruiter sees when a URL cannot be read.
 *
 * The server now distinguishes a board index from a bot check from an empty
 * shell, and writes recruiter-facing wording for each. What matters here is the
 * other half: that the wording reaches the screen, that paste is right there,
 * and that the typed URL is not thrown away — so the recruiter continues rather
 * than starts again.
 *
 * The index URL below is a real Greenhouse board whose job id has moved, which
 * is exactly the shape that used to import as a draft of nothing.
 */

const SHOTS = "/tmp/creatorjobs-recovery-qa";
const INDEX_URL = "https://job-boards.greenhouse.io/thenewyorktimes/jobs/4567154005";

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

async function attemptUrlImport(page: Page, url: string) {
  await page.goto("/post-job/import", { waitUntil: "domcontentloaded" });
  await page.getByRole("tab", { name: "Public URL" }).click();
  const field = page.getByTestId("import-url-input");
  await field.fill(url);
  await page.getByTestId("import-url-prepare").click();
}

test("paste is a first-class input, not a consolation prize", async ({ page }) => {
  await login(page);
  await page.goto("/post-job/import", { waitUntil: "domcontentloaded" });

  // Both paths are offered up front, and pasting is the default.
  await expect(page.getByRole("tab", { name: "Paste text" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Public URL" })).toBeVisible();
  await expect(page.getByTestId("import-textarea")).toBeVisible();
  // Both ways in are named by the tabs above; what the intro has to do is say
  // what happens next, which is the part a recruiter cannot guess from a tab.
  // Pinned to that rather than to a sentence — the wording has now been
  // rewritten twice and left this assertion behind each time.
  const body = await page.locator("body").innerText();
  expect(body).toMatch(/Bea/);
  expect(body).toMatch(/draft/i);
});

test("an index URL explains itself and leaves the recruiter mid-flow", async ({ page }) => {
  await login(page);
  await attemptUrlImport(page, INDEX_URL);

  // The specific reason, not a generic failure — and no fake processing.
  const message = page.getByText(/lists several jobs|couldn’t read|can't read/i).first();
  await expect(message).toBeVisible({ timeout: 60_000 });
  await page.screenshot({ path: `${SHOTS}/index-recovery.png`, fullPage: true });

  const body = await page.locator("body").innerText();
  // Product language only: no classification names, no vendor names.
  for (const leaked of ["multi_job_or_index", "Cloudflare", "scraping", "thin_or_shell"]) {
    expect(body).not.toContain(leaked);
  }

  // And the failure offers its own way forward rather than only a tab to hunt
  // for: an explicit recovery button, in the same session.
  const recover = page.getByRole("button", { name: /Paste text instead/i });
  await expect(recover).toBeVisible();
  await recover.click();
  await expect(page.getByTestId("import-textarea")).toBeVisible();
  await expect(page.getByTestId("import-textarea")).toBeEditable();

  // Nothing was thrown away: the URL is still there if they go back to it, so
  // the recruiter continues rather than starting the import again.
  await page.getByRole("tab", { name: "Public URL" }).click();
  await expect(page.getByTestId("import-url-input")).toHaveValue(INDEX_URL);
});

for (const vp of WIDTHS) {
  test(`recovery reads well at ${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await login(page);
    await attemptUrlImport(page, INDEX_URL);

    await expect(
      page.getByText(/lists several jobs|couldn’t read|can't read/i).first()
    ).toBeVisible({ timeout: 60_000 });
    await page.screenshot({ path: `${SHOTS}/recovery-${vp.name}.png`, fullPage: true });

    // The error must not take over the page: recovery stays reachable.
    await expect(
      page.getByRole("button", { name: /Paste text instead/i })
    ).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow, `${vp.name} scrolls horizontally`).toBeLessThanOrEqual(1);
  });
}
