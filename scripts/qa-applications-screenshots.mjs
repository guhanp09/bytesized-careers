// Throwaway visual QA for the /you Applications workspace. Run with the e2e
// server up: node scripts/qa-applications-screenshots.mjs
import { chromium } from "@playwright/test";
import { encode } from "next-auth/jwt";

const BASE = "http://127.0.0.1:3100";
const OUT = "/tmp/cj-apps-qa";

const token = await encode({
  token: {
    name: "Demo Owner",
    email: "owner-e2e@example.com",
    sub: "e2e-owner",
    username: "demo-owner",
    displayName: "Demo Owner",
    backendAccessToken: "e2e-offline-token",
    backendTokenType: "bearer",
    backendUserId: "e2e-owner",
  },
  secret: "e2e-secret",
});

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
await context.addCookies([
  { name: "next-auth.session-token", value: token, domain: "127.0.0.1", path: "/", httpOnly: true, sameSite: "Lax" },
]);
const page = await context.newPage();

await page.goto(`${BASE}/you?tab=applications`);
await page.getByTestId("applications-workspace").waitFor({ timeout: 15000 });
await page.waitForTimeout(400);
await page.getByTestId("applications-workspace").screenshot({ path: `${OUT}-talent-desktop.png` });

await page
  .getByTestId("interaction-row")
  .filter({ hasText: "Shorts editing package — 15 shorts per month" })
  .click();
await page.waitForTimeout(250);
await page.getByTestId("applications-workspace").screenshot({ path: `${OUT}-talent-request-detail.png` });

await page.getByRole("button", { name: "Recruiter", exact: true }).click();
await page.waitForTimeout(350);
await page.getByTestId("applications-workspace").screenshot({ path: `${OUT}-recruiter-desktop.png` });

const mobile = await context.newPage();
await mobile.setViewportSize({ width: 390, height: 844 });
await mobile.goto(`${BASE}/you?tab=applications`);
await mobile.getByTestId("applications-workspace").waitFor({ timeout: 15000 });
await mobile.waitForTimeout(400);
await mobile.screenshot({ path: `${OUT}-mobile-list.png`, fullPage: false });
await mobile.getByTestId("interaction-row").first().click();
await mobile.waitForTimeout(300);
await mobile.screenshot({ path: `${OUT}-mobile-detail.png`, fullPage: false });

await browser.close();
console.log("done");
