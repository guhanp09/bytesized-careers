import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { encode } from "next-auth/jwt";

// Matches NEXTAUTH_SECRET in the test:e2e:server script. The backend is not
// running during e2e, so /you renders its offline shell with mock data.
const SESSION_SECRET = "e2e-secret";

async function signInAsOwner(context: BrowserContext) {
  // backendAccessToken makes YouHubClient attempt real backend calls; with the
  // backend down they fail as network errors, which triggers the offline
  // profile shell instead of the blocking persistence-unavailable error.
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

async function openApplicationsTab(page: Page) {
  await page.goto("/you?tab=applications");
  await expect(page.getByTestId("applications-workspace")).toBeVisible({ timeout: 15_000 });
}

test.describe("/you Applications workspace", () => {
  test.beforeEach(async ({ context }) => {
    await signInAsOwner(context);
  });

  test("renders master-detail with list visible beside auto-selected detail", async ({ page }) => {
    await openApplicationsTab(page);

    const rows = page.getByTestId("interaction-row");
    await expect(rows).toHaveCount(6);

    await expect(rows.first()).toHaveAttribute("aria-pressed", "true");
    const detail = page.getByTestId("applications-detail");
    await expect(detail).toBeVisible();
    await expect(detail.getByText("Job you applied to")).toBeVisible();
    await expect(detail.getByText("₹350–₹3,500 per project")).toBeVisible();
  });

  test("talent mode shows sent applications and received hiring requests; row click updates detail without navigation", async ({
    page,
  }) => {
    await openApplicationsTab(page);

    const rows = page.getByTestId("interaction-row");
    await expect(rows.filter({ hasText: "Sent application" })).toHaveCount(3);
    await expect(rows.filter({ hasText: "Received hiring request" })).toHaveCount(3);

    const requestRow = rows.filter({ hasText: "Shorts editing package — 15 shorts per month" });
    await requestRow.click();
    await expect(requestRow).toHaveAttribute("aria-pressed", "true");

    const detail = page.getByTestId("applications-detail");
    await expect(detail.getByText("Recruiter", { exact: true })).toBeVisible();
    await expect(detail.getByText("Hiring for Daily faceless shorts channel")).toBeVisible();
    await expect(detail.getByRole("button", { name: "Accept request" })).toBeVisible();
    await expect(page).toHaveURL(/\/you\?tab=applications/);
  });

  test("accepting a received hiring request updates status from the detail pane", async ({ page }) => {
    await openApplicationsTab(page);

    await page
      .getByTestId("interaction-row")
      .filter({ hasText: "Shorts editing package — 15 shorts per month" })
      .click();

    const detail = page.getByTestId("applications-detail");
    await detail.getByRole("button", { name: "Accept request" }).click();
    await expect(detail.getByText("Accepted", { exact: true })).toBeVisible();
    await expect(detail.getByText("Accepted by you")).toBeVisible();
    await expect(detail.getByRole("button", { name: "Accept request" })).toHaveCount(0);
  });

  test("Sent, Received, and Archived filters scope the list", async ({ page }) => {
    await openApplicationsTab(page);

    const rows = page.getByTestId("interaction-row");

    await page.getByTestId("applications-filter-sent").click();
    await expect(rows).toHaveCount(3);
    await expect(rows.filter({ hasText: "Received hiring request" })).toHaveCount(0);

    await page.getByTestId("applications-filter-received").click();
    await expect(rows).toHaveCount(3);
    await expect(rows.filter({ hasText: "Sent application" })).toHaveCount(0);

    await page.getByTestId("applications-filter-archived").click();
    await expect(rows).toHaveCount(3);

    await page.getByTestId("applications-filter-all").click();
    await expect(rows).toHaveCount(6);
  });

  test("recruiter mode shows received applications with candidate snapshot and clears stale talent detail", async ({
    page,
  }) => {
    await openApplicationsTab(page);

    // Open a talent-mode detail first so staleness is observable.
    await page
      .getByTestId("interaction-row")
      .filter({ hasText: "Shorts editing package — 15 shorts per month" })
      .click();

    await page.getByRole("button", { name: "Recruiter", exact: true }).click();

    const rows = page.getByTestId("interaction-row");
    await expect(rows.filter({ hasText: "Received application" })).toHaveCount(3);
    await expect(rows.filter({ hasText: "Sent hiring request" })).toHaveCount(3);

    const detail = page.getByTestId("applications-detail");
    await expect(detail.getByText("Shorts editing package — 15 shorts per month")).toHaveCount(0);

    await rows.filter({ hasText: "Aarav Mehta" }).click();
    await expect(detail.getByText("Candidate", { exact: true })).toBeVisible();
    await expect(detail.getByText("Retention editor for creator-led YouTube channels")).toBeVisible();
    await expect(detail.getByText("Premiere Pro")).toBeVisible();
    await expect(detail.getByText("Retention rebuild — market explainer")).toBeVisible();
    await expect(detail.getByRole("button", { name: "Shortlist" })).toBeVisible();
    await expect(detail.getByRole("link", { name: "View full profile" })).toBeVisible();
  });

  test("reply composer sends a local reply with quick actions", async ({ page }) => {
    await openApplicationsTab(page);
    await page.getByRole("button", { name: "Recruiter", exact: true }).click();
    await page.getByTestId("interaction-row").filter({ hasText: "Aarav Mehta" }).click();

    const detail = page.getByTestId("applications-detail");
    const composer = detail.getByRole("textbox", { name: "Reply message" });
    await expect(composer).toBeVisible();

    await detail.getByRole("button", { name: "Ask for portfolio" }).click();
    await expect(composer).toHaveValue(/work samples/);

    await detail.getByRole("button", { name: "Send", exact: true }).click();
    await expect(detail.getByText("Conversation")).toBeVisible();
    await expect(detail.getByText("You · Just now")).toBeVisible();
    await expect(detail.getByText("Reply sent")).toBeVisible();
    await expect(composer).toHaveValue("");
  });

  test("declining a received application via the confirm panel archives it", async ({ page }) => {
    await openApplicationsTab(page);
    await page.getByRole("button", { name: "Recruiter", exact: true }).click();
    await page.getByTestId("interaction-row").filter({ hasText: "Aarav Mehta" }).click();

    const detail = page.getByTestId("applications-detail");
    await detail.getByRole("button", { name: "Decline", exact: true }).click();
    await expect(detail.getByText("Decline this application?")).toBeVisible();

    await detail.getByRole("button", { name: "Confirm decline" }).click();
    await expect(detail.getByText("Declined", { exact: true })).toBeVisible();
    await expect(detail.getByText("Declined by you")).toBeVisible();
    await expect(detail.getByRole("button", { name: "Shortlist" })).toHaveCount(0);
    await expect(detail.getByRole("button", { name: "Decline", exact: true })).toHaveCount(0);
  });

  test("shortlisting a received application updates its status", async ({ page }) => {
    await openApplicationsTab(page);
    await page.getByRole("button", { name: "Recruiter", exact: true }).click();

    await page.getByTestId("interaction-row").filter({ hasText: "Aarav Mehta" }).click();

    const detail = page.getByTestId("applications-detail");
    await detail.getByRole("button", { name: "Shortlist" }).click();
    await expect(detail.getByText("Shortlisted", { exact: true })).toBeVisible();
    await expect(detail.getByText("Shortlisted by you")).toBeVisible();
  });

  test("narrow viewport shows list first, opens detail on tap, and returns via back", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openApplicationsTab(page);

    const detail = page.getByTestId("applications-detail");
    await expect(detail).not.toBeVisible();

    const firstRow = page.getByTestId("interaction-row").first();
    await firstRow.click();
    await expect(detail).toBeVisible();
    await expect(firstRow).not.toBeVisible();

    await detail.getByRole("button", { name: "Back to list" }).click();
    await expect(detail).not.toBeVisible();
    await expect(firstRow).toBeVisible();
  });
});
