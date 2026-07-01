import { expect, test } from "@playwright/test";

// Regression guard: page-level horizontal scrolling is never acceptable. Local
// carousels may have their own scrollWidth, but the document itself must fit.
const routes = [
  "/",
  "/jobs",
  "/jobs/1",
  "/jobs?q=finance%20thumbnail%20youtube",
  "/talent",
  "/talent/mock-talent-retention-editor",
  "/talent?q=video%20editor",
  "/u/aarav-mehta",
];

const viewports = [
  { width: 1440, height: 900, label: "1440px desktop" },
  { width: 1280, height: 900, label: "1280px desktop" },
  { width: 1024, height: 900, label: "1024px tablet" },
  { width: 768, height: 900, label: "768px tablet" },
  { width: 390, height: 844, label: "390px mobile" },
];

for (const viewport of viewports) {
  for (const route of routes) {
    test(`no horizontal page overflow at ${viewport.label}: ${route}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(route, { waitUntil: "domcontentloaded" });
      // Let client filters, dev controls, and card rails settle after hydration.
      await page.waitForTimeout(150);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      expect(overflow, `${route} should not overflow horizontally at ${viewport.label}`).toBeLessThanOrEqual(2);
    });
  }
}
