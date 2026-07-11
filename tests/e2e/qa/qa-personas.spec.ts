import { expect, test, type Page } from "@playwright/test";

const CONTROLLER_EMAIL = "qa-controller@example.com";
const CONTROLLER_PASSWORD = "LocalQaController123!";

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
