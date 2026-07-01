import { expect, test, type BrowserContext } from "@playwright/test";
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
      accountType: "BOTH",
      provider: "google",
      providerAccountId: "google-demo-owner",
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

test.describe("Settings page", () => {
  test("signed-out users are redirected to login with the settings return path", async ({ page }) => {
    await page.goto("/settings", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/auth\?mode=login&next=%2Fsettings$/);
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  });

  test("authenticated users can open Settings from the profile dropdown", async ({ page, context }) => {
    await signInAsOwner(context);

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Profile" }).click();
    await expect(page.getByRole("menu")).toContainText("Settings");

    await page.getByRole("button", { name: /Settings/ }).click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  });

  test("settings renders active and future marketplace sections without backend profile data", async ({ page, context }) => {
    await signInAsOwner(context);

    await page.goto("/settings", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("settings-profile-fallback")).toBeVisible();

    for (const id of [
      "account",
      "profile-visibility",
      "notifications",
      "marketplace",
      "payments",
      "privacy-data",
      "security",
      "preferences",
      "support-legal",
    ]) {
      await expect(page.getByTestId(`settings-section-${id}`)).toBeVisible();
    }

    await expect(page.getByText("CreatorJobs beta does not require a payment method")).toBeVisible();
    await expect(page.getByTestId("settings-section-privacy-data")).toContainText("Delete account");
    await expect(page.getByTestId("settings-section-privacy-data")).toContainText("Coming soon");
    await expect(
      page.getByTestId("settings-section-marketplace").getByRole("link", { name: "Post" })
    ).toHaveAttribute("href", "/post-job");
  });
});
