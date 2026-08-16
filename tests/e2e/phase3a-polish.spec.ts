import { expect, test } from "@playwright/test";

test.describe("phase 3a polish surfaces", () => {
  test("saved and applications unauth states stay calm and actionable", async ({ page }) => {
    await page.goto("/saved");
    await expect(page.getByRole("heading", { name: "Saved", exact: true })).toBeVisible();
    await expect(page.locator("body")).toContainText("Sign in to keep your shortlist together.");

    await page.goto("/applications");
    await expect(page.getByRole("heading", { name: "Applications", exact: true })).toBeVisible();
    await expect(page.locator("body")).toContainText("Sign in to open your applications.");
  });

  test("legacy activity routes redirect to canonical destinations", async ({ page }) => {
    await page.goto("/activity");
    await expect(page).toHaveURL(/\/applications$/);

    await page.goto("/activity?tab=applications");
    await expect(page).toHaveURL(/\/applications$/);

    await page.goto("/activity?tab=applicants");
    await expect(page).toHaveURL(/\/applications\?view=hiring$/);

    await page.goto("/activity?tab=interests");
    await expect(page).toHaveURL(/\/applications\?view=talent$/);

    await page.goto("/activity?tab=updates");
    await expect(page).toHaveURL(/\/auth\?mode=login&next=.*notifications/);
  });

  test("search handles empty and results states without placeholder copy", async ({ page }) => {
    await page.goto("/search");
    await expect(page).toHaveURL(/\/jobs$/);

    await page.goto("/search?q=editor");
    await expect(page).toHaveURL(/\/jobs\?q=editor/);
    await expect(page.locator('div[role="link"]').first()).toBeVisible();
    // Currency dropped from this guard for the same reason as
    // beta-review-safety: the demo corpus now carries genuinely USD/EUR jobs
    // and TRUST-001 requires showing the posted currency.
    await expect(page.locator("body")).not.toContainText(/Proof/);
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
