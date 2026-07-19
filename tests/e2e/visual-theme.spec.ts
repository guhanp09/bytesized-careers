import { expect, test, type Page } from "@playwright/test";

// Reversible visual-theme preview: current theme is the default, the floating
// toggle flips the root attribute, and localStorage persists the choice across
// reloads (applied pre-paint by the layout bootstrap).

// Clicking before React hydration silently no-ops. With no stored theme, the
// first-run pulse class is added post-mount — a reliable hydration barrier.
async function toggleReady(page: Page) {
  const toggle = page.getByTestId("visual-theme-toggle");
  await expect(toggle).toHaveClass(/vt-toggle-pulse/);
  return toggle;
}

test("current theme is the default and the toggle is present without overlaying content", async ({ page }) => {
  await page.goto("/jobs", { waitUntil: "domcontentloaded" });
  await expect(page.locator("html")).not.toHaveAttribute("data-visual-theme", "enhanced");
  const toggle = page.getByTestId("visual-theme-toggle");
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(toggle).toContainText("Theme");
});

test("toggling on restyles via the root attribute, persists across reload, and toggles off", async ({ page }) => {
  await page.goto("/jobs", { waitUntil: "domcontentloaded" });
  const html = page.locator("html");
  const toggle = await toggleReady(page);

  await toggle.click();
  await expect(html).toHaveAttribute("data-visual-theme", "enhanced");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => window.localStorage.getItem("cj_visual_theme"))).toBe("enhanced");

  // Reload: the pre-paint bootstrap restores the choice.
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(html).toHaveAttribute("data-visual-theme", "enhanced");

  // Key /jobs UI still present under the enhanced theme (nothing removed).
  await expect(page.getByRole("combobox", { name: "Sort jobs" })).toBeVisible();
  expect(await page.locator('[role="link"][tabindex="0"]').count()).toBeGreaterThan(0);

  // Toggle off returns to the current theme and persists that too. With a stored
  // value, aria-pressed flipping to "true" is the post-hydration signal.
  const toggleAfterReload = page.getByTestId("visual-theme-toggle");
  await expect(toggleAfterReload).toHaveAttribute("aria-pressed", "true");
  await toggleAfterReload.click();
  await expect(html).not.toHaveAttribute("data-visual-theme", "enhanced");
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(html).not.toHaveAttribute("data-visual-theme", "enhanced");
});

test("enhanced theme changes computed surface colors without touching layout", async ({ page }) => {
  await page.goto("/jobs", { waitUntil: "domcontentloaded" });
  // Cards reveal after hydration; count only once the grid is actually painted.
  await expect(page.locator('[role="link"][tabindex="0"]').first()).toBeVisible();
  const cardCountBefore = await page.locator('[role="link"][tabindex="0"]').count();
  const readSurfaces = () =>
    page.evaluate(() => ({
      main: getComputedStyle(document.querySelector("main")!).backgroundColor,
      rootImage: getComputedStyle(document.documentElement).backgroundImage,
    }));
  const before = await readSurfaces();

  await (await toggleReady(page)).click();
  const after = await readSurfaces();
  // The token-driven main surface shifts, and the root atmosphere appears.
  expect(after.main).not.toBe(before.main);
  expect(before.rootImage).toBe("none");
  expect(after.rootImage).not.toBe("none");

  const cardCountAfter = await page.locator('[role="link"][tabindex="0"]').count();
  expect(cardCountAfter).toBe(cardCountBefore);
});

test("Apply Now becomes the amber opportunity pill only in the enhanced theme", async ({ page }) => {
  await page.goto("/jobs", { waitUntil: "domcontentloaded" });
  const cta = page.getByRole("button", { name: "Apply Now" }).first();
  const readCta = () =>
    cta.evaluate((el) => {
      const style = getComputedStyle(el);
      // Layout is governed by the margin box: the enhanced pill grows padding and
      // shrinks margins by the same amount, so the outer footprint is unchanged.
      const outer =
        el.getBoundingClientRect().width + parseFloat(style.marginLeft) + parseFloat(style.marginRight);
      return { backgroundImage: style.backgroundImage, box: outer };
    });

  const before = await readCta();
  expect(before.backgroundImage).toBe("none");

  const toggle = await toggleReady(page);
  await toggle.click();
  const after = await readCta();
  expect(after.backgroundImage).toContain("linear-gradient");
  // Net-zero footprint: the pill paints into whitespace without moving layout.
  expect(Math.abs(after.box - before.box)).toBeLessThanOrEqual(1);

  await toggle.click();
  expect((await readCta()).backgroundImage).toBe("none");
});
