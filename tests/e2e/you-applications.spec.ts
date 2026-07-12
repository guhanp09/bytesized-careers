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
  await page.goto("/applications?demo=1");
  await expect(page.getByTestId("applications-workspace")).toBeVisible({ timeout: 15_000 });
}

// Workflow actions live in the detail app-bar overflow menu.
async function openOverflow(page: Page) {
  await page.getByTestId("applications-detail").getByRole("button", { name: "More actions" }).click();
}

test.describe("/you Applications workspace", () => {
  test.beforeEach(async ({ context }) => {
    await signInAsOwner(context);
  });

  test("signed-in /you uses the offline shell without the blocking backend-offline banner", async ({ page }) => {
    await page.goto("/you");
    await expect(page.locator("body")).not.toContainText("Backend storage is offline");
    await expect(page.locator("body")).toContainText(/Demo Owner|You/);
  });

  test("renders master-detail with list visible beside auto-selected detail", async ({ page }) => {
    await openApplicationsTab(page);

    const rows = page.getByTestId("interaction-row");
    await expect(rows).toHaveCount(9);

    await expect(rows.first()).toHaveAttribute("aria-pressed", "true");
    const detail = page.getByTestId("applications-detail");
    await expect(detail).toBeVisible();
    // One primary title (H1), and the job reference row carries the compensation once.
    await expect(detail.getByRole("heading", { name: /Video editor for YouTube/ })).toBeVisible();
    await expect(detail.getByText("₹350–₹3,500 per project")).toBeVisible();
  });

  test("talent mode shows sent applications and received hiring requests; row click updates detail without navigation", async ({
    page,
  }) => {
    await openApplicationsTab(page);

    const rows = page.getByTestId("interaction-row");
    await expect(rows.filter({ hasText: "Sent application" })).toHaveCount(5);
    await expect(rows.filter({ hasText: "Received hiring request" })).toHaveCount(4);

    const requestRow = rows.filter({ hasText: "Shorts editing package — 15 shorts per month" });
    await requestRow.click();
    await expect(requestRow).toHaveAttribute("aria-pressed", "true");

    const detail = page.getByTestId("applications-detail");
    // Header is the recruiter; the context card is the viewer's own talent listing.
    await expect(detail.getByRole("heading", { name: "Motivation Shorts" })).toBeVisible();
    await expect(
      detail.getByRole("heading", { name: "Retention-focused long-form and shorts editing" })
    ).toBeVisible();
    await openOverflow(page);
    await expect(page.getByRole("menuitem", { name: "Accept request" })).toBeVisible();
    await expect(page).toHaveURL(/\/applications/);
  });

  test("accepting a received hiring request updates status from the detail pane", async ({ page }) => {
    await openApplicationsTab(page);

    await page
      .getByTestId("interaction-row")
      .filter({ hasText: "Shorts editing package — 15 shorts per month" })
      .click();

    const detail = page.getByTestId("applications-detail");
    await openOverflow(page);
    await page.getByRole("menuitem", { name: "Accept request" }).click();
    await expect(detail.getByText("Accept this hiring request?")).toBeVisible();
    await detail.getByRole("button", { name: "Confirm acceptance" }).click();
    // Status moves to the app-bar chip and terminal manager actions disappear.
    await expect(detail.getByText("Accepted", { exact: true })).toBeVisible();
    await openOverflow(page);
    await expect(page.getByRole("menuitem", { name: "Accept request" })).toHaveCount(0);
  });

  test("Sent, Received, and Archived filters scope the list", async ({ page }) => {
    await openApplicationsTab(page);

    const rows = page.getByTestId("interaction-row");

    await page.getByTestId("applications-filter-sent").click();
    await expect(rows).toHaveCount(5);
    await expect(rows.filter({ hasText: "Received hiring request" })).toHaveCount(0);

    await page.getByTestId("applications-filter-received").click();
    await expect(rows).toHaveCount(4);
    await expect(rows.filter({ hasText: "Sent application" })).toHaveCount(0);

    await page.getByTestId("applications-filter-archived").click();
    await expect(rows).toHaveCount(3);

    await page.getByTestId("applications-filter-all").click();
    await expect(rows).toHaveCount(9);
  });

  test("sent application: header is the counterparty and the job context card links to the job", async ({ page }) => {
    await openApplicationsTab(page);
    await page.getByTestId("interaction-row").filter({ hasText: "Video editor for YouTube" }).click();

    const detail = page.getByTestId("applications-detail");
    // Header answers "who am I talking to?" — the channel — not the job title.
    await expect(detail.getByRole("heading", { name: "Finance Channel" })).toBeVisible();

    // The job lives in the context card, which is itself the link to the job detail page.
    const jobCard = detail.locator('a[href="/jobs/1"]');
    await expect(jobCard).toBeVisible();
    await expect(jobCard.getByRole("heading", { name: /Video editor for YouTube/ })).toBeVisible();
    await expect(jobCard.getByText("₹350–₹3,500 per project")).toBeVisible();

    // No redundant label, no tag clutter in the compact card.
    await expect(detail.getByText("Job you applied to")).toHaveCount(0);
    await expect(jobCard.getByText("Premiere")).toHaveCount(0);
  });

  test("sent hiring request: talent context card is a compact mini-card linking to the profile, without bio/tag/portfolio clutter", async ({
    page,
  }) => {
    await openApplicationsTab(page);
    await page.getByRole("button", { name: "Recruiter", exact: true }).click();
    await page.getByTestId("interaction-row").filter({ hasText: "Anika Rao" }).click();

    const detail = page.getByTestId("applications-detail");
    // Header answers "who am I talking to?" — the talent.
    await expect(detail.getByRole("heading", { name: "Anika Rao" })).toBeVisible();

    // The talent lives in a compact context card — the mirror of the job card — that is
    // itself the link to their talent profile. Scope by the headline so the header link
    // (same href, no headline) isn't matched.
    const talentCard = detail
      .locator('a[href^="/u/anika-rao"]')
      .filter({ hasText: "Shorts editor for daily faceless channels" });
    await expect(talentCard).toBeVisible();
    await expect(
      talentCard.getByRole("heading", { name: "Shorts editor for daily faceless channels" })
    ).toBeVisible();
    // Same shape of info as the job card, same order: rate → experience (numeric years) → location.
    await expect(talentCard.getByText("₹15,000 per month")).toBeVisible();
    await expect(talentCard.getByText("3 years")).toBeVisible();
    await expect(talentCard.getByText("Bengaluru, India")).toBeVisible();

    // No availability status, no raw experience clause, no tag pills, no portfolio block.
    await expect(talentCard.getByText("Available · evenings IST")).toHaveCount(0);
    await expect(talentCard.getByText("Daily shorts pipelines for 3 faceless channels")).toHaveCount(0);
    await expect(talentCard.getByText("CapCut")).toHaveCount(0);
    await expect(talentCard.getByText("Daily shorts system — fitness channel")).toHaveCount(0);
  });

  test("received hiring request: context card is the viewer's own talent listing (mini talent card), not the recruiter", async ({
    page,
  }) => {
    await openApplicationsTab(page);
    // Talent mode (default): a recruiter showed interest in the viewer's listing.
    await page
      .getByTestId("interaction-row")
      .filter({ hasText: "Shorts editing package — 15 shorts per month" })
      .click();

    const detail = page.getByTestId("applications-detail");
    // Header answers "who am I talking to?" — the recruiter — and links to their hiring profile.
    await expect(detail.getByRole("heading", { name: "Motivation Shorts" })).toBeVisible();

    // Context card is the same compact talent card, here representing the viewer's own
    // listing, linking to their talent profile. Identity is genericised to "Your listing".
    const ownListingCard = detail.locator('a[href^="/u/demo-owner"]');
    await expect(ownListingCard).toBeVisible();
    await expect(
      ownListingCard.getByRole("heading", { name: "Retention-focused long-form and shorts editing" })
    ).toBeVisible();
    await expect(ownListingCard.getByText("Your listing")).toBeVisible();
    await expect(ownListingCard.getByText("₹2,000–₹3,500 per video")).toBeVisible();
    // Availability status is not a job-card-equivalent field, so it does not appear here.
    await expect(ownListingCard.getByText("Available · 2 retainer slots")).toHaveCount(0);

    // The recruiter is the header, not a second context card — its old detail is gone.
    await expect(detail.getByText(/Hiring for/)).toHaveCount(0);
    await expect(detail.getByText(/Sent for your listing/)).toHaveCount(0);
  });

  test("recruiter mode shows received applications: counterparty header, job context card, and clears stale detail", async ({
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
    await expect(rows.filter({ hasText: "Received application" })).toHaveCount(6);
    await expect(rows.filter({ hasText: "Sent hiring request" })).toHaveCount(5);

    const detail = page.getByTestId("applications-detail");
    await expect(detail.getByText("Shorts editing package — 15 shorts per month")).toHaveCount(0);

    await rows.filter({ hasText: "Aarav Mehta" }).click();
    // Header answers "who am I talking to?" — the applicant — and links to their profile.
    await expect(detail.getByRole("heading", { name: "Aarav Mehta" })).toBeVisible();
    await expect(detail.locator('a[href^="/u/aarav-mehta"]').first()).toBeVisible();
    // Context card represents the job they applied to.
    await expect(
      detail.getByRole("heading", { name: /Long-form editor for weekly finance explainers/ })
    ).toBeVisible();
    await openOverflow(page);
    await expect(page.getByRole("menuitem", { name: "Shortlist" })).toBeVisible();
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
    await expect(composer).toHaveValue("");
    // The reply lands as a right-aligned ("me") chat bubble.
    await expect(
      detail.locator('[data-testid="chat-message"][data-from="me"]').filter({ hasText: /work samples/ })
    ).toBeVisible();
  });

  test("marking a received application not selected uses confirmation and closes actions", async ({ page }) => {
    await openApplicationsTab(page);
    await page.getByRole("button", { name: "Recruiter", exact: true }).click();
    await page.getByTestId("interaction-row").filter({ hasText: "Aarav Mehta" }).click();

    const detail = page.getByTestId("applications-detail");
    await openOverflow(page);
    await page.getByRole("menuitem", { name: "Not selected", exact: true }).click();
    await expect(detail.getByText("Mark this application as not selected?")).toBeVisible();

    await detail.getByRole("button", { name: "Confirm not selected" }).click();
    await expect(detail.getByText("Declined", { exact: true })).toBeVisible();
    // Terminal outcome → no active workflow actions remain in the menu.
    await openOverflow(page);
    await expect(page.getByRole("menuitem", { name: "Shortlist privately" })).toHaveCount(0);
    await expect(page.getByRole("menuitem", { name: "Not selected", exact: true })).toHaveCount(0);
  });

  test("shortlisting a received application updates its status", async ({ page }) => {
    await openApplicationsTab(page);
    await page.getByRole("button", { name: "Recruiter", exact: true }).click();

    await page.getByTestId("interaction-row").filter({ hasText: "Aarav Mehta" }).click();

    const detail = page.getByTestId("applications-detail");
    await openOverflow(page);
    await page.getByRole("menuitem", { name: "Shortlist" }).click();
    await expect(detail.getByText("Shortlisted", { exact: true })).toBeVisible();
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

    await detail.getByRole("button", { name: "Applications" }).click();
    await expect(detail).not.toBeVisible();
    await expect(firstRow).toBeVisible();
  });

  test("conversation renders chat bubbles with sent-right / received-left alignment", async ({ page }) => {
    await openApplicationsTab(page);
    await page
      .getByTestId("interaction-row")
      .filter({ hasText: "Shorts editor for daily YouTube Shorts" })
      .click();

    const detail = page.getByTestId("applications-detail");

    // Opening application + recruiter response + two follow-up replies = 4 bubbles,
    // split evenly between the owner ("me") and the other party.
    await expect(detail.getByTestId("chat-message")).toHaveCount(4);
    await expect(detail.locator('[data-testid="chat-message"][data-from="me"]')).toHaveCount(2);
    await expect(detail.locator('[data-testid="chat-message"][data-from="other"]')).toHaveCount(2);

    // The job reference is a separate clickable row (a link), not a chat bubble.
    await expect(detail.locator('a[href^="/jobs/"]').first()).toBeVisible();
  });

  test("an answers-only hiring request renders a generated opening message, never a blank thread", async ({ page }) => {
    await openApplicationsTab(page);
    await page
      .getByTestId("interaction-row")
      .filter({ hasText: "Thumbnail + packaging help for gaming channel" })
      .click();

    // This request has no typed message — only structured first-message answers.
    // The inbox turns those into one real opening bubble from the requester
    // (fit note as the body, budget in the summary), never a blank thread.
    const detail = page.getByTestId("applications-detail");
    await expect(detail.getByTestId("chat-message")).toHaveCount(1);
    await expect(detail.locator('[data-testid="chat-message"][data-from="other"]')).toHaveCount(1);
    await expect(detail).toContainText("retention and packaging work");
    await expect(detail).toContainText("₹1,000 per month");
    await expect(detail.getByText("No messages yet.")).toHaveCount(0);
  });

  test("Applications filters are All/Sent/Received/Archived and no longer include Drafts", async ({ page }) => {
    await openApplicationsTab(page);
    await expect(page.getByTestId("applications-filter-all")).toBeVisible();
    await expect(page.getByTestId("applications-filter-sent")).toBeVisible();
    await expect(page.getByTestId("applications-filter-received")).toBeVisible();
    await expect(page.getByTestId("applications-filter-archived")).toBeVisible();
    // Drafts has moved out of Applications into its own parent tab.
    await expect(page.getByTestId("applications-filter-drafts")).toHaveCount(0);
  });

  test("Drafts is no longer a tab inside the /you profile", async ({ page }) => {
    await page.goto("/you");
    await expect(page.locator("body")).toContainText(/Demo Owner|You/);
    // The profile tab nav must not expose a Drafts tab anymore.
    await expect(page.getByRole("button", { name: "Drafts", exact: true })).toHaveCount(0);
  });
});
