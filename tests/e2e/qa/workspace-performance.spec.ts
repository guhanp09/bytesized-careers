import { expect, test, type Page } from "@playwright/test";

/**
 * Performance and stability of the workspace.
 *
 * These are **budgets, not benchmarks**. The numbers are deliberately loose
 * relative to what the app actually does locally, because a tight threshold on
 * a shared laptop produces a flaky suite and teaches everyone to ignore it. They
 * exist to catch a regression of the kind that makes the product feel broken —
 * a switch that takes seconds, a request storm, a leak of duplicate work — not
 * to defend a millisecond.
 *
 * Measured values are printed on every run, so the trend is visible even when
 * nothing fails.
 */

const CONTROLLER_EMAIL = "qa-controller@example.com";
const CONTROLLER_PASSWORD = "LocalQaController123!";

/** Generous by design; see the note above. */
const BUDGET = {
  meaningfulContent: 6_000,
  conversationSwitch: 2_500,
  viewSwitch: 2_500,
  queueSwitch: 1_500,
  sendFeedback: 3_000,
};

async function loginController(page: Page) {
  await page.goto("/auth?mode=login", { waitUntil: "domcontentloaded" });
  await page.getByPlaceholder("Email").fill(CONTROLLER_EMAIL);
  await page.getByPlaceholder("Password").fill(CONTROLLER_PASSWORD);
  await page.locator("form").getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page).toHaveURL(/\/you/);
}

async function openRecruiterInbox(page: Page) {
  await loginController(page);
  const restore = await page.request.post("/api/qa/scenarios/inbox-pipeline/restore", {
    data: { confirmation: "RESTORE INBOX" },
  });
  expect(restore.ok(), await restore.text()).toBeTruthy();
  await page.getByTestId("qa-persona-open").click();
  await page.getByTestId("qa-switch-recruiter-active").click();
  await expect(page.getByTestId("qa-persona-open")).toContainText("Finance Simplified", {
    timeout: 20_000,
  });
}

async function timed<T>(label: string, run: () => Promise<T>): Promise<number> {
  const started = Date.now();
  await run();
  const elapsed = Date.now() - started;
  console.log(`perf · ${label}: ${elapsed}ms`);
  return elapsed;
}

test("the inbox reaches meaningful content and switches views without stalling", async ({ page }) => {
  await openRecruiterInbox(page);

  const load = await timed("initial load → first conversation row", async () => {
    await page.goto("/applications?view=inbox&mode=recruiter&direction=received", {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByTestId("interaction-row").first()).toBeVisible({ timeout: 20_000 });
  });
  expect(load).toBeLessThan(BUDGET.meaningfulContent);

  const rows = page.getByTestId("interaction-row");
  await rows.nth(0).click();
  await expect(page.getByTestId("applications-detail")).toBeVisible();

  const switchConversation = await timed("conversation switch", async () => {
    await rows.nth(1).click();
    await expect(page.getByTestId("applications-detail")).toBeVisible();
  });
  expect(switchConversation).toBeLessThan(BUDGET.conversationSwitch);

  const toPipeline = await timed("inbox → pipeline", async () => {
    await page.getByTestId("applications-view-pipeline").click();
    await expect(page.getByTestId("pipeline-board")).toBeVisible();
  });
  expect(toPipeline).toBeLessThan(BUDGET.viewSwitch);

  const toInbox = await timed("pipeline → inbox", async () => {
    await page.getByTestId("applications-view-inbox").click();
    await expect(page.getByTestId("applications-detail")).toBeVisible();
  });
  expect(toInbox).toBeLessThan(BUDGET.viewSwitch);

  const queueTrigger = page.getByTestId("queue-selector-trigger");
  if (await queueTrigger.isVisible().catch(() => false)) {
    await queueTrigger.click();
    const queue = page.getByTestId("queue-chip-decision_needed");
    if (await queue.isVisible().catch(() => false)) {
      const queueSwitch = await timed("queue filter", async () => {
        await queue.click();
        await expect(page.getByTestId("interaction-row").first()).toBeVisible();
      });
      expect(queueSwitch).toBeLessThan(BUDGET.queueSwitch);
    }
  }
});

test("the list-wide reads happen once per load, not once per row", async ({ page }) => {
  await openRecruiterInbox(page);

  const calls = new Map<string, number>();
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (!url.pathname.startsWith("/api/v1/me/")) return;
    // Collapse ids so "one per record" shows up as a large count.
    const key = url.pathname
      .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "/{id}")
      .replace(/^\/api\/v1/, "");
    calls.set(key, (calls.get(key) ?? 0) + 1);
  });

  await page.goto("/applications?view=inbox&mode=recruiter&direction=received", {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByTestId("interaction-row").first()).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(2_500);

  console.log(`perf · requests\n${JSON.stringify(Object.fromEntries(calls), null, 2)}`);

  // The three list-wide reads Phase B and C added must each be one request for
  // the whole inbox. If any of these grows with the number of records, the
  // queue counts have quietly become N round-trips.
  for (const path of ["/me/interaction-preferences", "/me/interviews", "/me/engagements"]) {
    const count = calls.get(path) ?? 0;
    expect(count, `${path} was called ${count} times`).toBeLessThanOrEqual(2);
  }

  // Opening no conversation must not have fetched every conversation's detail.
  const perRecord =
    (calls.get("/me/applications/{id}/conversation") ?? 0) +
    (calls.get("/me/talent-interests/{id}/conversation") ?? 0);
  const rowCount = await page.getByTestId("interaction-row").count();
  expect(
    perRecord,
    `${perRecord} conversation fetches for ${rowCount} rows — details must load on demand`
  ).toBeLessThan(Math.max(4, rowCount));
});

test("sending a message gives feedback immediately and does not duplicate it", async ({ page }) => {
  await openRecruiterInbox(page);
  await page.goto("/applications?view=inbox&mode=recruiter&direction=received", {
    waitUntil: "domcontentloaded",
  });
  await page.getByTestId("interaction-row").filter({ hasText: "Priya Nair" }).first().click();

  const body = `Perf check ${Date.now()}`;
  const composer = page.getByRole("textbox", { name: "Reply message" });
  await composer.fill(body);

  const feedback = await timed("send → message on screen", async () => {
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(body, { exact: true })).toBeVisible({ timeout: 20_000 });
  });
  expect(feedback).toBeLessThan(BUDGET.sendFeedback);

  // A single send produces a single message, after polling and realtime have
  // both had a chance to reconcile it.
  await page.waitForTimeout(3_000);
  await expect(page.getByText(body, { exact: true })).toHaveCount(1);
});

test("the workspace survives going offline and coming back", async ({ page, context }) => {
  await openRecruiterInbox(page);
  await page.goto("/applications?view=inbox&mode=recruiter&direction=received", {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByTestId("interaction-row").first()).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("interaction-row").first().click();
  await expect(page.getByTestId("applications-detail")).toBeVisible();

  await context.setOffline(true);
  await page.waitForTimeout(2_000);

  // Offline must not blank the workspace: what was loaded stays readable.
  await expect(page.getByTestId("interaction-row").first()).toBeVisible();
  await expect(page.getByTestId("applications-detail")).toBeVisible();

  await context.setOffline(false);
  const recovery = await timed("offline → recovered", async () => {
    await page.getByTestId("interaction-row").nth(1).click();
    await expect(page.getByTestId("applications-detail")).toBeVisible({ timeout: 20_000 });
  });
  expect(recovery).toBeLessThan(BUDGET.conversationSwitch * 3);
});

test("a queue filter never strands the open conversation", async ({ page }) => {
  await openRecruiterInbox(page);
  await page.goto("/applications?view=inbox&mode=recruiter&direction=received", {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByTestId("interaction-row").first()).toBeVisible({ timeout: 20_000 });

  await page.getByTestId("interaction-row").filter({ hasText: "Priya Nair" }).first().click();
  const before = await page.getByTestId("applications-detail-header").textContent();

  const trigger = page.getByTestId("queue-selector-trigger");
  if ((await trigger.count()) === 0) test.skip(true, "no queue holds work in this fixture");

  await trigger.click();
  const chipCount = await page.getByTestId("queue-selector-menu").getByRole("menuitemradio").count();
  for (let index = 0; index < chipCount; index += 1) {
    // The menu closes on each choice, so it is reopened per queue.
    if (index > 0) await page.getByTestId("queue-selector-trigger").click();
    await page.getByTestId("queue-selector-menu").getByRole("menuitemradio").nth(index).click();
    // Whatever the filter does to the list, the thing being read stays open.
    await expect(page.getByTestId("applications-detail-header")).toHaveText(before ?? "");
  }
});
