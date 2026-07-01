import { expect, test } from "@playwright/test";

// The dev tools panel renders only when the server decides the environment is
// dev/test (the e2e server runs on localhost, which qualifies). These checks cover
// visibility + the reset confirmation gate. The actual persona switch needs a live
// backend, so it is not asserted here — the panel degrades to "no personas" offline.

test("dev tools button opens a clearly-labelled dev-only panel", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const openButton = page.getByTestId("dev-tools-open").first();
  await expect(openButton).toBeVisible();

  await openButton.click();

  const panel = page.getByTestId("dev-tools-panel").first();
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("Dev tools");
  await expect(panel).toContainText("Development only");

  // Persona selector and seed controls are present.
  await expect(page.getByTestId("dev-persona-select").first()).toBeVisible();
  await expect(page.getByTestId("dev-seed-full_demo").first()).toBeVisible();
});

test("reset is guarded by an explicit confirmation step that can be cancelled", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("dev-tools-open").first().click();
  await expect(page.getByTestId("dev-tools-panel").first()).toBeVisible();

  // First click only arms the confirmation — it does not reset anything.
  await page.getByTestId("dev-reset").first().click();
  const confirm = page.getByTestId("dev-reset-confirm").first();
  await expect(confirm).toBeVisible();
  await expect(page.getByTestId("dev-tools-panel").first()).toContainText(
    "Reset local dev data?"
  );

  // Cancel restores the idle state without confirming.
  await page.getByTestId("dev-reset-cancel").first().click();
  await expect(page.getByTestId("dev-reset-confirm")).toHaveCount(0);
  await expect(page.getByTestId("dev-reset").first()).toBeVisible();
});

test("the workflow tester section lists the cross-persona flows", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("dev-tools-open").first().click();

  const tester = page.getByTestId("dev-workflow-tester").first();
  await expect(tester).toBeVisible();
  await expect(tester).toContainText("Workflow tester");

  // The default action is talent→recruiter apply, and the run control is present.
  const select = page.getByTestId("dev-workflow-select").first();
  await expect(select).toBeVisible();
  await expect(tester).toContainText("talent-complete → recruiter-active");
  await expect(page.getByTestId("dev-workflow-run").first()).toBeVisible();

  // Messaging is now a real, supported workflow.
  await select.selectOption("send-message");
  await expect(tester).toContainText("Sends a real message");
});

test("the panel can be collapsed back to the floating button", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("dev-tools-open").first().click();
  await expect(page.getByTestId("dev-tools-panel").first()).toBeVisible();

  await page.getByRole("button", { name: "Collapse dev tools" }).first().click();
  await expect(page.getByTestId("dev-tools-panel")).toHaveCount(0);
  await expect(page.getByTestId("dev-tools-open").first()).toBeVisible();
});
