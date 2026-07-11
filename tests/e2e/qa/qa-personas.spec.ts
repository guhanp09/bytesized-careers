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

test("an application stage update and message carry across both real personas", async ({ page }) => {
  await loginController(page);
  await restoreScenario(page, "inbox-pipeline", "RESTORE INBOX");
  await switchPersona(page, "recruiter-active", "Finance Simplified");
  await page.goto("/applications?view=pipeline&mode=recruiter&direction=received", {
    waitUntil: "domcontentloaded",
  });

  const board = page.getByTestId("pipeline-board");
  const priya = board
    .getByTestId("pipeline-group-shortlisted")
    .getByTestId("pipeline-row")
    .filter({ hasText: "Priya Nair" });
  await expect(priya).toBeVisible();
  await priya.getByTestId("pipeline-stage-menu").click();
  await page.getByTestId("pipeline-stage-option-reviewing").click();
  await expect(
    board
      .getByTestId("pipeline-group-reviewing")
      .getByTestId("pipeline-row")
      .filter({ hasText: "Priya Nair" })
  ).toBeVisible();

  await board
    .getByTestId("pipeline-group-reviewing")
    .getByTestId("pipeline-row")
    .filter({ hasText: "Priya Nair" })
    .getByTestId("pipeline-message")
    .click();
  const dock = page.getByTestId("chat-dock-panel");
  await dock.getByTestId("chat-dock-composer").fill("Your application is now under review.");
  await dock.getByTestId("chat-dock-send").click();
  await expect(dock.getByTestId("chat-message").last()).toContainText(
    "Your application is now under review."
  );

  await returnToController(page);
  await switchPersona(page, "talent-complete", "Priya Nair");
  await page.goto("/applications?view=pipeline&mode=talent&direction=sent", {
    waitUntil: "domcontentloaded",
  });
  await expect(
    page
      .getByTestId("pipeline-group-reviewing")
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
  await expect(page.getByTestId("applications-detail")).toContainText(
    "Your application is now under review."
  );
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
      .getByTestId("pipeline-group-shortlisted")
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
    await recruiterPage.evaluate(() => window.localStorage.removeItem("cj.applications.notes"));
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
  await modal.locator('[data-requirement-key="working_hours"] input').fill("Evenings IST");
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
  await page.getByTestId("pipeline-stage-option-contacted").click();
  const prompt = page.getByTestId("stage-notify-prompt");
  if (await prompt.isVisible()) {
    await prompt.getByTestId("stage-notify-send").click();
    await expect(prompt).toContainText(/posted to the thread/i);
    const done = prompt.getByTestId("stage-notify-done");
    if (await done.isVisible()) await done.click();
  }
  await expect(
    page
      .getByTestId("pipeline-group-contacted")
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
      .getByTestId("pipeline-group-contacted")
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
