import { expect, test, type Page } from "@playwright/test";

/**
 * The craft question, watched rather than asserted about.
 *
 * A listing whose title names several crafts is the case the old rule fell
 * through: too clearly in scope to leave blank, too genuinely ambiguous to
 * decide for the recruiter. Everything here runs on the development fixture, so
 * no provider call is made, and the screenshots go to /tmp so a person can look
 * at what the recruiter would actually see.
 */

const CONTROLLER_EMAIL = "qa-controller@example.com";
const CONTROLLER_PASSWORD = "LocalQaController123!";
const SHOTS = "/tmp/creatorjobs-craft-qa";

const WIDTHS = [
  { name: "mobile-390", width: 390, height: 844 },
  { name: "mobile-430", width: 430, height: 932 },
  { name: "tablet-834", width: 834, height: 1112 },
  { name: "desktop-1280", width: 1280, height: 900 },
  { name: "wide-1680", width: 1680, height: 1000 },
];

async function loginController(page: Page) {
  await page.goto("/auth?mode=login", { waitUntil: "domcontentloaded" });
  await page.getByPlaceholder("Email").fill(CONTROLLER_EMAIL);
  await page.getByPlaceholder("Password").fill(CONTROLLER_PASSWORD);
  await page.locator("form").getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page).toHaveURL(/\/you/);
}

async function openMultiCraft(page: Page) {
  await page.goto("/post-job/import", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("import-development-scenario")).toBeVisible();
  await page.getByTestId("import-development-scenario").selectOption("multi-craft");
  await page.getByTestId("open-import-review-fixture").click();
}

/** The turn currently on screen, once it has stopped being a typing bubble. */
async function settledTurn(page: Page) {
  const turn = page.getByTestId("conversation-turn");
  await expect(turn).toBeVisible({ timeout: 30_000 });
  await expect(turn.locator('[data-testid^="conversation-option-"]').first()).toBeVisible({
    timeout: 30_000,
  });
  return turn;
}

test.describe("a title naming several crafts", () => {
  test("asks once, with only the crafts the page named", async ({ page }) => {
    await loginController(page);
    await openMultiCraft(page);

    const turn = await settledTurn(page);
    await expect(turn).toContainText("Which craft is this role mainly for?");

    // The buttons must read as crafts, not as internal slugs. A recruiter who
    // sees "video-editor" is looking at our database, not at their job.
    const options = turn.locator('[data-testid^="conversation-option-"]');
    const labels = await options.allInnerTexts();
    expect(labels.length).toBeGreaterThanOrEqual(2);
    for (const label of labels) {
      expect(label.trim()).not.toMatch(/^[a-z0-9]+(-[a-z0-9]+)+$/);
    }

    // Only what the title named. Offering the whole taxonomy here would be a
    // worse version of the picker waiting in the editor.
    expect(labels.length).toBeLessThanOrEqual(4);
    expect(labels.join(" | ")).toMatch(/Video Editor/i);
    expect(labels.join(" | ")).toMatch(/Animator/i);

    await page.screenshot({ path: `${SHOTS}/craft-question.png`, fullPage: true });
  });

  test("the answer carries into the editor, and nothing else is re-asked", async ({
    page,
  }) => {
    await loginController(page);
    await openMultiCraft(page);

    const turn = await settledTurn(page);
    const chosen = (
      await turn.locator('[data-testid^="conversation-option-"]').first().innerText()
    ).trim();
    await turn.locator('[data-testid^="conversation-option-"]').first().click();

    // The craft was the only thing this page left open, so answering it should
    // finish preparation rather than reveal a second form.
    await page.waitForURL(/\/post-job/, { timeout: 60_000 });
    await page.screenshot({ path: `${SHOTS}/handoff.png`, fullPage: true });

    const body = await page.locator("body").innerText();
    expect(body).toContain(chosen);
    // The facts the page stated must already be in place.
    expect(body).toMatch(/Coimbatore/);
    expect(body).not.toMatch(/Coimbatore district/);
  });

  for (const viewport of WIDTHS) {
    test(`the question fits at ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await loginController(page);
      await openMultiCraft(page);
      await settledTurn(page);

      await page.screenshot({
        path: `${SHOTS}/craft-${viewport.name}.png`,
        fullPage: true,
      });

      // Nothing may push the page sideways. Grid children default to
      // min-width:auto, which is how this regressed before.
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `${viewport.name} scrolls horizontally`).toBeLessThanOrEqual(1);

      // The controls have to be reachable without hunting for them.
      const options = page
        .getByTestId("conversation-turn")
        .locator('[data-testid^="conversation-option-"]');
      await expect(options.first()).toBeInViewport();
    });
  }
});
