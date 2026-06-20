import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { encode } from "next-auth/jwt";

// Matches NEXTAUTH_SECRET in the test:e2e:server script. The backend is not
// running during e2e, so /drafts renders its offline shell with mock drafts.
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

async function openDrafts(page: Page) {
  await page.goto("/drafts");
  await expect(page.getByTestId("drafts-workspace")).toBeVisible({ timeout: 15_000 });
}

async function deleteSelectedDraft(page: Page) {
  const detail = page.getByTestId("draft-detail");
  await detail.getByRole("button", { name: "Delete draft" }).click();
  const confirm = page.getByTestId("draft-delete-confirm");
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Delete draft" }).click();
}

test.describe("Drafts standalone page", () => {
  test.beforeEach(async ({ context }) => {
    await signInAsOwner(context);
  });

  test("sidebar Drafts item opens the dedicated /drafts page and marks it active", async ({ page }) => {
    await page.goto("/you");
    await page.getByRole("link", { name: "Drafts" }).click();
    await expect(page).toHaveURL(/\/drafts$/);
    await expect(page.getByTestId("drafts-workspace")).toBeVisible({ timeout: 15_000 });
    // Active sidebar state is exposed via aria-current.
    await expect(page.getByRole("link", { name: "Drafts" })).toHaveAttribute("aria-current", "page");
  });

  test("legacy /you?tab=drafts redirects to /drafts", async ({ page }) => {
    await page.goto("/you?tab=drafts");
    await expect(page).toHaveURL(/\/drafts$/);
    await expect(page.getByTestId("drafts-workspace")).toBeVisible({ timeout: 15_000 });
  });

  test("default view shows job listing drafts; talent filter shows talent drafts", async ({ page }) => {
    await openDrafts(page);
    const rows = page.getByTestId("draft-row");

    // Job listings is the default filter.
    await expect(page.getByTestId("drafts-filter-job")).toHaveAttribute("aria-selected", "true");
    await expect(rows).toHaveCount(5);
    await expect(rows.filter({ hasText: "Talent listing" })).toHaveCount(0);

    await page.getByTestId("drafts-filter-talent").click();
    await expect(rows).toHaveCount(4);
    await expect(rows.filter({ hasText: "Job listing" })).toHaveCount(0);
  });

  test("layout cleanup removes the redundant page heading and list header labels", async ({ page }) => {
    await openDrafts(page);
    const workspace = page.getByTestId("drafts-workspace");
    // No redundant page-level heading/description inside the content area.
    await expect(workspace.getByRole("heading", { name: "Drafts" })).toHaveCount(0);
    await expect(workspace.getByText("Resume unfinished job and talent listings.")).toHaveCount(0);
    // No redundant left-list header block.
    await expect(workspace.getByText("Resume queue")).toHaveCount(0);
    // "Last saved" now only survives as detail-pane metadata, not as a list sort label.
    await expect(workspace.getByText(/Last saved/)).toHaveCount(1);
    // The two filters still drive selection via the tab pattern.
    await expect(page.getByTestId("drafts-filter-job")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("drafts-filter-talent")).toHaveAttribute("aria-selected", "false");
  });

  test("Job/Talent filters live inside the left draft list panel, above the rows", async ({ page }) => {
    await openDrafts(page);
    const listPanel = page.getByTestId("drafts-list-panel");
    // Both filter tabs are scoped within the left list column, not the page header.
    await expect(listPanel.getByTestId("drafts-filter-job")).toBeVisible();
    await expect(listPanel.getByTestId("drafts-filter-talent")).toBeVisible();
    // The filter row sits above the draft rows in the same column.
    const order = await listPanel.evaluate((root) => {
      const filter = root.querySelector("[data-testid='drafts-filter-job']");
      const firstRow = root.querySelector("[data-testid='draft-row']");
      return Boolean(
        filter &&
          firstRow &&
          filter.compareDocumentPosition(firstRow) & Node.DOCUMENT_POSITION_FOLLOWING
      );
    });
    expect(order).toBe(true);
    // Filters still switch the list contents from the list column.
    await listPanel.getByTestId("drafts-filter-talent").click();
    await expect(page.getByTestId("drafts-filter-talent")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("draft-row").filter({ hasText: "Job listing" })).toHaveCount(0);
  });

  test("clicking a job draft resumes the job listing flow with its draftId", async ({ page }) => {
    await openDrafts(page);
    const rows = page.getByTestId("draft-row");
    await rows.filter({ hasText: "Channel manager for YouTube uploads" }).click();
    const detail = page.getByTestId("draft-detail");
    await expect(detail.getByText(/Verification code wasn/)).toBeVisible();
    await detail.getByRole("button", { name: "Resume", exact: true }).click();
    await expect(page).toHaveURL(/\/post-job\?draftId=/);
  });

  test("clicking a talent draft resumes the talent listing flow with its draftId", async ({ page }) => {
    await openDrafts(page);
    await page.getByTestId("drafts-filter-talent").click();
    const rows = page.getByTestId("draft-row");
    await rows.first().click();
    const detail = page.getByTestId("draft-detail");
    await detail.getByRole("button", { name: "Resume", exact: true }).click();
    await expect(page).toHaveURL(/\/post-talent\?draftId=/);
  });

  test("delete icon asks for confirmation, then removes the draft", async ({ page }) => {
    await openDrafts(page);
    const rows = page.getByTestId("draft-row");
    const before = await rows.count();
    expect(before).toBeGreaterThan(1);

    await rows.first().click();
    const detail = page.getByTestId("draft-detail");
    await expect(detail.getByRole("button", { name: "Resume", exact: true })).toBeVisible();
    await expect(detail.getByRole("button", { name: "Duplicate draft" })).toBeVisible();
    await expect(detail.getByRole("button", { name: "Delete draft" })).toBeVisible();

    await detail.getByRole("button", { name: "Delete draft" }).click();
    const confirm = page.getByTestId("draft-delete-confirm");
    await expect(confirm).toBeVisible();
    await expect(rows).toHaveCount(before);

    await confirm.getByRole("button", { name: "Delete draft" }).click();
    await expect(rows).toHaveCount(before - 1);
  });

  test("duplicate icon creates and selects a copied draft in mock mode", async ({ page }) => {
    await openDrafts(page);
    const rows = page.getByTestId("draft-row");
    const before = await rows.count();
    await rows.filter({ hasText: "Video editor for weekly finance explainers" }).click();

    const detail = page.getByTestId("draft-detail");
    await detail.getByRole("button", { name: "Duplicate draft" }).click();

    await expect(rows).toHaveCount(before + 1);
    await expect(rows.first()).toContainText("Copy of Video editor for weekly finance explainers");
    await expect(detail.getByText("Copy of Video editor for weekly finance explainers")).toBeVisible();
  });

  test("empty state renders when a draft type has no drafts", async ({ page }) => {
    await openDrafts(page);
    await page.getByTestId("drafts-filter-talent").click();
    const rows = page.getByTestId("draft-row");

    // Delete every talent draft to reach the per-type empty state.
    for (let remaining = await rows.count(); remaining > 0; remaining -= 1) {
      await rows.first().click();
      await deleteSelectedDraft(page);
      await expect(rows).toHaveCount(remaining - 1);
    }

    await expect(page.getByText("No talent drafts yet.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Create talent listing" })).toBeVisible();
  });

  test("resume queue rows show readiness and the next best action", async ({ page }) => {
    await openDrafts(page);
    const row = page.getByTestId("draft-row").first();
    await expect(row).toContainText(/Ready \d+%/);
    await expect(row).toContainText(/Strong \d+%/);
    await expect(row).toContainText(/Next:|Improve next:/);
    await expect(row).not.toContainText(/Missing \d+ required|Ready to publish|Needs verification|Not started/);
  });

  test("completion workspace shows publish readiness and listing strength meters", async ({ page }) => {
    await openDrafts(page);
    await page.getByTestId("draft-row").first().click();
    const detail = page.getByTestId("draft-detail");
    await expect(detail.getByRole("progressbar", { name: "Publish readiness" })).toBeVisible();
    await expect(detail.getByRole("progressbar", { name: "Listing strength" })).toBeVisible();
    await expect(detail.getByText("Section checklist")).toHaveCount(0);
    await expect(detail.getByText("Key facts")).toHaveCount(0);
    await expect(detail.getByText("Required to publish")).toHaveCount(0);
    await expect(detail.getByText("Recommended to improve")).toHaveCount(0);
    await expect(detail.getByText(/\d+\s*\/\s*\d+\s+required/)).toHaveCount(0);
    await expect(detail.getByText(/\d+\s*\/\s*\d+\s+recommended/)).toHaveCount(0);
    await expect(detail.getByText(/Add \d+ required detail/)).toHaveCount(0);
  });

  test("required and recommended to-do lists are visible and actionable", async ({ page }) => {
    await openDrafts(page);
    await page.getByTestId("draft-row").first().click();
    const detail = page.getByTestId("draft-detail");
    const required = detail.getByTestId("draft-required-list");
    const recommended = detail.getByTestId("draft-recommended-list");
    await expect(required).toBeVisible();
    await expect(recommended).toBeVisible();
    await expect(required.locator("li[data-complete='true']").first()).toBeVisible();
    await expect(required.getByRole("link", { name: /^Add |^Verify / }).first()).toBeVisible();
    await expect(required.getByRole("link", { name: "Add about the brand" })).toBeVisible();
    await expect(detail.getByText("Listing context")).toHaveCount(0);
    await expect(recommended.getByRole("link", { name: /^Add |^Attach |^Describe / }).first()).toBeVisible();
    await expect(detail.getByTestId("draft-disclosure")).toHaveCount(0);
  });

  test("the completion workspace renders the rotating tip strip with a Learn more link", async ({ page }) => {
    await openDrafts(page);
    await page.getByTestId("draft-row").first().click();
    const detail = page.getByTestId("draft-detail");
    const tip = detail.getByTestId("draft-tip");
    await expect(tip).toBeVisible();
    // The full current tip is always present in the DOM (live region + height reserve),
    // even while the visible text types in — so this is timing-independent.
    await expect(tip.getByText(/reduce back-and-forth/).first()).toBeAttached();
    await expect(tip.getByRole("link", { name: "Learn more" })).toHaveAttribute("href", "/support");
  });

  test("the active drafts workspace fills the viewport height (not a short floating panel)", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openDrafts(page);
    await page.getByTestId("draft-row").first().click();
    const workspace = page.getByTestId("drafts-workspace");
    const box = await workspace.boundingBox();
    const viewport = page.viewportSize();
    // The workspace should consume most of the available height below the header,
    // rather than collapsing to a ~960px capped panel that floats in empty space.
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThan((viewport!.height - 56) * 0.85);
  });

  test("next best action appears below the completion to-do panels", async ({ page }) => {
    await openDrafts(page);
    await page.getByTestId("draft-row").first().click();
    const detail = page.getByTestId("draft-detail");
    const order = await detail.evaluate((root) => {
      const required = root.querySelector("[data-testid='draft-required-list']");
      const recommended = root.querySelector("[data-testid='draft-recommended-list']");
      const next = root.querySelector("[data-testid='draft-next-action']");
      return Boolean(
        required &&
          recommended &&
          next &&
          (required.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING) &&
          (recommended.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING)
      );
    });
    expect(order).toBe(true);
  });

  test("publish-ready drafts use Improve next in the resume queue", async ({ page }) => {
    await openDrafts(page);
    const row = page.getByTestId("draft-row").filter({ hasText: "Motion graphics editor for explainer channel" });
    await expect(row).toContainText(/Improve next: Add/);
  });

  test("a missing field exposes a Jump link that deep-links into the editor with a section", async ({ page }) => {
    await openDrafts(page);
    // The first job draft is missing required fields, so its next step jumps into the editor.
    await page.getByTestId("draft-row").first().click();
    const detail = page.getByTestId("draft-detail");
    const jump = detail.getByTestId("draft-required-list").getByRole("link", { name: /^Add |^Verify / }).first();
    await expect(jump).toBeVisible();
    await jump.click();
    await expect(page).toHaveURL(/\/post-(job|talent)\?draftId=[^&]+&section=/);
  });

  test("the /you profile page still works and has no Drafts tab", async ({ page }) => {
    await page.goto("/you");
    await expect(page.locator("body")).toContainText(/Demo Owner|You/);
    await expect(page.getByRole("button", { name: "Drafts", exact: true })).toHaveCount(0);
  });

  test("legacy /activity?tab=drafts redirects to the dedicated /drafts page", async ({ page }) => {
    await page.goto("/activity?tab=drafts");
    await expect(page).toHaveURL(/\/drafts$/);
    await expect(page.getByTestId("drafts-workspace")).toBeVisible({ timeout: 15_000 });
  });

  test("Save Draft redirect target (?type=&draftId=&saved=1) lands on the saved draft", async ({ page }) => {
    // Mirrors where post-job/post-talent Save Draft redirects after persisting.
    await page.goto("/drafts?type=talent&draftId=mock-talent-draft-ready&saved=1");
    await expect(page.getByTestId("drafts-workspace")).toBeVisible({ timeout: 15_000 });
    // Lands with the Talent filter active and that draft selected in the detail pane.
    await expect(page.getByTestId("drafts-filter-talent")).toHaveAttribute("aria-selected", "true");
    await expect(
      page.getByTestId("draft-detail").getByText("Thumbnail designer for tech and finance channels")
    ).toBeVisible();
  });
});
