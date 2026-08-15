import { expect, test, type ConsoleMessage, type Page } from "@playwright/test";

/**
 * Exploratory guards for the things a scripted happy path tends to miss:
 * console health, repeated clicks, browser history, and awkward content.
 *
 * These are deliberately behavioural rather than visual — each one encodes a
 * defect class found (or specifically looked for) during the workspace audit.
 */

const CONTROLLER_EMAIL = "qa-controller@example.com";
const CONTROLLER_PASSWORD = "LocalQaController123!";

/** Noise that is environmental rather than a product defect. */
const IGNORED_CONSOLE = [
  /favicon/i,
  /Download the React DevTools/i,
  /net::ERR_INTERNET_DISCONNECTED/i,
  /ERR_NAME_NOT_RESOLVED/i,
  /Failed to load resource/i,
  // A session poll that was still in flight when the test navigated. The browser
  // reports `net::ERR_ABORTED` and next-auth turns that into an error line, but
  // nothing failed: the very next `/api/auth/session` answers 200 and the
  // session is intact. This began appearing once the content security policy
  // moved every page to per-request rendering (WEB-008B) — pages take longer to
  // go idle, so a scripted four-navigation sequence is more likely to interrupt
  // the poll. The race is the browser's, not the product's.
  /\[next-auth]\[error]\[CLIENT_FETCH_ERROR][\s\S]*Failed to fetch/i,
];

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message: ConsoleMessage) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (IGNORED_CONSOLE.some((pattern) => pattern.test(text))) return;
    errors.push(text);
  });
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  return errors;
}

async function loginController(page: Page) {
  await page.goto("/auth?mode=login", { waitUntil: "domcontentloaded" });
  await page.getByPlaceholder("Email").fill(CONTROLLER_EMAIL);
  await page.getByPlaceholder("Password").fill(CONTROLLER_PASSWORD);
  await page.locator("form").getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page).toHaveURL(/\/you/);
}

async function switchPersona(page: Page, key: string, displayName: string) {
  await page.getByTestId("qa-persona-open").click();
  await expect(page.getByTestId("qa-persona-drawer")).toBeVisible();
  await page.getByTestId(`qa-switch-${key}`).click();
  await expect(page.getByTestId("qa-persona-open")).toContainText(displayName, { timeout: 20_000 });
}

async function restoreScenario(page: Page, key: string, confirmation: string) {
  const response = await page.request.post(`/api/qa/scenarios/${key}/restore`, {
    data: { confirmation },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
}

test("the workspace stays console-clean across views, modes, and status actions", async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await loginController(page);
  await restoreScenario(page, "inbox-pipeline", "RESTORE INBOX");
  await switchPersona(page, "recruiter-active", "Finance Simplified");

  await page.goto("/applications?view=inbox&mode=recruiter", { waitUntil: "domcontentloaded" });
  await page.getByTestId("applications-view-pipeline").click();
  await expect(page.getByTestId("pipeline-board")).toBeVisible();
  await page.getByTestId("applications-view-inbox").click();
  await page.getByTestId("interaction-row").filter({ hasText: "Priya Nair" }).first().click();

  const detail = page.getByTestId("applications-detail");
  await detail.getByRole("button", { name: "More actions" }).click();
  await page.keyboard.press("Escape");
  await page.getByTestId("applications-filter-archived").click();
  await page.getByTestId("applications-filter-received").click();

  expect(errors, `unexpected console errors:\n${errors.join("\n")}`).toEqual([]);
});

test("switching views keeps the URL shareable without polluting browser history", async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await loginController(page);
  await restoreScenario(page, "inbox-pipeline", "RESTORE INBOX");
  await switchPersona(page, "recruiter-active", "Finance Simplified");

  await page.goto("/you", { waitUntil: "domcontentloaded" });
  await page.goto("/applications?view=inbox&mode=recruiter", { waitUntil: "domcontentloaded" });
  await page.getByTestId("applications-view-pipeline").click();
  await expect(page).toHaveURL(/view=pipeline/);

  // The view is a persistent preference, not a navigation step: it rewrites the
  // current history entry rather than stacking one per toggle, so Back leaves
  // the workspace instead of silently flipping the view underneath the user.
  await page.goBack();
  await expect(page).toHaveURL(/\/you$/);

  // ...and the chosen view is restored on return, from the URL alone.
  await page.goto("/applications?view=pipeline&mode=recruiter", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("pipeline-board")).toBeVisible();
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("pipeline-board")).toBeVisible();

  expect(errors, `unexpected console errors:\n${errors.join("\n")}`).toEqual([]);
});

test("repeated clicks on one decision do not produce repeated outcomes", async ({ page }) => {
  await loginController(page);
  await restoreScenario(page, "inbox-pipeline", "RESTORE INBOX");
  await switchPersona(page, "recruiter-active", "Finance Simplified");
  await page.goto("/applications?view=inbox&mode=recruiter&direction=received", {
    waitUntil: "domcontentloaded",
  });
  await page.getByTestId("interaction-row").filter({ hasText: "Priya Nair" }).first().click();

  const detail = page.getByTestId("applications-detail");
  await detail.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Hire" }).click();

  const confirmation = page.getByRole("dialog", { name: "Hire this candidate?" });
  const confirm = confirmation.getByRole("button", { name: "Confirm hire" });
  // Three synchronous presses in one tick, before React can unmount the
  // dialog: the in-flight mutation guard must swallow the extras rather than
  // issuing three hires.
  await confirm.evaluate((button: HTMLElement) => {
    button.click();
    button.click();
    button.click();
  });

  await expect(detail.getByTestId("applications-detail-header")).toContainText("Hired");

  // Exactly one hire announcement survives a reload — no duplicate side effects.
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("interaction-row").filter({ hasText: "Priya Nair" }).first().click();
  await expect(page.getByTestId("applications-detail").getByText(/Hired for/).first()).toBeVisible();
  await expect(page.getByTestId("applications-detail").getByText(/Hired for/)).toHaveCount(1);
});

test("a long pasted note survives the round trip intact", async ({ page }) => {
  await loginController(page);
  await restoreScenario(page, "hiring-requests", "RESTORE REQUESTS");
  await switchPersona(page, "both-sides", "Aditi Verma");
  await page.goto("/applications?view=inbox&mode=talent", { waitUntil: "domcontentloaded" });
  await page.getByTestId("applications-filter-received").click();
  await page.getByTestId("interaction-row").filter({ hasText: "Finance Simplified" }).first().click();

  const detail = page.getByTestId("applications-detail");
  await detail.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Decline request", exact: true }).click();

  const confirmation = page.getByRole("dialog", { name: "Decline this hiring request?" });
  const marker = "Thanks for thinking of me — here is the long version.";
  const longNote = `${marker} ${"Scheduling context. ".repeat(40)}`.trim();
  await confirmation.getByTestId("stage-confirm-note").fill(longNote);
  await confirmation.getByRole("button", { name: "Confirm decline" }).click();

  await expect(detail).toContainText(marker);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("applications-detail")).toContainText(marker);
});
