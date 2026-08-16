import { expect, test } from "@playwright/test";

const coreRoutes = [
  "/",
  "/jobs",
  "/jobs/1",
  "/talent",
  "/talent/mock-talent-retention-editor",
  "/u/anika-rao",
  "/post-job",
  "/post-talent",
  "/saved",
  "/search",
];

// Fake trust signals and retired marketing copy. Currency used to be on this
// list, from when the demo corpus was rupees-only and a dollar figure meant
// something had been invented. The corpus now carries genuinely USD- and
// EUR-denominated jobs, and TRUST-001 requires a listing to show the amount and
// currency it was actually posted in — so suppressing "$450–$700 per video"
// would be the fabrication, not the display of it. Whether the *right* currency
// is shown for a given job is TRUST-001's own contract, not this one's.
const blockedTrustCopy = /Proof|Post availability|Enlist|★★★★★|[1-9][0-9]* reviews/i;

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

    await expect(page.locator("body")).toContainText("No reviews yet");
    await expect(page.locator("body")).not.toContainText(/★★★★★|4\.[5-9]|5\.0|[1-9][0-9]* reviews/i);
  });

  test("talent public profiles show the honest zero-review rating state", async ({ page }) => {
    await page.goto("/u/anika-rao", { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("heading", { name: "Anika Rao" })).toBeVisible();
    await expect(page.locator("body")).toContainText("No reviews yet");
    await expect(page.locator("body")).not.toContainText(/★★★★★|4\.[5-9]|5\.0|[1-9][0-9]* reviews/i);
  });
});
