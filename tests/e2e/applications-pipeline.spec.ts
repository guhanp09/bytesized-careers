import { expect, test, type BrowserContext } from "@playwright/test";
import { encode } from "next-auth/jwt";

/**
 * Applicant pipeline management (backlog #17 + #21) in the /applications
 * workspace, exercised against the demo dataset (mock mode): stage-grouped
 * pipeline view, per-row stage moves, bulk actions, and private manager notes.
 */

// Matches NEXTAUTH_SECRET in the test:e2e:server script (same bootstrap as
// you-applications.spec.ts); local mocks keep the workspace on demo data.
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

async function openWorkspace(page: import("@playwright/test").Page) {
  await page.goto("/applications?demo=1", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("main").getByTestId("applications-workspace")).toBeVisible({ timeout: 15_000 });
}

async function openRecruiterPipeline(page: import("@playwright/test").Page) {
  await openWorkspace(page);
  const main = page.getByRole("main");
  const recruiterMode = main.getByRole("button", { name: "Recruiter", exact: true });
  await recruiterMode.click();
  await expect(recruiterMode).toHaveAttribute("aria-pressed", "true");
  await main.getByTestId("applications-view-pipeline").click();
  await expect(main.getByTestId("pipeline-board")).toBeVisible();
}

test.describe("applications pipeline view", () => {
  test.beforeEach(async ({ context }) => {
    await signInAsOwner(context);
  });

  test("inbox stays the default view; pipeline is opt-in and switches back", async ({ page }) => {
    await openWorkspace(page);
    const main = page.getByRole("main");
    // Default: inbox rows, no board.
    await expect(main.getByTestId("interaction-row").first()).toBeVisible();
    await expect(main.getByTestId("pipeline-board")).toHaveCount(0);

    await main.getByTestId("applications-view-pipeline").click();
    await expect(main.getByTestId("pipeline-board")).toBeVisible();
    await expect(main.getByTestId("interaction-row")).toHaveCount(0);

    await main.getByTestId("applications-view-inbox").click();
    await expect(main.getByTestId("interaction-row").first()).toBeVisible();
  });

  test("talent mode groups received hiring requests by stage with a full funnel strip", async ({ page }) => {
    await openWorkspace(page);
    const main = page.getByRole("main");
    await main.getByTestId("applications-view-pipeline").click();

    const board = main.getByTestId("pipeline-board");
    await expect(board).toBeVisible();
    // The funnel strip always shows every stage with its count — including zeros —
    // so empty stages never render as wasted section blocks.
    await expect(board.getByTestId("pipeline-stage-chip-new")).toContainText("2");
    await expect(board.getByTestId("pipeline-stage-chip-reviewing")).toContainText("0");
    await expect(board.getByTestId("pipeline-stage-chip-accepted")).toContainText("1");
    await expect(board.getByTestId("pipeline-group-reviewing")).toContainText("No one in reviewing yet.");
    // Sections stay visible even at zero, while populated stages still show their cards.
    await expect(board.getByTestId("pipeline-group-new").getByTestId("pipeline-row")).toHaveCount(2);
    await expect(board.getByTestId("pipeline-group-accepted").getByTestId("pipeline-row")).toHaveCount(1);
    await expect(board.getByTestId("pipeline-group-declined").getByTestId("pipeline-row")).toHaveCount(1);
  });

  test("a stage chip focuses the board on that stage and toggles back", async ({ page }) => {
    await openRecruiterPipeline(page);
    const board = page.getByTestId("pipeline-board");

    await board.getByTestId("pipeline-stage-chip-shortlisted").click();
    // Only the focused stage renders, even alongside other non-empty stages.
    await expect(board.getByTestId("pipeline-group-shortlisted")).toBeVisible();
    await expect(board.getByTestId("pipeline-group-new")).toHaveCount(0);
    await expect(board.getByTestId("pipeline-row")).toHaveCount(1);

    // Focusing an empty stage shows its quiet one-line state, not a large block.
    await board.getByTestId("pipeline-stage-chip-hired").click();
    await expect(board.getByTestId("pipeline-group-hired")).toContainText("No one in hired yet.");

    // Clicking the active chip returns to the full board.
    await board.getByTestId("pipeline-stage-chip-hired").click();
    await expect(board.getByTestId("pipeline-group-new")).toBeVisible();
  });

  test("workspace controls stay fixed in place across Inbox and Pipeline", async ({ page }) => {
    await openWorkspace(page);
    const main = page.getByRole("main");
    await expect(page.getByRole("button", { name: "Sample data" })).toBeVisible();

    const controlsBox = await main.getByTestId("applications-workspace-controls").boundingBox();
    const detailHeaderBox = await main.getByTestId("applications-detail-header").boundingBox();
    expect(controlsBox).not.toBeNull();
    expect(detailHeaderBox).not.toBeNull();
    expect(Math.abs((detailHeaderBox?.y ?? 0) - (controlsBox?.y ?? 0))).toBeLessThan(3);

    const viewToggle = main.getByTestId("applications-view-pipeline");
    const inboxBox = await viewToggle.boundingBox();

    await viewToggle.click();
    await expect(page.getByTestId("pipeline-board")).toBeVisible();
    const pipelineBox = await viewToggle.boundingBox();

    // Same control, same location — the user switches views inside one workspace.
    expect(pipelineBox).not.toBeNull();
    expect(Math.abs((pipelineBox?.x ?? 0) - (inboxBox?.x ?? 0))).toBeLessThan(2);
    expect(Math.abs((pipelineBox?.y ?? 0) - (inboxBox?.y ?? 0))).toBeLessThan(2);
    // The mode switch stays put too.
    await expect(main.getByRole("button", { name: "Recruiter", exact: true })).toBeVisible();
  });

  test("neither view introduces horizontal overflow", async ({ page }) => {
    await openWorkspace(page);
    const main = page.getByRole("main");
    const overflowOf = () =>
      page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(await overflowOf()).toBeLessThanOrEqual(1);

    await main.getByTestId("applications-view-pipeline").click();
    await expect(main.getByTestId("pipeline-board")).toBeVisible();
    expect(await overflowOf()).toBeLessThanOrEqual(1);
  });

  test("recruiter mode shows the applicant funnel with counts and the note indicator", async ({ page }) => {
    await openRecruiterPipeline(page);

    const board = page.getByTestId("pipeline-board");
    // 6 received applications in the demo set: 2 new, 1 shortlisted, 1 interviewing, 1 rejected, 1 archived.
    await expect(board.getByTestId("pipeline-group-new").getByTestId("pipeline-row")).toHaveCount(2);
    await expect(board.getByTestId("pipeline-group-shortlisted").getByTestId("pipeline-row")).toHaveCount(1);
    await expect(board.getByTestId("pipeline-group-interviewing").getByTestId("pipeline-row")).toHaveCount(1);
    await expect(board.getByTestId("pipeline-group-rejected").getByTestId("pipeline-row")).toHaveCount(1);
    // The shortlisted applicant carries a private note, surfaced as an indicator.
    await expect(
      board.getByTestId("pipeline-group-shortlisted").getByTestId("pipeline-note-indicator")
    ).toBeVisible();
  });

  test("a single applicant moves stages through the row menu", async ({ page }) => {
    await openRecruiterPipeline(page);
    const board = page.getByTestId("pipeline-board");

    const newGroup = board.getByTestId("pipeline-group-new");
    const aarav = newGroup.getByTestId("pipeline-row").filter({ hasText: "Aarav Mehta" });
    await expect(aarav).toHaveCount(1);

    await aarav.getByTestId("pipeline-stage-menu").click();
    await page.getByTestId("pipeline-stage-option-shortlisted").click();

    // Aarav leaves New and lands in Shortlisted (joining Mira).
    await expect(newGroup.getByTestId("pipeline-row").filter({ hasText: "Aarav Mehta" })).toHaveCount(0);
    await expect(
      board.getByTestId("pipeline-group-shortlisted").getByTestId("pipeline-row")
    ).toHaveCount(2);
  });

  test("bulk selection moves several applicants at once", async ({ page }) => {
    await openRecruiterPipeline(page);
    const board = page.getByTestId("pipeline-board");
    const newGroup = board.getByTestId("pipeline-group-new");

    // Select both new applicants via the group header checkbox.
    await newGroup.getByLabel("Select all in New").check();
    const bulkBar = page.getByTestId("bulk-action-bar");
    await expect(bulkBar).toBeVisible();
    await expect(bulkBar).toContainText("2 selected");

    await page.getByTestId("bulk-move-trigger").click();
    await page.getByTestId("bulk-move-reviewing").click();

    await expect(newGroup.getByTestId("pipeline-row")).toHaveCount(0);
    await expect(board.getByTestId("pipeline-group-reviewing").getByTestId("pipeline-row")).toHaveCount(2);
    // Selection clears after a successful move.
    await expect(bulkBar).toHaveCount(0);
  });

  test("pipeline search narrows rows; clearing restores them", async ({ page }) => {
    await openRecruiterPipeline(page);
    const board = page.getByTestId("pipeline-board");

    await board.getByTestId("pipeline-search").fill("Mira");
    await expect(board.getByTestId("pipeline-row")).toHaveCount(1);
    await expect(board.getByTestId("pipeline-row")).toContainText("Mira Shah");

    await board.getByTestId("pipeline-search").fill("");
    await expect(board.getByTestId("pipeline-row").first()).toBeVisible();
  });

  test("clicking a pipeline row opens the conversation in the chat dock, not the full inbox", async ({ page }) => {
    await openRecruiterPipeline(page);
    await page
      .getByTestId("pipeline-board")
      .getByTestId("pipeline-row")
      .filter({ hasText: "Mira Shah" })
      .click();

    // Opens the compact chatbox on that thread; the pipeline stays put behind it.
    const dock = page.getByTestId("chat-dock-panel");
    await expect(dock).toBeVisible();
    await expect(dock).toContainText("Mira Shah");
    await expect(page.getByTestId("pipeline-board")).toBeVisible();
  });

  test("the sent pipeline is read-only: stages visible, no checkboxes or stage menus", async ({ page }) => {
    await openWorkspace(page);
    const main = page.getByRole("main");
    await main.getByTestId("applications-view-pipeline").click();
    await main.getByTestId("pipeline-direction-sent").click();

    const board = main.getByTestId("pipeline-board");
    // Sent applications use applicant-facing labels (Pending/Viewed/…).
    await expect(board.getByTestId("pipeline-group-new")).toContainText("Pending");
    await expect(board.getByTestId("pipeline-group-reviewing")).toContainText("Viewed");
    await expect(board.getByTestId("pipeline-row").first()).toBeVisible();
    await expect(board.getByTestId("pipeline-row-checkbox")).toHaveCount(0);
    await expect(board.getByTestId("pipeline-stage-menu")).toHaveCount(0);
  });

  test("private notes save from the inbox detail rail and surface in the pipeline", async ({ page }) => {
    await openWorkspace(page);
    await page.getByRole("button", { name: "Recruiter", exact: true }).click();

    // Open the received application from Aarav (no note yet).
    await page.getByTestId("interaction-row").filter({ hasText: "Aarav Mehta" }).click();
    const noteCard = page.getByTestId("private-note-card");
    await expect(noteCard).toBeVisible();
    await expect(noteCard).toContainText("Only you can see this");

    await page.getByTestId("private-note-input").fill("Great retention instincts — schedule a test edit.");
    await page.getByTestId("private-note-save").click();
    await expect(noteCard).toContainText("Saved");

    // The note now shows as an indicator on Aarav's pipeline row.
    const main = page.getByRole("main");
    await main.getByTestId("applications-view-pipeline").click();
    const aarav = main.getByTestId("pipeline-row").filter({ hasText: "Aarav Mehta" });
    await expect(aarav.getByTestId("pipeline-note-indicator")).toBeVisible();
  });

  test("cards carry decision-making facts, snippet, and a clickable profile name", async ({ page }) => {
    await openRecruiterPipeline(page);
    const aarav = page
      .getByTestId("pipeline-group-new")
      .getByTestId("pipeline-row")
      .filter({ hasText: "Aarav Mehta" });

    // Structured rate + turnaround + portfolio count read straight off the card.
    await expect(aarav.getByTestId("pipeline-fact").first()).toContainText("₹2,500 per video");
    await expect(aarav.getByTestId("pipeline-fact").nth(1)).toContainText("4-day turnaround");
    await expect(aarav).toContainText("2 portfolio");
    // The teaser is the applicant's fit note (a structured requirement), not the
    // optional free-text message — consistent with the newer first-message model.
    await expect(aarav).toContainText("I already edit in your niche");
    await expect(aarav).not.toContainText("I came across the listing");
    // The name links to the applicant's public profile in a new tab.
    const profileLink = aarav.getByTestId("pipeline-profile-link");
    await expect(profileLink).toHaveAttribute("href", "/u/aarav-mehta?view=talent");
    await expect(profileLink).toHaveAttribute("target", "_blank");
  });

  test("hovering the first message shows the requirements the applicant answered", async ({ page }) => {
    await openRecruiterPipeline(page);
    const aarav = page
      .getByTestId("pipeline-group-new")
      .getByTestId("pipeline-row")
      .filter({ hasText: "Aarav Mehta" });
    const snippet = aarav.getByTestId("pipeline-snippet-trigger");

    await snippet.hover();
    const preview = page.getByTestId("pipeline-snippet-preview");
    await expect(preview).toBeVisible();
    // The listing owner's structured requirements as the applicant answered them —
    // the "first message" in the newer model — not the optional free-text note.
    await expect(preview).toContainText("First message");
    await expect(preview).toContainText("Portfolio");
    await expect(preview).toContainText("Turnaround");
    await expect(preview).toContainText("Fit note");
    await expect(preview).not.toContainText("I came across the listing");

    await page.keyboard.press("Escape");
    await expect(preview).toHaveCount(0);

    await snippet.focus();
    await expect(page.getByTestId("pipeline-snippet-preview")).toBeVisible();
    await snippet.blur();
    await expect(page.getByTestId("pipeline-snippet-preview")).toHaveCount(0);
  });

  test("the 'First message' affordance is a full-width hover target, not a tiny label", async ({ page }) => {
    await openRecruiterPipeline(page);
    // Rhea answered structured requirements but wrote no note → the card shows the
    // "First message" affordance instead of a teaser line.
    const rhea = page.getByTestId("pipeline-row").filter({ hasText: "Rhea Kapoor" }).first();
    const trigger = rhea.getByTestId("pipeline-snippet-trigger");
    await expect(trigger).toContainText("First message");

    // The hover target spans the row (a bare w-fit label was too small to hit).
    const triggerBox = await trigger.boundingBox();
    const cardBox = await rhea.boundingBox();
    expect(triggerBox && cardBox && triggerBox.width > cardBox.width * 0.6).toBeTruthy();

    // Hovering anywhere on that row reveals the requirements.
    await trigger.hover();
    const preview = page.getByTestId("pipeline-snippet-preview");
    await expect(preview).toBeVisible();
    await expect(preview).toContainText("Turnaround");
  });

  test("a card drags into another stage section and the funnel updates", async ({ page }) => {
    await openRecruiterPipeline(page);
    const board = page.getByTestId("pipeline-board");
    const aarav = board
      .getByTestId("pipeline-group-new")
      .getByTestId("pipeline-row")
      .filter({ hasText: "Aarav Mehta" });
    const shortlistedGroup = board.getByTestId("pipeline-group-shortlisted");

    // Native HTML5 drag events with a shared DataTransfer (the documented
    // Playwright pattern for draggable elements).
    const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
    await aarav.dispatchEvent("dragstart", { dataTransfer });
    await shortlistedGroup.dispatchEvent("dragover", { dataTransfer });
    // The hovered section confirms it's a drop target.
    await expect(shortlistedGroup).toContainText("Drop to move");
    // Drop commits the move and resets the drag state (no dragend needed —
    // the card has already re-rendered inside its new section).
    await shortlistedGroup.dispatchEvent("drop", { dataTransfer });

    await expect(
      board.getByTestId("pipeline-group-new").getByTestId("pipeline-row").filter({ hasText: "Aarav Mehta" })
    ).toHaveCount(0);
    await expect(shortlistedGroup.getByTestId("pipeline-row")).toHaveCount(2);
    await expect(board.getByTestId("pipeline-stage-chip-shortlisted")).toContainText("2");
  });

  test("dropping on a funnel chip moves the card — empty stages stay reachable", async ({ page }) => {
    await openRecruiterPipeline(page);
    const board = page.getByTestId("pipeline-board");
    const aarav = board.getByTestId("pipeline-row").filter({ hasText: "Aarav Mehta" });
    const hiredChip = board.getByTestId("pipeline-stage-chip-hired");

    const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
    await aarav.dispatchEvent("dragstart", { dataTransfer });
    await hiredChip.dispatchEvent("dragover", { dataTransfer });
    await hiredChip.dispatchEvent("drop", { dataTransfer });
    const confirmation = page.getByRole("dialog", { name: "Hire this candidate?" });
    await expect(confirmation).toBeVisible();
    await confirmation.getByRole("button", { name: "Confirm hire" }).click();

    await expect(hiredChip).toContainText("1");
    await expect(board.getByTestId("pipeline-group-hired").getByTestId("pipeline-row")).toHaveCount(1);
  });

  test("the message action opens the compact chat dock on that thread", async ({ page }) => {
    await openRecruiterPipeline(page);
    await page
      .getByTestId("pipeline-row")
      .filter({ hasText: "Aarav Mehta" })
      .getByTestId("pipeline-message")
      .click();

    const dock = page.getByTestId("chat-dock-panel");
    await expect(dock).toBeVisible();
    await expect(dock).toContainText("Aarav Mehta");
    // The pipeline stays open behind the dock — no screen switch.
    await expect(page.getByTestId("pipeline-board")).toBeVisible();
    // The opening thread now starts with a system event and a structured summary,
    // not a duplicated generated prose bubble.
    await expect(dock.getByTestId("chat-status-update").first()).toContainText("Aarav Mehta applied for");
    await expect(dock.locator('[data-testid="chat-message"]').first()).toContainText("Portfolio");
    await expect(dock.locator('[data-testid="chat-message"]').first()).toContainText("Retention rebuild");

    // Sending a demo reply appends it to the thread.
    await dock.getByTestId("chat-dock-composer").fill("Thanks — sharing a test brief shortly.");
    await dock.getByTestId("chat-dock-send").click();
    await expect(dock.locator('[data-testid="chat-message"]').last()).toContainText(
      "Thanks — sharing a test brief shortly."
    );
  });

  test("the chat dock minimizes to a launcher and reopens; back returns to the list", async ({ page }) => {
    await openRecruiterPipeline(page);
    await page
      .getByTestId("pipeline-row")
      .filter({ hasText: "Mira Shah" })
      .getByTestId("pipeline-message")
      .click();
    const dock = page.getByTestId("chat-dock-panel");
    await expect(dock).toContainText("Mira Shah");

    // Minimize → launcher pill; the sample-data chip coexists beside it.
    await dock.getByTestId("chat-dock-minimize").click();
    await expect(dock).toHaveCount(0);
    const launcher = page.getByTestId("chat-dock-launcher");
    await expect(launcher).toBeVisible();
    const launcherBox = await launcher.boundingBox();
    const chipBox = await page.getByRole("button", { name: "Sample data" }).boundingBox();
    expect(launcherBox && chipBox && chipBox.x + chipBox.width <= launcherBox.x + 1).toBeTruthy();

    // Reopen → same thread; back → compact inbox list with filters.
    await launcher.click();
    await expect(dock).toContainText("Mira Shah");
    await dock.getByTestId("chat-dock-back").click();
    await expect(dock).toContainText("Messages");
    await expect(dock.getByTestId("chat-dock-filter-received")).toBeVisible();
    await dock.getByTestId("chat-dock-filter-received").click();
    await expect(dock.getByTestId("chat-dock-thread-row").first()).toBeVisible();

    // A list row opens that conversation inside the dock.
    await dock.getByTestId("chat-dock-thread-row").filter({ hasText: "Dev Patel" }).click();
    await expect(dock).toContainText("Dev Patel");
  });

  test("sent items never show the private note card", async ({ page }) => {
    await openWorkspace(page);
    const main = page.getByRole("main");
    // Default talent mode; pick a sent application thread.
    await main.getByTestId("applications-filter-sent").click();
    await main.getByTestId("interaction-row").first().click();
    await expect(main.getByTestId("applications-detail")).toBeVisible();
    await expect(main.getByTestId("private-note-card")).toHaveCount(0);
  });

  test("direction tabs and inbox filters use workflow names per mode", async ({ page }) => {
    await openWorkspace(page);
    const main = page.getByRole("main");
    // Talent inbox: the direction filters name the workflows, received first.
    await expect(main.getByTestId("applications-filter-received")).toContainText("Hiring requests");
    await expect(main.getByTestId("applications-filter-sent")).toContainText("Applications");

    await main.getByTestId("applications-view-pipeline").click();
    await expect(main.getByTestId("pipeline-direction-received")).toContainText("Hiring requests");
    await expect(main.getByTestId("pipeline-direction-sent")).toContainText("Applications");

    // Recruiter mode renames both directions — and the Pipeline view survives
    // the mode switch instead of falling back to the Inbox.
    await main.getByRole("button", { name: "Recruiter", exact: true }).click();
    await expect(main.getByTestId("pipeline-board")).toBeVisible();
    await expect(main.getByTestId("pipeline-direction-received")).toContainText("Applicants");
    await expect(main.getByTestId("pipeline-direction-sent")).toContainText("Outreach");
  });

  test("the pipeline summary reads the board at a glance and tracks moves", async ({ page }) => {
    await openRecruiterPipeline(page);
    const summary = page.getByTestId("pipeline-summary");
    // 6 received applications: 2 new; interviewing is the furthest active stage.
    await expect(summary).toHaveText("6 applicants · 2 new · 1 interviewing");

    // Hiring someone advances the furthest-stage readout and publishes the
    // relationship outcome immediately; it does not ask a redundant question.
    const aarav = page
      .getByTestId("pipeline-group-new")
      .getByTestId("pipeline-row")
      .filter({ hasText: "Aarav Mehta" });
    await aarav.getByTestId("pipeline-stage-menu").click();
    await page.getByTestId("pipeline-stage-option-hired").click();
    const confirmation = page.getByRole("dialog", { name: "Hire this candidate?" });
    await expect(confirmation).toBeVisible();
    await confirmation.getByRole("button", { name: "Confirm hire" }).click();
    await expect(summary).toHaveText("6 applicants · 1 new · 1 hired");
    await expect(page.getByTestId("stage-notify-prompt")).toHaveCount(0);

    // Talent mode reads its own workflow.
    await page.getByRole("button", { name: "Talent", exact: true }).click();
    await expect(page.getByTestId("pipeline-summary")).toHaveText("4 hiring requests · 2 new · 1 accepted");
  });

  test("closed stages sit under a quiet divider, apart from the active funnel", async ({ page }) => {
    await openRecruiterPipeline(page);
    const board = page.getByTestId("pipeline-board");
    const divider = board.getByTestId("pipeline-closed-divider");
    await expect(divider).toBeVisible();
    await expect(divider).toContainText("Closed");

    // Active sections render above the divider; terminal ones below it.
    const newBox = await board.getByTestId("pipeline-group-new").boundingBox();
    const dividerBox = await divider.boundingBox();
    const rejectedBox = await board.getByTestId("pipeline-group-rejected").boundingBox();
    expect(newBox && dividerBox && newBox.y < dividerBox.y).toBeTruthy();
    expect(dividerBox && rejectedBox && dividerBox.y < rejectedBox.y).toBeTruthy();

    // Focusing a single stage drops the divider (nothing to separate).
    await board.getByTestId("pipeline-stage-chip-rejected").click();
    await expect(divider).toHaveCount(0);
  });

  test("the workspace shape persists across reloads and return visits", async ({ page }) => {
    await openRecruiterPipeline(page);
    await page.getByTestId("pipeline-direction-sent").click();

    // Reload: the URL carries the state. Scoping through main skips the
    // transient streamed duplicate outside it (strict mode fails fast on it).
    await page.reload();
    const main = page.getByRole("main");
    await expect(main.getByTestId("pipeline-board")).toBeVisible({ timeout: 15_000 });
    await expect(main.getByTestId("pipeline-direction-sent")).toHaveAttribute("aria-pressed", "true");
    await expect(main.getByTestId("pipeline-direction-received")).toContainText("Applicants");

    // A fresh visit with a bare URL: localStorage restores the last shape.
    await page.goto("/applications?demo=1");
    await expect(main.getByTestId("pipeline-board")).toBeVisible({ timeout: 15_000 });
    await expect(main.getByTestId("pipeline-direction-sent")).toHaveAttribute("aria-pressed", "true");
    await expect(main.getByTestId("pipeline-direction-received")).toContainText("Applicants");
  });

  test("leaving and returning reopens the same chat dock conversation", async ({ page }) => {
    await openRecruiterPipeline(page);
    await page
      .getByTestId("pipeline-row")
      .filter({ hasText: "Aarav Mehta" })
      .getByTestId("pipeline-message")
      .click();
    await expect(page.getByTestId("chat-dock-panel")).toContainText("Aarav Mehta");

    // Leave the workspace entirely, then return with a bare URL.
    await page.goto("/jobs", { waitUntil: "domcontentloaded" });
    await page.goto("/applications?demo=1", { waitUntil: "domcontentloaded" });

    // The dock is back on the same conversation, not the default list.
    const dock = page.getByTestId("chat-dock-panel");
    await expect(dock).toBeVisible({ timeout: 15_000 });
    await expect(dock).toContainText("Aarav Mehta");
  });

  test("leaving and returning restores the open inbox conversation", async ({ page }) => {
    await openWorkspace(page);
    const main = page.getByRole("main");
    await main.getByRole("button", { name: "Recruiter", exact: true }).click();
    // Select a non-first thread so restoring it is distinguishable from the default.
    await main.getByTestId("interaction-row").filter({ hasText: "Rhea Kapoor" }).first().click();
    await expect(main.getByTestId("applications-detail-header")).toContainText("Rhea Kapoor");

    await page.goto("/jobs", { waitUntil: "domcontentloaded" });
    await page.goto("/applications?demo=1", { waitUntil: "domcontentloaded" });

    // Back on Rhea's conversation, not the first thread in the list.
    await expect(main.getByTestId("applications-detail-header")).toContainText("Rhea Kapoor", {
      timeout: 15_000,
    });
  });

  test("deep links restore a specific pipeline state; legacy links keep working", async ({ page }) => {
    await page.goto("/applications?demo=1&view=pipeline&mode=recruiter&direction=received&stage=shortlisted");
    const main = page.getByRole("main");
    const board = main.getByTestId("pipeline-board");
    await expect(board).toBeVisible({ timeout: 15_000 });
    await expect(main.getByTestId("pipeline-direction-received")).toContainText("Applicants");
    // The linked stage arrives focused.
    await expect(board.getByTestId("pipeline-group-shortlisted")).toBeVisible();
    await expect(board.getByTestId("pipeline-group-new")).toHaveCount(0);

    // The legacy notification contract (?view=<mode>&thread=<id>) still opens
    // that conversation in the Inbox.
    await page.goto("/applications?demo=1&view=hiring&thread=r-app-recv-2");
    await expect(main.getByTestId("applications-detail")).toContainText("Mira Shah", {
      timeout: 15_000,
    });
  });

  test("internal moves stay quiet; meaningful moves ask before informing", async ({ page }) => {
    await openRecruiterPipeline(page);
    const board = page.getByTestId("pipeline-board");
    const aaravIn = (group: string) =>
      board.getByTestId(`pipeline-group-${group}`).getByTestId("pipeline-row").filter({ hasText: "Aarav Mehta" });

    // Reviewing is internal tracking — no prompt, nothing sent.
    await aaravIn("new").getByTestId("pipeline-stage-menu").click();
    await expect(page.getByTestId("pipeline-stage-menu-group-manage-privately")).toBeVisible();
    await expect(page.getByTestId("pipeline-stage-menu-group-share-a-decision")).toBeVisible();
    await page.getByTestId("pipeline-stage-option-reviewing").click();
    await expect(board.getByTestId("pipeline-group-reviewing")).toBeVisible();
    await expect(page.getByTestId("stage-notify-prompt")).toHaveCount(0);

    // Shortlisted is externally meaningful — the prompt shows the exact update.
    await aaravIn("reviewing").getByTestId("pipeline-stage-menu").click();
    await page.getByTestId("pipeline-stage-option-shortlisted").click();
    const prompt = page.getByTestId("stage-notify-prompt");
    await expect(prompt).toBeVisible();
    await expect(prompt).toContainText("Aarav Mehta");
    await expect(prompt).toContainText("moved to Shortlisted");
    await expect(prompt.getByTestId("stage-notify-preview")).toContainText("Shortlisted for");

    // Skip sends nothing: the thread carries no platform update.
    await prompt.getByTestId("stage-notify-skip").click();
    await expect(prompt).toHaveCount(0);
    await aaravIn("shortlisted").getByTestId("pipeline-message").click();
    const dock = page.getByTestId("chat-dock-panel");
    await expect(dock).toContainText("Aarav Mehta");
    // Skipping the stage notice adds no extra platform update; the only status
    // line is the application-created event.
    await expect(dock.getByTestId("chat-status-update")).toHaveCount(1);
    await expect(dock.getByTestId("chat-status-update").first()).toContainText("Aarav Mehta applied for");
  });

  test("a shared outcome posts a platform update and automatically opens the thread", async ({ page }) => {
    await openRecruiterPipeline(page);
    const board = page.getByTestId("pipeline-board");
    const aarav = board
      .getByTestId("pipeline-group-new")
      .getByTestId("pipeline-row")
      .filter({ hasText: "Aarav Mehta" });
    await aarav.getByTestId("pipeline-stage-menu").click();
    await page.getByTestId("pipeline-stage-option-interviewing").click();

    await expect(page.getByTestId("stage-notify-prompt")).toHaveCount(0);

    // Shared outcomes are automatic: the compact thread opens and the pipeline
    // stays put, without making the recruiter confirm the same decision twice.
    const dock = page.getByTestId("chat-dock-panel");
    await expect(dock).toContainText("Aarav Mehta");
    await expect(page.getByTestId("pipeline-board")).toBeVisible();
    await expect(dock.getByTestId("chat-status-update").last()).toContainText("Invited to interview");

    // A personal message continues in the same dock.
    await dock.getByTestId("chat-dock-composer").fill("Would Tuesday 4pm work for a quick call?");
    await dock.getByTestId("chat-dock-send").click();
    await expect(dock.locator('[data-testid="chat-message"]').last()).toContainText(
      "Would Tuesday 4pm work for a quick call?"
    );

    // The full Inbox thread shows the same status line.
    await dock.getByTestId("chat-dock-open-inbox").click();
    await expect(
      page.getByTestId("applications-detail").getByTestId("chat-status-update").last()
    ).toContainText("Invited to interview");
  });

  test("a bulk private outcome saves without prompting to contact everyone", async ({ page }) => {
    await openRecruiterPipeline(page);
    const board = page.getByTestId("pipeline-board");
    await board.getByTestId("pipeline-group-new").getByLabel("Select all in New").check();
    await page.getByTestId("bulk-move-trigger").click();
    await page.getByTestId("bulk-move-rejected").click();

    // Rejecting several people at once is consequential, so the board asks
    // first — the same deliberation the Inbox requires for a single rejection.
    const confirmation = page.getByRole("dialog", {
      name: /Mark \d+ applications as not selected\?/,
    });
    await expect(confirmation).toBeVisible();
    await confirmation.getByRole("button", { name: "Confirm not selected" }).click();

    // Saving privately must still never offer to contact everyone.
    await expect(page.getByTestId("stage-notify-prompt")).toHaveCount(0);
    await expect(board.getByTestId("pipeline-group-new").getByTestId("pipeline-row")).toHaveCount(0);
    await expect(board.getByTestId("pipeline-group-rejected").getByTestId("pipeline-row")).toHaveCount(3);
  });
});
