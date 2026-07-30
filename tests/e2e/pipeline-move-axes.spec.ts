import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { encode } from "next-auth/jwt";
import { anchor, card, openWorkspace } from "./scenarioAnchors";

/**
 * Which way the card went.
 *
 * `pipeline-move-confirmation.spec.ts` covers the ordinary case: a card sent
 * further down a funnel that is taller than the window. The axis maths behind
 * it is unit-tested in `tests/moveConfirmation.test.mjs`, but only two of its
 * four directions were ever exercised in a browser — downward and vertical.
 *
 * The two that were not are the ones most likely to break silently. Moving a
 * card *back* means the destination is above the current scroll position, so a
 * confirmation that only ever scrolls forward leaves the reader staring at the
 * gap the card left. And the board scrolls horizontally at narrow widths, where
 * a purely vertical confirmation moves the viewport along an axis that was
 * already correct and not along the one that was not.
 *
 * Backwards is a narrow door on purpose. `APPLICATION_TRANSITIONS` offers no
 * route back to New from anywhere, and a rejection the applicant has already
 * been told about offers no route at all — reopening it would be the product
 * un-saying something a person has read. The one genuine reconsideration is a
 * rejection saved *privately*, which is the record these use.
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

async function openBoard(page: Page, scenario: "default" | "busy" = "busy") {
  await openWorkspace(page, {
    scenario,
    mode: "recruiter",
    view: "pipeline",
    extraParams: { direction: "received" },
  });
  await expect(board(page).getByTestId("pipeline-row").first()).toBeVisible();
}

/** How far the card sits from the middle of its scroll container, per axis. */
async function offCentre(page: Page, recordId: string, axis: "vertical" | "horizontal") {
  return page.evaluate(
    ({ id, wanted }) => {
      const node = document.querySelector(`[data-testid="pipeline-row"][data-record-id="${id}"]`);
      if (!node) return Number.NaN;
      const box = node.getBoundingClientRect();
      let container: Element | null = node.parentElement;
      while (container) {
        const style = getComputedStyle(container);
        const overflow = wanted === "vertical" ? style.overflowY : style.overflowX;
        const scrollable = ["auto", "scroll", "overlay"].includes(overflow);
        const extent =
          wanted === "vertical"
            ? container.scrollHeight - container.clientHeight
            : container.scrollWidth - container.clientWidth;
        if (scrollable && extent > 1) break;
        container = container.parentElement;
      }
      const bounds = (container ?? document.documentElement).getBoundingClientRect();
      const size = (wanted === "vertical" ? bounds.height : bounds.width) || 1;
      const cardMid = wanted === "vertical" ? (box.top + box.bottom) / 2 : (box.left + box.right) / 2;
      const boundsMid =
        wanted === "vertical" ? (bounds.top + bounds.bottom) / 2 : (bounds.left + bounds.right) / 2;
      return Math.abs(cardMid - boundsMid) / size;
    },
    { id: recordId, wanted: axis }
  );
}

/** Move a card from a named stage group, returning the record id that moved. */
async function moveFromStage(page: Page, fromStage: string, toOption: string): Promise<string> {
  const group = board(page).getByTestId(`pipeline-group-${fromStage}`);
  const row = group.getByTestId("pipeline-row").first();
  await expect(row).toBeVisible();
  const recordId = (await row.getAttribute("data-record-id")) ?? "";
  expect(recordId, `no card in ${fromStage} to move`).not.toBe("");
  await row.scrollIntoViewIfNeeded();
  await row.getByTestId("pipeline-stage-menu").click();
  await page.getByTestId(`pipeline-stage-option-${toOption}`).click();
  return recordId;
}

/** The privately-rejected record: the one reconsideration the product allows. */
const reconsiderable = () => anchor("default", "saved privately", { persona: "recruiter" });

/**
 * Bring one record onto the board by searching for it, as a person would.
 *
 * The board renders a bounded window and grows it on scroll, so a card can
 * match every filter and still not be in the DOM. Searching is the path a user
 * has, and it leaves the board short enough that a move's destination is a real
 * scroll away rather than accidentally adjacent.
 */
async function findOnBoard(page: Page, target: ReturnType<typeof anchor>) {
  await board(page).getByTestId("pipeline-search").fill(target.counterpartyName);
  const row = card(page, target.recordId);
  await expect(row).toHaveCount(1);
  await row.scrollIntoViewIfNeeded();
  return row;
}

async function reconsider(page: Page, target: ReturnType<typeof anchor>, toOption: string) {
  const row = await findOnBoard(page, target);
  await row.getByTestId("pipeline-stage-menu").click();
  await page.getByTestId(`pipeline-stage-option-${toOption}`).click();
}

test("a card sent backwards is followed upwards, not left behind", async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 700 });
  await openBoard(page, "default");

  // Rejected sits below Reviewing, so this destination is above the card — the
  // direction a confirmation that only ever scrolls forward gets wrong.
  const target = reconsiderable();
  await reconsider(page, target, "reviewing");

  const moved = card(page, target.recordId);
  await expect(moved).toHaveAttribute("data-moved", "true");
  await expect(moved).toBeVisible();

  await page.waitForTimeout(800);
  const ratio = await offCentre(page, target.recordId, "vertical");
  expect(
    ratio,
    `card sits ${Math.round(ratio * 100)}% of the container from its middle after moving back`
  ).toBeLessThan(0.35);

  const stage = await moved.evaluate(
    (node) => node.closest("section[data-testid^='pipeline-group-']")?.getAttribute("data-testid") ?? ""
  );
  expect(stage).toBe("pipeline-group-reviewing");
});

test("moving backwards is announced with its destination, like any other move", async ({ page }) => {
  await openBoard(page, "default");
  await reconsider(page, reconsiderable(), "reviewing");
  // A move the reader did not expect to be possible is the one that most needs
  // saying out loud.
  await expect(board(page).getByTestId("pipeline-paging-status")).toContainText(/Moved to Reviewing/i);
});

test("a rejection the applicant was told about offers no way back", async ({ page }) => {
  // The counterpart to the two above. Reopening a decision somebody has
  // already read would be the product un-saying it, so the reconsideration
  // options are absent — Archived remains, because tidying up is not reopening.
  await openBoard(page, "busy");
  const rejected = board(page).getByTestId("pipeline-group-rejected").getByTestId("pipeline-row");
  test.skip((await rejected.count()) === 0, "no rejected card on this board");

  const first = rejected.first();
  await first.scrollIntoViewIfNeeded();
  await first.getByTestId("pipeline-stage-menu").click();
  await expect(page.getByTestId("pipeline-stage-option-reviewing")).toHaveCount(0);
  await expect(page.getByTestId("pipeline-stage-option-interviewing")).toHaveCount(0);
  await expect(page.getByTestId("pipeline-stage-option-archived")).toHaveCount(1);
});

test("at a narrow width the card is brought into view along the axis that was wrong", async ({
  page,
}) => {
  // Narrow enough that the board scrolls sideways rather than wrapping.
  await page.setViewportSize({ width: 620, height: 900 });
  await openBoard(page);

  const recordId = await moveFromStage(page, "new", "interviewing");
  const moved = card(page, recordId);
  await expect(moved).toHaveAttribute("data-moved", "true");
  await expect(moved).toBeVisible();
  await page.waitForTimeout(900);

  // Whichever axis actually scrolls here, the card ends up on screen: the
  // failure this guards against is a confirmation that corrects one axis and
  // leaves the card off the edge of the other.
  const box = await moved.boundingBox();
  expect(box, "the moved card has no box").not.toBeNull();
  const viewport = page.viewportSize();
  expect(box!.x + box!.width).toBeGreaterThan(0);
  expect(box!.x).toBeLessThan(viewport!.width);
  expect(box!.y + box!.height).toBeGreaterThan(0);
  expect(box!.y).toBeLessThan(viewport!.height);
});

test("the page itself never scrolls sideways to reveal a moved card", async ({ page }) => {
  // Centring inside a container is a fix; widening the document is a bug that
  // moves every other column too.
  await page.setViewportSize({ width: 620, height: 900 });
  await openBoard(page);
  await moveFromStage(page, "new", "hired");
  await page.waitForTimeout(900);

  const overflow = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.body.clientWidth,
  }));
  expect(overflow.doc, "the document scrolls horizontally").toBeLessThanOrEqual(1);
  expect(overflow.body, "the body scrolls horizontally").toBeLessThanOrEqual(1);
});

test("whichever way it went, the board comes to rest", async ({ page }) => {
  // Both directions share one failure mode: a confirmation that corrects the
  // position and then keeps correcting it, which is the drag-autoscroll bug
  // wearing a different hat.
  await page.setViewportSize({ width: 1500, height: 700 });
  await openBoard(page, "default");
  const target = reconsiderable();
  await reconsider(page, target, "reviewing");
  await expect(card(page, target.recordId)).toHaveAttribute("data-moved", "true");

  const scroller = page.locator('[data-testid="pipeline-board"] .overflow-y-auto').first();
  await page.waitForTimeout(900);
  const settled = await scroller.evaluate((node) => node.scrollTop).catch(() => 0);
  await page.waitForTimeout(600);
  const later = await scroller.evaluate((node) => node.scrollTop).catch(() => 0);
  expect(Math.abs(later - settled), "the board kept scrolling after moving backwards").toBeLessThan(2);
});
