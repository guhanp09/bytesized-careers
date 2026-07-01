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

// During React streaming SSR the production server briefly renders a hidden
// duplicate of the page content (a `<div hidden>` appended to <body>) which
// hydration then relocates and removes. While both copies exist, page-content
// locators (drafts-workspace, draft-row, draft-detail, the filters…) resolve to
// two elements, which breaks strict `toBeVisible`/`toHaveAttribute` and doubles
// `toHaveCount`. The real content is always DOM-first, so scoping every query to
// the first workspace keeps locators strict-safe and counts correct; Playwright's
// web-first assertions then auto-retry past the transient until the stream settles.
function draftsRoot(page: Page) {
  return page.getByTestId("drafts-workspace").first();
}

async function settleDrafts(page: Page) {
  await expect(draftsRoot(page)).toBeVisible({ timeout: 15_000 });
}

async function openDrafts(page: Page) {
  await page.goto("/drafts");
  await settleDrafts(page);
}

async function deleteSelectedDraft(page: Page) {
  const detail = draftsRoot(page).getByTestId("draft-detail");
  await detail.getByRole("button", { name: "Delete draft" }).click();
  const confirm = draftsRoot(page).getByTestId("draft-delete-confirm");
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
    await settleDrafts(page);
    // Active sidebar state is exposed via aria-current.
    await expect(page.getByRole("link", { name: "Drafts" })).toHaveAttribute("aria-current", "page");
  });

  test("legacy /you?tab=drafts redirects to /drafts", async ({ page }) => {
    await page.goto("/you?tab=drafts");
    await expect(page).toHaveURL(/\/drafts$/);
    await settleDrafts(page);
  });

  test("default view shows job listing drafts; talent filter shows talent drafts", async ({ page }) => {
    await openDrafts(page);
    const rows = draftsRoot(page).getByTestId("draft-row");

    // Job listings is the default filter.
    await expect(draftsRoot(page).getByTestId("drafts-filter-job")).toHaveAttribute("aria-selected", "true");
    await expect(rows).toHaveCount(5);
    await expect(rows.filter({ hasText: "Talent listing" })).toHaveCount(0);

    await draftsRoot(page).getByTestId("drafts-filter-talent").click();
    await expect(rows).toHaveCount(4);
    await expect(rows.filter({ hasText: "Job listing" })).toHaveCount(0);
  });

  test("layout cleanup removes the redundant page heading and list header labels", async ({ page }) => {
    await openDrafts(page);
    const workspace = draftsRoot(page);
    // No redundant page-level heading/description inside the content area.
    await expect(workspace.getByRole("heading", { name: "Drafts" })).toHaveCount(0);
    await expect(workspace.getByText("Resume unfinished job and talent listings.")).toHaveCount(0);
    // No redundant left-list header block / standalone sort label.
    await expect(workspace.getByText("Resume queue")).toHaveCount(0);
    // "Last saved" is row + detail metadata (paired with the listing-kind label), never
    // a standalone sort header: one per visible draft row plus the open detail pane.
    const rowCount = await workspace.getByTestId("draft-row").count();
    await expect(workspace.getByText(/Last saved/)).toHaveCount(rowCount + 1);
    // The two filters still drive selection via the tab pattern.
    await expect(draftsRoot(page).getByTestId("drafts-filter-job")).toHaveAttribute("aria-selected", "true");
    await expect(draftsRoot(page).getByTestId("drafts-filter-talent")).toHaveAttribute("aria-selected", "false");
  });

  test("Job/Talent filters live inside the left draft list panel, above the rows", async ({ page }) => {
    await openDrafts(page);
    const listPanel = draftsRoot(page).getByTestId("drafts-list-panel");
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
    await expect(draftsRoot(page).getByTestId("drafts-filter-talent")).toHaveAttribute("aria-selected", "true");
    await expect(draftsRoot(page).getByTestId("draft-row").filter({ hasText: "Job listing" })).toHaveCount(0);
  });

  test("clicking a job draft resumes the job listing flow with its draftId", async ({ page }) => {
    await openDrafts(page);
    const rows = draftsRoot(page).getByTestId("draft-row");
    await rows.filter({ hasText: "Channel manager for YouTube uploads" }).click();
    const detail = draftsRoot(page).getByTestId("draft-detail");
    await expect(detail.getByText(/Verification code wasn/)).toBeVisible();
    await detail.getByRole("button", { name: "Resume", exact: true }).click();
    await expect(page).toHaveURL(/\/post-job\?draftId=/);
  });

  test("clicking a talent draft resumes the talent listing flow with its draftId", async ({ page }) => {
    await openDrafts(page);
    await draftsRoot(page).getByTestId("drafts-filter-talent").click();
    const rows = draftsRoot(page).getByTestId("draft-row");
    await rows.first().click();
    const detail = draftsRoot(page).getByTestId("draft-detail");
    await detail.getByRole("button", { name: "Resume", exact: true }).click();
    await expect(page).toHaveURL(/\/post-talent\?draftId=/);
  });

  test("delete icon asks for confirmation, then removes the draft", async ({ page }) => {
    await openDrafts(page);
    const rows = draftsRoot(page).getByTestId("draft-row");
    const before = await rows.count();
    expect(before).toBeGreaterThan(1);

    await rows.first().click();
    const detail = draftsRoot(page).getByTestId("draft-detail");
    await expect(detail.getByRole("button", { name: "Resume", exact: true })).toBeVisible();
    await expect(detail.getByRole("button", { name: "Duplicate draft" })).toBeVisible();
    await expect(detail.getByRole("button", { name: "Delete draft" })).toBeVisible();

    await detail.getByRole("button", { name: "Delete draft" }).click();
    const confirm = draftsRoot(page).getByTestId("draft-delete-confirm");
    await expect(confirm).toBeVisible();
    await expect(rows).toHaveCount(before);

    await confirm.getByRole("button", { name: "Delete draft" }).click();
    await expect(rows).toHaveCount(before - 1);
  });

  test("duplicate icon creates and selects a copied draft in mock mode", async ({ page }) => {
    await openDrafts(page);
    const rows = draftsRoot(page).getByTestId("draft-row");
    const before = await rows.count();
    await rows.filter({ hasText: "Video editor for weekly finance explainers" }).click();

    const detail = draftsRoot(page).getByTestId("draft-detail");
    await detail.getByRole("button", { name: "Duplicate draft" }).click();

    await expect(rows).toHaveCount(before + 1);
    await expect(rows.first()).toContainText("Copy of Video editor for weekly finance explainers");
    await expect(detail.getByText("Copy of Video editor for weekly finance explainers")).toBeVisible();
  });

  test("empty state renders when a draft type has no drafts", async ({ page }) => {
    await openDrafts(page);
    await draftsRoot(page).getByTestId("drafts-filter-talent").click();
    const rows = draftsRoot(page).getByTestId("draft-row");

    // Delete every talent draft to reach the per-type empty state.
    for (let remaining = await rows.count(); remaining > 0; remaining -= 1) {
      await rows.first().click();
      await deleteSelectedDraft(page);
      await expect(rows).toHaveCount(remaining - 1);
    }

    await expect(draftsRoot(page).getByText("No talent drafts yet.")).toBeVisible();
    await expect(draftsRoot(page).getByRole("link", { name: "Create talent listing" })).toBeVisible();
  });

  test("resume queue rows show readiness and the next best action", async ({ page }) => {
    await openDrafts(page);
    const row = draftsRoot(page).getByTestId("draft-row").first();
    await expect(row).toContainText(/Ready \d+%/);
    await expect(row).toContainText(/Strong \d+%/);
    await expect(row).toContainText(/Next:|Improve next:/);
    await expect(row).not.toContainText(/Missing \d+ required|Ready to publish|Needs verification|Not started/);
  });

  test("completion workspace shows publish readiness and listing strength meters", async ({ page }) => {
    await openDrafts(page);
    await draftsRoot(page).getByTestId("draft-row").first().click();
    const detail = draftsRoot(page).getByTestId("draft-detail");
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
    await draftsRoot(page).getByTestId("draft-row").first().click();
    const detail = draftsRoot(page).getByTestId("draft-detail");
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
    await draftsRoot(page).getByTestId("draft-row").first().click();
    const detail = draftsRoot(page).getByTestId("draft-detail");
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
    await draftsRoot(page).getByTestId("draft-row").first().click();
    const workspace = draftsRoot(page);
    const box = await workspace.boundingBox();
    const viewport = page.viewportSize();
    // The workspace should consume most of the available height below the header,
    // rather than collapsing to a ~960px capped panel that floats in empty space.
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThan((viewport!.height - 56) * 0.85);
  });

  test("next best action appears below the completion to-do panels", async ({ page }) => {
    await openDrafts(page);
    await draftsRoot(page).getByTestId("draft-row").first().click();
    const detail = draftsRoot(page).getByTestId("draft-detail");
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
    const row = draftsRoot(page).getByTestId("draft-row").filter({ hasText: "Motion graphics editor for explainer channel" });
    await expect(row).toContainText(/Improve next: Add/);
  });

  test("a missing field exposes a Jump link that deep-links into the editor with a section", async ({ page }) => {
    await openDrafts(page);
    // The first job draft is missing required fields, so its next step jumps into the editor.
    await draftsRoot(page).getByTestId("draft-row").first().click();
    const detail = draftsRoot(page).getByTestId("draft-detail");
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
    await settleDrafts(page);
  });

  test("Save Draft redirect target (?type=&draftId=&saved=1) lands on the saved draft", async ({ page }) => {
    // Mirrors where post-job/post-talent Save Draft redirects after persisting.
    await page.goto("/drafts?type=talent&draftId=mock-talent-draft-ready&saved=1");
    await settleDrafts(page);
    // Lands with the Talent filter active and that draft selected in the detail pane.
    await expect(draftsRoot(page).getByTestId("drafts-filter-talent")).toHaveAttribute("aria-selected", "true");
    await expect(
      draftsRoot(page).getByTestId("draft-detail").getByText("Thumbnail designer for tech and finance channels")
    ).toBeVisible();
  });

  test("edit icon opens an inline title input, prefilled and focused, for a job draft", async ({ page }) => {
    await openDrafts(page);
    await draftsRoot(page)
      .getByTestId("draft-row")
      .filter({ hasText: "Video editor for weekly finance explainers" })
      .click();
    const detail = draftsRoot(page).getByTestId("draft-detail");
    await detail.getByTestId("draft-title-edit").click();
    const input = detail.getByTestId("draft-title-input");
    await expect(input).toBeVisible();
    await expect(input).toBeFocused();
    await expect(input).toHaveValue("Video editor for weekly finance explainers");
  });

  test("Enter saves a new job draft title in the header and the resume queue", async ({ page }) => {
    await openDrafts(page);
    const rows = draftsRoot(page).getByTestId("draft-row");
    await rows.filter({ hasText: "Video editor for weekly finance explainers" }).click();
    const detail = draftsRoot(page).getByTestId("draft-detail");
    await detail.getByTestId("draft-title-edit").click();
    const input = detail.getByTestId("draft-title-input");
    await input.fill("Senior video editor for finance explainers");
    await input.press("Enter");

    // Editor closes; the new title shows in the detail header and the queue row.
    await expect(detail.getByTestId("draft-title-input")).toHaveCount(0);
    await expect(
      detail.getByRole("heading", { name: "Senior video editor for finance explainers" })
    ).toBeVisible();
    await expect(rows.filter({ hasText: "Senior video editor for finance explainers" })).toHaveCount(1);
    await expect(rows.filter({ hasText: "Video editor for weekly finance explainers" })).toHaveCount(0);
  });

  test("an empty title is rejected and keeps the inline editor open", async ({ page }) => {
    await openDrafts(page);
    await draftsRoot(page).getByTestId("draft-row").first().click();
    const detail = draftsRoot(page).getByTestId("draft-detail");
    await detail.getByTestId("draft-title-edit").click();
    const input = detail.getByTestId("draft-title-input");
    await input.fill("");
    await input.press("Enter");
    await expect(detail.getByTestId("draft-title-error")).toBeVisible();
    await expect(input).toBeVisible();
  });

  test("Escape cancels inline title editing without changing the title", async ({ page }) => {
    await openDrafts(page);
    const rows = draftsRoot(page).getByTestId("draft-row");
    await rows.filter({ hasText: "Video editor for weekly finance explainers" }).click();
    const detail = draftsRoot(page).getByTestId("draft-detail");
    await detail.getByTestId("draft-title-edit").click();
    const input = detail.getByTestId("draft-title-input");
    await input.fill("Throwaway title");
    await input.press("Escape");
    await expect(detail.getByTestId("draft-title-input")).toHaveCount(0);
    await expect(
      detail.getByRole("heading", { name: "Video editor for weekly finance explainers" })
    ).toBeVisible();
    await expect(rows.filter({ hasText: "Throwaway title" })).toHaveCount(0);
  });

  test("inline editing an untitled talent draft completes the title task", async ({ page }) => {
    await openDrafts(page);
    await draftsRoot(page).getByTestId("drafts-filter-talent").click();
    const rows = draftsRoot(page).getByTestId("draft-row");
    await rows.filter({ hasText: "Untitled talent draft" }).click();
    const detail = draftsRoot(page).getByTestId("draft-detail");

    const required = detail.getByTestId("draft-required-list");
    await expect(required.locator("li", { hasText: "Add title" })).toHaveAttribute("data-complete", "false");

    await detail.getByTestId("draft-title-edit").click();
    const input = detail.getByTestId("draft-title-input");
    // Untitled draft → empty input (never the fallback wording).
    await expect(input).toHaveValue("");
    await input.fill("Voice over artist for explainer videos");
    await input.press("Enter");

    await expect(
      detail.getByRole("heading", { name: "Voice over artist for explainer videos" })
    ).toBeVisible();
    await expect(rows.filter({ hasText: "Voice over artist for explainer videos" })).toHaveCount(1);
    // Completion recomputed: the "Add title" required task is now done.
    await expect(required.locator("li", { hasText: "Add title" })).toHaveAttribute("data-complete", "true");
  });
});
