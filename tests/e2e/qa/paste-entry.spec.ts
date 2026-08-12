import { expect, test, type Page } from "@playwright/test";

/**
 * The paste box, in a real browser, against the real server.
 *
 * Everything a recruiter pastes is now judged before a provider is involved:
 * the text is normalised on the server, and it is checked for being one job at
 * all. Both decisions happen at source creation, which is exactly why they can
 * be proven here without a provider call — nothing in this file spends a token
 * or invokes a backend endpoint by hand.
 *
 * What is deliberately *not* here is the half that needs an extraction to
 * exist. That path is driven by the development fixtures, whose non-URL
 * scenarios already enter through `rough_description` — a recruiter-supplied
 * text source, the same kind a paste creates — so draft, Post Job hydration and
 * the candidate view are covered against recruiter text by the assistant specs
 * rather than duplicated here with a live model call.
 */

const CONTROLLER_EMAIL = "qa-controller@example.com";
const CONTROLLER_PASSWORD = "LocalQaController123!";

const MULTI_JOB_PASTE = [
  "Current openings at Example Studio",
  "Role 1: Video Editor — Chennai. Responsibilities: edit weekly videos.",
  "Role 2: Thumbnail Designer — Remote. Requirements: Photoshop.",
  "Role 3: Social Media Manager — Mumbai. Qualifications: two years.",
  "View all jobs. Filter by location. Sort by date. Showing 3 of 12 jobs.",
].join("\n");

const NOT_A_JOB_PASTE = [
  "Acme builds delightful software for modern teams.",
  "Our platform helps thousands of companies collaborate every day.",
  "Read the customer stories and see why teams choose Acme for their work.",
  "Book a demo today and discover what Acme can do for your organisation.",
].join("\n");

const ONE_JOB_PASTE = [
  "\u{1F680} We're hiring a Video Editor!",
  "\u{1F4CD} Location: Nungambakkam, Chennai, Tamil Nadu",
  "\u{1F4B0} Compensation: ₹30,000 – ₹40,000 per month",
  "⏳ Experience: 1 to 2 years",
  "Responsibilities: edit 3–5 long-form YouTube videos each week.",
  "Qualifications: Adobe Premiere Pro. After Effects preferred.",
].join("\n");

async function loginController(page: Page) {
  await page.goto("/auth?mode=login", { waitUntil: "domcontentloaded" });
  await page.getByPlaceholder("Email").fill(CONTROLLER_EMAIL);
  await page.getByPlaceholder("Password").fill(CONTROLLER_PASSWORD);
  await page.locator("form").getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page).toHaveURL(/\/you/);
}

async function openPaste(page: Page) {
  await page.goto("/post-job/import", { waitUntil: "domcontentloaded" });
  const textarea = page.getByTestId("import-textarea");
  await expect(textarea).toBeVisible();
  return textarea;
}

test.describe("pasting a job", () => {
  test.beforeEach(async ({ page }) => {
    await loginController(page);
  });

  test("three roles pasted together are refused, in words the recruiter can act on", async ({
    page,
  }) => {
    const textarea = await openPaste(page);
    await textarea.fill(MULTI_JOB_PASTE);
    await page.getByTestId("import-prepare").click();

    // The server decides this, because only the server can: the sentence names
    // what to do next rather than reporting that something went wrong.
    await expect(page.getByText(/several jobs rather than one/i)).toBeVisible();
    await expect(page.getByText(/import the others separately/i)).toBeVisible();

    // The recruiter stays where the fix is. This is one edit away, so replacing
    // the box with a failure screen and a Retry that would fail identically
    // would be taking the text away at the moment it is needed.
    await expect(textarea).toHaveValue(/Role 1: Video Editor/);
    await expect(textarea).toHaveValue(/Role 3: Social Media Manager/);
    await expect(page.getByTestId("job-import-failure")).toHaveCount(0);
    await expect(page).toHaveURL(/\/post-job\/import$/);
  });

  test("content that is not a job is refused rather than turned into one", async ({
    page,
  }) => {
    const textarea = await openPaste(page);
    await textarea.fill(NOT_A_JOB_PASTE);
    await page.getByTestId("import-prepare").click();

    await expect(page.getByText(/couldn't find a job description/i)).toBeVisible();
    await expect(textarea).toBeVisible();
    await expect(page.getByTestId("job-import-failure")).toHaveCount(0);
    await expect(page).toHaveURL(/\/post-job\/import$/);
  });

  test("a single job with emoji row labels is accepted", async ({ page }) => {
    const textarea = await openPaste(page);
    await textarea.fill(ONE_JOB_PASTE);

    // The box shows the recruiter exactly what the server will read: the row
    // labels survive, the decoration in front of them does not.
    await expect(textarea).toHaveValue(/^Compensation: /m);
    await expect(textarea).toHaveValue(/^Experience: 1 to 2 years$/m);
    await expect(textarea).not.toHaveValue(/\u{1F4B0}/u);

    await expect(page.getByTestId("import-prepare")).toBeEnabled();
    await expect(page.getByText(/several jobs|couldn't find a job/i)).toHaveCount(0);
  });

  test("an empty box cannot start an import", async ({ page }) => {
    await openPaste(page);

    await expect(page.getByTestId("import-prepare")).toBeDisabled();
  });
});

test.describe("the paste surface holds together", () => {
  for (const { name, width, height } of [
    { name: "mobile-390", width: 390, height: 844 },
    { name: "mobile-430", width: 430, height: 932 },
    { name: "tablet-834", width: 834, height: 1112 },
    { name: "desktop-1280", width: 1280, height: 900 },
    { name: "wide-1680", width: 1680, height: 1000 },
  ]) {
    test(`${name}: the box is usable and nothing scrolls sideways`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await loginController(page);
      const textarea = await openPaste(page);

      await textarea.fill(ONE_JOB_PASTE);
      await expect(page.getByTestId("import-prepare")).toBeEnabled();
      await expect(page.getByTestId("import-prepare")).toBeInViewport();

      const noHorizontalScroll = await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth + 1
      );
      expect(noHorizontalScroll).toBe(true);
    });
  }
});
