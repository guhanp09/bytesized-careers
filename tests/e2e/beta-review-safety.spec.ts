import { expect, test } from "@playwright/test";

const coreRoutes = [
  "/",
  "/jobs",
  "/jobs/1",
  "/talent",
  "/talent/mock-talent-retention-editor",
  "/u/aarav-mehta",
  "/post-job",
  "/post-talent",
  "/activity",
  "/saved",
  "/search",
];

const blockedTrustCopy = /Proof|Post availability|Enlist|USD|\$[0-9]|4\.[5-9]|5\.0|★★★★★|[1-9][0-9]* reviews/i;

test.describe("beta review and trust-copy safety", () => {
  for (const route of coreRoutes) {
    test(`${route} does not expose fake positive reviews or blocked marketplace copy`, async ({ page }) => {
      const response = await page.goto(route, { waitUntil: "domcontentloaded" });
      expect(response?.status(), `${route} should not server error`).toBeLessThan(500);
      await expect(page.locator("body")).not.toContainText(blockedTrustCopy);
    });
  }

  test("public work samples use the honest zero-review rating state", async ({ page }) => {
    await page.goto("/u/aarav-mehta/projects/aarav-mehta-sample-1", {
      waitUntil: "domcontentloaded",
    });

    await expect(page.locator("body")).toContainText("☆☆☆☆☆ 0 reviews");
    await expect(page.locator("body")).not.toContainText(/★★★★★|4\.[5-9]|5\.0|[1-9][0-9]* reviews/i);
  });

  test("talent public profiles show the honest zero-review rating state", async ({ page }) => {
    await page.goto("/u/aarav-mehta", { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("heading", { name: "Aarav Mehta" })).toBeVisible();
    await expect(page.locator("body")).toContainText("☆☆☆☆☆ 0 reviews");
    await expect(page.locator("body")).not.toContainText(/★★★★★|4\.[5-9]|5\.0|[1-9][0-9]* reviews/i);
  });
});
