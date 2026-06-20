import { expect, test } from "@playwright/test";

test.describe("talent browse regression coverage", () => {
  test("mock/test mode renders talent listings without the backend error state", async ({ page }) => {
    await page.goto("/talent");

    await expect(page.getByText("Talent listings could not be loaded right now")).toHaveCount(0);
    await expect(page.getByText("No talent found")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "All" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Featured" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Available" })).toHaveCount(0);
    await expect(page.getByText("Retention editor", { exact: false }).first()).toBeVisible();
    await expect(page.getByText("₹20,000 per long-form video").first()).toBeVisible();
    await expect(page.getByText("Experience: 2–4 years").first()).toBeVisible();
    await expect(page.getByText(/interested recruiters/i).first()).toBeVisible();
    await expect(page.locator("body")).not.toContainText(/\$|USD|Proof|1 slot open|Selective/);
  });

  test("valid talent filters keep showing matching listings", async ({ page }) => {
    await page.goto("/talent");

    await page.getByRole("button", { name: "Thumbnail designer" }).click();

    await expect(page.getByText("CTR-focused thumbnail designer", { exact: false })).toBeVisible();
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
