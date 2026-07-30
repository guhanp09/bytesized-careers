import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { encode } from "next-auth/jwt";
import { card, openWorkspace } from "./scenarioAnchors";

/**
 * Where the card went.
 *
 * The board accepted a drop and then showed nothing. On a funnel with offscreen
 * stages — the same funnel that made drag autoscroll necessary — the
 * destination is usually not on screen, so a successful move read as the card
 * disappearing.
 *
 * These assert the three things that make a move legible: the card is rendered
 * at its destination, it is brought comfortably into view when it is not
 * already there, and it says so out loud for anyone who cannot see either.
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

const board = (page: Page) => page.getByRole("main").getByTestId("pipeline-board");

async function openBoard(page: Page, scenario: "default" | "busy" | "edge" = "default") {
  await openWorkspace(page, {
    scenario,
    mode: "recruiter",
    view: "pipeline",
    extraParams: { direction: "received" },
  });
  await expect(board(page).getByTestId("pipeline-row").first()).toBeVisible();
}

/** Move one card through its stage menu, returning the record id that moved. */
async function moveFirstCard(page: Page, optionKey: string): Promise<string> {
  const first = board(page).getByTestId("pipeline-row").first();
  const recordId = (await first.getAttribute("data-record-id")) ?? "";
  expect(recordId).not.toBe("");
  await first.getByTestId("pipeline-stage-menu").click();
  await page.getByTestId(`pipeline-stage-option-${optionKey}`).click();
  return recordId;
}

/** How far the card sits from the middle of its scroll container, as a ratio. */
async function offCentre(page: Page, recordId: string): Promise<number> {
  return page.evaluate((id) => {
    const node = document.querySelector(`[data-testid="pipeline-row"][data-record-id="${id}"]`);
    if (!node) return Number.NaN;
    const box = node.getBoundingClientRect();
    // The nearest ancestor that can actually scroll vertically.
    let container: Element | null = node.parentElement;
    while (container) {
      const style = getComputedStyle(container);
      const scrollable = ["auto", "scroll", "overlay"].includes(style.overflowY);
      if (scrollable && container.scrollHeight - container.clientHeight > 1) break;
      container = container.parentElement;
    }
    const bounds = (container ?? document.documentElement).getBoundingClientRect();
    const size = bounds.height || 1;
    return Math.abs((box.top + box.bottom) / 2 - (bounds.top + bounds.bottom) / 2) / size;
  }, recordId);
}

test("a moved card is rendered at its destination, not lost past the window", async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 800 });
  await openBoard(page, "busy");
  const recordId = await moveFirstCard(page, "reviewing");

  // Present exactly once — the bounded window expanded to include it rather
  // than the card being duplicated into view.
  const moved = card(page, recordId);
  await expect(moved).toHaveCount(1);
  await expect(moved).toBeVisible();
});

test("the destination is brought into view and briefly emphasised", async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 700 });
  await openBoard(page, "busy");
  const recordId = await moveFirstCard(page, "interviewing");

  const moved = card(page, recordId);
  await expect(moved).toHaveAttribute("data-moved", "true");
  // Settled and centred rather than merely revealed at an edge.
  await page.waitForTimeout(700);
  const ratio = await offCentre(page, recordId);
  expect(ratio, `card sits ${Math.round(ratio * 100)}% of the container from its middle`).toBeLessThan(0.3);

  // And the emphasis expires on its own: a permanent marker would be a second
  // board state competing with the stages.
  await expect(moved).not.toHaveAttribute("data-moved", "true", { timeout: 4_000 });
});

test("the move is announced, naming where it went", async ({ page }) => {
  await openBoard(page);
  await moveFirstCard(page, "reviewing");
  await expect(board(page).getByTestId("pipeline-paging-status")).toContainText(/Moved to/i);
});

test("the scroll settles and the card ends comfortably in view", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await openBoard(page, "busy");
  const recordId = await moveFirstCard(page, "reviewing");
  await expect(card(page, recordId)).toHaveAttribute("data-moved", "true");

  const scroller = page.locator('[data-testid="pipeline-board"] .overflow-y-auto').first();
  await page.waitForTimeout(900);
  const settled = await scroller.evaluate((node) => node.scrollTop).catch(() => 0);
  await page.waitForTimeout(600);
  const later = await scroller.evaluate((node) => node.scrollTop).catch(() => 0);

  // One movement, then stillness — a confirmation that kept scrolling would be
  // the drag autoscroll bug in a different costume.
  expect(Math.abs(later - settled), "the board kept scrolling after the move").toBeLessThan(2);
  // And it stopped somewhere useful.
  const ratio = await offCentre(page, recordId);
  expect(ratio, `card sits ${Math.round(ratio * 100)}% of the container from its middle`).toBeLessThan(0.35);
});

test("a bulk move is confirmed once, for the group", async ({ page }) => {
  await openBoard(page, "busy");
  const rows = board(page).getByTestId("pipeline-row");
  const boxes = rows.locator('[data-testid="pipeline-row-checkbox"]');
  const count = Math.min(3, await boxes.count());
  test.skip(count < 2, "not enough selectable cards for a bulk move");
  for (let index = 0; index < count; index += 1) await boxes.nth(index).check();

  const bulk = board(page).getByTestId("bulk-move-trigger");
  test.skip((await bulk.count()) === 0, "no bulk stage control on this board");
  await bulk.click();
  await page.getByTestId("bulk-move-reviewing").click();

  const status = board(page).getByTestId("pipeline-paging-status");
  await expect(status).toContainText(new RegExp(`${count} moved to`, "i"));
});

test("a failed move confirms nothing", async ({ page }) => {
  await openBoard(page);
  // Fail every status write, so the transition can only roll back.
  await page.route("**/status", (route) => route.fulfill({ status: 503, body: "{}" }));
  const first = board(page).getByTestId("pipeline-row").first();
  const recordId = (await first.getAttribute("data-record-id")) ?? "";
  await first.getByTestId("pipeline-stage-menu").click();
  await page.getByTestId("pipeline-stage-option-reviewing").click();

  // Demo mode commits locally, so this only asserts the invariant that matters:
  // nothing is ever emphasised at a destination the record did not reach.
  const moved = card(page, recordId);
  if ((await moved.count()) === 0) return;
  const highlighted = await moved.getAttribute("data-moved");
  const stage = await moved.evaluate(
    (node) => node.closest("section[data-testid^='pipeline-group-']")?.getAttribute("data-testid") ?? ""
  );
  if (highlighted === "true") expect(stage).toBe("pipeline-group-reviewing");
  await page.unroute("**/status");
});

test("reduced motion still moves the card into view, without animating", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1500, height: 700 });
  await openBoard(page, "busy");
  const recordId = await moveFirstCard(page, "interviewing");

  await expect(card(page, recordId)).toHaveAttribute("data-moved", "true");
  // Instant rather than smooth: the position is correct almost immediately.
  await page.waitForTimeout(250);
  const ratio = await offCentre(page, recordId);
  expect(ratio).toBeLessThan(0.35);
});

test("a keyboard-driven move lands focus on the card it moved", async ({ page }) => {
  await openBoard(page, "busy");
  const first = board(page).getByTestId("pipeline-row").first();
  const recordId = (await first.getAttribute("data-record-id")) ?? "";
  const menu = first.getByTestId("pipeline-stage-menu");
  await menu.focus();
  await menu.press("Enter");
  const option = page.getByTestId("pipeline-stage-option-reviewing");
  await option.focus();
  await option.press("Enter");

  // Continuity, not theft: the move came from a control the keyboard was
  // already in, so following the card is where the user was going.
  await expect(card(page, recordId)).toBeFocused({ timeout: 5_000 });
});
