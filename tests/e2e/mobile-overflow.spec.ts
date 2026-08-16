import { expect, test, type Page } from "@playwright/test";

async function dismissHiringDialog(page: Page) {
  const hiringDialog = page.getByRole("dialog", { name: "Who are you hiring for?" });
  const cancelHiringDialog = hiringDialog.getByRole("button", { name: "Cancel" }).first();
  await cancelHiringDialog
    .waitFor({ state: "visible", timeout: 3_000 })
    .then(async () => {
      await cancelHiringDialog.click();
      await expect(hiringDialog).toBeHidden();
    })
    .catch(() => undefined);
}

async function expectNoHorizontalPageOverflow(page: Page, label: string) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow, `${label} should not overflow horizontally`).toBeLessThanOrEqual(2);
}

// Regression guard: page-level horizontal scrolling is never acceptable. Local
// carousels may have their own scrollWidth, but the document itself must fit.
const routes = [
  "/",
  "/jobs",
  "/jobs/1",
  "/jobs?q=finance%20thumbnail%20youtube",
  "/talent",
  "/talent/mock-talent-retention-editor",
  "/talent?q=video%20editor",
  "/settings",
  "/u/aarav-mehta",
  "/post-job?section=tools",
];

const viewports = [
  { width: 1920, height: 1080, label: "1920px wide desktop" },
  { width: 1440, height: 900, label: "1440px desktop" },
  { width: 1280, height: 900, label: "1280px desktop" },
  { width: 1024, height: 900, label: "1024px tablet" },
  { width: 768, height: 900, label: "768px tablet" },
  { width: 390, height: 844, label: "390px mobile" },
];

for (const viewport of viewports) {
  for (const route of routes) {
    test(`no horizontal page overflow at ${viewport.label}: ${route}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(route, { waitUntil: "domcontentloaded" });
      // Let client filters, dev controls, and card rails settle after hydration.
      await page.waitForTimeout(150);
      await expectNoHorizontalPageOverflow(page, `${route} at ${viewport.label}`);
    });
  }
}

for (const viewport of [
  { width: 390, height: 844, label: "390px mobile" },
  { width: 320, height: 720, label: "320px narrow mobile" },
]) {
  test(`no horizontal page overflow on the V3 /post-job form at ${viewport.label}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/post-job?section=tools", { waitUntil: "domcontentloaded" });
    await dismissHiringDialog(page);

    const form = page.locator("form");

    // Grow the form before measuring, which is the point: a static form rarely
    // overflows. Language requirements used to provide the repeatable row and
    // were removed from post-job, so the tools tag input does it instead — and
    // it exercises the harder case anyway, since a long unbroken token is a
    // classic source of horizontal overflow at 320px.
    const tagInput = form.getByPlaceholder("Type a tag and press Enter (e.g. Premiere, After Effects)");
    await expect(tagInput).toBeVisible();
    await tagInput.fill("DaVinci Resolve Studio colour management");
    await tagInput.press("Enter");
    await expect(form.getByText("DaVinci Resolve Studio colour management")).toBeVisible();

    const saveDraft = form.getByRole("button", { name: "Save draft" }).last();
    // The footer action is labelled just "Continue" now; it used to carry the
    // step number.
    const continueButton = form.getByRole("button", { name: /^Continue$/ }).last();
    const actionFooter = saveDraft.locator("xpath=ancestor::div[contains(@class, 'fixed')][1]");
    await expect(saveDraft).toBeVisible();
    await expect(continueButton).toBeVisible();
    await expect(actionFooter).toBeVisible();
    await expect(actionFooter).toHaveCSS("position", "fixed");

    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect
      .poll(() =>
        page.evaluate(() =>
          Math.abs(
            document.documentElement.scrollHeight -
              document.documentElement.clientHeight -
              window.scrollY,
          ),
        ),
      )
      .toBeLessThanOrEqual(2);

    const lastInput = tagInput;
    await expect(lastInput).toBeVisible();
    const footerBox = await actionFooter.boundingBox();
    const lastInputBox = await lastInput.boundingBox();
    expect(footerBox, "mobile action footer should have a viewport box").not.toBeNull();
    expect(lastInputBox, "the last input should have a viewport box at the bottom of the form").not.toBeNull();
    if (!footerBox || !lastInputBox) throw new Error("Missing mobile footer or final input bounds");

    expect(footerBox.y + footerBox.height, "mobile action footer should meet the viewport bottom").toBeLessThanOrEqual(
      viewport.height + 1,
    );
    expect(lastInputBox.y + lastInputBox.height, "the last input should clear the fixed action footer").toBeLessThanOrEqual(
      footerBox.y - 8,
    );
    await page.waitForTimeout(150);

    await expectNoHorizontalPageOverflow(page, `/post-job tools form at ${viewport.label}`);
  });
}
