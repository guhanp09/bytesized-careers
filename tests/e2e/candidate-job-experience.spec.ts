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
      providerAccountId: "google-candidate-e2e",
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
    await drawer.getByRole("button", { name: "English", exact: true }).click();
    await drawer.getByRole("button", { name: "Show jobs" }).click();

    await expect
      .poll(() => {
        const params = new URL(page.url()).searchParams;
        return {
          role: params.get("role"),
          platform: params.get("platform"),
          workMode: params.get("workMode"),
          language: params.get("language"),
          legacyCategory: params.get("filter"),
        };
      })
      .toEqual({
        role: "thumbnail-designer",
        platform: "YouTube",
        workMode: "remote",
        language: "English",
        legacyCategory: null,
      });

    await expect(page.getByText("Thumbnail designer (CTR-focused, 2–3 concepts)", { exact: false }).first()).toBeVisible();
    await expect(page.getByText("Video editor for YouTube", { exact: false })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Filters\s*4/ })).toBeVisible();

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /Filters\s*4/ }).click();
    const reloadedDrawer = page.getByRole("dialog", { name: "Filter jobs" });
    await expect(reloadedDrawer.getByLabel("Primary role")).toHaveValue("thumbnail-designer");
    await expect(reloadedDrawer.getByRole("button", { name: "YouTube", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(reloadedDrawer.getByRole("button", { name: "Remote", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(reloadedDrawer.getByRole("button", { name: "English", exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Escape");
    await expect(reloadedDrawer).toBeHidden();
    await expect(page.getByRole("button", { name: /Filters\s*4/ })).toBeFocused();

    await page.getByRole("link", { name: "Reset filters" }).click();
    await expect
      .poll(() => {
        const params = new URL(page.url()).searchParams;
        return ["role", "platform", "workMode", "language"].every((key) => !params.has(key));
      })
      .toBe(true);
  });

  test("internal applications expose materials, trial terms, and screening questions before submit", async ({
    context,
    page,
  }) => {
    await signInAsCandidate(context);
    await stubNoExistingApplication(page, "1");
    await page.goto("/jobs/1", { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("heading", { name: "Required application materials" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Screening questions" })).toBeVisible();
    await expect(
      page.getByText(/Which edit in your portfolio best demonstrates retention-focused storytelling\?/),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Trial terms" })).toBeVisible();
    await expect(page.getByText("Paid trial", { exact: true })).toBeVisible();
    await expect(page.getByText(/Trial pay:.*1,500/)).toBeVisible();

    const applyButton = page.locator('[data-testid="job-apply-button"]:visible');
    await expect(applyButton).toHaveText("Apply");
    await applyButton.click();

    const modal = page.getByTestId("first-message-modal-job");
    await expect(modal).toBeVisible();
    await expect(modal.getByRole("textbox", { name: "Expected rate amount" })).toBeFocused();
    await expect(modal.getByRole("region", { name: "Application overview" })).toContainText("Paid trial");
    await expect(modal.getByRole("region", { name: "Application overview" })).toContainText(
      "9 requested details · 2 screening questions",
    );
    await expect(
      modal.getByRole("textbox", {
        name: /Which edit in your portfolio best demonstrates retention-focused storytelling\?\s*Required/,
      }),
    ).toBeVisible();
    await expect(
      modal.getByRole("textbox", {
        name: /Is there anything about the proposed turnaround you would adjust\?\s*Optional/,
      }),
    ).toBeVisible();

    await modal.getByTestId("first-message-modal-submit").click();
    await expect(modal.getByText("Answer this required question.")).toBeVisible();
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
      if (request.method() === "POST" && url.pathname === "/api/v1/jobs/2/applications") {
        internalApplicationPosts.push(url.pathname);
      }
    });

    await page.goto("/jobs/2", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/jobs\/2$/);
    await expect(page.getByText("Apply on an external site", { exact: true })).toBeVisible();
    await expect(page.getByText("This opens another site. CreatorJobs does not receive or track the application.")).toBeVisible();

    const externalAction = page.locator('a[data-testid="job-apply-button"]:visible');
    await expect(externalAction).toHaveText("Continue to application");
    await expect(externalAction).toHaveAttribute(
      "href",
      "https://example.com/creatorjobs-thumbnail-application",
    );
    await expect(externalAction).toHaveAttribute("target", "_blank");

    const popupPromise = page.waitForEvent("popup");
    await externalAction.click();
    const externalPage = await popupPromise;
    await expect(externalPage).toHaveURL("https://example.com/creatorjobs-thumbnail-application");
    await externalPage.close();
    await expect(page).toHaveURL(/\/jobs\/2$/);

    await page.waitForTimeout(100);
    expect(internalApplicationPosts).toEqual([]);
  });

  test("expired jobs disable application without opening or submitting", async ({ page }) => {
    const applicationPosts: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (request.method() === "POST" && url.pathname === "/api/v1/jobs/3/applications") {
        applicationPosts.push(url.pathname);
      }
    });

    await page.goto("/jobs/3", { waitUntil: "domcontentloaded" });
    await expect(page.getByText(/^Closed /).first()).toBeVisible();
    const closedAction = page.locator('button[data-testid="job-apply-button"]:visible');
    await expect(closedAction).toHaveText("Applications closed");
    await expect(closedAction).toBeDisabled();
    await expect(page.getByTestId("first-message-modal-job")).toHaveCount(0);
    expect(applicationPosts).toEqual([]);
  });

  test("candidate trust surfaces stay factual and do not fabricate review or safety scores", async ({ page }) => {
    await page.goto("/jobs/1", { waitUntil: "domcontentloaded" });

    const postedBy = page.getByTestId("posted-by-card");
    await expect(postedBy).toContainText("Hiring on behalf of Finance Channel");
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
    const mobileApply = page.locator('[data-testid="job-mobile-apply-bar"] [data-testid="job-apply-button"]');
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
      await expect(page.getByRole("heading", { name: /Video editor for YouTube/i })).toBeVisible();
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
