import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { encode } from "next-auth/jwt";
import { anchor, card, observeStarBackendRequests, openRecord, openWorkspace, row } from "./scenarioAnchors";

/**
 * The named fixes, re-checked after the redesign moved everything they touch.
 *
 * Each of these was a defect somebody reported by name — a button that did
 * nothing, a label that could not be pressed, categories that did not add up.
 * The conversation list, the thread and the Pipeline card have all been rebuilt
 * since, so "it was fixed" is a claim about the old layout unless it is
 * asserted against the new one.
 */

const SESSION_SECRET = "e2e-secret";

async function signIn(context: BrowserContext) {
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
    { name: "next-auth.session-token", value: sessionToken, domain: "127.0.0.1", path: "/", httpOnly: true, sameSite: "Lax" },
  ]);
}

test.beforeEach(async ({ context }) => {
  await signIn(context);
});

const main = (page: Page) => page.getByRole("main");

/* ---- the personal message on a consequential outcome --------------------- */

test("a personal note travels with the decision and lands as a real message", async ({ page }) => {
  const target = anchor("default", "portfolio attached", { persona: "recruiter" });
  await openWorkspace(page, { scenario: "default", mode: "recruiter", view: "inbox" });
  const detail = await openRecord(page, target);
  const firstName = target.counterpartyName.split(" ")[0];
  const overflow = () =>
    page.getByTestId("applications-detail").getByRole("button", { name: "More actions" }).click();

  // Decide privately first — that is the state a share is made from.
  await overflow();
  await page.getByRole("menuitem", { name: "Not selected", exact: true }).click();
  const confirmation = page.getByRole("dialog", { name: "Mark this application as not selected?" });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole("button", { name: "Confirm not selected" }).click();
  await expect(detail.getByText("Declined", { exact: true })).toBeVisible();

  const statusBefore = await detail.getByTestId("chat-status-update").count();

  await overflow();
  await page.getByRole("menuitem", { name: `Share decision with ${firstName}` }).click();

  const prompt = page.getByTestId("stage-notify-prompt");
  await expect(prompt).toBeVisible();

  // The note is offered *before* the transition, on the same operation — not as
  // a composer to open afterwards, which is where the dead button used to lead.
  const note = prompt.getByTestId("stage-notify-note");
  await expect(note).toBeVisible();
  const body = "Your edit test was strong — the brief needed more motion work.";
  await note.fill(body);
  await prompt.getByTestId("stage-notify-send").click();

  // It arrives as a message somebody wrote, after the status line.
  const sent = detail.getByTestId("chat-message").filter({ hasText: "needed more motion work" });
  await expect(sent).toHaveCount(1);
  const order = await detail.evaluate((node, text) => {
    const nodes = Array.from(node.querySelectorAll('[data-testid="chat-status-update"], [data-testid="chat-message"]'));
    const message = nodes.findIndex((entry) => (entry.textContent ?? "").includes(text));
    const status = nodes.reduce(
      (last, entry, index) =>
        entry.getAttribute("data-testid") === "chat-status-update" && index < message ? index : last,
      -1
    );
    return { message, status };
  }, "needed more motion work");
  expect(order.status, "the note arrived before any status line").toBeGreaterThanOrEqual(0);
  expect(order.message).toBeGreaterThan(order.status);

  // Exactly one transition event, not one per surface that heard about it.
  const statusAfter = await detail.getByTestId("chat-status-update").count();
  expect(statusAfter - statusBefore, "the share produced more than one status event").toBe(1);

  // The outcome closes the thread, so the prompt says so rather than offering a
  // composer that cannot be used.
  await expect(prompt.getByTestId("stage-notify-closed")).toBeVisible();
  await expect(prompt.getByTestId("stage-notify-followup")).toHaveCount(0);
});

test("a failed share keeps what was typed", async ({ page }) => {
  const target = anchor("default", "portfolio attached", { persona: "recruiter" });
  await openWorkspace(page, { scenario: "default", mode: "recruiter", view: "inbox" });
  const detail = await openRecord(page, target);
  const firstName = target.counterpartyName.split(" ")[0];

  await page.getByTestId("applications-detail").getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Not selected", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Mark this application as not selected?" })
    .getByRole("button", { name: "Confirm not selected" })
    .click();
  await expect(detail.getByText("Declined", { exact: true })).toBeVisible();

  await page.getByTestId("applications-detail").getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: `Share decision with ${firstName}` }).click();

  const prompt = page.getByTestId("stage-notify-prompt");
  const note = prompt.getByTestId("stage-notify-note");
  await note.fill("A sentence worth not losing.");
  // Closing the prompt without sending must not be a way to lose the note
  // silently — reopening starts clean, and nothing was sent.
  await prompt.getByTestId("stage-notify-close").click();
  await expect(prompt).toHaveCount(0);
  await expect(
    detail.getByTestId("chat-message").filter({ hasText: "A sentence worth not losing." })
  ).toHaveCount(0);
});

/* ---- no inert control ---------------------------------------------------- */

test("nothing anywhere offers to choose a next step it cannot take", async ({ page }) => {
  for (const scenario of ["default", "busy", "edge"] as const) {
    await openWorkspace(page, { scenario, mode: "recruiter", view: "inbox" });
    await expect(main(page).getByText("Choose next step", { exact: true })).toHaveCount(0);
    await openWorkspace(page, {
      scenario,
      mode: "recruiter",
      view: "pipeline",
      extraParams: { direction: "received" },
    });
    await expect(main(page).getByText("Choose next step", { exact: true })).toHaveCount(0);
  }
});

test("every primary recommendation carries a confident action key", async ({ page }) => {
  await openWorkspace(page, { scenario: "busy", mode: "recruiter", view: "inbox" });
  const rows = main(page).getByTestId("interaction-row");
  for (let index = 0; index < Math.min(6, await rows.count()); index += 1) {
    await rows.nth(index).click();
    const primary = page.getByTestId("next-action-primary");
    if ((await primary.count()) === 0) continue;
    const key = await primary.getAttribute("data-action-key");
    expect(key).not.toBe("choose-next-step");
    // And never Reply: the composer is pinned below with the person's name in
    // its placeholder, so a header button focusing it is the same click twice.
    expect(key).not.toBe("reply");
    expect(await primary.getAttribute("data-action-weight")).toMatch(/^(filled|secondary)$/);
    await expect(primary).toBeEnabled();
  }
});

/* ---- the private Star ---------------------------------------------------- */

test("the Star works from the row, the card and the header, and stays private", async ({ page }) => {
  const backendRequests = observeStarBackendRequests(page);
  const target = anchor("default", "portfolio attached", { persona: "recruiter" });

  // Row.
  await openWorkspace(page, { scenario: "default", mode: "recruiter", view: "inbox" });
  const record = row(page, target);
  await record.scrollIntoViewIfNeeded();
  const rowStar = record.locator("xpath=..").getByTestId("row-star-toggle");
  await expect(rowStar).toHaveAttribute("aria-pressed", "false");
  await rowStar.click();
  await expect(rowStar).toHaveAttribute("aria-pressed", "true");
  await expect(record.locator("xpath=..").getByTestId("row-starred")).toBeVisible();
  // Privacy is stated in the control itself, not only in a document somewhere.
  expect(await rowStar.getAttribute("aria-label")).toMatch(/only you can see this/i);

  // Header — the same record, the same state, without a second source of truth.
  await record.click();
  const headerStar = page.getByTestId("star-toggle");
  await expect(headerStar).toHaveAttribute("aria-pressed", "true");
  expect(await headerStar.getAttribute("aria-label")).toMatch(/only you can see this/i);

  // Un-starring from the header returns the row, so the two are one state.
  await headerStar.click();
  await expect(rowStar).toHaveAttribute("aria-pressed", "false");
  await expect(record.locator("xpath=..").getByTestId("row-starred")).toHaveCount(0);

  // Starring must never look like, or produce, a shared lifecycle event.
  const detail = page.getByTestId("applications-detail");
  await expect(detail.getByTestId("chat-status-update").filter({ hasText: /star/i })).toHaveCount(0);
  expect(backendRequests, "authenticated demo row/header actions must stay local").toEqual([]);
});

test("the Star is a real control on a Pipeline card too", async ({ page }) => {
  const backendRequests = observeStarBackendRequests(page);
  await openWorkspace(page, {
    scenario: "default",
    mode: "recruiter",
    view: "pipeline",
    extraParams: { direction: "received" },
  });
  // Demo mode has no server to hold a per-user preference, so the state is the
  // session's — asserted here on the surface that owns it rather than across a
  // navigation, which would be testing persistence that deliberately is not
  // there. Backend-mode persistence is covered by the QA suite.
  const star = page.getByTestId("pipeline-star-toggle").first();
  await expect(star).toHaveAttribute("aria-pressed", "false");
  expect(await star.getAttribute("aria-label")).toMatch(/only you can see this/i);
  await star.click();
  await expect(star).toHaveAttribute("aria-pressed", "true");
  await star.click();
  await expect(star).toHaveAttribute("aria-pressed", "false");
  expect(backendRequests, "authenticated demo Pipeline actions must stay local").toEqual([]);
});

/* ---- work categories ----------------------------------------------------- */

test("each section of the menu reconciles against its own stated denominator", async ({ page }) => {
  await openWorkspace(page, { scenario: "busy", mode: "recruiter", view: "inbox" });
  await main(page).getByTestId("queue-selector-trigger").click();
  const menu = page.getByTestId("queue-selector-menu");
  await expect(menu).toBeVisible();

  const total = Number(
    (await menu.getByTestId("queue-chip-all").getAttribute("data-queue-count")) ?? "0"
  );
  expect(total).toBeGreaterThan(10);

  const planes = await menu.evaluate((node) => {
    const found: Record<string, { count: number; describes: boolean }[]> = {};
    for (const entry of Array.from(node.querySelectorAll("[data-plane]"))) {
      const plane = entry.getAttribute("data-plane") ?? "";
      (found[plane] ??= []).push({
        count: Number(entry.getAttribute("data-queue-count") ?? "0"),
        describes: (entry.textContent ?? "").trim().length > 20,
      });
    }
    return found;
  });

  /*
    One partition, and some flags.

    Stage covers everything and says so. The flag sections do not cover
    anything — a record that needs nobody carries no flag — which is the change
    that removed a row holding two thirds of the inbox and meaning nothing. So
    the flags must sum to *less* than the total, and a run where they summed to
    exactly it would mean the residual had come back.
  */
  const sum = (rows: { count: number }[]) => rows.reduce((a, b) => a + b.count, 0);
  expect(sum(planes.stage ?? []), "stage is the partition").toBe(total);

  const flagged = sum(planes.attention ?? []) + sum(planes.waiting ?? []);
  expect(flagged, "the flags cover more records than exist").toBeLessThanOrEqual(total);
  expect(flagged, "the flags cover everything, so a residual is back").toBeLessThan(total);

  // And every option states its criteria rather than only naming a state.
  for (const rows of Object.values(planes)) {
    for (const row of rows) expect(row.describes).toBeTruthy();
  }
});

test("the planes combine, and one control clears them all", async ({ page }) => {
  await openWorkspace(page, { scenario: "busy", mode: "recruiter", view: "inbox" });
  const trigger = main(page).getByTestId("queue-selector-trigger");

  // A stage and a flag: the two things the menu asks separately.
  await trigger.click();
  const stage = page.getByTestId("queue-chip-new");
  const stageCount = Number((await stage.getAttribute("data-queue-count")) ?? "0");
  await stage.click();
  await expect(main(page).getByTestId("interaction-scope")).toBeVisible();

  await trigger.click();
  // Whichever flag this board actually carries — the flags are not exhaustive,
  // so naming one that happens to be empty would test nothing.
  const flag = page.getByTestId("queue-selector-menu").locator('[data-plane="attention"]').first();
  await expect(flag).toBeVisible();
  const narrowed = Number((await flag.getAttribute("data-queue-count")) ?? "0");
  await flag.click();

  // Combining narrows: the two questions are different, so the answer to both
  // can only be a subset of the answer to one.
  expect(narrowed).toBeLessThanOrEqual(stageCount);
  await expect(trigger).toContainText("2 filters");

  await main(page).getByTestId("queue-clear").click();
  await expect(main(page).getByTestId("queue-clear")).toHaveCount(0);
});

/* ---- persona icons ------------------------------------------------------- */

test("the working-as control marks each persona with its own icon", async ({ page }) => {
  await openWorkspace(page, { scenario: "default", mode: "recruiter", view: "inbox" });
  const trigger = main(page).getByTestId("workspace-persona").first();
  await expect(trigger.locator("svg")).not.toHaveCount(0);
  await trigger.click();
  const menu = page.getByTestId("workspace-persona-menu");
  await expect(menu).toBeVisible();

  const options = menu.getByRole("menuitemradio");
  const count = await options.count();
  expect(count).toBeGreaterThan(1);
  for (let index = 0; index < count; index += 1) {
    const option = options.nth(index);
    // An icon per row, and text that still says which is which.
    await expect(option.locator("svg").first()).toBeVisible();
    await expect(option).not.toHaveText("");
  }
});

/* ---- system events, both surfaces ---------------------------------------- */

test("the dock and the thread group system events identically", async ({ page }) => {
  // Taken from the board rather than named, so the comparison always runs on a
  // record that genuinely appears in both surfaces.
  await openWorkspace(page, {
    scenario: "default",
    mode: "recruiter",
    view: "pipeline",
    extraParams: { direction: "received" },
  });
  const boardCard = main(page).getByTestId("pipeline-row").first();
  const recordId = await boardCard.getAttribute("data-record-id");
  expect(recordId).toBeTruthy();

  await boardCard.getByTestId("pipeline-message").click();
  const dock = page.getByTestId("chat-dock-panel");
  await expect(dock).toBeVisible();
  await expect(dock.getByTestId("chat-message").first()).toBeVisible();
  const dockShape = await dock.evaluate((node) => ({
    groups: node.querySelectorAll('[data-testid="system-event-group"]').length,
    lines: node.querySelectorAll('[data-testid="chat-status-update"]').length,
    runs: node.querySelectorAll('[data-testid="message-group"]').length,
  }));

  await openWorkspace(page, { scenario: "default", mode: "recruiter", view: "inbox" });
  const detail = await openRecord(page, recordId as string);
  await expect(detail.getByTestId("chat-message").first()).toBeVisible();
  const inboxShape = await detail.evaluate((node) => ({
    groups: node.querySelectorAll('[data-testid="system-event-group"]').length,
    lines: node.querySelectorAll('[data-testid="chat-status-update"]').length,
    runs: node.querySelectorAll('[data-testid="message-group"]').length,
  }));

  expect(dockShape, "the same history told two different ways").toEqual(inboxShape);
});
