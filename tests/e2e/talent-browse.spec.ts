import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

async function expectAnchoredPopupWithinViewport(page: Page, popup: Locator) {
  const box = await popup.boundingBox();
  const viewport = page.viewportSize();
  expect(box, "anchored popup should have a measurable bounding box").not.toBeNull();
  expect(viewport, "viewport should be available").not.toBeNull();
  if (!box || !viewport) return;

  expect(box.x, "popup should stay inside the left viewport edge").toBeGreaterThanOrEqual(0);
  expect(box.y, "popup should stay inside the top viewport edge").toBeGreaterThanOrEqual(0);
  expect(box.x + box.width, "popup should stay inside the right viewport edge").toBeLessThanOrEqual(viewport.width);
  expect(box.y + box.height, "popup should stay inside the bottom viewport edge").toBeLessThanOrEqual(viewport.height);

  await expect(popup.locator('[data-testid="anchored-popover-caret"]')).toHaveAttribute(
    "data-placement",
    /^(top|right|bottom|left)$/
  );
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow, "anchored popup should not create document-level horizontal overflow").toBeLessThanOrEqual(1);
}

test.describe("talent browse regression coverage", () => {
  test("mock/test mode renders talent listings without the backend error state", async ({ page }) => {
    await page.goto("/talent");

    await expect(page.getByText("Talent listings could not be loaded right now")).toHaveCount(0);
    await expect(page.getByText("No talent found")).toHaveCount(0);
    // The role chips are curated SEO routes now, so they render as <Link>
    // (role=link), not <button>. "All" clears to the base list.
    await expect(page.getByRole("link", { name: "All", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Featured" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Available" })).toHaveCount(0);
    await expect(page.getByText("Retention editor", { exact: false }).first()).toBeVisible();
    await expect(page.getByText("₹20,000 per long-form video").first()).toBeVisible();
    await expect(page.getByText("Experience: 5 years").first()).toBeVisible();
    // The under-a-year bucket renders as a clean label, never "0 years".
    await expect(page.getByText("Experience: Less than 1 year").first()).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Experience: 0 years");
    // Legacy saves/counters are not validated recruiter-interest or presence
    // measurements and must not be presented as public activity claims.
    await expect(page.locator("body")).not.toContainText(/Interested recruiters|Currently viewing|Response rate/i);
    await expect(page.locator("body")).not.toContainText(/\$|USD|Proof|1 slot open|Selective/);
  });

  test("valid talent filters keep showing matching listings", async ({ page }) => {
    await page.goto("/talent");

    // "Thumbnail designer" is a curated SEO chip (role=link): clicking it
    // navigates to /talent/thumbnail-designers, which hard-filters to
    // thumbnail-design talent. `.first()` guards the streaming-SSR duplicate.
    await page.getByRole("link", { name: "Thumbnail designer" }).first().click();
    await expect(page).toHaveURL(/\/talent\/thumbnail-designers$/);

    // `.first()` is streaming-SSR safe: Next briefly renders a hidden duplicate of the
    // page content during hydration, so the unscoped text can resolve to two nodes.
    await expect(page.getByText("CTR-focused thumbnail designer", { exact: false }).first()).toBeVisible();
    await expect(page.getByText("No talent listings found.")).toHaveCount(0);
  });

  test("clicking a talent card opens listing detail", async ({ page }) => {
    await page.goto("/talent");

    await page
      .getByRole("link", { name: /Open talent listing: Retention editor/i })
      .click();

    await expect(page).toHaveURL(/\/talent\/mock-talent-retention-editor$/);
    await expect(page.getByRole("heading", { name: /RETENTION EDITOR/i })).toBeVisible();
  });

  test("talent detail shows relevant portfolio instead of the old work samples UI", async ({ page }) => {
    await page.goto("/talent/mock-talent-retention-editor");

    await expect(page.getByRole("heading", { name: "Relevant portfolio" })).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Work samples");
    await expect(page.getByText("Education channel retention edit")).toBeVisible();
    await expect(page.getByText("Finance explainer cleanup")).toBeVisible();
    await expect(page.getByText("Founder story cutdown")).toBeVisible();
    await expect(page.getByText("Video Editor sample for Education · business")).toBeVisible();

    await page.getByRole("button", { name: /View portfolio project details: Education channel retention edit/i }).click({
      position: { x: 36, y: 92 },
    });
    const popup = page.getByRole("dialog", { name: /Portfolio project details: Education channel retention edit/i });
    await expect(popup).toBeVisible();
    await expectAnchoredPopupWithinViewport(page, popup);
    await expect(popup).toContainText("What I Did");
    await expect(popup).toContainText("Contribution Highlights");
    await expect(popup).toContainText("Timestamp Notes");
    await expect(popup).toContainText("Tools Used");
    await expect(popup).not.toContainText("Content Context");
    await expect(popup).not.toContainText("Results");
    await expect(popup.getByRole("link", { name: /Open project at 12 seconds: Opening hook/i })).toHaveAttribute("href", /t=12s/);
    await expect(popup.getByRole("link", { name: /Open project externally/i })).toHaveAttribute("href", /youtube\.com\/watch/);
    await page.keyboard.press("Escape");
    await expect(popup).toHaveCount(0);

    const viewFull = page.getByRole("link", { name: /View Full Portfolio/ });
    await expect(viewFull).toHaveAttribute("href", "/u/aarav-mehta?view=talent&tab=portfolio#portfolio");
    await viewFull.click();

    await expect(page).toHaveURL(/\/u\/aarav-mehta\?view=talent&tab=portfolio#portfolio$/);
    await expect(page.getByRole("button", { name: "Portfolio", exact: true })).toHaveAttribute("aria-pressed", "true");
  });

  test("talent detail rating links to the public profile reviews tab", async ({ page }) => {
    await page.goto("/talent/mock-talent-retention-editor");

    const rating = page.getByTestId("talent-hero-rating");
    await expect(rating).toBeVisible();
    await expect(rating).toContainText("4.6");
    await expect(rating).toContainText("(5)");
    await expect(rating).toHaveAttribute("href", "/u/aarav-mehta?view=talent&tab=reviews");

    await rating.click();

    await expect(page).toHaveURL(/\/u\/aarav-mehta\?view=talent&tab=reviews$/);
    await expect(page.getByRole("button", { name: "Reviews", exact: true })).toHaveAttribute("aria-pressed", "true");
  });

  test("talent detail hides hero rating when review data is empty", async ({ page }) => {
    await page.goto("/talent/mock-talent-shorts-editor");

    await expect(page.getByTestId("talent-hero-rating")).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText("0.0 (0)");
  });

  test("clicking the talent name opens the public profile", async ({ page }) => {
    await page.goto("/talent");

    await page.getByRole("link", { name: "Aarav Mehta" }).click();

    await expect(page).toHaveURL(/\/u\/aarav-mehta\?view=talent$/);
    await expect(page.getByText("Aarav Mehta").first()).toBeVisible();
  });

  test("share and save actions do not open the talent detail card route", async ({ page }) => {
    await page.goto("/talent");

    await page.getByRole("button", { name: "Share" }).first().click();
    await expect(page).toHaveURL(/\/talent$/);

    await page.getByRole("button", { name: "Save" }).first().click();
    await expect(page).toHaveURL(/\/auth\?mode=login/);
    await expect(page).not.toHaveURL(/\/talent\/mock-talent-retention-editor/);
  });
});
