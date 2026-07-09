import { expect, test } from "@playwright/test";

const firstMarketplaceCard = (page: import("@playwright/test").Page) =>
  page.locator('div[role="link"]').filter({ has: page.getByRole("button", { name: "Share" }) }).first();

test("job card share/save actions give visible transient feedback", async ({ page }) => {
  await page.goto("/jobs", { waitUntil: "domcontentloaded" });

  const card = firstMarketplaceCard(page);
  await expect(card).toBeVisible();

  await card.getByRole("button", { name: "Share" }).click();
  await expect(card.getByText("Job link copied.")).toBeVisible();
  await expect(card.getByText("Job link copied.")).toBeHidden({ timeout: 4_000 });

  await card.getByRole("button", { name: "Save" }).click();
  await expect(card.getByText("Sign in to save this job.")).toBeVisible();
  await expect(page).toHaveURL(/\/auth\?mode=login/);
});

test("talent card share/save actions give visible transient feedback", async ({ page }) => {
  await page.goto("/talent", { waitUntil: "domcontentloaded" });

  const card = firstMarketplaceCard(page);
  await expect(card).toBeVisible();

  await card.getByRole("button", { name: "Share" }).click();
  await expect(card.getByText("Talent link copied.")).toBeVisible();
  await expect(card.getByText("Talent link copied.")).toBeHidden({ timeout: 4_000 });

  await card.getByRole("button", { name: "Save" }).click();
  await expect(card.getByText("Sign in to save this talent listing.")).toBeVisible();
  await expect(page).toHaveURL(/\/auth\?mode=login/);
});
