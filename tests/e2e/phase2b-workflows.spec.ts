import { expect, test } from "@playwright/test";

test.describe("phase 2b marketplace workflow scaffolding", () => {
  test("saved and applications routes require auth with calm entry states", async ({ page }) => {
    await page.goto("/saved");
    await expect(page.getByRole("heading", { name: "Saved", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();

    await page.goto("/applications");
    await expect(page.getByRole("heading", { name: "Applications", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
  });

  test("talent contact is a real protected action and public view hides owner controls", async ({ page }) => {
    await page.goto("/talent/mock-talent-retention-editor");

    await expect(page.getByRole("button", { name: "Hire me" })).toBeVisible();
    await expect(page.getByText("Owner controls")).toHaveCount(0);

    await page.getByRole("button", { name: "Hire me" }).click();
    await expect(page).toHaveURL(/\/auth\?mode=login/);
  });

  test("draft resume URLs keep publishing flows reachable", async ({ page }) => {
    await page.goto("/post-job?draftId=test-draft");
    await expect(page.getByText(/job draft/i).first()).toBeVisible();

    await page.goto("/post-talent?draftId=test-draft");
    await expect(page.locator("body")).toContainText(
      /Welcome back|talent listing draft|Create talent listing|Edit talent listing/i
    );
  });
});
