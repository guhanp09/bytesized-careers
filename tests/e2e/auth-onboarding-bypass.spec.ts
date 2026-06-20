import { test, expect, type BrowserContext } from "@playwright/test";
import { encode } from "next-auth/jwt";

const SESSION_SECRET = "e2e-secret";

async function signInAsOwner(context: BrowserContext) {
  const sessionToken = await encode({
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
    secret: SESSION_SECRET,
  });
  await context.addCookies([
    {
      name: "next-auth.session-token",
      value: sessionToken,
      domain: "127.0.0.1",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}

test.describe("auth onboarding intent bypass", () => {
  test("signup no longer asks for an initial intent", async ({ page }) => {
    await page.goto("/auth?mode=signup", { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Choose initial intent");
    await expect(page.locator("body")).not.toContainText("I am looking for work");
    await expect(page.locator("body")).not.toContainText("I am hiring content talent");
    await expect(page.locator("body")).not.toContainText("I want to do both");
    await expect(page.locator("body")).not.toContainText("I will decide later");
  });

  test("legacy onboarding route no longer renders and falls back to login when signed out", async ({ page }) => {
    await page.goto("/auth/onboarding-intent", { waitUntil: "domcontentloaded" });

    await expect(page).toHaveURL(/\/auth\?mode=login&next=%2Fyou$/);
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Choose initial intent");
  });

  test("legacy onboarding routes redirect authenticated users straight into the app", async ({ page, context }) => {
    await signInAsOwner(context);

    await page.goto("/auth/onboarding-intent?next=%2Fjobs%2F1", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/jobs\/1$/);

    await page.goto("/auth/account-type?next=%2Fyou", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/you$/);
    await expect(page.locator("body")).not.toContainText("Choose initial intent");
  });
});
