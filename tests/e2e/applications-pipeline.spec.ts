import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { encode } from "next-auth/jwt";
import { switchPersona } from "./workspacePersona";
import { anchor, card, manifest, row, type ScenarioName } from "./scenarioAnchors";

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

/**
 * The board's scenario.
 *
 * `recruiter` exists for exactly this: forty-two records with every stage
 * populated, private notes, stars and snoozes, across nineteen jobs. `default`
 * would work but is ten times the size for no extra coverage, and `busy` is for
 * the volume tests only.
 */
const BOARD: ScenarioName = "recruiter";

/*
  The records these specs act on, resolved from the generated index.

  Named by the stage they demonstrate rather than by a person, so a failure says
  which board position stopped working. The ids are deterministic UUID5s keyed by
  meaning, so they survive regeneration.
*/
const SUBJECT = anchor(BOARD, "stage new", { persona: "recruiter" });
const REVIEWED = anchor(BOARD, "stage reviewing", { persona: "recruiter" });
const INTERVIEWED = anchor(BOARD, "stage interviewing", { persona: "recruiter" });
const HIRED = anchor(BOARD, "stage hired", { persona: "recruiter" });
/** Answered the requirements, wrote no note — the "First message" affordance. */
const ANSWERS_ONLY = anchor(BOARD, "Answers only", { persona: "recruiter" });

/** How many records sit in a stage, from the manifest rather than from memory. */
function inStage(scenario: ScenarioName, stage: string, kind: "application" | "hiring_request") {
  return manifest(scenario).relationships.filter((rel) => rel.kind === kind && rel.stage === stage).length;
}

async function openWorkspace(page: Page, scenario: ScenarioName = BOARD) {
  // Always an explicit seed: a spec that inherited whichever scenario ran before
  // it would pass or fail on test order.
  await page.goto(`/applications?demo=1&seed=${scenario}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("main").getByTestId("applications-workspace")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("interaction-row").first()).toBeVisible({ timeout: 20_000 });
}

async function openRecruiterPipeline(page: Page, scenario: ScenarioName = BOARD) {
  // Enter the board through its canonical deep link. Opening Inbox first leaves
  // the selected application visibly open for the auto-review dwell threshold,
  // which correctly promotes it from New to Reviewing before these tests can
  // assert the untouched scenario counts. Inbox -> Pipeline navigation remains
  // covered separately; board tests need a board that still matches its manifest.
  await page.goto(
    `/applications?demo=1&seed=${scenario}&view=pipeline&mode=recruiter&direction=received`,
    { waitUntil: "domcontentloaded" }
  );
  const main = page.getByRole("main");
  await expect(main.getByTestId("applications-workspace")).toBeVisible({ timeout: 20_000 });
  await expect(main.getByTestId("pipeline-board")).toBeVisible();
  // The shell and an empty board render before the selected scenario manifest
  // arrives. Interact only after the seeded board has replaced that pending tree;
  // otherwise its remount can legitimately clear a scope selection mid-test.
  await expect(main.getByTestId("pipeline-row").first()).toBeVisible({ timeout: 20_000 });
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
    // `recruiter` rather than `talent` here, deliberately: `talent` populates
    // every talent-facing outcome, so it has no empty stage, and the compact
    // zero-height stage is half of what this test is about.
    await openWorkspace(page, "recruiter");
    const main = page.getByRole("main");
    await main.getByTestId("applications-view-pipeline").click();

    const board = main.getByTestId("pipeline-board");
    await expect(board).toBeVisible();
    const requestsIn = (stage: string) => inStage("recruiter", stage, "hiring_request");
    // The funnel strip always shows every stage with its count — including zeros —
    // so empty stages never render as wasted section blocks.
    // Every stage and its count, including zeros — now in the scope control
    // rather than in a chip row duplicating the section headings below it.
    const scope = board.getByTestId("pipeline-scope");
    await expect(scope).toContainText(`New (${requestsIn("new")})`);
    await expect(scope).toContainText(`Reviewing (${requestsIn("reviewing")})`);
    await expect(scope).toContainText(`Accepted (${requestsIn("accepted")})`);
    /*
      An empty stage is now one compact line — its name and its zero — rather
      than a card-height container holding a sentence. It stays visible and
      droppable; it simply stops standing between the reader and the work.
    */
    // An empty stage stays visible and droppable as one compact line.
    expect(requestsIn("reviewing")).toBe(0);
    const emptyStage = board.getByTestId("pipeline-group-reviewing");
    await expect(emptyStage).toContainText("Reviewing");
    await expect(emptyStage).toContainText("0");
    expect(await emptyStage.evaluate((node) => node.getBoundingClientRect().height)).toBeLessThan(80);
    // Sections stay visible even at zero, while populated stages still show their cards.
    for (const stage of ["new", "accepted", "declined"]) {
      await expect(board.getByTestId(`pipeline-group-${stage}`).getByTestId("pipeline-row")).toHaveCount(
        requestsIn(stage)
      );
    }
  });

  test("the scope control focuses one stage and returns to the full board", async ({ page }) => {
    await openRecruiterPipeline(page);
    const board = page.getByTestId("pipeline-board");
    const scope = board.getByTestId("pipeline-scope");

    await scope.selectOption("reviewing");
    // Only the focused stage renders, even alongside other non-empty stages.
    await expect(board.getByTestId("pipeline-group-reviewing")).toBeVisible();
    await expect(board.getByTestId("pipeline-group-new")).toHaveCount(0);
    await expect(board.getByTestId("pipeline-row")).toHaveCount(inStage(BOARD, "reviewing", "application"));

    // A focused stage with cards still renders them; the compact empty line is
    // covered by the funnel test above, and `recruiter` populates every stage.
    await scope.selectOption("hired");
    const hired = board.getByTestId("pipeline-group-hired");
    await expect(hired).toBeVisible();
    await expect(hired.getByTestId("pipeline-row")).toHaveCount(inStage(BOARD, "hired", "application"));

    await board.getByTestId("pipeline-scope-clear").click();
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
    await expect(main.getByTestId("workspace-persona")).toBeVisible();
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
    // Every stage in the funnel shows exactly the records the scenario puts there.
    for (const stage of ["new", "reviewing", "interviewing", "hired", "rejected", "withdrawn"]) {
      await expect(board.getByTestId(`pipeline-group-${stage}`).getByTestId("pipeline-row")).toHaveCount(
        inStage(BOARD, stage, "application")
      );
    }
    // A private note is surfaced as an indicator on the card that carries one.
    await expect(board.getByTestId("pipeline-note-indicator").first()).toBeVisible();
  });

  test("a single applicant moves stages through the row menu", async ({ page }) => {
    await openRecruiterPipeline(page);
    const board = page.getByTestId("pipeline-board");

    const newGroup = board.getByTestId("pipeline-group-new");
    // A named record from the index, not "the first card": the assertion is that
    // *this* applicant moved, which is only checkable if we know which one.
    const moving = anchor(BOARD, "stage new", { persona: "recruiter" });
    const movingCard = card(page, moving);
    await expect(movingCard).toHaveCount(1);

    await movingCard.getByTestId("pipeline-stage-menu").click();
    await page.getByTestId("pipeline-stage-option-reviewing").click();

    // It leaves New and lands in Reviewing, which grows by exactly one.
    await expect(newGroup.locator(`[data-record-id="${moving.recordId}"]`)).toHaveCount(0);
    await expect(
      board.getByTestId("pipeline-group-reviewing").locator(`[data-record-id="${moving.recordId}"]`)
    ).toHaveCount(1);
    await expect(
      board.getByTestId("pipeline-group-reviewing").getByTestId("pipeline-row")
    ).toHaveCount(inStage(BOARD, "reviewing", "application") + 1);
  });

  test("bulk selection moves several applicants at once", async ({ page }) => {
    await openRecruiterPipeline(page);
    const board = page.getByTestId("pipeline-board");
    const newGroup = board.getByTestId("pipeline-group-new");

    // Select every new applicant via the group header checkbox.
    const newCount = inStage(BOARD, "new", "application");
    const reviewingCount = inStage(BOARD, "reviewing", "application");
    await newGroup.getByLabel("Select all in New").check();
    const bulkBar = page.getByTestId("bulk-action-bar");
    await expect(bulkBar).toBeVisible();
    await expect(bulkBar).toContainText(`${newCount} selected`);

    await page.getByTestId("bulk-move-trigger").click();
    await page.getByTestId("bulk-move-reviewing").click();

    await expect(newGroup.getByTestId("pipeline-row")).toHaveCount(0);
    // They join the records already in Reviewing rather than replacing them.
    await expect(board.getByTestId("pipeline-group-reviewing").getByTestId("pipeline-row")).toHaveCount(
      reviewingCount + newCount
    );
    // Selection clears after a successful move.
    await expect(bulkBar).toHaveCount(0);
  });

  test("pipeline search narrows rows; clearing restores them", async ({ page }) => {
    await openRecruiterPipeline(page);
    const board = page.getByTestId("pipeline-board");

    const target = anchor(BOARD, "stage reviewing", { persona: "recruiter" });
    await board.getByTestId("pipeline-search").fill(target.counterpartyName);
    // Narrowed to the searched person: their card is there, and the board is no
    // longer showing the whole funnel.
    await expect(card(page, target)).toBeVisible();
    const narrowed = await board.getByTestId("pipeline-row").count();
    expect(narrowed).toBeGreaterThan(0);
    expect(narrowed).toBeLessThan(manifest(BOARD).relationships.length);

    await board.getByTestId("pipeline-search").fill("");
    await expect(board.getByTestId("pipeline-row").first()).toBeVisible();
    expect(await board.getByTestId("pipeline-row").count()).toBeGreaterThan(narrowed);
  });

  test("clicking a pipeline row opens the conversation in the chat dock, not the full inbox", async ({ page }) => {
    await openRecruiterPipeline(page);
    const target = anchor(BOARD, "stage reviewing", { persona: "recruiter" });
    // Deliberately offset. A pipeline card is not a button — it holds a profile
    // link, a checkbox, a stage menu and a Message button, all of which stop
    // propagation on purpose — so Playwright's default centre click lands on a
    // child and the row handler never runs. Clicking the card's own surface is
    // what "clicking the row" means, and it is the behaviour worth guarding:
    // the labelled Message button is already covered separately below.
    await card(page, target).click({ position: { x: 6, y: 6 } });

    // Opens the compact chatbox on that thread; the pipeline stays put behind it.
    const dock = page.getByTestId("chat-dock-panel");
    await expect(dock).toBeVisible();
    await expect(dock).toContainText(target.counterpartyName);
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
    await switchPersona(page, "hiring");

    // Open the received application from Aarav (no note yet).
    await row(page, SUBJECT).click();
    const noteCard = page.getByTestId("private-note-card");
    await expect(noteCard).toBeVisible();
    await expect(noteCard).toContainText("Only you can see this");

    await page.getByTestId("private-note-input").fill("Great retention instincts — schedule a test edit.");
    await page.getByTestId("private-note-save").click();
    await expect(noteCard).toContainText("Saved");

    // The note now shows as an indicator on Aarav's pipeline row.
    const main = page.getByRole("main");
    await main.getByTestId("applications-view-pipeline").click();
    const subject = card(page, SUBJECT);
    await expect(subject.getByTestId("pipeline-note-indicator")).toBeVisible();
  });

  test("cards carry decision-making facts, snippet, and a clickable profile name", async ({ page }) => {
    await openRecruiterPipeline(page);
    const subject = card(page, SUBJECT);

    // The card carries decision-making facts rather than a bare name: a rate and
    // a turnaround, both drawn from the job. Asserted structurally, because the
    // exact strings are the product's own formatters' business and duplicating
    // them here would be a second formatter in a test.
    await expect(subject.getByTestId("pipeline-fact").first()).toContainText(/₹|\$|€/);
    await expect(subject.getByTestId("pipeline-fact").nth(1)).toContainText(/turnaround|day|week/i);
    // The card shows the work itself, so the count is carried by the strip
    // rather than by a sentence about it, and matches what the record attached.
    const strip = subject.getByTestId("portfolio-strip");
    await expect(strip).toHaveAttribute("data-portfolio-count", String(SUBJECT.portfolioCount));
    await expect(strip.getByTestId("portfolio-lead")).toBeVisible();
    // The name links to the applicant's public profile in a new tab.
    const profileLink = subject.getByTestId("pipeline-profile-link");
    await expect(profileLink).toHaveAttribute("href", `/u/${SUBJECT.counterpartyUsername}?view=talent`);
    await expect(profileLink).toHaveAttribute("target", "_blank");
  });

  test("hovering the first message shows the requirements the applicant answered", async ({ page }) => {
    await openRecruiterPipeline(page);
    const subject = card(page, SUBJECT);
    const snippet = subject.getByTestId("pipeline-snippet-trigger");

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
    // This applicant answered the structured requirements and wrote no note, so
    // the card shows the "First message" affordance instead of a teaser line.
    const quiet = card(page, ANSWERS_ONLY);
    await quiet.scrollIntoViewIfNeeded();
    const trigger = quiet.getByTestId("pipeline-snippet-trigger");
    await expect(trigger).toContainText("First message");

    // The hover target spans the row (a bare w-fit label was too small to hit).
    const triggerBox = await trigger.boundingBox();
    const cardBox = await quiet.boundingBox();
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
    const subject = card(page, SUBJECT);
    const shortlistedGroup = board.getByTestId("pipeline-group-reviewing");

    // Native HTML5 drag events with a shared DataTransfer (the documented
    // Playwright pattern for draggable elements).
    const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
    await subject.dispatchEvent("dragstart", { dataTransfer });
    await shortlistedGroup.dispatchEvent("dragover", { dataTransfer });
    // The hovered section confirms it's a drop target.
    await expect(shortlistedGroup).toContainText("Drop to move");
    // Drop commits the move and resets the drag state (no dragend needed —
    // the card has already re-rendered inside its new section).
    await shortlistedGroup.dispatchEvent("drop", { dataTransfer });

    await expect(
      board.getByTestId("pipeline-group-new").locator(`[data-record-id="${SUBJECT.recordId}"]`)
    ).toHaveCount(0);
    const reviewingAfter = inStage(BOARD, "reviewing", "application") + 1;
    await expect(shortlistedGroup.getByTestId("pipeline-row")).toHaveCount(reviewingAfter);
    await expect(board.getByTestId("pipeline-scope")).toContainText(`Reviewing (${reviewingAfter})`);
  });

  test("an empty stage collapses but stays a valid drop target", async ({ page }) => {
    /*
      The funnel chip row is gone — it repeated the stage names and counts that
      the section headings already carry, and focusing moved to one compact
      scope control. The capability it provided is what matters: a collapsed,
      empty stage must still accept a card, or "empty stages stay reachable"
      becomes false the moment they stop taking full height.
    */
    // `talent` rather than `recruiter`: `recruiter` populates every application
    // stage, so it has no empty section to collapse. `talent` has no archived
    // application, which is the case this test needs.
    await openRecruiterPipeline(page, "talent");
    const board = page.getByTestId("pipeline-board");
    const mover = anchor("talent", "New · unread · portfolio attached", { persona: "recruiter" });
    const subject = card(page, mover);
    await subject.scrollIntoViewIfNeeded();
    expect(inStage("talent", "archived", "application")).toBe(0);
    const hiredSection = board.getByTestId("pipeline-group-archived");

    // Empty, and therefore compact — but present and droppable.
    await expect(hiredSection).toBeVisible();
    const collapsedHeight = await hiredSection.evaluate((node) => node.getBoundingClientRect().height);
    expect(collapsedHeight, "an empty stage should not occupy card height").toBeLessThan(80);

    const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
    await subject.dispatchEvent("dragstart", { dataTransfer });
    await hiredSection.dispatchEvent("dragover", { dataTransfer });
    await hiredSection.dispatchEvent("drop", { dataTransfer });
    // Archiving is a private, reversible move, so it commits without asking —
    // the confirmed moves are covered by the hire and decision tests.
    await expect(hiredSection.getByTestId("pipeline-row")).toHaveCount(1);
    // And the scope control's count follows, since both read one derivation.
    await expect(board.getByTestId("pipeline-scope")).toContainText("Archived (1)");
  });

  test("the scope control focuses one stage and offers the way back", async ({ page }) => {
    await openRecruiterPipeline(page);
    const board = page.getByTestId("pipeline-board");
    const scope = board.getByTestId("pipeline-scope");
    await expect(scope).toBeVisible();

    // No duplicated row of every stage and count.
    await expect(board.locator("[data-testid^='pipeline-stage-chip-']")).toHaveCount(0);

    const allSections = await board.locator("[data-testid^='pipeline-group-']").count();
    expect(allSections).toBeGreaterThan(1);

    await scope.selectOption("new");
    await expect(board.locator("[data-testid^='pipeline-group-']")).toHaveCount(1);

    await board.getByTestId("pipeline-scope-clear").click();
    await expect(board.locator("[data-testid^='pipeline-group-']")).toHaveCount(allSections);
  });

  test("the message action opens the compact chat dock on that thread", async ({ page }) => {
    await openRecruiterPipeline(page);
    await card(page, SUBJECT)
      .getByTestId("pipeline-message")
      .click();

    const dock = page.getByTestId("chat-dock-panel");
    await expect(dock).toBeVisible();
    await expect(dock).toContainText(SUBJECT.counterpartyName);
    // The pipeline stays open behind the dock — no screen switch.
    await expect(page.getByTestId("pipeline-board")).toBeVisible();
    // The opening thread now starts with a system event and a structured summary,
    // not a duplicated generated prose bubble.
    await expect(dock.getByTestId("chat-status-update").first()).toContainText(`${SUBJECT.counterpartyName} applied for`);
    await expect(dock.locator('[data-testid="chat-message"]').first()).toContainText("Portfolio");
    // This record's own attached work, read from the manifest. The title used
    // to be hardcoded, which made the assertion a statement about what the
    // generator happened to emit the day it was written.
    expect(SUBJECT.portfolioTitles.length, "the subject has no work attached").toBeGreaterThan(0);
    await expect(dock.locator('[data-testid="chat-message"]').first()).toContainText(
      SUBJECT.portfolioTitles[0]
    );

    // Sending a demo reply appends it to the thread.
    await dock.getByTestId("chat-dock-composer").fill("Thanks — sharing a test brief shortly.");
    await dock.getByTestId("chat-dock-send").click();
    await expect(dock.locator('[data-testid="chat-message"]').last()).toContainText(
      "Thanks — sharing a test brief shortly."
    );
  });

  test("the chat dock minimizes to a launcher and reopens; back returns to the list", async ({ page }) => {
    await openRecruiterPipeline(page);
    await card(page, REVIEWED)
      .getByTestId("pipeline-message")
      .click();
    const dock = page.getByTestId("chat-dock-panel");
    await expect(dock).toContainText(REVIEWED.counterpartyName);

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
    await expect(dock).toContainText(REVIEWED.counterpartyName);
    await dock.getByTestId("chat-dock-back").click();
    await expect(dock).toContainText("Messages");
    await expect(dock.getByTestId("chat-dock-filter-received")).toBeVisible();
    await dock.getByTestId("chat-dock-filter-received").click();
    await expect(dock.getByTestId("chat-dock-thread-row").first()).toBeVisible();

    // A list row opens that conversation inside the dock.
    await dock.getByTestId("chat-dock-thread-row").filter({ hasText: HIRED.counterpartyName }).first().click();
    await expect(dock).toContainText(HIRED.counterpartyName);
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
    await switchPersona(page, "hiring");
    await expect(main.getByTestId("pipeline-board")).toBeVisible();
    await expect(main.getByTestId("pipeline-direction-received")).toContainText("Applicants");
    await expect(main.getByTestId("pipeline-direction-sent")).toContainText("Outreach");
  });

  test("the pipeline summary reads the board at a glance and tracks moves", async ({ page }) => {
    await openRecruiterPipeline(page);
    const summary = page.getByTestId("pipeline-summary");
    // Read off the manifest: the total, how many are new, and the furthest
    // active stage the board has anyone in.
    const applications = manifest(BOARD).relationships.filter((rel) => rel.kind === "application").length;
    const newCount = inStage(BOARD, "new", "application");
    await expect(summary).toContainText(`${applications} applicants`);
    await expect(summary).toContainText(`${newCount} new`);

    // Hiring someone advances the furthest-stage readout and publishes the
    // relationship outcome immediately; it does not ask a redundant question.
    const subject = card(page, SUBJECT);
    await subject.getByTestId("pipeline-stage-menu").click();
    await page.getByTestId("pipeline-stage-option-hired").click();
    const confirmation = page.getByRole("dialog", { name: "Hire this candidate?" });
    await expect(confirmation).toBeVisible();
    await confirmation.getByRole("button", { name: "Confirm hire" }).click();
    // One fewer new, and the total is unchanged — a hire is a move, not a
    // removal.
    await expect(summary).toContainText(`${applications} applicants`);
    await expect(summary).toContainText(`${newCount - 1} new`);
    await expect(page.getByTestId("stage-notify-prompt")).toHaveCount(0);

    // Talent mode reads its own workflow, in its own vocabulary.
    await switchPersona(page, "talent");
    const requests = manifest(BOARD).relationships.filter((rel) => rel.kind !== "application").length;
    await expect(page.getByTestId("pipeline-summary")).toContainText(`${requests} hiring request`);
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
    await board.getByTestId("pipeline-scope").selectOption("rejected");
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
    await page.goto(`/applications?demo=1&seed=${BOARD}`);
    await expect(main.getByTestId("pipeline-board")).toBeVisible({ timeout: 15_000 });
    await expect(main.getByTestId("pipeline-direction-sent")).toHaveAttribute("aria-pressed", "true");
    await expect(main.getByTestId("pipeline-direction-received")).toContainText("Applicants");
  });

  test("leaving and returning reopens the same chat dock conversation", async ({ page }) => {
    await openRecruiterPipeline(page);
    await card(page, SUBJECT)
      .getByTestId("pipeline-message")
      .click();
    await expect(page.getByTestId("chat-dock-panel")).toContainText(SUBJECT.counterpartyName);

    // Leave the workspace entirely, then return with a bare URL.
    await page.goto("/jobs", { waitUntil: "domcontentloaded" });
    await page.goto(`/applications?demo=1&seed=${BOARD}`, { waitUntil: "domcontentloaded" });

    // The dock is back on the same conversation, not the default list.
    const dock = page.getByTestId("chat-dock-panel");
    await expect(dock).toBeVisible({ timeout: 15_000 });
    await expect(dock).toContainText(SUBJECT.counterpartyName);
  });

  test("leaving and returning restores the open inbox conversation", async ({ page }) => {
    await openWorkspace(page);
    const main = page.getByRole("main");
    await switchPersona(page, "hiring");
    // Select a non-first thread so restoring it is distinguishable from the default.
    await row(page, INTERVIEWED).click();
    await expect(main.getByTestId("applications-detail-header")).toContainText(INTERVIEWED.counterpartyName);

    await page.goto("/jobs", { waitUntil: "domcontentloaded" });
    await page.goto(`/applications?demo=1&seed=${BOARD}`, { waitUntil: "domcontentloaded" });

    // Back on Rhea's conversation, not the first thread in the list.
    await expect(main.getByTestId("applications-detail-header")).toContainText(INTERVIEWED.counterpartyName, {
      timeout: 15_000,
    });
  });

  test("deep links restore a specific pipeline state; legacy links keep working", async ({ page }) => {
    await page.goto(`/applications?demo=1&seed=${BOARD}&view=pipeline&mode=recruiter&direction=received&stage=reviewing`);
    const main = page.getByRole("main");
    const board = main.getByTestId("pipeline-board");
    await expect(board).toBeVisible({ timeout: 15_000 });
    await expect(main.getByTestId("pipeline-direction-received")).toContainText("Applicants");
    // The linked stage arrives focused.
    await expect(board.getByTestId("pipeline-group-reviewing")).toBeVisible();
    await expect(board.getByTestId("pipeline-group-new")).toHaveCount(0);

    // The legacy notification contract (?view=<mode>&thread=<id>) still opens
    // that conversation in the Inbox.
    await page.goto(`/applications?demo=1&seed=${BOARD}&view=hiring&thread=${REVIEWED.recordId}`);
    await expect(main.getByTestId("applications-detail")).toContainText(REVIEWED.counterpartyName, {
      timeout: 15_000,
    });
  });

  test("internal moves stay quiet; meaningful moves ask before informing", async ({ page }) => {
    await openRecruiterPipeline(page);
    const board = page.getByTestId("pipeline-board");
    const subjectIn = (group: string) =>
      board.getByTestId(`pipeline-group-${group}`).locator(`[data-record-id="${SUBJECT.recordId}"]`);

    // Reviewing is internal tracking — no prompt, nothing sent.
    await subjectIn("new").getByTestId("pipeline-stage-menu").click();
    await expect(page.getByTestId("pipeline-stage-menu-group-manage-privately")).toBeVisible();
    await expect(page.getByTestId("pipeline-stage-menu-group-share-a-decision")).toBeVisible();
    await page.getByTestId("pipeline-stage-option-reviewing").click();
    await expect(board.getByTestId("pipeline-group-reviewing")).toBeVisible();
    await expect(page.getByTestId("stage-notify-prompt")).toHaveCount(0);

    // "Not selected" is the remaining optional-shared outcome: recorded
    // privately, and the prompt offers to tell the applicant.
    await subjectIn("reviewing").getByTestId("pipeline-stage-menu").click();
    await page.getByTestId("pipeline-stage-option-rejected").click();
    const confirmation = page.getByRole("dialog", { name: /not selected/i });
    await expect(confirmation).toBeVisible();
    await confirmation.getByRole("button", { name: "Confirm not selected" }).click();

    const prompt = page.getByTestId("stage-notify-prompt");
    await expect(prompt).toBeVisible();
    await expect(prompt).toContainText(SUBJECT.counterpartyName);
    await expect(prompt.getByTestId("stage-notify-preview")).toContainText("Not moving forward");

    // Skip sends nothing: the thread carries no platform update.
    await prompt.getByTestId("stage-notify-skip").click();
    await expect(prompt).toHaveCount(0);
    await subjectIn("rejected").getByTestId("pipeline-message").click();
    const dock = page.getByTestId("chat-dock-panel");
    await expect(dock).toContainText(SUBJECT.counterpartyName);
    // Skipping the stage notice adds no extra platform update; the only status
    // line is the application-created event.
    await expect(dock.getByTestId("chat-status-update")).toHaveCount(1);
    await expect(dock.getByTestId("chat-status-update").first()).toContainText(`${SUBJECT.counterpartyName} applied for`);
  });

  test("a shared outcome posts a platform update and automatically opens the thread", async ({ page }) => {
    await openRecruiterPipeline(page);
    const board = page.getByTestId("pipeline-board");
    const subject = card(page, SUBJECT);
    await subject.getByTestId("pipeline-stage-menu").click();
    await page.getByTestId("pipeline-stage-option-interviewing").click();

    await expect(page.getByTestId("stage-notify-prompt")).toHaveCount(0);

    // Shared outcomes are automatic: the compact thread opens and the pipeline
    // stays put, without making the recruiter confirm the same decision twice.
    const dock = page.getByTestId("chat-dock-panel");
    await expect(dock).toContainText(SUBJECT.counterpartyName);
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
    await expect(board.getByTestId("pipeline-group-rejected").getByTestId("pipeline-row")).toHaveCount(
      inStage(BOARD, "rejected", "application") + inStage(BOARD, "new", "application")
    );
  });
});
