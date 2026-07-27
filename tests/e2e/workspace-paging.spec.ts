import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { encode } from "next-auth/jwt";
import { anchor, applicantCount, jobWithApplicants, manifest, openWorkspace, revealRecord, row } from "./scenarioAnchors";
import { INBOX_PAGE_SIZE, PIPELINE_STAGE_PAGE_SIZE } from "../../lib/workspacePaging";

/**
 * Bounded rendering, and everything that must survive it.
 *
 * The workspace used to render every record it had: 329 rows and 23,000 nodes on
 * first paint for the `busy` scenario, and 214 cards in one stage. It now renders
 * a page and offers to render more.
 *
 * The risk in that change is not performance, it is honesty — a list that shows
 * forty of three hundred and calls it three hundred, or a filter that narrows the
 * total but leaves a stale window, or a deep link to a record on page four that
 * silently opens nothing. These are the tests for that.
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

const rowIds = (page: Page) =>
  page.getByRole("main").getByTestId("interaction-row").evaluateAll((els) =>
    els.map((el) => el.getAttribute("data-record-id") ?? "")
  );

test.beforeEach(async ({ context }) => {
  await signIn(context);
});

test.describe("Inbox", () => {
  test("renders one page of a large scenario while stating the true total", async ({ page }) => {
    await openWorkspace(page, { scenario: "busy", mode: "recruiter", view: "inbox" });
    const main = page.getByRole("main");
    const total = manifest("busy").relationships.length;

    const rendered = await main.getByTestId("interaction-row").count();
    expect(rendered).toBe(INBOX_PAGE_SIZE);
    expect(rendered).toBeLessThan(total);
    // The number the reader sees must be the real one, not the size of the DOM.
    await expect(main.getByTestId("inbox-showing")).toHaveText(
      `Showing ${INBOX_PAGE_SIZE} of ${total} conversations`
    );
  });

  test("loading more adds a page, without duplicating or reordering what was there", async ({ page }) => {
    await openWorkspace(page, { scenario: "busy", mode: "recruiter", view: "inbox" });
    const main = page.getByRole("main");
    const before = await rowIds(page);

    await main.getByTestId("inbox-load-more").click();
    const after = await rowIds(page);

    expect(after.length).toBe(before.length + INBOX_PAGE_SIZE);
    // The first page is still the first page, in the same order.
    expect(after.slice(0, before.length)).toEqual(before);
    expect(new Set(after).size, "a conversation was rendered twice").toBe(after.length);
  });

  test("every conversation is reachable, and the end says so", async ({ page }) => {
    await openWorkspace(page, { scenario: "busy", mode: "recruiter", view: "inbox" });
    const main = page.getByRole("main");
    const total = manifest("busy").relationships.length;
    const loadMore = main.getByTestId("inbox-load-more");

    let presses = 0;
    while ((await loadMore.count()) > 0) {
      await loadMore.click();
      presses += 1;
      expect(presses, "loading more stopped making progress").toBeLessThan(40);
    }

    const ids = await rowIds(page);
    expect(ids.length).toBe(total);
    expect(new Set(ids).size).toBe(total);
    // Reaching the end is a state, and the product says it rather than just
    // removing the button.
    await expect(main.getByTestId("inbox-list-end")).toHaveText(`All ${total} conversations shown`);
  });

  test("the control announces what happened, without moving focus", async ({ page }) => {
    await openWorkspace(page, { scenario: "busy", mode: "recruiter", view: "inbox" });
    const main = page.getByRole("main");
    const loadMore = main.getByTestId("inbox-load-more");

    // Reached and activated from the keyboard alone.
    await loadMore.focus();
    await expect(loadMore).toBeFocused();
    await page.keyboard.press("Enter");

    await expect(main.getByTestId("inbox-paging-status")).toHaveText(
      `${INBOX_PAGE_SIZE} more conversations loaded. Showing ${INBOX_PAGE_SIZE * 2} of ${
        manifest("busy").relationships.length
      }.`
    );
    // Focus stays where the reader put it; a list that grows must not steal it.
    await expect(loadMore).toBeFocused();
  });

  test("a filter changes the total and restarts the window rather than emptying the list", async ({ page }) => {
    await openWorkspace(page, { scenario: "busy", mode: "recruiter", view: "inbox" });
    const main = page.getByRole("main");
    await main.getByTestId("inbox-load-more").click();
    await main.getByTestId("inbox-load-more").click();
    expect(await main.getByTestId("interaction-row").count()).toBeGreaterThan(INBOX_PAGE_SIZE);

    // `busy` is recruiter-facing, so Outreach is genuinely small. A stale offset
    // would leave this looking empty.
    await main.getByTestId("applications-filter-sent").click();
    const sent = await main.getByTestId("interaction-row").count();
    const sentTotal = manifest("busy").relationships.filter((rel) => rel.kind !== "application").length;
    expect(sent).toBe(Math.min(sentTotal, INBOX_PAGE_SIZE));

    await main.getByTestId("applications-filter-all").click();
    expect(await main.getByTestId("interaction-row").count()).toBeGreaterThan(0);
  });

  test("queue counts describe every record, not just the rendered page", async ({ page }) => {
    await openWorkspace(page, { scenario: "busy", mode: "recruiter", view: "inbox" });
    const main = page.getByRole("main");
    const total = manifest("busy").relationships.length;
    // The scope chips carry totals; they must exceed what is on screen.
    await expect(main.getByTestId("applications-filter-all")).toContainText(String(total));
    expect(await main.getByTestId("interaction-row").count()).toBeLessThan(total);
  });

  test("a deep-linked conversation opens even when it is past the first page", async ({ page }) => {
    // The 44-message thread sits deep in `busy`; a notification link to it must
    // work rather than opening whatever happens to be first.
    const deep = anchor("busy", "44 messages", { persona: "recruiter" });
    await openWorkspace(page, {
      scenario: "busy",
      mode: "recruiter",
      view: "inbox",
      thread: deep.recordId,
    });
    const main = page.getByRole("main");
    await expect(main.getByTestId("applications-detail")).toContainText(deep.counterpartyName);
    // And its row is rendered, selected, in place — not hidden behind Load more.
    await expect(row(page, deep)).toHaveAttribute("aria-pressed", "true");
  });

  test("a remembered conversation past the first page survives leaving and returning", async ({ page }) => {
    const deep = anchor("busy", "44 messages", { persona: "recruiter" });
    await openWorkspace(page, { scenario: "busy", mode: "recruiter", view: "inbox" });
    await revealRecord(page, deep);
    await row(page, deep).click();
    const main = page.getByRole("main");
    await expect(main.getByTestId("applications-detail")).toContainText(deep.counterpartyName);

    await page.goto("/jobs", { waitUntil: "domcontentloaded" });
    await openWorkspace(page, { scenario: "busy", mode: "recruiter", view: "inbox" });

    // Still open, and still rendered: the window grew to reach it rather than
    // the selection being dropped for being off the first page.
    await expect(main.getByTestId("applications-detail")).toContainText(deep.counterpartyName, {
      timeout: 15_000,
    });
    await expect(row(page, deep)).toHaveAttribute("aria-pressed", "true");
  });

  test("a small scenario shows no paging controls at all", async ({ page }) => {
    // Paging must be invisible where it is not needed.
    await openWorkspace(page, { scenario: "edge", mode: "recruiter", view: "inbox" });
    const main = page.getByRole("main");
    expect(manifest("edge").relationships.length).toBeLessThan(INBOX_PAGE_SIZE);
    await expect(main.getByTestId("inbox-load-more")).toHaveCount(0);
    await expect(main.getByTestId("inbox-showing")).toHaveCount(0);
    await expect(main.getByTestId("inbox-list-end")).toHaveCount(0);
  });

  test("paging works on a narrow viewport", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openWorkspace(page, { scenario: "busy", mode: "recruiter", view: "inbox" });
    const main = page.getByRole("main");
    const loadMore = main.getByTestId("inbox-load-more");
    await expect(loadMore).toBeVisible();
    await loadMore.click();
    expect(await main.getByTestId("interaction-row").count()).toBe(INBOX_PAGE_SIZE * 2);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

test.describe("Pipeline", () => {
  test("each stage renders a bounded set while its heading keeps the true total", async ({ page }) => {
    await openWorkspace(page, { scenario: "busy", mode: "recruiter", view: "pipeline" });
    const main = page.getByRole("main");
    await expect(main.getByTestId("pipeline-row").first()).toBeVisible({ timeout: 30_000 });

    const stages = await page.evaluate(() => {
      const out: Array<{ key: string; heading: number; rendered: number }> = [];
      for (const section of document.querySelectorAll('[data-testid^="pipeline-group-"]')) {
        const key = (section.getAttribute("data-testid") ?? "").replace("pipeline-group-", "");
        const heading = Number(section.querySelector("h3 + span")?.textContent ?? "0");
        const rendered = section.querySelectorAll('[data-testid="pipeline-row"]').length;
        out.push({ key, heading, rendered });
      }
      return out;
    });
    expect(stages.length).toBeGreaterThan(0);

    for (const stage of stages) {
      // The heading is the truth about the stage; the cards are a page of it.
      expect(stage.rendered, `${stage.key} rendered more than a page`).toBeLessThanOrEqual(
        PIPELINE_STAGE_PAGE_SIZE
      );
      if (stage.heading > PIPELINE_STAGE_PAGE_SIZE) {
        expect(stage.rendered, `${stage.key} should be capped`).toBe(PIPELINE_STAGE_PAGE_SIZE);
      } else {
        expect(stage.rendered, `${stage.key} should render all it has`).toBe(stage.heading);
      }
    }
    // Empty stages stay compact rather than becoming card-height containers.
    for (const stage of stages.filter((entry) => entry.heading === 0)) {
      expect(stage.rendered).toBe(0);
    }
  });

  test("showing more in one stage does not expand the others", async ({ page }) => {
    await openWorkspace(page, { scenario: "busy", mode: "recruiter", view: "pipeline" });
    const main = page.getByRole("main");
    await expect(main.getByTestId("pipeline-row").first()).toBeVisible({ timeout: 30_000 });

    const busiest = main.getByTestId("pipeline-group-new");
    const before = await busiest.getByTestId("pipeline-row").count();
    const othersBefore = await main.getByTestId("pipeline-row").count();

    await main.getByTestId("pipeline-show-more-new").click();
    const after = await busiest.getByTestId("pipeline-row").count();
    expect(after).toBeGreaterThan(before);
    // Only that stage grew.
    expect(await main.getByTestId("pipeline-row").count()).toBe(othersBefore + (after - before));
  });

  test("a focused stage renders more, but still bounded", async ({ page }) => {
    await openWorkspace(page, { scenario: "busy", mode: "recruiter", view: "pipeline" });
    const main = page.getByRole("main");
    await expect(main.getByTestId("pipeline-row").first()).toBeVisible({ timeout: 30_000 });

    await main.getByTestId("pipeline-scope").selectOption("new");
    await expect(main.getByTestId("pipeline-group-new")).toBeVisible();
    const rendered = await main.getByTestId("pipeline-row").count();
    const total = Number(
      (await main.getByTestId("pipeline-group-new").locator("h3 + span").textContent()) ?? "0"
    );
    expect(rendered).toBeGreaterThan(PIPELINE_STAGE_PAGE_SIZE);
    // Focusing a stage is a request to see that stage, not permission to render
    // every card in it — which is how 214 cards reached the DOM.
    expect(rendered).toBeLessThan(total);
  });

  test("the named volume jobs carry exactly the applicants the scenario promises", async ({ page }) => {
    // The scenario contract, checked against the data the board is reading.
    const named = [214, 47, 1].map((count) => ({ count, job: jobWithApplicants("busy", count) }));
    for (const { count, job } of named) {
      expect(applicantCount("busy", job.id)).toBe(count);
    }
    const zero = manifest("busy").jobs.filter((job) => applicantCount("busy", job.id) === 0);
    expect(zero.length, "busy must carry a job nobody applied to").toBeGreaterThan(0);

    // And the board renders without putting all 214 of them on screen.
    await openWorkspace(page, { scenario: "busy", mode: "recruiter", view: "pipeline" });
    const main = page.getByRole("main");
    await expect(main.getByTestId("pipeline-row").first()).toBeVisible({ timeout: 30_000 });
    expect(await main.getByTestId("pipeline-row").count()).toBeLessThan(214);
  });

  test("moving a card leaves it visible in its destination, and both counts follow", async ({ page }) => {
    await openWorkspace(page, { scenario: "recruiter", mode: "recruiter", view: "pipeline" });
    const main = page.getByRole("main");
    const target = anchor("recruiter", "stage new", { persona: "recruiter" });
    const card = main.locator(`[data-testid="pipeline-row"][data-record-id="${target.recordId}"]`);
    await card.scrollIntoViewIfNeeded();

    const reviewing = main.getByTestId("pipeline-group-reviewing");
    const before = Number((await reviewing.locator("h3 + span").textContent()) ?? "0");

    await card.getByTestId("pipeline-stage-menu").click();
    await page.getByTestId("pipeline-stage-option-reviewing").click();

    await expect(reviewing.locator("h3 + span")).toHaveText(String(before + 1));
    // The card is where it landed, not swallowed by the destination's window.
    await expect(reviewing.locator(`[data-record-id="${target.recordId}"]`)).toHaveCount(1);
  });

  test("the board stays bounded on a narrow viewport", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openWorkspace(page, { scenario: "busy", mode: "recruiter", view: "pipeline" });
    const main = page.getByRole("main");
    await expect(main.getByTestId("pipeline-row").first()).toBeVisible({ timeout: 30_000 });
    expect(await main.getByTestId("pipeline-row").count()).toBeLessThan(
      manifest("busy").relationships.length
    );
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
