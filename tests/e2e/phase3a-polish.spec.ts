import { expect, test } from "@playwright/test";

test.describe("phase 3a polish surfaces", () => {
  test("saved and activity unauth states stay calm and actionable", async ({ page }) => {
    await page.goto("/saved");
    await expect(page.getByRole("heading", { name: "Saved", exact: true })).toBeVisible();
    await expect(page.locator("body")).toContainText("Sign in to keep your shortlist together.");

    await page.goto("/activity");
    await expect(page.getByRole("heading", { name: "Activity", exact: true })).toBeVisible();
    await expect(page.locator("body")).toContainText("Sign in to see your marketplace activity.");
  });

  test("search handles empty and results states without placeholder copy", async ({ page }) => {
    await page.goto("/search");
    await expect(page.getByRole("heading", { name: "Search" })).toBeVisible();
    await expect(page.locator("body")).toContainText("Start with a role, platform, or niche.");

    await page.goto("/search?q=editor");
    await expect(page.getByRole("heading", { name: /Results for "editor"/ })).toBeVisible();
    await expect(page.locator("body")).not.toContainText(/Proof|USD|\$[0-9]/);
  });

  test("notifications stay behind auth and public profiles stay marketplace-facing", async ({ page }) => {
    await page.goto("/notifications");
    await expect(page).toHaveURL(/\/auth\?mode=login/);

    await page.goto("/u/aarav-mehta");
    await expect(page.locator("body")).not.toContainText(/Proof|Edit profile|Notification center/);
    await expect(page.locator("body")).not.toContainText(/\$|USD/);
  });

  test("public profiles use structured metadata language", async ({ page }) => {
    await page.goto("/u/aarav-mehta");

    await expect(page.locator("body")).toContainText("Work preferences");
    await expect(page.locator("body")).toContainText("Tools");
    await expect(page.locator("body")).toContainText("Availability");
    await expect(page.locator("body")).not.toContainText(/Proof|USD|\$[0-9]/);
  });
});
