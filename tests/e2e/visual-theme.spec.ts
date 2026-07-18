import { expect, test } from "@playwright/test";

// Reversible visual-theme preview: current theme is the default, the floating
// toggle flips the root attribute, and localStorage persists the choice across
// reloads (applied pre-paint by the layout bootstrap).

test("current theme is the default and the toggle is present without overlaying content", async ({ page }) => {
  await page.goto("/jobs", { waitUntil: "domcontentloaded" });
  await expect(page.locator("html")).not.toHaveAttribute("data-visual-theme", "enhanced");
  const toggle = page.getByTestId("visual-theme-toggle");
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
});

test("toggling on restyles via the root attribute, persists across reload, and toggles off", async ({ page }) => {
  await page.goto("/jobs", { waitUntil: "domcontentloaded" });
  const html = page.locator("html");
  const toggle = page.getByTestId("visual-theme-toggle");

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

  // Toggle off returns to the current theme and persists that too.
  await page.getByTestId("visual-theme-toggle").click();
  await expect(html).not.toHaveAttribute("data-visual-theme", "enhanced");
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(html).not.toHaveAttribute("data-visual-theme", "enhanced");
});

test("enhanced theme changes computed surface colors without touching layout", async ({ page }) => {
  await page.goto("/jobs", { waitUntil: "domcontentloaded" });
  const cardCountBefore = await page.locator('[role="link"][tabindex="0"]').count();
  const readSurfaces = () =>
    page.evaluate(() => ({
      main: getComputedStyle(document.querySelector("main")!).backgroundColor,
      rootImage: getComputedStyle(document.documentElement).backgroundImage,
    }));
  const before = await readSurfaces();

  await page.getByTestId("visual-theme-toggle").click();
  const after = await readSurfaces();
  // The token-driven main surface shifts, and the root atmosphere appears.
  expect(after.main).not.toBe(before.main);
  expect(before.rootImage).toBe("none");
  expect(after.rootImage).not.toBe("none");

  const cardCountAfter = await page.locator('[role="link"][tabindex="0"]').count();
  expect(cardCountAfter).toBe(cardCountBefore);
});
