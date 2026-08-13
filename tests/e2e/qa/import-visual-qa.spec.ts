import { expect, test, type Page } from "@playwright/test";

/**
 * Screenshots of the automated draft-preparation journey, for looking at.
 *
 * Not assertions. This exists because the defects that matter in this flow have
 * repeatedly been invisible to the unit suite and obvious in a picture: a
 * control below the fold, four nested rectangles, a heading competing with the
 * thing the recruiter is supposed to do next. Everything runs through the real
 * UI on the development fixtures, so no provider is called.
 *
 * Output goes to /tmp and is never committed.
 */

const CONTROLLER_EMAIL = "qa-controller@example.com";
const CONTROLLER_PASSWORD = "LocalQaController123!";
const SHOTS = process.env.IMPORT_SHOTS ?? "/tmp/creatorjobs-import-visual";

const DENSE_PASTE = [
  "We're hiring a Video Editor in Chennai.",
  "",
  "Company: Finance Simplified",
  "",
  "Location: Nungambakkam, Chennai, Tamil Nadu",
  "Work setup: On-site, Monday to Friday, 8 hours per day.",
  "",
  "Experience: 1 to 2 years",
  "",
  "Compensation: ₹30,000–₹40,000 per month",
  "",
  "You'll edit 3–5 long-form YouTube videos each week using Adobe Premiere Pro.",
  "After Effects is preferred.",
  "",
  "Please submit your resume, portfolio and cover letter.",
].join("\n");

async function login(page: Page) {
  await page.goto("/auth?mode=login", { waitUntil: "domcontentloaded" });
  await page.getByPlaceholder("Email").fill(CONTROLLER_EMAIL);
  await page.getByPlaceholder("Password").fill(CONTROLLER_PASSWORD);
  await page.locator("form").getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page).toHaveURL(/\/you/);
}

async function openFixture(page: Page, scenario: string) {
  await page.goto("/post-job/import", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("import-development-scenario")).toBeVisible();
  await page.getByTestId("import-development-scenario").selectOption(scenario);
  await page.getByTestId("open-import-review-fixture").click();
}

async function shoot(page: Page, name: string) {
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

test("entry states", async ({ page }) => {
  await login(page);
  await page.goto("/post-job/import", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("import-textarea")).toBeVisible();
  await shoot(page, "01-entry-paste-empty");

  await page.getByTestId("import-textarea").fill(DENSE_PASTE);
  await shoot(page, "02-entry-paste-filled");

  await page.getByRole("tab", { name: "Public URL" }).click();
  await expect(page.getByTestId("import-url-input")).toBeVisible();
  await shoot(page, "03-entry-url-empty");

  await page.getByTestId("import-url-input").fill("https://example.com/jobs/video-editor");
  await shoot(page, "04-entry-url-filled");
});

test("refusals", async ({ page }) => {
  await login(page);
  await page.goto("/post-job/import", { waitUntil: "domcontentloaded" });
  await page.getByTestId("import-textarea").fill(
    [
      "Current openings at Example Studio",
      "Role 1: Video Editor — Chennai. Responsibilities: edit weekly videos.",
      "Role 2: Thumbnail Designer — Remote. Requirements: Photoshop.",
      "Role 3: Social Media Manager — Mumbai. Qualifications: two years.",
      "View all jobs. Filter by location. Sort by date. Showing 3 of 12 jobs.",
    ].join("\n")
  );
  await page.getByTestId("import-prepare").click();
  await expect(page.getByText(/several jobs rather than one/i)).toBeVisible();
  await shoot(page, "05-refusal-multi-job");
});

test("processing and assistant states", async ({ page }) => {
  await login(page);

  await openFixture(page, "delayed-processing");
  await expect(page.getByTestId("draft-assistant-canvas")).toBeVisible();
  await shoot(page, "06-processing-early");

  await openFixture(page, "strong-decisions");
  await expect(page.getByTestId("draft-assistant-canvas")).toBeVisible();
  await page.waitForTimeout(1200);
  await shoot(page, "07-bea-first-question");

  await openFixture(page, "checkpoint-trial");
  await expect(page.getByTestId("draft-assistant-canvas")).toBeVisible();
  await page.waitForTimeout(1200);
  await shoot(page, "08-bea-checkpoint");

  await openFixture(page, "labelled-pay-conflict");
  await expect(page.getByTestId("draft-assistant-canvas")).toBeVisible();
  await page.waitForTimeout(1200);
  await shoot(page, "09-bea-conflict");

  await openFixture(page, "checkpoint-experience");
  await expect(page.getByTestId("draft-assistant-canvas")).toBeVisible();
  await page.waitForTimeout(1200);
  await shoot(page, "10-bea-custom-answer");

  await openFixture(page, "processing-failure");
  // A processing failure leaves the assistant surface for the recovery card,
  // so this waits for whichever one the product actually shows.
  await expect(
    page
      .getByTestId("job-import-failure")
      .or(page.getByTestId("draft-assistant-failure"))
      .or(page.getByTestId("draft-assistant-canvas"))
      .first()
  ).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(800);
  await shoot(page, "11-failure");
});

test("answering through to the draft", async ({ page }) => {
  await login(page);
  await openFixture(page, "strong-decisions");
  await expect(page.getByTestId("draft-assistant-canvas")).toBeVisible();
  await page.waitForTimeout(1500);
  await shoot(page, "12-clean-import-arrival");

  // Walk a few turns so history builds up, then look at it.
  for (let turn = 0; turn < 4; turn += 1) {
    const option = page.locator('[data-testid^="conversation-option-"]').first();
    const chip = page.locator('[data-testid^="conversation-chip-"]').first();
    const done = page.getByTestId("conversation-open-draft");
    if (await done.isVisible().catch(() => false)) break;
    if (await option.isVisible().catch(() => false)) {
      await option.click();
    } else if (await chip.isVisible().catch(() => false)) {
      await chip.click();
      await page.getByTestId("conversation-multiselect-submit").click();
    } else {
      break;
    }
    await page.waitForTimeout(900);
  }
  await shoot(page, "13-bea-with-history");

  const done = page.getByTestId("conversation-open-draft");
  if (await done.isVisible().catch(() => false)) {
    await shoot(page, "14-draft-ready");
    await done.click();
    await page.waitForURL(/\/post-job/, { timeout: 30_000 }).catch(() => undefined);
    await page.waitForTimeout(1500);
    await shoot(page, "15-post-job-imported");
  }
});

for (const { name, width, height } of [
  { name: "390", width: 390, height: 844 },
  { name: "430", width: 430, height: 932 },
  { name: "834", width: 834, height: 1112 },
  { name: "1280", width: 1280, height: 900 },
  { name: "1680", width: 1680, height: 1000 },
]) {
  test(`viewport ${name}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await login(page);
    await page.goto("/post-job/import", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("import-textarea")).toBeVisible();
    await page.getByTestId("import-textarea").fill(DENSE_PASTE);
    await shoot(page, `vp-${name}-entry`);

    await openFixture(page, "strong-decisions");
    await expect(page.getByTestId("draft-assistant-canvas")).toBeVisible();
    await page.waitForTimeout(1200);
    await shoot(page, `vp-${name}-bea`);
  });
}
