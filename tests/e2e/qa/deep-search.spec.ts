import { expect, test } from "@playwright/test";


test("deep Jobs search explains authoritative matches and preserves the query", async ({ page }) => {
  await page.goto("/jobs?q=video%20editor%20remote", { waitUntil: "domcontentloaded" });

  const summary = page.getByRole("region", { name: "Search interpretation" });
  await expect(summary).toBeVisible();
  await expect(summary).toContainText("video editor remote");
  await expect(page.getByLabel("Why this result matched").first()).toBeVisible();

  const switcher = summary.getByRole("group", { name: "Search results type" });
  await switcher.getByRole("link", { name: "Talent" }).click();
  await expect(page).toHaveURL(/\/talent\?q=video%20editor%20remote/);
  const talentSummary = page.getByRole("region", { name: "Search interpretation" });
  await expect(talentSummary.getByRole("link", { name: "Talent" })).toHaveAttribute(
    "aria-current",
    "page"
  );

  await page.getByRole("link", { name: "Clear search" }).click();
  await expect(page).toHaveURL(/\/talent$/);
});


test("deep Talent search remains usable on a mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/talent?q=editor%20youtube%20remote", { waitUntil: "domcontentloaded" });

  const summary = page.getByRole("region", { name: "Search interpretation" });
  await expect(summary).toBeVisible();
  await expect(summary.getByRole("group", { name: "Search results type" })).toBeVisible();
  await expect(page.locator('[aria-label^="Open talent listing"]').first()).toBeVisible();
  await expect(page.locator("body")).not.toHaveCSS("overflow-x", "scroll");
});
