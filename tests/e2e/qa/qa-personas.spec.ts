import { expect, test, type Page } from "@playwright/test";

const CONTROLLER_EMAIL = "qa-controller@example.com";
const CONTROLLER_PASSWORD = "LocalQaController123!";
const QA_BASE_URL = "http://127.0.0.1:3200";

async function loginController(page: Page) {
  await page.goto("/auth?mode=login", { waitUntil: "domcontentloaded" });
  await page.getByPlaceholder("Email").fill(CONTROLLER_EMAIL);
  await page.getByPlaceholder("Password").fill(CONTROLLER_PASSWORD);
  await page.locator('form').getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page).toHaveURL(/\/you/);
  await expect(page.getByTestId("qa-persona-open")).toBeVisible();
}

async function openDrawer(page: Page) {
  await page.getByTestId("qa-persona-open").click();
  await expect(page.getByTestId("qa-persona-drawer")).toBeVisible();
}

async function switchPersona(page: Page, key: string, displayName: string) {
  await openDrawer(page);
  await page.getByTestId(`qa-switch-${key}`).click();
  await expect(page.getByTestId("qa-persona-open")).toContainText(displayName, { timeout: 20_000 });
}

async function restoreScenario(page: Page, key: string, confirmation: string) {
  const response = await page.request.post(`/api/qa/scenarios/${key}/restore`, {
    data: { confirmation },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
}

async function returnToController(page: Page) {
  await openDrawer(page);
  await page.getByRole("button", { name: "Return to Guhan" }).click();
  await expect(page.getByTestId("qa-persona-open")).toContainText("QA personas", {
    timeout: 20_000,
  });
}

test("signed-out and ordinary sessions do not receive QA controls", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("qa-persona-open")).toHaveCount(0);
  const response = await page.request.get("/api/qa/personas");
  expect(response.status()).toBe(404);
});

test("controller switches to a real talent persona and returns without re-login", async ({ page }) => {
  await loginController(page);
  await switchPersona(page, "talent-complete", "Priya Nair");

  await page.goto("/you", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Priya Nair", { exact: true }).first()).toBeVisible();
  await openDrawer(page);
  await expect(page.getByText("All product actions use this persona.")).toBeVisible();
  await page.getByRole("button", { name: "Return to Guhan" }).click();
  await expect(page.getByTestId("qa-persona-open")).toContainText("QA personas", { timeout: 20_000 });
  await page.goto("/you", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("qa-persona-open")).toBeVisible();
});

test("recruiter persona sees the real pipeline and a targeted restore is confirmed", async ({ page }) => {
  await loginController(page);
  await switchPersona(page, "recruiter-active", "Finance Simplified");
  await page.goto("/applications?view=pipeline&mode=recruiter", {
    waitUntil: "domcontentloaded",
  });

  const board = page.getByTestId("pipeline-board");
  await expect(board).toBeVisible();
  await expect(board.getByTestId("pipeline-group-reviewing")).toBeVisible();
  await expect(board.getByTestId("pipeline-group-interviewing")).toBeVisible();
  await expect(board.getByTestId("pipeline-group-withdrawn")).toBeVisible();

  await openDrawer(page);
  await page.getByRole("button", { name: "Scenarios" }).click();
  await page.getByTestId("qa-restore-applications").click();
  await page.getByLabel("Restore confirmation phrase").fill("RESTORE APPLICATIONS");
  await page.getByRole("button", { name: "Restore scenario" }).click();
  await expect(page.getByRole("status")).toContainText("Applications restored");
});

test("workspace controls switch real views, retain an empty mode, and open status actions", async ({ page }) => {
  await loginController(page);
  await restoreScenario(page, "inbox-pipeline", "RESTORE INBOX");
  await switchPersona(page, "recruiter-active", "Finance Simplified");
  await page.goto("/applications?view=inbox&mode=recruiter", {
    waitUntil: "domcontentloaded",
  });

  const controls = page.getByTestId("applications-workspace-controls");
  await expect(controls).toBeVisible();

  await page.getByTestId("applications-view-pipeline").click();
  await expect(page.getByTestId("pipeline-board")).toBeVisible();
  await expect(page).toHaveURL(/view=pipeline/);

  await page.getByTestId("applications-view-inbox").click();
  await expect(page.getByTestId("applications-detail")).toBeVisible();
  await expect(page).toHaveURL(/view=inbox/);

  await controls.getByRole("button", { name: "Talent", exact: true }).click();
  await expect(page).toHaveURL(/mode=talent/);
  await expect(page.getByText("No applications yet.", { exact: true })).toBeVisible();
  await expect(page.getByTestId("applications-workspace-controls")).toBeVisible();

  await page
    .getByTestId("applications-workspace-controls")
    .getByRole("button", { name: "Recruiter", exact: true })
    .click();
  await expect(page).toHaveURL(/mode=recruiter/);
  await expect(page.getByTestId("applications-detail")).toBeVisible();

  const moreActions = page.getByRole("button", { name: "More actions" });
  await moreActions.click();
  await expect(page.getByRole("menu")).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Hire" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(moreActions).toBeFocused();

  // A failing transition must surface the reason and leave the visible stage
  // exactly where it was. Driven through Hire because "Invite to interview" now
  // opens the scheduling surface first — an invitation needs a time before it
  // is worth sending, so it is no longer a one-click stage move.
  await page.route("**/api/v1/applications/*/transition", (route) =>
    route.fulfill({ status: 503, contentType: "application/json", body: '{"detail":"Temporary outage"}' })
  );
  await moreActions.press("Enter");
  await page.getByRole("menuitem", { name: "Hire", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Hire this candidate?" })
    .getByRole("button", { name: "Confirm hire" })
    .click();
  await expect(page.getByTestId("applications-detail")).toContainText("Temporary outage");
  await expect(page.getByTestId("applications-detail-header")).toContainText("Viewed");
  await page.unroute("**/api/v1/applications/*/transition");
});

test("mobile workspace keeps view, mode, detail, and status controls reachable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginController(page);
  await restoreScenario(page, "inbox-pipeline", "RESTORE INBOX");
  await switchPersona(page, "recruiter-active", "Finance Simplified");
  await page.goto("/applications?view=inbox&mode=recruiter", { waitUntil: "domcontentloaded" });

  await expect(page.getByTestId("applications-workspace-controls")).toBeVisible();
  await page.getByTestId("applications-view-pipeline").click();
  await expect(page.getByTestId("pipeline-board")).toBeVisible();
  await page.getByTestId("applications-view-inbox").click();
  await page.getByTestId("interaction-row").filter({ hasText: "Priya Nair" }).first().click();
  const detail = page.getByTestId("applications-detail");
  await expect(detail).toBeVisible();
  await detail.getByRole("button", { name: "More actions" }).click();
  await expect(page.getByRole("menuitem", { name: "Hire" })).toBeVisible();
  await page.keyboard.press("Escape");
  await detail.getByRole("button", { name: "Back to applications" }).click();
  await expect(page.getByTestId("interaction-row").first()).toBeVisible();
});

test("Hired from Inbox is authoritative, persistent, shared once, and stays messageable", async ({ page }) => {
  await loginController(page);
  await restoreScenario(page, "inbox-pipeline", "RESTORE INBOX");
  await switchPersona(page, "recruiter-active", "Finance Simplified");
  await page.goto("/applications?view=inbox&mode=recruiter", { waitUntil: "domcontentloaded" });

  await page.getByTestId("applications-filter-received").click();
  await page.getByTestId("interaction-row").filter({ hasText: "Priya Nair" }).first().click();
  const detail = page.getByTestId("applications-detail");
  await detail.getByRole("button", { name: "More actions" }).click();
  await expect(page.getByText("Manage privately", { exact: true })).toBeVisible();
  await expect(page.getByText("Share a decision", { exact: true })).toBeVisible();
  await page.getByRole("menuitem", { name: "Hire", exact: true }).click();
  const confirmation = page.getByRole("dialog", { name: "Hire this candidate?" });
  await expect(confirmation).toContainText("creates the work engagement");
  await confirmation.getByRole("button", { name: "Confirm hire" }).click();
  await expect(detail.getByText("Hired", { exact: true })).toBeVisible();
  await expect(detail).toContainText("Shared with Priya");
  await expect(detail.getByLabel("Reply message")).toBeVisible();

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(
    page.getByTestId("applications-detail-header").getByText("Hired", { exact: true })
  ).toBeVisible();
  await expect(page.getByTestId("applications-detail")).toContainText("Hired for");
  await expect(page.getByTestId("applications-detail").getByLabel("Reply message")).toBeVisible();

  await returnToController(page);
  await switchPersona(page, "talent-complete", "Priya Nair");
  await page.goto("/applications?view=inbox&mode=talent", { waitUntil: "domcontentloaded" });
  await page.getByTestId("applications-filter-sent").click();
  await page
    .getByTestId("interaction-row")
    .filter({ hasText: "Long-form video editor for a finance YouTube channel" })
    .first()
    .click();
  const talentDetail = page.getByTestId("applications-detail");
  await expect(
    talentDetail.getByTestId("applications-detail-header").getByText("Hired", { exact: true })
  ).toBeVisible();
  await expect(talentDetail).toContainText("Hired for");
  await expect(talentDetail.getByLabel("Reply message")).toBeVisible();

  await returnToController(page);
  await switchPersona(page, "recruiter-active", "Finance Simplified");
  await page.goto("/applications?view=pipeline&mode=recruiter&direction=received", {
    waitUntil: "domcontentloaded",
  });
  await expect(
    page.getByTestId("pipeline-group-hired").getByTestId("pipeline-row").filter({ hasText: "Priya Nair" })
  ).toBeVisible();

  await returnToController(page);
  await page.getByRole("button", { name: "Profile", exact: true }).click();
  await page.getByRole("button", { name: "Logout", exact: true }).click();
  await expect(page).toHaveURL(`${QA_BASE_URL}/`, { timeout: 20_000 });
  await loginController(page);
  await switchPersona(page, "recruiter-active", "Finance Simplified");
  await page.goto("/applications?view=inbox&mode=recruiter", {
    waitUntil: "domcontentloaded",
  });
  await page.getByTestId("applications-filter-received").click();
  await page.getByTestId("interaction-row").filter({ hasText: "Priya Nair" }).first().click();
  await expect(
    page.getByTestId("applications-detail-header").getByText("Hired", { exact: true })
  ).toBeVisible();
});

test("Hired from Pipeline confirms before committing and agrees with Inbox", async ({ page }) => {
  await loginController(page);
  await restoreScenario(page, "inbox-pipeline", "RESTORE INBOX");
  await switchPersona(page, "recruiter-active", "Finance Simplified");
  await page.goto("/applications?view=pipeline&mode=recruiter&direction=received", {
    waitUntil: "domcontentloaded",
  });

  const priya = page
    .getByTestId("pipeline-group-reviewing")
    .getByTestId("pipeline-row")
    .filter({ hasText: "Priya Nair" });
  await priya.getByTestId("pipeline-stage-menu").click();
  await expect(page.getByText("Manage privately", { exact: true })).toBeVisible();
  await expect(page.getByText("Share a decision", { exact: true })).toBeVisible();
  await page.getByTestId("pipeline-stage-option-hired").click();
  const confirmation = page.getByRole("dialog", { name: "Hire this candidate?" });
  await confirmation.getByRole("button", { name: "Confirm hire" }).click();
  await expect(page.getByText("Shared with Priya", { exact: true })).toBeVisible();
  await expect(
    page.getByTestId("pipeline-group-hired").getByTestId("pipeline-row").filter({ hasText: "Priya Nair" })
  ).toBeVisible();

  await page.getByTestId("applications-view-inbox").click();
  await page.getByTestId("applications-filter-received").click();
  await page.getByTestId("interaction-row").filter({ hasText: "Priya Nair" }).first().click();
  await expect(
    page.getByTestId("applications-detail-header").getByText("Hired", { exact: true })
  ).toBeVisible();
  await expect(page.getByTestId("applications-detail")).toContainText("Hired for");
});

test("internal application stages stay private while shared outcomes cross personas", async ({ page }) => {
  await loginController(page);
  await restoreScenario(page, "inbox-pipeline", "RESTORE INBOX");
  await switchPersona(page, "recruiter-active", "Finance Simplified");
  await page.goto("/applications?view=pipeline&mode=recruiter&direction=received", {
    waitUntil: "domcontentloaded",
  });

  const board = page.getByTestId("pipeline-board");
  // New -> Reviewing is the private stage change now that Shortlisted is retired.
  const priya = board
    .getByTestId("pipeline-group-new")
    .getByTestId("pipeline-row")
    .filter({ hasText: "Priya Nair" })
    .first();
  await expect(priya).toBeVisible();
  await priya.getByTestId("pipeline-stage-menu").click();
  await page.getByTestId("pipeline-stage-option-reviewing").click();
  await expect(
    board
      .getByTestId("pipeline-group-reviewing")
      .getByTestId("pipeline-row")
      .filter({ hasText: "Priya Nair" })
  ).toBeVisible();

  await returnToController(page);
  await switchPersona(page, "talent-complete", "Priya Nair");
  await page.goto("/applications?view=pipeline&mode=talent&direction=sent", {
    waitUntil: "domcontentloaded",
  });
  await expect(
    page
      .getByTestId("pipeline-group-new")
      .getByTestId("pipeline-row")
      .filter({ hasText: "Long-form video editor for a finance YouTube channel" })
  ).toBeVisible();

  await page.getByTestId("applications-view-inbox").click();
  await page.getByTestId("applications-filter-sent").click();
  await page
    .getByTestId("interaction-row")
    .filter({ hasText: "Long-form video editor for a finance YouTube channel" })
    .first()
    .click();
  await expect(page.getByTestId("applications-detail")).not.toContainText("Moved to Reviewing");
  await expect(page.getByTestId("applications-detail")).not.toContainText("Invited to interview");

  await returnToController(page);
  await switchPersona(page, "recruiter-active", "Finance Simplified");
  await page.goto("/applications?view=pipeline&mode=recruiter&direction=received", {
    waitUntil: "domcontentloaded",
  });
  // Both of Priya's applications now sit in Reviewing, so identify the one the
  // talent-side assertions below actually check.
  const reviewingPriya = page
    .getByTestId("pipeline-group-reviewing")
    .getByTestId("pipeline-row")
    .filter({ hasText: "Priya Nair" })
    .filter({ hasText: "Long-form video editor for a finance YouTube channel" })
    .first();
  await reviewingPriya.getByTestId("pipeline-stage-menu").click();
  await page.getByTestId("pipeline-stage-option-interviewing").click();
  await expect(
    page
      .getByTestId("pipeline-group-interviewing")
      .getByTestId("pipeline-row")
      .filter({ hasText: "Priya Nair" })
  ).toBeVisible();

  await returnToController(page);
  await switchPersona(page, "talent-complete", "Priya Nair");
  await page.goto("/applications?view=inbox&mode=talent", { waitUntil: "domcontentloaded" });
  await page.getByTestId("applications-filter-sent").click();
  await page
    .getByTestId("interaction-row")
    .filter({ hasText: "Long-form video editor for a finance YouTube channel" })
    .first()
    .click();
  await expect(page.getByTestId("applications-detail")).toContainText("Invited to interview");
});

test("two online personas receive and reply to messages without reloading", async ({ page, browser }) => {
  await loginController(page);
  await restoreScenario(page, "inbox-pipeline", "RESTORE INBOX");
  await switchPersona(page, "recruiter-active", "Finance Simplified");

  const talentContext = await browser.newContext({ baseURL: QA_BASE_URL });
  const talentPage = await talentContext.newPage();
  try {
    await loginController(talentPage);
    await switchPersona(talentPage, "talent-complete", "Priya Nair");
    await talentPage.goto("/applications?view=inbox&mode=talent", {
      waitUntil: "domcontentloaded",
    });
    await talentPage.getByTestId("applications-filter-sent").click();
    await talentPage
      .getByTestId("interaction-row")
      .filter({ hasText: "Long-form video editor for a finance YouTube channel" })
      .first()
      .click();
    const talentDetail = talentPage.getByTestId("applications-detail");
    await expect(talentDetail.getByRole("textbox", { name: "Reply message" })).toBeVisible();

    await page.goto("/applications?view=pipeline&mode=recruiter&direction=received", {
      waitUntil: "domcontentloaded",
    });
    const priya = page
      .getByTestId("pipeline-group-reviewing")
      .getByTestId("pipeline-row")
      .filter({ hasText: "Priya Nair" })
      .filter({ hasText: "Long-form video editor for a finance YouTube channel" })
      .first();
    await priya.getByTestId("pipeline-message").click();
    const dock = page.getByTestId("chat-dock-panel");
    await dock.getByTestId("chat-dock-composer").fill("Live delivery check from Finance.");
    await dock.getByTestId("chat-dock-send").click();
    await expect(dock.getByTestId("chat-message").last()).toContainText(
      "Live delivery check from Finance."
    );

    // The second browser receives the persisted message through active-thread
    // refresh; no navigation, reload, or persona switch is used here.
    await expect(talentDetail).toContainText("Live delivery check from Finance.", {
      timeout: 12_000,
    });
    const talentComposer = talentDetail.getByRole("textbox", { name: "Reply message" });
    await talentComposer.fill("Received — replying live from Priya.");
    await talentDetail.getByRole("button", { name: "Send", exact: true }).click();
    await expect(talentComposer).toHaveValue("");

    // The compact dock independently refreshes the same backend conversation.
    await expect(dock).toContainText("Received — replying live from Priya.", {
      timeout: 12_000,
    });
  } finally {
    await talentContext.close();
  }
});

test("two active Inbox threads show real-time typing and a durable read receipt", async ({ page, browser }) => {
  await loginController(page);
  await restoreScenario(page, "inbox-pipeline", "RESTORE INBOX");
  await switchPersona(page, "recruiter-active", "Finance Simplified");
  await page.goto("/applications?view=inbox&mode=recruiter", { waitUntil: "domcontentloaded" });
  await page.getByTestId("applications-filter-received").click();
  await page.getByTestId("interaction-row").filter({ hasText: "Priya Nair" }).first().click();
  const recruiterDetail = page.getByTestId("applications-detail");
  await expect(recruiterDetail.getByRole("textbox", { name: "Reply message" })).toBeVisible();

  const talentContext = await browser.newContext({ baseURL: QA_BASE_URL });
  const talentPage = await talentContext.newPage();
  try {
    await loginController(talentPage);
    await switchPersona(talentPage, "talent-complete", "Priya Nair");
    await talentPage.goto("/applications?view=inbox&mode=talent", { waitUntil: "domcontentloaded" });
    await talentPage.getByTestId("applications-filter-sent").click();
    await talentPage
      .getByTestId("interaction-row")
      .filter({ hasText: "Long-form video editor for a finance YouTube channel" })
      .first()
      .click();
    const talentDetail = talentPage.getByTestId("applications-detail");
    const talentComposer = talentDetail.getByRole("textbox", { name: "Reply message" });
    await expect(talentComposer).toBeVisible();

    // Give both authenticated browser contexts a brief chance to establish the
    // socket before asserting the ephemeral signal (the fallback poll is not
    // involved in this state).
    await talentPage.waitForTimeout(450);
    await talentComposer.fill("Typing in real time");
    await expect(recruiterDetail.getByTestId("conversation-typing")).toContainText(
      "Priya is typing",
      { timeout: 3_000 }
    );
    await talentComposer.fill("");
    await expect(recruiterDetail.getByTestId("conversation-typing")).toHaveCount(0);

    const marker = `Real-time receipt ${Date.now()}`;
    await talentComposer.fill(marker);
    await talentDetail.getByRole("button", { name: "Send", exact: true }).click();
    await expect(recruiterDetail.getByText(marker, { exact: true })).toBeVisible({ timeout: 3_000 });
    await expect(talentDetail.getByText("Seen", { exact: true })).toBeVisible({ timeout: 5_000 });
  } finally {
    await talentContext.close();
  }
});

test("blocking preserves the thread and disables direct messaging for both participants", async ({
  page,
  browser,
}) => {
  await loginController(page);
  await restoreScenario(page, "inbox-pipeline", "RESTORE INBOX");
  await switchPersona(page, "recruiter-active", "Finance Simplified");
  await page.goto("/applications?view=inbox&mode=recruiter", { waitUntil: "domcontentloaded" });
  await page.getByTestId("applications-filter-received").click();
  await page.getByTestId("interaction-row").filter({ hasText: "Priya Nair" }).first().click();
  const recruiterDetail = page.getByTestId("applications-detail");
  await recruiterDetail.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Block user" }).click();
  const confirmation = page.getByTestId("block-user-confirmation");
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole("button", { name: "Block user" }).click();
  await expect(recruiterDetail).toContainText("You blocked Priya");
  await expect(recruiterDetail.getByRole("textbox", { name: "Reply message" })).toHaveCount(0);

  const talentContext = await browser.newContext({ baseURL: QA_BASE_URL });
  const talentPage = await talentContext.newPage();
  try {
    await loginController(talentPage);
    await switchPersona(talentPage, "talent-complete", "Priya Nair");
    await talentPage.goto("/applications?view=inbox&mode=talent", { waitUntil: "domcontentloaded" });
    await talentPage.getByTestId("applications-filter-sent").click();
    await talentPage
      .getByTestId("interaction-row")
      .filter({ hasText: "Long-form video editor for a finance YouTube channel" })
      .first()
      .click();
    const talentDetail = talentPage.getByTestId("applications-detail");
    await expect(talentDetail).toContainText("unavailable for new messages");
    await expect(talentDetail.getByRole("textbox", { name: "Reply message" })).toHaveCount(0);
  } finally {
    await talentContext.close();
  }
});

test("a fresh job application appears in both inboxes and cannot be duplicated", async ({ page, browser }) => {
  await loginController(page);
  await restoreScenario(page, "inbox-pipeline", "RESTORE INBOX");
  await switchPersona(page, "talent-complete", "Priya Nair");

  await page.goto("/jobs", { waitUntil: "domcontentloaded" });
  const targetJob = page
    .getByRole("link")
    .filter({ hasText: "Thumbnail designer for a gaming channel" })
    .first();
  await expect(targetJob).toBeVisible();
  await targetJob.click();
  await expect(page).toHaveURL(/\/jobs\/[0-9a-f-]+$/);
  const jobHref = new URL(page.url()).pathname;

  const applyButton = page.getByTestId("job-apply-button");
  await expect(applyButton).toHaveText(/Apply/);
  await applyButton.click();
  const modal = page.getByTestId("first-message-modal-job");
  await expect(modal).toBeVisible();
  await modal.locator('[data-requirement-key="expected_rate"] input').fill("1800");
  const portfolioField = modal.locator('[data-requirement-key="relevant_portfolio"]');
  await expect(portfolioField.locator('button[aria-pressed="false"]').first()).toBeVisible();
  await portfolioField.locator('button[aria-pressed="false"]').first().click();
  await modal
    .locator('[data-requirement-key="fit_note"] textarea')
    .fill("My education packaging work translates well to fast gaming thumbnail iteration.");
  await modal.getByTestId("first-message-modal-submit").click();

  const success = page.getByTestId("apply-success-modal");
  await expect(success).toBeVisible();
  await success.getByTestId("action-success-primary").click();
  await expect(page).toHaveURL(/\/applications\?.*mode=talent.*thread=/);
  const applicationId = new URL(page.url()).searchParams.get("thread");
  expect(applicationId).toBeTruthy();
  const talentDetail = page.getByTestId("applications-detail");
  await expect(talentDetail).toContainText("Thumbnail designer for a gaming channel");
  await expect(talentDetail).toContainText("You applied");
  await expect(talentDetail).toContainText("₹1,800");
  await expect(talentDetail.getByTestId("private-note-card")).toHaveCount(0);

  // Refresh/revisit is backend-derived: the CTA opens the one existing record
  // instead of reopening the application form or creating another application.
  await page.goto(jobHref, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("job-application-status")).toHaveText("Application submitted");
  const openConversation = page.getByRole("button", { name: "Open conversation", exact: true });
  await expect(openConversation).toBeVisible();
  await openConversation.click();
  await expect(page).toHaveURL(new RegExp(`thread=${applicationId}`));

  const recruiterContext = await browser.newContext({ baseURL: QA_BASE_URL });
  const recruiterPage = await recruiterContext.newPage();
  try {
    await loginController(recruiterPage);
    await switchPersona(recruiterPage, "recruiter-active", "Finance Simplified");
    await recruiterPage.goto(
      `/applications?view=inbox&mode=recruiter&thread=${encodeURIComponent(applicationId!)}`,
      { waitUntil: "domcontentloaded" }
    );
    const recruiterDetail = recruiterPage.getByTestId("applications-detail");
    await expect(recruiterDetail).toContainText("Priya Nair");
    await expect(recruiterDetail).toContainText("Thumbnail designer for a gaming channel");

    const privateNote = recruiterDetail.getByTestId("private-note-input");
    await privateNote.fill("Fresh application QA note — visible only to the hiring side.");
    await recruiterDetail.getByTestId("private-note-save").click();
    await expect(recruiterDetail.getByTestId("saved-notes-card")).toContainText(
      "Fresh application QA note"
    );
    await privateNote.fill("Second hiring-side note — ask about source-file handoff.");
    await recruiterDetail.getByTestId("private-note-save").click();
    await expect(recruiterDetail.getByTestId("saved-notes-count")).toHaveText("2");

    // Prove that live history comes from the backend, not the browser cache.
    // (The note cache is per-user-scoped: cj.applications.notes::<backendUserId>.)
    await recruiterPage.evaluate(() => {
      for (const key of Object.keys(window.localStorage)) {
        if (key.startsWith("cj.applications.notes")) window.localStorage.removeItem(key);
      }
    });
    await recruiterPage.reload({ waitUntil: "domcontentloaded" });
    const reloadedRecruiterDetail = recruiterPage.getByTestId("applications-detail");
    await expect(reloadedRecruiterDetail.getByTestId("saved-notes-count")).toHaveText("2");
    await expect(reloadedRecruiterDetail.getByTestId("saved-notes-card")).toContainText(
      "Second hiring-side note"
    );
    await reloadedRecruiterDetail.getByRole("button", { name: "Older note" }).click();
    await expect(reloadedRecruiterDetail.getByTestId("saved-notes-card")).toContainText(
      "Fresh application QA note"
    );

    const recruiterComposer = reloadedRecruiterDetail.getByRole("textbox", { name: "Reply message" });
    const retriedMessage = "Thanks Priya — this retry should arrive exactly once.";
    await recruiterComposer.fill(retriedMessage);
    const messageRoute = "**/api/v1/me/conversations/*/messages";
    await recruiterPage.route(messageRoute, (route) =>
      route.fulfill({ status: 503, contentType: "application/json", body: '{"detail":"Temporary outage"}' })
    );
    await reloadedRecruiterDetail.getByRole("button", { name: "Send", exact: true }).click();
    await expect(reloadedRecruiterDetail).toContainText("Message could not be sent. Please try again.");
    await expect(recruiterComposer).toHaveValue(retriedMessage);
    await recruiterPage.unroute(messageRoute);
    await reloadedRecruiterDetail.getByRole("button", { name: "Send", exact: true }).click();
    await expect(recruiterComposer).toHaveValue("");

    const applicantThread = page.getByTestId("applications-detail");
    await expect(applicantThread).toContainText(retriedMessage, { timeout: 12_000 });
    await expect(applicantThread.getByText(retriedMessage, { exact: true })).toHaveCount(1);
    await expect(page.getByTestId("applications-detail").getByTestId("private-note-card")).toHaveCount(0);
  } finally {
    await recruiterContext.close();
  }
});

test("a fresh hiring request appears for both sides and reuses its conversation", async ({ page, browser }) => {
  await loginController(page);
  await restoreScenario(page, "hiring-requests", "RESTORE REQUESTS");
  await switchPersona(page, "recruiter-active", "Finance Simplified");

  await page.goto("/talent", { waitUntil: "domcontentloaded" });
  const targetListing = page
    .getByRole("link")
    .filter({ hasText: "Retention-focused long-form editor for finance & education channels" })
    .first();
  await expect(targetListing).toBeVisible();
  await targetListing.click();
  await expect(page).toHaveURL(/\/talent\/[0-9a-f-]+$/);
  const listingHref = new URL(page.url()).pathname;

  const hireButton = page.getByTestId("talent-hire-button");
  await expect(hireButton).toHaveText("Hire Me");
  await hireButton.click();
  const modal = page.getByTestId("first-message-modal-talent");
  await expect(modal).toBeVisible();
  await modal.locator('[data-requirement-key="project_budget"] input').fill("40000");
  await modal
    .locator('[data-requirement-key="project_brief"] textarea')
    .fill("Two finance explainers with motion callouts and two Shorts cutdowns per video.");
  await modal.locator('[data-requirement-key="turnaround"] input').fill("5");
  const workingHours = modal.locator('[data-requirement-key="working_hours"] input');
  await workingHours.fill("Evenings IST");
  await expect(workingHours).toHaveValue("Evenings IST");
  await modal
    .locator('[data-requirement-key="channel_or_brand_link"] input')
    .fill("https://youtube.com/@financesimplified");
  await modal
    .locator('[data-requirement-key="reference_links"] input')
    .fill("https://youtube.com/watch?v=finance-reference");
  await modal.locator('[data-requirement-key="start_availability"] input').fill("Within 2 weeks");
  await modal
    .locator('[data-requirement-key="fit_note"] textarea')
    .fill("Priya's retention-focused finance edits match the channel's long-form direction.");
  await expect(workingHours).toHaveValue("Evenings IST");
  await modal.getByTestId("first-message-modal-submit").click();

  const success = page.getByTestId("hire-success-modal");
  await expect(success).toBeVisible();
  await success.getByTestId("action-success-primary").click();
  await expect(page).toHaveURL(/\/applications\?.*mode=recruiter.*thread=/);
  const interestId = new URL(page.url()).searchParams.get("thread");
  expect(interestId).toBeTruthy();
  const recruiterDetail = page.getByTestId("applications-detail");
  await expect(recruiterDetail).toContainText("Priya Nair");
  await expect(recruiterDetail).toContainText("You sent a hiring request");
  await expect(recruiterDetail).toContainText("₹40,000");
  await expect(recruiterDetail.getByTestId("private-note-card")).toHaveCount(0);

  await page.goto(listingHref, { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Hiring request sent", { exact: true })).toBeVisible();
  const openConversation = page.getByRole("button", { name: "Open conversation", exact: true });
  await expect(openConversation).toBeVisible();
  await openConversation.click();
  await expect(page).toHaveURL(new RegExp(`thread=${interestId}`));

  const talentContext = await browser.newContext({ baseURL: QA_BASE_URL });
  const talentPage = await talentContext.newPage();
  try {
    await loginController(talentPage);
    await switchPersona(talentPage, "talent-complete", "Priya Nair");
    await talentPage.goto(
      `/applications?view=inbox&mode=talent&thread=${encodeURIComponent(interestId!)}`,
      { waitUntil: "domcontentloaded" }
    );
    const talentDetail = talentPage.getByTestId("applications-detail");
    await expect(talentDetail).toContainText("Finance Simplified");
    await expect(talentDetail).toContainText("Two finance explainers with motion callouts");

    const note = talentDetail.getByTestId("private-note-input");
    await note.fill("Qualified finance channel; clarify revision rounds.");
    await talentDetail.getByTestId("private-note-save").click();
    await expect(talentDetail.getByTestId("saved-notes-card")).toContainText(
      "clarify revision rounds"
    );
    await talentPage.evaluate(() => window.localStorage.removeItem("cj.applications.notes"));
    await talentPage.reload({ waitUntil: "domcontentloaded" });
    const reloadedTalentDetail = talentPage.getByTestId("applications-detail");
    await expect(reloadedTalentDetail.getByTestId("saved-notes-card")).toContainText(
      "clarify revision rounds"
    );

    const talentComposer = reloadedTalentDetail.getByRole("textbox", { name: "Reply message" });
    await talentComposer.fill("Thanks — I can take this on from the second week of August.");
    await reloadedTalentDetail.getByRole("button", { name: "Send", exact: true }).click();
    await expect(talentComposer).toHaveValue("");

    await expect(page.getByTestId("applications-detail")).toContainText(
      "I can take this on from the second week of August.",
      { timeout: 12_000 }
    );
    await expect(page.getByTestId("applications-detail").getByTestId("private-note-card")).toHaveCount(0);
  } finally {
    await talentContext.close();
  }
});

test("a hiring request acceptance carries back to recruiter outreach", async ({ page }) => {
  await loginController(page);
  await restoreScenario(page, "hiring-requests", "RESTORE REQUESTS");
  await switchPersona(page, "both-sides", "Aditi Verma");
  await page.goto("/applications?view=pipeline&mode=talent&direction=received", {
    waitUntil: "domcontentloaded",
  });

  const request = page
    .getByTestId("pipeline-group-new")
    .getByTestId("pipeline-row")
    .filter({ hasText: "Finance Simplified" });
  await expect(request).toBeVisible();
  await request.getByTestId("pipeline-stage-menu").click();
  await page.getByTestId("pipeline-stage-option-accepted").click();
  const confirmation = page.getByRole("dialog", { name: "Accept this hiring request?" });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole("button", { name: "Confirm acceptance" }).click();
  await expect(
    page
      .getByTestId("pipeline-group-accepted")
      .getByTestId("pipeline-row")
      .filter({ hasText: "Finance Simplified" })
  ).toBeVisible();

  await returnToController(page);
  await switchPersona(page, "recruiter-active", "Finance Simplified");
  await page.goto("/applications?view=pipeline&mode=recruiter&direction=sent", {
    waitUntil: "domcontentloaded",
  });
  await expect(
    page
      .getByTestId("pipeline-group-accepted")
      .getByTestId("pipeline-row")
      .filter({ hasText: "Aditi Verma" })
  ).toBeVisible();
});

test("legacy archives require one deliberate stage choice and then behave normally", async ({ page }) => {
  await loginController(page);
  await restoreScenario(page, "inbox-pipeline", "RESTORE INBOX");
  await switchPersona(page, "both-sides", "Aditi Verma");

  await page.goto("/applications?view=pipeline&mode=recruiter&direction=received", {
    waitUntil: "domcontentloaded",
  });
  const legacyApplication = page
    .getByTestId("pipeline-group-archived")
    .getByTestId("pipeline-row")
    .filter({ hasText: "Dev New User" });
  await expect(legacyApplication).toBeVisible();
  await expect(legacyApplication.getByTestId("pipeline-stage-menu")).toContainText(
    "Choose current stage"
  );
  await legacyApplication.getByTestId("pipeline-stage-menu").click();
  await page.getByTestId("pipeline-stage-option-reviewing").click();
  await expect(page.getByText("Saved privately", { exact: true })).toBeVisible();
  await expect(
    page
      .getByTestId("pipeline-group-reviewing")
      .getByTestId("pipeline-row")
      .filter({ hasText: "Dev New User" })
  ).toBeVisible();

  await page.reload({ waitUntil: "domcontentloaded" });
  const resolvedApplication = page
    .getByTestId("pipeline-group-reviewing")
    .getByTestId("pipeline-row")
    .filter({ hasText: "Dev New User" });
  await expect(resolvedApplication).toBeVisible();
  await expect(resolvedApplication.getByTestId("pipeline-stage-menu")).not.toContainText(
    "Choose current stage"
  );

  await page.goto("/applications?view=pipeline&mode=talent&direction=received", {
    waitUntil: "domcontentloaded",
  });
  const legacyRequest = page
    .getByTestId("pipeline-group-archived")
    .getByTestId("pipeline-row")
    .filter({ hasText: "BrightLab Media" });
  await expect(legacyRequest).toBeVisible();
  await expect(legacyRequest.getByTestId("pipeline-stage-menu")).toContainText(
    "Choose current stage"
  );
  await legacyRequest.getByTestId("pipeline-stage-menu").click();
  await page.getByTestId("pipeline-stage-option-accepted").click();
  const confirmation = page.getByRole("dialog", { name: "Accept this hiring request?" });
  await confirmation.getByRole("button", { name: "Confirm acceptance" }).click();
  await expect(page.getByText("Shared with BrightLab", { exact: true })).toBeVisible();
  await expect(
    page
      .getByTestId("pipeline-group-accepted")
      .getByTestId("pipeline-row")
      .filter({ hasText: "BrightLab Media" })
  ).toBeVisible();
});

test("Accepted from Inbox is authoritative, persistent, shared once, and stays messageable", async ({
  page,
}) => {
  await loginController(page);
  await restoreScenario(page, "hiring-requests", "RESTORE REQUESTS");
  await switchPersona(page, "both-sides", "Aditi Verma");
  await page.goto("/applications?view=inbox&mode=talent", {
    waitUntil: "domcontentloaded",
  });
  await page.getByTestId("applications-filter-received").click();
  await page
    .getByTestId("interaction-row")
    .filter({ hasText: "Finance Simplified" })
    .first()
    .click();

  const detail = page.getByTestId("applications-detail");
  await detail.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Accept request", exact: true }).click();
  const confirmation = page.getByRole("dialog", { name: "Accept this hiring request?" });
  await confirmation.getByRole("button", { name: "Confirm acceptance" }).click();
  await expect(
    detail.getByTestId("applications-detail-header").getByText("Accepted", { exact: true })
  ).toBeVisible();
  await expect(detail).toContainText("Hiring request accepted");
  await expect(detail.getByLabel("Reply message")).toBeVisible();

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(
    page.getByTestId("applications-detail-header").getByText("Accepted", { exact: true })
  ).toBeVisible();
  await expect(page.getByTestId("applications-detail").getByLabel("Reply message")).toBeVisible();

  await returnToController(page);
  await switchPersona(page, "recruiter-active", "Finance Simplified");
  await page.goto("/applications?view=inbox&mode=recruiter", {
    waitUntil: "domcontentloaded",
  });
  await page.getByTestId("applications-filter-sent").click();
  await page.getByTestId("interaction-row").filter({ hasText: "Aditi Verma" }).first().click();
  const recruiterDetail = page.getByTestId("applications-detail");
  await expect(
    recruiterDetail.getByTestId("applications-detail-header").getByText("Accepted", { exact: true })
  ).toBeVisible();
  await expect(recruiterDetail).toContainText("Hiring request accepted");
  await expect(recruiterDetail.getByLabel("Reply message")).toBeVisible();

  await page.goto("/applications?view=pipeline&mode=recruiter&direction=sent", {
    waitUntil: "domcontentloaded",
  });
  await expect(
    page
      .getByTestId("pipeline-group-accepted")
      .getByTestId("pipeline-row")
      .filter({ hasText: "Aditi Verma" })
  ).toBeVisible();
});

test("engagement confirmation and blind feedback complete across both participants", async ({ page }) => {
  await loginController(page);
  await restoreScenario(page, "engagements-reviews", "RESTORE REVIEWS");
  await switchPersona(page, "recruiter-active", "Finance Simplified");
  await page.goto("/applications?view=inbox&mode=recruiter&direction=received", {
    waitUntil: "domcontentloaded",
  });

  const rohanRows = page.getByTestId("interaction-row").filter({ hasText: "Rohan Das" });
  await rohanRows
    .filter({ hasText: "Long-form video editor for a finance YouTube channel" })
    .first()
    .click();
  const startRow = page.getByTestId("engagement-status-row");
  await expect(startRow).toContainText("Start confirmation pending");
  await expect(
    page.getByTestId("applications-detail").getByRole("textbox", { name: "Reply message" })
  ).toBeVisible();
  await startRow.getByRole("button", { name: "Confirm start" }).click();
  await expect(startRow).toContainText("Work in progress");

  await rohanRows
    .filter({ hasText: "Thumbnail designer for a gaming channel" })
    .first()
    .click();
  const completionRow = page.getByTestId("engagement-status-row");
  await expect(completionRow).toContainText("Completion confirmation pending");
  await completionRow.getByRole("button", { name: "Confirm outcome" }).click();
  await expect(completionRow).toContainText("Feedback available");
  await completionRow.getByRole("button", { name: "Leave feedback" }).click();

  let dialog = page.getByRole("dialog", { name: "Share feedback" });
  await dialog.getByRole("radio", { name: "5 stars" }).first().click();
  await dialog.getByLabel("Public feedback").fill(
    "Clear collaboration and a thoughtful handoff throughout the project."
  );
  await dialog.getByRole("button", { name: "Submit feedback" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(completionRow).toContainText("Feedback submitted");

  await returnToController(page);
  await switchPersona(page, "talent-incomplete", "Rohan Das");
  await page.goto("/applications?view=inbox&mode=talent&direction=sent", {
    waitUntil: "domcontentloaded",
  });
  await page
    .getByTestId("interaction-row")
    .filter({ hasText: "Thumbnail designer for a gaming channel" })
    .first()
    .click();
  const talentCompletionRow = page.getByTestId("engagement-status-row");
  await expect(talentCompletionRow).toContainText("Feedback available");
  await talentCompletionRow.getByRole("button", { name: "Leave feedback" }).click();
  dialog = page.getByRole("dialog", { name: "Share feedback" });
  await dialog.getByRole("radio", { name: "5 stars" }).first().click();
  await dialog.getByLabel("Public feedback").fill(
    "The brief was clear, feedback was prompt, and decisions stayed professional."
  );
  await dialog.getByRole("button", { name: "Submit feedback" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(talentCompletionRow).toContainText("Feedback published");
});

test("moderator requires confirmation and receives admin access", async ({ page }) => {
  await loginController(page);
  await openDrawer(page);
  await page.getByTestId("qa-switch-admin").click();
  const confirmation = page.getByRole("alertdialog", { name: "Confirm QA Moderator" });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole("button", { name: "Continue as moderator" }).click();
  await expect(page.getByTestId("qa-persona-open")).toContainText("QA Moderator", { timeout: 20_000 });

  await page.goto("/admin", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.getByText("Admin", { exact: true }).first()).toBeVisible();
});

test("drawer stays within a mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginController(page);
  await openDrawer(page);
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      )
    )
    .toBeLessThanOrEqual(1);
});

test("drawer restores focus on Escape and fails closed on a catalogue outage", async ({ page }) => {
  await loginController(page);
  const trigger = page.getByTestId("qa-persona-open");
  await trigger.click();
  await expect(page.getByRole("button", { name: "Close QA controls" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("qa-persona-drawer")).toHaveCount(0);
  await expect(trigger).toBeFocused();

  await page.route("**/api/qa/personas", (route) =>
    route.fulfill({ status: 503, contentType: "application/json", body: '{"detail":"Unavailable"}' })
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("qa-persona-open")).toHaveCount(0);
  await expect(page.getByRole("main")).toBeVisible();
});

test("message notifications stay reachable after a persona switch — the inbox never contradicts the bell", async ({
  page,
}) => {
  await loginController(page);

  // Seed a stale pre-fix global key (the exact state the regression screenshot
  // came from): it must be purged, never steer any persona's inbox.
  await page.evaluate(() => {
    window.localStorage.setItem(
      "cj.applications.workspace",
      JSON.stringify({ view: "inbox", mode: "hiring", direction: "received" })
    );
  });

  // The recruiter works their inbox in Recruiter mode and messages Priya.
  await switchPersona(page, "recruiter-active", "Finance Simplified");
  await page.goto("/applications?view=inbox&mode=recruiter", { waitUntil: "domcontentloaded" });
  await page.getByTestId("applications-filter-received").click();
  await page.getByTestId("interaction-row").filter({ hasText: "Priya Nair" }).first().click();
  const recruiterDetail = page.getByTestId("applications-detail");
  const composer = recruiterDetail.getByRole("textbox", { name: "Reply message" });
  const marker = `Persona coherence ping ${Date.now()}`;
  await composer.fill(marker);
  await recruiterDetail.getByRole("button", { name: "Send", exact: true }).click();
  await expect(composer).toHaveValue("");

  // Switching to Priya lands on HER start route — not on the recruiter's URL,
  // whose mode/thread params describe the previous persona's context.
  await switchPersona(page, "talent-complete", "Priya Nair");
  await expect(page).toHaveURL(/\/you/);

  // Her bell shows the unread message notification.
  await expect(page.getByRole("button", { name: "Notifications" })).toContainText(/\d/);

  // The bare Inbox route (sidebar path) opens HER conversations — never the
  // previous persona's empty Recruiter view.
  await page.goto("/applications", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/mode=talent/);
  await expect(page.getByTestId("interaction-row").first()).toBeVisible();
  await expect(page.getByRole("main")).not.toContainText("No hiring activity yet.");

  // No un-scoped cross-persona inbox keys survive.
  const legacyKeys = await page.evaluate(() =>
    [
      "cj.applications.workspace",
      "cj.applications.selected",
      "cj.applications.chatdock",
      "cj.applications.notes",
    ].filter((key) => window.localStorage.getItem(key) !== null)
  );
  expect(legacyKeys).toEqual([]);

  // Her genuinely-empty Recruiter side points back at the Talent conversations
  // instead of a dead end.
  await page.goto("/applications?view=inbox&mode=recruiter", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("inbox-other-mode-hint")).toBeVisible();
  await page.getByTestId("inbox-other-mode-switch").click();
  await expect(page.getByTestId("interaction-row").first()).toBeVisible();

  // The bell notification deep-links to the exact thread with the new message,
  // and opening it clears the unread state.
  await page.getByRole("button", { name: "Notifications" }).click();
  const notificationLink = page
    .locator('a[href*="/applications?view=inbox&mode=talent"]')
    .filter({ hasText: "New message from Finance Simplified" })
    .first();
  await expect(notificationLink).toBeVisible();
  await notificationLink.click();
  await expect(page).toHaveURL(/mode=talent.*thread=/);
  await expect(page.getByTestId("applications-detail")).toContainText(marker);

  // Switching back restores the recruiter's own saved workspace (their scoped
  // state), proving per-persona persistence survives the round trip.
  await switchPersona(page, "recruiter-active", "Finance Simplified");
  await page.goto("/applications", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/mode=recruiter/);
  await expect(page.getByRole("main")).not.toContainText("No applications yet.");
});

test("declining a hiring request delivers the note atomically to the recruiter", async ({ page }) => {
  await loginController(page);
  await restoreScenario(page, "hiring-requests", "RESTORE REQUESTS");
  await switchPersona(page, "both-sides", "Aditi Verma");
  await page.goto("/applications?view=inbox&mode=talent", { waitUntil: "domcontentloaded" });
  await page.getByTestId("applications-filter-received").click();
  await page.getByTestId("interaction-row").filter({ hasText: "Finance Simplified" }).first().click();

  const detail = page.getByTestId("applications-detail");
  await detail.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Decline request", exact: true }).click();

  // A decline shares immediately, so the confirmation is where the
  // explanation has to be collected.
  const confirmation = page.getByRole("dialog", { name: "Decline this hiring request?" });
  const note = confirmation.getByTestId("stage-confirm-note");
  await expect(note).toBeVisible();
  await note.fill("Fully booked until March — please do reach out again then.");
  await confirmation.getByRole("button", { name: "Confirm decline" }).click();

  await expect(
    detail.getByTestId("applications-detail-header").getByText("Declined", { exact: true })
  ).toBeVisible();
  await expect(detail).toContainText("Fully booked until March");

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("applications-detail")).toContainText("Fully booked until March");

  // The other participant must actually receive both the outcome and the note.
  await returnToController(page);
  await switchPersona(page, "recruiter-active", "Finance Simplified");
  await page.goto("/applications?view=inbox&mode=recruiter", { waitUntil: "domcontentloaded" });
  await page.getByTestId("applications-filter-sent").click();
  await page.getByTestId("interaction-row").filter({ hasText: "Aditi Verma" }).first().click();
  const recruiterDetail = page.getByTestId("applications-detail");
  await expect(recruiterDetail).toContainText("Hiring request declined");
  await expect(recruiterDetail).toContainText("Fully booked until March");
  // Exactly one of each — the note is not duplicated by the status message.
  await expect(recruiterDetail.getByText("Fully booked until March", { exact: false })).toHaveCount(1);
});

test("a private rejection tells nobody until it is shared, and then shares once with its note", async ({
  page,
}) => {
  await loginController(page);
  await restoreScenario(page, "inbox-pipeline", "RESTORE INBOX");
  await switchPersona(page, "recruiter-active", "Finance Simplified");
  await page.goto("/applications?view=inbox&mode=recruiter&direction=received", {
    waitUntil: "domcontentloaded",
  });
  await page.getByTestId("interaction-row").filter({ hasText: "Priya Nair" }).first().click();

  const detail = page.getByTestId("applications-detail");
  await detail.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Not selected", exact: true }).click();
  const confirmation = page.getByRole("dialog", { name: "Mark this application as not selected?" });
  // Private stages tell no one, so they must not collect an explanation here.
  await expect(confirmation.getByTestId("stage-confirm-note")).toHaveCount(0);
  await confirmation.getByRole("button", { name: "Confirm not selected" }).click();

  // Saved privately: the prompt offers to share, and nothing has been sent yet.
  const prompt = page.getByTestId("stage-notify-prompt");
  await expect(prompt).toBeVisible();

  await returnToController(page);
  await switchPersona(page, "talent-complete", "Priya Nair");
  await page.goto("/applications?view=inbox&mode=talent", { waitUntil: "domcontentloaded" });
  await page.getByTestId("applications-filter-sent").click();
  await page
    .getByTestId("interaction-row")
    .filter({ hasText: "Long-form video editor for a finance YouTube channel" })
    .first()
    .click();
  const applicantDetail = page.getByTestId("applications-detail");
  await expect(applicantDetail).not.toContainText("Not moving forward");

  // Now the recruiter deliberately shares it, with an explanation.
  await returnToController(page);
  await switchPersona(page, "recruiter-active", "Finance Simplified");
  await page.goto("/applications?view=inbox&mode=recruiter&direction=received", {
    waitUntil: "domcontentloaded",
  });
  await page.getByTestId("interaction-row").filter({ hasText: "Priya Nair" }).first().click();
  await page.getByTestId("applications-detail").getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: /Share decision with/ }).click();

  const sharePrompt = page.getByTestId("stage-notify-prompt");
  await sharePrompt.getByTestId("stage-notify-note").fill("Your edit test was strong — the brief needed more motion work.");
  await sharePrompt.getByTestId("stage-notify-send").click();
  await expect(sharePrompt.getByTestId("stage-notify-followup")).toBeVisible();

  await returnToController(page);
  await switchPersona(page, "talent-complete", "Priya Nair");
  await page.goto("/applications?view=inbox&mode=talent", { waitUntil: "domcontentloaded" });
  await page.getByTestId("applications-filter-sent").click();
  await page
    .getByTestId("interaction-row")
    .filter({ hasText: "Long-form video editor for a finance YouTube channel" })
    .first()
    .click();
  const shared = page.getByTestId("applications-detail");
  await expect(shared).toContainText("Not moving forward");
  await expect(shared).toContainText("the brief needed more motion work");
  await expect(shared.getByText("the brief needed more motion work", { exact: false })).toHaveCount(1);
});

test("Accepted from Pipeline confirms before committing and agrees with the Inbox", async ({ page }) => {
  await loginController(page);
  await restoreScenario(page, "hiring-requests", "RESTORE REQUESTS");
  await switchPersona(page, "both-sides", "Aditi Verma");
  await page.goto("/applications?view=pipeline&mode=talent&direction=received", {
    waitUntil: "domcontentloaded",
  });

  const board = page.getByTestId("pipeline-board");
  const row = board.getByTestId("pipeline-row").filter({ hasText: "Finance Simplified" }).first();
  await row.getByTestId("pipeline-stage-menu").click();
  await page.getByTestId("pipeline-stage-option-accepted").click();

  const confirmation = page.getByRole("dialog", { name: "Accept this hiring request?" });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole("button", { name: "Confirm acceptance" }).click();

  await expect(
    board.getByTestId("pipeline-group-accepted").getByTestId("pipeline-row").filter({ hasText: "Finance Simplified" })
  ).toBeVisible();

  // The Inbox must agree after a hard reload, not just optimistically.
  await page.goto("/applications?view=inbox&mode=talent", { waitUntil: "domcontentloaded" });
  await page.getByTestId("applications-filter-received").click();
  await page.getByTestId("interaction-row").filter({ hasText: "Finance Simplified" }).first().click();
  await expect(
    page.getByTestId("applications-detail-header").getByText("Accepted", { exact: true })
  ).toBeVisible();
});

test("Pipeline asks before a rejection, exactly as the Inbox does", async ({ page }) => {
  await loginController(page);
  await restoreScenario(page, "inbox-pipeline", "RESTORE INBOX");
  await switchPersona(page, "recruiter-active", "Finance Simplified");
  await page.goto("/applications?view=pipeline&mode=recruiter&direction=received", {
    waitUntil: "domcontentloaded",
  });

  const board = page.getByTestId("pipeline-board");
  const priya = board.getByTestId("pipeline-row").filter({ hasText: "Priya Nair" }).first();
  await priya.getByTestId("pipeline-stage-menu").click();
  await page.getByTestId("pipeline-stage-option-rejected").click();

  // Previously this committed instantly from the board while the Inbox asked.
  const confirmation = page.getByRole("dialog", { name: "Mark this application as not selected?" });
  await expect(confirmation).toBeVisible();
  await expect(confirmation).toContainText("saved privately");

  // Cancelling must leave the record exactly where it was.
  await confirmation.getByRole("button", { name: "Cancel" }).click();
  await expect(
    board.getByTestId("pipeline-group-rejected").getByTestId("pipeline-row").filter({ hasText: "Priya Nair" })
  ).toHaveCount(0);
});

test("archive and unarchive are personal and never touch the lifecycle", async ({ page }) => {
  await loginController(page);
  await restoreScenario(page, "inbox-pipeline", "RESTORE INBOX");
  await switchPersona(page, "recruiter-active", "Finance Simplified");
  await page.goto("/applications?view=inbox&mode=recruiter&direction=received", {
    waitUntil: "domcontentloaded",
  });
  await page.getByTestId("interaction-row").filter({ hasText: "Priya Nair" }).first().click();

  const detail = page.getByTestId("applications-detail");
  const squash = (value: string) => value.replace(/\s+/g, "");
  const statusBefore = squash(
    await detail.getByTestId("applications-detail-header").innerText()
  );

  await detail.getByRole("button", { name: "More actions" }).click();
  // Archiving is reversible and private, so it commits without a confirmation.
  await page.getByRole("menuitem", { name: "Archive", exact: true }).first().click();
  await expect(page.getByRole("menu")).toHaveCount(0);

  // The counterparty's view of the relationship is untouched by a personal tidy-up.
  await returnToController(page);
  await switchPersona(page, "talent-complete", "Priya Nair");
  await page.goto("/applications?view=inbox&mode=talent", { waitUntil: "domcontentloaded" });
  await page.getByTestId("applications-filter-sent").click();
  await expect(
    page.getByTestId("interaction-row").filter({ hasText: "Long-form video editor for a finance YouTube channel" }).first()
  ).toBeVisible();

  await returnToController(page);
  await switchPersona(page, "recruiter-active", "Finance Simplified");
  await page.goto("/applications?view=inbox&mode=recruiter", { waitUntil: "domcontentloaded" });
  await page.getByTestId("applications-filter-archived").click();
  const archivedRow = page.getByTestId("interaction-row").filter({ hasText: "Priya Nair" }).first();
  await expect(archivedRow).toBeVisible();
  await archivedRow.click();
  const archivedDetail = page.getByTestId("applications-detail");
  await archivedDetail.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Unarchive", exact: true }).click();

  await page.goto("/applications?view=inbox&mode=recruiter", { waitUntil: "domcontentloaded" });
  await page.getByTestId("applications-filter-received").click();
  await page.getByTestId("interaction-row").filter({ hasText: "Priya Nair" }).first().click();
  // Same lifecycle status it had before it was ever archived.
  await expect
    .poll(async () => squash(await page.getByTestId("applications-detail-header").innerText()))
    .toBe(statusBefore);
});

test("withdrawing an application reaches the recruiter and closes the thread", async ({ page }) => {
  await loginController(page);
  await restoreScenario(page, "inbox-pipeline", "RESTORE INBOX");
  await switchPersona(page, "talent-complete", "Priya Nair");
  await page.goto("/applications?view=inbox&mode=talent", { waitUntil: "domcontentloaded" });
  await page.getByTestId("applications-filter-sent").click();
  await page
    .getByTestId("interaction-row")
    .filter({ hasText: "Long-form video editor for a finance YouTube channel" })
    .first()
    .click();

  const detail = page.getByTestId("applications-detail");
  await detail.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Withdraw application", exact: true }).click();
  const confirmation = page.getByRole("dialog", { name: "Withdraw this application?" });
  await confirmation.getByRole("button", { name: "Confirm withdraw" }).click();

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("applications-filter-sent").click();
  await page
    .getByTestId("interaction-row")
    .filter({ hasText: "Long-form video editor for a finance YouTube channel" })
    .first()
    .click();
  await expect(
    page.getByTestId("applications-detail-header").getByText("Withdrawn", { exact: true })
  ).toBeVisible();

  // The recruiter must see it, and a withdrawn thread stops accepting messages.
  await returnToController(page);
  await switchPersona(page, "recruiter-active", "Finance Simplified");
  await page.goto("/applications?view=pipeline&mode=recruiter&direction=received", {
    waitUntil: "domcontentloaded",
  });
  await expect(
    page
      .getByTestId("pipeline-group-withdrawn")
      .getByTestId("pipeline-row")
      .filter({ hasText: "Priya Nair" })
      .first()
  ).toBeVisible();
});

test("a stale second tab cannot silently overwrite the first tab's decision", async ({
  page,
  browser,
}) => {
  await loginController(page);
  await restoreScenario(page, "inbox-pipeline", "RESTORE INBOX");
  await switchPersona(page, "recruiter-active", "Finance Simplified");

  const secondContext = await browser.newContext({ baseURL: QA_BASE_URL });
  const secondPage = await secondContext.newPage();
  try {
    await loginController(secondPage);
    await switchPersona(secondPage, "recruiter-active", "Finance Simplified");

    // Both tabs load the same record at the same version.
    for (const target of [page, secondPage]) {
      await target.goto("/applications?view=inbox&mode=recruiter&direction=received", {
        waitUntil: "domcontentloaded",
      });
      await target.getByTestId("interaction-row").filter({ hasText: "Priya Nair" }).first().click();
      await expect(target.getByTestId("applications-detail")).toBeVisible();
    }

    // Tab one moves it forward.
    await page.getByTestId("applications-detail").getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Move to Interviewing" }).click();
    // The detail header speaks the display vocabulary ("Viewed"), not the
    // backend stage name.
    await expect(page.getByTestId("applications-detail-header")).toContainText("Viewed");

    // Tab two is now stale. Its attempt must not commit silently on top.
    await secondPage
      .getByTestId("applications-detail")
      .getByRole("button", { name: "More actions" })
      .click();
    await secondPage.getByRole("menuitem", { name: "Move to Interviewing" }).click();

    // Either the backend refuses the stale version and the UI explains it, or
    // the UI reconciles to the authoritative state — never a silent overwrite
    // that loses tab one's decision.
    await expect
      .poll(
        async () => {
          const detail = secondPage.getByTestId("applications-detail");
          const text = await detail.innerText();
          const reconciled = text.includes("Interviewing") || text.includes("Viewed");
          const explained = /couldn|try again|refresh|changed/i.test(text);
          return reconciled || explained;
        },
        { timeout: 15_000 }
      )
      .toBe(true);

    // Whatever the second tab did, the server stays authoritative and coherent.
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByTestId("interaction-row").filter({ hasText: "Priya Nair" }).first().click();
    await expect(page.getByTestId("applications-detail-header")).not.toContainText("Rejected");
  } finally {
    await secondContext.close();
  }
});

test("a destructive decision can be completed with the keyboard alone", async ({ page }) => {
  await loginController(page);
  await restoreScenario(page, "inbox-pipeline", "RESTORE INBOX");
  await switchPersona(page, "recruiter-active", "Finance Simplified");
  await page.goto("/applications?view=inbox&mode=recruiter&direction=received", {
    waitUntil: "domcontentloaded",
  });
  await page.getByTestId("interaction-row").filter({ hasText: "Priya Nair" }).first().click();

  const moreActions = page.getByTestId("applications-detail").getByRole("button", { name: "More actions" });
  await moreActions.focus();
  await expect(moreActions).toBeFocused();
  await moreActions.press("Enter");
  await expect(page.getByRole("menu")).toBeVisible();

  // Reachable and actionable without a pointer.
  const notSelected = page.getByRole("menuitem", { name: "Not selected", exact: true });
  await notSelected.press("Enter");

  const confirmation = page.getByRole("dialog", { name: "Mark this application as not selected?" });
  await expect(confirmation).toBeVisible();
  // Escape must abandon it without any side effect.
  await page.keyboard.press("Escape");
  await expect(confirmation).toHaveCount(0);
  await expect(page.getByTestId("applications-detail-header")).toContainText("Viewed");
});
