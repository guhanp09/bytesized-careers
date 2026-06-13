import { expect, test } from "@playwright/test";

const routeChecks = [
  { path: "/", text: "Recent Job Listings" },
  { path: "/jobs", text: "Video editor" },
  { path: "/jobs/1", text: "Video editor for YouTube" },
  { path: "/talent", text: "Retention editor" },
  { path: "/talent/mock-talent-retention-editor", text: "RETENTION EDITOR" },
  { path: "/u/aarav-mehta", text: "Aarav Mehta" },
  { path: "/you", text: "Sign in to open your workspace." },
  { path: "/post", text: "Create talent listing" },
  { path: "/post-job", text: "Who are you hiring for?" },
  { path: "/post-talent", text: "Welcome back" },
  { path: "/support", text: "Contact CreatorJobs" },
  { path: "/terms", text: "Beta notice" },
  { path: "/privacy", text: "Public by design" },
  { path: "/auth", text: "Welcome back" },
];

for (const route of routeChecks) {
  test(`smoke loads ${route.path}`, async ({ page }) => {
    const response = await page.goto(route.path, { waitUntil: "domcontentloaded" });
    expect(response?.status(), `${route.path} should not server error`).toBeLessThan(500);
    await expect(page.locator("body")).not.toContainText(
      /Application error|Unhandled Runtime Error|Internal Server Error/i
    );
    await expect(page.getByText(route.text, { exact: false }).first()).toBeVisible();
  });
}

test("post chooser routes to both publishing flows", async ({ page }) => {
  await page.goto("/post");
  await page.getByRole("link", { name: "Post a job" }).click();
  await expect(page).toHaveURL(/\/post-job$/);
  await expect(page.getByText("Who are you hiring for?")).toBeVisible();

  await page.goto("/post");
  await page.getByRole("link", { name: "Create talent listing" }).click();
  await expect(page).toHaveURL(/\/post-talent|\/auth/);
  await expect(page.locator("body")).toContainText(/Create talent listing|Welcome back/);
});

test("frontend health endpoint is deployment-check friendly", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.status()).toBe(200);
  await expect(response).toBeOK();
  const body = await response.json();
  expect(body.status).toBe("ok");
  expect(body.service).toBe("creatorjobs-web");
});

test("unauthenticated you page is not mislabeled as backend storage offline", async ({ page }) => {
  await page.goto("/you", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Sign in to open your workspace.")).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Backend storage is offline");
});

test("homepage recent job cards use full-card navigation without redundant card CTA", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Recent Job Listings" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recent Talent Listings" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Open roles from content creators, channels, brands, and agencies.");
  await expect(page.locator("body")).not.toContainText("Talent currently open to content work.");
  await expect(page.locator("body")).not.toContainText("Featured talent");
  const recentJobs = page.locator("section.home-rise-delay-jobs").first();
  const recentTalent = page.locator("section.home-rise-delay-talent").first();
  await expect(recentTalent.getByText("Retention editor", { exact: false }).first()).toBeVisible();
  await expect(recentTalent).not.toContainText("No recent talent listings yet.");
  await expect(recentJobs.getByRole("link", { name: /View jobs/i })).toBeVisible();
  await expect(recentTalent.getByRole("link", { name: /View talent/i })).toBeVisible();
  await expect(page.locator("body")).not.toContainText(/View role/i);
  await expect(recentTalent).toContainText(/work samples/i);

  const firstCard = recentJobs.locator('div[role="link"]').first();
  const firstSave = firstCard.getByRole("button", { name: "Save" });
  await expect(firstSave).toBeVisible();
  await firstSave.click();
  await expect(page).toHaveURL(/\/auth\?mode=login/);

  await page.goto("/");
  await recentJobs.locator('div[role="link"]').first().click();
  await expect(page).toHaveURL(/\/jobs\//);

  await page.goto("/");
  await recentTalent.locator('div[role="link"]').first().click();
  await expect(page).toHaveURL(/\/talent\//);
});

test("listing cards do not show unproven featured badges", async ({ page }) => {
  await page.goto("/jobs");
  await expect(page.locator('[role="link"]').first()).toBeVisible();
  await expect(page.locator('[role="link"]').filter({ hasText: "Featured" })).toHaveCount(0);

  await page.goto("/talent");
  await expect(page.locator('div[role="link"]').first()).toBeVisible();
  await expect(page.locator('div[role="link"]').filter({ hasText: "Featured" })).toHaveCount(0);
});
