import { expect, test, type Page } from "@playwright/test";

/**
 * Job copy must not be able to push the page sideways.
 *
 * A recruiter pasted a URL into the About field and the text ran straight out of
 * its card. The URL was incidental — the defect is that *any* unbreakable token
 * could do it, and job copy is arbitrary text: pasted links, hashtags, a long
 * handle, a file path.
 *
 * The cause was two missing properties on the shared long-form primitive. A grid
 * or flex child defaults to `min-width: auto`, which sizes to its widest
 * unbreakable token rather than to its column, so the card grew to fit the URL
 * and took the layout with it. `min-w-0` lets it shrink; `break-words` then
 * wraps the token itself. Both live on `BodySection` and `BulletList`, so every
 * long-form candidate section is covered rather than the one that was reported.
 *
 * These drive the real listing at five widths and assert the two things a
 * recruiter would actually notice: the page does not scroll sideways, and the
 * text stays inside its card.
 */

const CONTROLLER_EMAIL = "qa-controller@example.com";
const CONTROLLER_PASSWORD = "LocalQaController123!";

const WIDTHS = [
  { name: "mobile-390", width: 390, height: 844 },
  { name: "mobile-430", width: 430, height: 932 },
  { name: "tablet-834", width: 834, height: 1112 },
  { name: "desktop-1280", width: 1280, height: 900 },
  { name: "wide-1680", width: 1680, height: 1000 },
];

/** The shapes of text that break naive layouts. */
const HOSTILE_TEXT = [
  "https://www.example.invalid/job/11j3vZrpcXaEMI7btjsm8lzFBxCl1PfVy--zWKbUeLTulxnUoYQs8w?utm_source=share&utm_medium=copy",
  "A".repeat(500),
  "#".repeat(120),
].join("\n\n");

async function login(page: Page) {
  await page.goto("/auth?mode=login", { waitUntil: "domcontentloaded" });
  await page.getByPlaceholder("Email").fill(CONTROLLER_EMAIL);
  await page.getByPlaceholder("Password").fill(CONTROLLER_PASSWORD);
  await page.locator("form").getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page).toHaveURL(/\/you/);
}

/** Whether the document scrolls horizontally at all. */
async function pageOverflowsSideways(page: Page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    // A pixel of tolerance: sub-pixel rounding is not a layout defect.
    return root.scrollWidth - root.clientWidth > 1;
  });
}

/**
 * Whether the About paragraph is wider than the box drawn around it.
 *
 * Measured on the element itself rather than on an ancestor. The first version
 * of this asserted on `section` scroll widths and passed with the fix removed —
 * an ancestor was clipping, so nothing ever reported an overflow and the test
 * was worthless. Comparing a paragraph's own `scrollWidth` to its `clientWidth`
 * is the direct signal: an unbreakable token makes the content wider than the
 * box, whatever any ancestor does about it afterwards.
 */
async function aboutTextOverflows(page: Page) {
  return page.evaluate(() => {
    const heading = Array.from(document.querySelectorAll("*")).find((node) =>
      /^About\b/i.test((node.textContent || "").trim().slice(0, 40))
    );
    const card = heading?.closest("section") ?? document.body;
    const paragraphs = Array.from(card.querySelectorAll("p"));
    return paragraphs.some((node) => node.scrollWidth - node.clientWidth > 1);
  });
}

/** Import a fixture, open the About step, and paste text designed to break it. */
async function typeHostileAbout(page: Page) {
  await page.goto("/post-job/import", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("import-development-scenario")).toBeVisible();
  await page.getByTestId("import-development-scenario").selectOption("ceiling-only-pay");
  await page.getByTestId("open-import-review-fixture").click();
  const open = page.getByRole("button", { name: /Open job draft/i });
  await expect(open.first()).toBeVisible({ timeout: 90_000 });
  await open.first().click();
  await expect.poll(() => new URL(page.url()).pathname, { timeout: 60_000 }).toBe("/post-job");

  const draftId = new URL(page.url()).searchParams.get("draftId");
  await page.goto(`/post-job?draftId=${draftId}&section=about`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForTimeout(2_500);

  const about = page.locator("#job-about-brand").first();
  await expect(about).toBeVisible({ timeout: 30_000 });
  await about.fill(HOSTILE_TEXT);
  await about.blur();
  await page.waitForTimeout(500);
}

test.describe("long-form job copy stays inside its card", () => {
  for (const width of WIDTHS) {
    test(`hostile About text does not break the layout at ${width.name}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: width.width, height: width.height });
      await login(page);

      // Typed into the real About field, so the copy reaches the shared
      // long-form primitive the way a recruiter's would. The demo listings
      // carry no About text at all, which is how the first version of this
      // test ended up measuring an unrelated paragraph and passing with the
      // fix removed.
      await typeHostileAbout(page);

      expect(
        await pageOverflowsSideways(page),
        `${width.name}: job copy made the page scroll sideways`
      ).toBe(false);
      expect(
        await aboutTextOverflows(page),
        `${width.name}: About text ran outside its card`
      ).toBe(false);
    });
  }

  test("ordinary prose is not fragmented by the wrapping rules", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await login(page);
    await page.goto("/jobs", { waitUntil: "domcontentloaded" });
    const firstJob = page.locator('a[href^="/jobs/"]').first();
    await expect(firstJob).toBeVisible({ timeout: 30_000 });
    await firstJob.click();
    await page.waitForTimeout(1_500);

    // `break-words` only breaks a word that cannot otherwise fit, so normal
    // sentences must be untouched — a rule that mid-word-hyphenated everything
    // would pass the overflow assertions and look terrible.
    const brokenMidWord = await page.evaluate(() => {
      const text = document.body.innerText;
      return /\b[a-z]{2,}­/.test(text);
    });

    expect(brokenMidWord, "ordinary prose was hyphenated mid-word").toBe(false);
    expect(await pageOverflowsSideways(page)).toBe(false);
  });
});
