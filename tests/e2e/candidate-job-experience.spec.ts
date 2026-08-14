import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { encode } from "next-auth/jwt";

const SESSION_SECRET = "e2e-secret";

async function signInAsCandidate(context: BrowserContext) {
  const sessionToken = await encode({
    token: {
      name: "Candidate E2E",
      email: "candidate-e2e@example.com",
      sub: "e2e-candidate",
      username: "candidate-e2e",
      displayName: "Candidate E2E",
      backendAccessToken: "e2e-offline-token",
      backendTokenType: "bearer",
      backendUserId: "e2e-candidate",
      accountType: "TALENT",
      provider: "google",
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

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,OPTIONS",
  "access-control-allow-headers": "authorization,content-type",
  "content-type": "application/json",
};

async function stubNoExistingApplication(page: Page, jobId: string) {
  await page.route(`**/api/v1/jobs/${jobId}/application`, async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: corsHeaders, body: "" });
      return;
    }
    await route.fulfill({ status: 200, headers: corsHeaders, body: "null" });
  });
}

async function expectNoHorizontalPageOverflow(page: Page, label: string) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, `${label} should not overflow horizontally`).toBeLessThanOrEqual(2);
}

test.describe("candidate V3 job experience", () => {
  test("structured discovery filters are shareable, reload-safe, and resettable", async ({ page }) => {
    await page.goto("/jobs", { waitUntil: "domcontentloaded" });

    await page.getByRole("button", { name: "Filters" }).click();
    const drawer = page.getByRole("dialog", { name: "Filter jobs" });
    await expect(drawer).toBeVisible();

    await drawer.getByLabel("Primary role").selectOption({ label: "Thumbnail Designer" });
    await drawer.getByRole("button", { name: "YouTube", exact: true }).click();
    await drawer.getByRole("button", { name: "Remote", exact: true }).click();
    await expect(
      drawer.getByRole("button", { name: "English", exact: true }),
    ).toHaveCount(0);
    await drawer.getByRole("button", { name: "Show jobs" }).click();

    await expect
      .poll(() => {
        const params = new URL(page.url()).searchParams;
        return {
          role: params.get("role"),
          platform: params.get("platform"),
          workMode: params.get("workMode"),
          legacyCategory: params.get("filter"),
        };
      })
      .toEqual({
        role: "thumbnail-designer",
        platform: "YouTube",
        workMode: "remote",
        legacyCategory: null,
      });

    await expect(page.getByText("Thumbnail designer for technology reviews and comparisons", { exact: false }).first()).toBeVisible();
    await expect(page.getByText("Long-form YouTube editor", { exact: false })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Filters\s*3/ })).toBeVisible();

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /Filters\s*3/ }).click();
    const reloadedDrawer = page.getByRole("dialog", { name: "Filter jobs" });
    await expect(reloadedDrawer.getByLabel("Primary role")).toHaveValue("thumbnail-designer");
    await expect(reloadedDrawer.getByRole("button", { name: "YouTube", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(reloadedDrawer.getByRole("button", { name: "Remote", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(
      reloadedDrawer.getByRole("button", { name: "English", exact: true }),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(reloadedDrawer).toBeHidden();
    await expect(page.getByRole("button", { name: /Filters\s*3/ })).toBeFocused();

    await page.getByRole("link", { name: "Reset filters" }).click();
    await expect
      .poll(() => {
        const params = new URL(page.url()).searchParams;
        return ["role", "platform", "workMode", "language"].every((key) => !params.has(key));
      })
      .toBe(true);
  });

  test("internal applications expose materials and trial terms while screening stays private", async ({
    context,
    page,
  }) => {
    await signInAsCandidate(context);
    await stubNoExistingApplication(page, "1");
    await page.goto("/jobs/1", { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("heading", { name: "Required application materials" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Screening questions" })).toHaveCount(0);
    await expect(
      page.getByRole("main").getByText(
        /Which portfolio edit best shows your approach to retention without over-editing\?/,
      ).first(),
    ).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Trial terms" })).toBeVisible();
    await expect(page.getByText("Paid trial", { exact: true })).toBeVisible();
    await expect(page.getByText(/Trial pay:.*90/)).toBeVisible();

    const applyButton = page.locator('[data-testid="job-apply-button"]:visible');
    await expect(applyButton).toHaveText("Apply");
    await applyButton.click();

    const modal = page.getByTestId("first-message-modal-job");
    await expect(modal).toBeVisible();
    await expect(modal.getByRole("textbox", { name: "Expected rate amount" })).toBeFocused();
    await expect(modal.getByRole("region", { name: "Application overview" })).toContainText("Paid trial");
    await expect(modal.getByRole("region", { name: "Application overview" })).toContainText(
      "9 requested details",
    );
    await expect(
      modal.getByRole("region", { name: "Application overview" }),
    ).not.toContainText("screening");
    await expect(
      modal.getByRole("textbox", {
        name: /Which portfolio edit best shows your approach to retention without over-editing\?\s*Required/,
      }),
    ).toHaveCount(0);
    await expect(
      modal.getByRole("textbox", {
        name: /How do you use viewer-retention data after a video ships\?\s*Optional/,
      }),
    ).toHaveCount(0);

    await modal.getByTestId("first-message-modal-submit").click();
    await expect(modal.getByText("Answer this required question.")).toHaveCount(0);
    await expect(modal.getByText("Expected rate is required.")).toBeVisible();
    await expect(page).toHaveURL(/\/jobs\/1$/);
  });

  test("external-only jobs open the declared site and never create an internal application", async ({
    context,
    page,
  }) => {
    await context.route("https://example.com/**", async (route) => {
      await route.fulfill({ status: 200, contentType: "text/html", body: "<title>External application</title>" });
    });

    const internalApplicationPosts: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (request.method() === "POST" && url.pathname === "/api/v1/jobs/4/applications") {
        internalApplicationPosts.push(url.pathname);
      }
    });

    await page.goto("/jobs/4", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/jobs\/4$/);
    await expect(page.getByText("Apply on an external site", { exact: true })).toBeVisible();
    await expect(page.getByText("This opens another site. CreatorJobs does not receive or track the application.")).toBeVisible();

    const externalAction = page.locator('a[data-testid="job-apply-button"]:visible');
    await expect(externalAction).toHaveText("Continue to application");
    await expect(externalAction).toHaveAttribute(
      "href",
      "https://example.com/creatorjobs-demo/thumbnail-application",
    );
    await expect(externalAction).toHaveAttribute("target", "_blank");

    const popupPromise = page.waitForEvent("popup");
    await externalAction.click();
    const externalPage = await popupPromise;
    await expect(externalPage).toHaveURL("https://example.com/creatorjobs-demo/thumbnail-application");
    await externalPage.close();
    await expect(page).toHaveURL(/\/jobs\/4$/);

    await page.waitForTimeout(100);
    expect(internalApplicationPosts).toEqual([]);
  });

  test("published demo jobs keep a future deadline and an available application path", async ({ page }) => {
    await page.goto("/jobs/3", { waitUntil: "domcontentloaded" });
    await expect(page.getByText(/^Apply by /).first()).toBeVisible();
    await expect(page.locator('[data-testid="job-apply-button"]:visible')).toHaveText("Apply");
    await expect(page.locator('[data-testid="job-apply-button"]:visible')).toBeEnabled();
  });

  test("candidate trust surfaces stay factual and do not fabricate review or safety scores", async ({ page }) => {
    await page.goto("/jobs/1", { waitUntil: "domcontentloaded" });

    const postedBy = page.getByTestId("posted-by-card");
    await expect(postedBy).toContainText("Money & Mindset");
    await expect(postedBy).toContainText("Verified hiring identity");
    await expect(postedBy).not.toContainText("No reviews yet");

    const transparency = page.getByTestId("job-transparency-card");
    await expect(transparency).toBeVisible();
    await expect(transparency).toContainText("Factual details disclosed on this listing, not a safety or quality score.");
    await expect(transparency).not.toContainText(/trust score|safety score|quality score:\s*\d/i);
    await expect(page.locator("body")).not.toContainText("No reviews yet");
  });

  test("jobs, detail, filters, and application preflight fit a 320px viewport", async ({ context, page }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await page.goto("/jobs", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(150);
    await expectNoHorizontalPageOverflow(page, "/jobs at 320px");

    await page.getByRole("button", { name: "Filters" }).click();
    const drawer = page.getByRole("dialog", { name: "Filter jobs" });
    await expect(drawer).toBeVisible();
    const drawerBox = await drawer.boundingBox();
    expect(drawerBox, "filter drawer should have a viewport box").not.toBeNull();
    if (!drawerBox) throw new Error("Missing filter drawer bounds");
    expect(drawerBox.x).toBeGreaterThanOrEqual(80);
    expect(drawerBox.x + drawerBox.width).toBeLessThanOrEqual(320);
    await expectNoHorizontalPageOverflow(page, "job filter drawer at 320px");
    await drawer.getByRole("button", { name: "Close", exact: true }).click();

    await signInAsCandidate(context);
    await stubNoExistingApplication(page, "1");
    await page.goto("/jobs/1", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(150);
    await expectNoHorizontalPageOverflow(page, "/jobs/1 at 320px");
    const mobileApply = page.locator(
      '[data-testid="job-mobile-apply-bar"] [data-testid="job-apply-button"]:visible:not(:disabled)',
    );
    await expect(mobileApply).toBeVisible();
    await mobileApply.click();

    const modal = page.getByTestId("first-message-modal-job");
    await expect(modal).toBeVisible();
    const modalBox = await modal.boundingBox();
    expect(modalBox, "application preflight should have a viewport box").not.toBeNull();
    if (!modalBox) throw new Error("Missing application modal bounds");
    expect(modalBox.x).toBeGreaterThanOrEqual(0);
    expect(modalBox.x + modalBox.width).toBeLessThanOrEqual(320);
    await expectNoHorizontalPageOverflow(page, "application preflight at 320px");
  });

  test("390px, tablet, desktop, and wide layouts keep the decision hierarchy usable", async ({ page }) => {
    for (const viewport of [
      { width: 390, height: 844, label: "390px mobile" },
      { width: 768, height: 900, label: "tablet" },
      { width: 1280, height: 900, label: "desktop" },
      { width: 1920, height: 1080, label: "wide desktop" },
    ]) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      if (viewport.width === 390) {
        await page.goto("/jobs", { waitUntil: "domcontentloaded" });
        await expectNoHorizontalPageOverflow(page, `/jobs at ${viewport.label}`);
      }
      await page.goto("/jobs/1", { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { name: /Long-form YouTube editor/i })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Deliverables and volume" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Trial terms" })).toBeVisible();
      await expectNoHorizontalPageOverflow(page, `/jobs/1 at ${viewport.label}`);

      const mobileBar = page.getByTestId("job-mobile-apply-bar");
      if (viewport.width < 1024) {
        await expect(mobileBar).toBeVisible();
      } else {
        await expect(mobileBar).toBeHidden();
        await expect(page.getByTestId("job-apply-panel").locator('[data-testid="job-apply-button"]')).toBeVisible();
      }
    }
  });
});
