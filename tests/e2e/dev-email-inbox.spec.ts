import { expect, test } from "@playwright/test";

test("development email inbox page renders an empty state locally", async ({ page }) => {
  await page.route("**/api/dev/emails", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [] }),
    });
  });

  const response = await page.goto("/dev/emails", { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBeLessThan(500);
  await expect(page.getByRole("heading", { name: "Development email inbox" })).toBeVisible();
  await expect(page.getByText("No development emails captured yet.")).toBeVisible();
  await expect(page.locator("body")).not.toContainText("[object Object]");
});

test("development email inbox displays normalized auth emails and clears them", async ({ page }) => {
  let emails = [
    {
      id: { value: "dev-email-1" },
      to: { email: "local@example.com" },
      type: { value: "verification" },
      subject: { text: "Verify your CreatorJobs email" },
      createdAt: { value: new Date().toISOString() },
      actionUrl: { url: "http://127.0.0.1:3100/auth/verify?token=local-token" },
      body: { text: "Verify your CreatorJobs account by opening this link." },
    },
  ];

  await page.route("**/api/dev/emails", async (route) => {
    if (route.request().method() === "DELETE") {
      emails = [];
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: emails }),
    });
  });

  await page.goto("/dev/emails", { waitUntil: "domcontentloaded" });

  await expect(page.getByText("Email verification", { exact: true })).toBeVisible();
  await expect(page.getByText("To: local@example.com")).toBeVisible();
  await expect(page.getByText("Subject: Verify your CreatorJobs email")).toBeVisible();
  await expect(page.getByRole("link", { name: "Open verification link" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy link" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("[object Object]");

  await page.getByRole("button", { name: "Copy link" }).click();
  await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();

  await page.getByRole("button", { name: "Clear inbox" }).click();
  await expect(page.getByText("Development inbox cleared.")).toBeVisible();
});

test("signup success links to the local development email inbox", async ({ page }) => {
  await page.route("**/api/v1/auth/register", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "ok",
        message: "Account created. Verify your email before logging in.",
        verification_url: "http://127.0.0.1:3100/auth/verify?token=local-signup-token",
      }),
    });
  });

  await page.goto("/auth?mode=signup");
  await page.getByPlaceholder("Username (lowercase, 3-20 chars)").fill("dev_email_user");
  await page.getByPlaceholder("Email").fill("dev-email-user@example.com");
  await page.getByPlaceholder("Password (min 8 chars)").fill("supersecure123");
  await page.getByPlaceholder("Confirm password").fill("supersecure123");
  const signupForm = page.locator("form").filter({ has: page.getByPlaceholder("Confirm password") });
  await signupForm.getByRole("button", { name: "Sign up" }).click();

  await expect(page.getByText("Account created.", { exact: false })).toBeVisible();
  await expect(page.getByRole("link", { name: "Local development: open dev email inbox" })).toHaveAttribute(
    "href",
    "/dev/emails"
  );
});

test("password reset request success links to the local development email inbox", async ({ page }) => {
  await page.route("**/api/v1/auth/password-reset/request", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        message: "If an account exists for this email, we sent a password reset link.",
        reset_url: "http://127.0.0.1:3100/auth/reset?token=local-reset-token",
      }),
    });
  });

  await page.goto("/auth/reset");
  await page.getByPlaceholder("Email").fill("dev-email-user@example.com");
  await page.getByRole("button", { name: "Send reset link" }).click();

  await expect(page.getByText("If an account exists", { exact: false })).toBeVisible();
  await expect(page.getByRole("link", { name: "Local development: open dev email inbox" })).toHaveAttribute(
    "href",
    "/dev/emails"
  );
});
