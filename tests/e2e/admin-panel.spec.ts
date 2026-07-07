import { expect, test, type BrowserContext } from "@playwright/test";
import { encode } from "next-auth/jwt";

/**
 * Admin panel shell (docs/ADMIN_PANEL_PLAN.md): server-side gating, navigation,
 * planned states, and graceful degradation when the backend is unreachable.
 *
 * The e2e environment runs the frontend only (mock marketplace mode, no
 * FastAPI backend), so these tests cover the UI shell and its honest
 * error/planned states; the functional admin flows (queues, actions, audit
 * writes) are covered end-to-end by backend/tests/test_admin_panel.py.
 */

const SESSION_SECRET = "e2e-secret";

async function signIn(context: BrowserContext, accountType: "TALENT" | "ADMIN") {
  const sessionToken = await encode({
    token: {
      name: accountType === "ADMIN" ? "Admin Operator" : "Demo Owner",
      email: accountType === "ADMIN" ? "admin-e2e@example.com" : "owner-e2e@example.com",
      sub: accountType === "ADMIN" ? "e2e-admin" : "e2e-owner",
      username: accountType === "ADMIN" ? "admin-operator" : "demo-owner",
      displayName: accountType === "ADMIN" ? "Admin Operator" : "Demo Owner",
      accountType,
      backendAccessToken: "e2e-offline-token",
      backendTokenType: "bearer",
      backendUserId: accountType === "ADMIN" ? "e2e-admin" : "e2e-owner",
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

test.describe("admin panel access", () => {
  test("non-admin sessions get a 404, not a login bounce or a shell", async ({ context, page }) => {
    await signIn(context, "TALENT");
    const response = await page.goto("/admin", { waitUntil: "domcontentloaded" });
    expect(response?.status()).toBe(404);
    await expect(page.getByTestId("admin-nav")).toHaveCount(0);
  });

  test("anonymous visitors get a 404 too — the panel never leaks", async ({ page }) => {
    const response = await page.goto("/admin/reports", { waitUntil: "domcontentloaded" });
    expect(response?.status()).toBe(404);
  });

  test("the old moderation URL is folded into the panel", async ({ context, page }) => {
    await signIn(context, "ADMIN");
    await page.goto("/admin/moderation", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/admin\/reports$/);
  });
});

test.describe("admin panel shell (backend offline)", () => {
  test.beforeEach(async ({ context }) => {
    await signIn(context, "ADMIN");
  });

  test("the shell renders with full navigation and the environment banner", async ({ page }) => {
    await page.goto("/admin", { waitUntil: "domcontentloaded" });
    const nav = page.getByTestId("admin-nav");
    await expect(nav).toBeVisible();
    for (const section of [
      "overview",
      "reports",
      "verification",
      "users",
      "listings",
      "conversations",
      "platform",
      "compliance",
      "audit-log",
    ]) {
      await expect(nav.getByTestId(`admin-nav-${section}`)).toBeVisible();
    }
    // e2e runs a non-production build → the environment strip shows.
    await expect(page.getByTestId("admin-env-banner")).toBeVisible();
  });

  test("data sections degrade to an honest error state without a backend", async ({ page }) => {
    await page.goto("/admin", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("admin-error")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("admin-error")).toContainText("backend");

    await page.getByTestId("admin-nav-reports").click();
    await expect(page.getByTestId("admin-reports")).toBeVisible();
    await expect(page.getByTestId("admin-error")).toBeVisible({ timeout: 15_000 });
  });

  test("compliance renders premium Planned states, never fake functionality", async ({ page }) => {
    await page.goto("/admin/compliance", { waitUntil: "domcontentloaded" });
    const planned = page.getByTestId("admin-planned");
    await expect(planned).toHaveCount(5);
    await expect(planned.first()).toContainText("Planned");
    await expect(page.getByTestId("admin-compliance")).toContainText("deletion-request model");
  });

  test("listings' profiles tab is a Planned state pointing at real alternatives", async ({ page }) => {
    await page.goto("/admin/listings", { waitUntil: "domcontentloaded" });
    await page.getByTestId("admin-listings-tab-profiles").click();
    await expect(page.getByTestId("admin-planned")).toBeVisible();
    await expect(page.getByTestId("admin-planned")).toContainText("admin portfolio endpoints");
  });

  test("no section introduces horizontal overflow", async ({ page }) => {
    const overflowOf = () =>
      page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    for (const path of ["/admin", "/admin/reports", "/admin/users", "/admin/compliance"]) {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      expect(await overflowOf(), path).toBeLessThanOrEqual(1);
    }
  });

  test("the header account menu links admins to the panel", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Profile", exact: true }).click();
    await expect(page.getByTestId("header-admin-link")).toBeVisible();
    await page.getByTestId("header-admin-link").click();
    await expect(page.getByTestId("admin-nav")).toBeVisible();
  });
});
