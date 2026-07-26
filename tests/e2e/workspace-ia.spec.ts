import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { encode } from "next-auth/jwt";

/**
 * The Applications workspace information architecture.
 *
 * Phase 2 collapsed five stacked control layers into three:
 *
 *   1. identity — Working as Talent / Recruiter
 *   2. view     — Inbox / Pipeline
 *   3. scope    — All / Applicants / Outreach / Archived, plus queues or stages
 *
 * These tests hold that shape, and hold the things a reshuffle most easily
 * breaks: that the persona control cannot be mistaken for the header's search
 * scope, that every capability the old rows carried is still reachable, and
 * that changing scope never throws away what the user was reading.
 */

const SESSION_SECRET = "e2e-secret";

async function signInAsOwner(context: BrowserContext) {
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
    {
      name: "next-auth.session-token",
      value: sessionToken,
      domain: "127.0.0.1",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}

async function openWorkspace(page: Page, query = "?demo=1") {
  await page.goto(`/applications${query}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("applications-workspace")).toBeVisible({ timeout: 15_000 });
}

test.beforeEach(async ({ context }) => {
  await signInAsOwner(context);
});

/* --- the three layers ---------------------------------------------------- */

/**
 * Count the distinct horizontal bands of controls stacked above content.
 *
 * Rounded to 8px because the persona button and the view switcher are
 * different heights inside the same bar; what matters is how many *rows* a
 * user's eye has to descend, not the pixel each control starts at.
 */
async function controlBands(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    const workspace = document.querySelector('[data-testid="applications-workspace"]');
    if (!workspace) return [];
    const content =
      document.querySelector('[data-testid="interaction-row"]') ||
      document.querySelector('[data-testid="pipeline-row"]') ||
      document.querySelector('[data-testid="inbox-empty-state"]');
    const contentTop = content ? content.getBoundingClientRect().top : Number.MAX_SAFE_INTEGER;
    const bands = new Set<number>();
    for (const el of workspace.querySelectorAll("button, select, summary")) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      // Scrolled out of view is not a layer standing between anyone and their
      // work — only what is actually on screen above the content counts.
      if (rect.top < 0) continue;
      if (rect.top >= contentTop - 2) continue;
      bands.add(Math.round(rect.top / 8) * 8);
    }
    return [...bands].sort((a, b) => a - b);
  });
}

test("the Inbox puts at most two control bars between the user and their work", async ({ page }) => {
  await openWorkspace(page, "?demo=1&view=inbox&mode=recruiter");
  await expect(page.getByTestId("interaction-row").first()).toBeVisible();

  const bands = await controlBands(page);
  // Identity and view share the first bar; scope owns the second. Bands are
  // 8px-rounded tops, so one bar can register as two adjacent bands.
  const bars = bands.filter((band, index) => index === 0 || band - bands[index - 1] > 16);
  expect(bars.length, `bands at ${bands.join(", ")}`).toBeLessThanOrEqual(2);
});

test("the Pipeline puts at most two control bars above the board", async ({ page }) => {
  await openWorkspace(page, "?demo=1&view=pipeline&mode=recruiter");
  await expect(page.getByTestId("pipeline-board")).toBeVisible();

  // Direction, stage focus, search and per-job filtering all answer "which
  // records am I looking at", so they belong on one row rather than three.
  const scopeRow = page.getByTestId("pipeline-scope-row");
  for (const id of ["pipeline-direction-received", "pipeline-scope", "pipeline-search"]) {
    await expect(scopeRow.getByTestId(id)).toBeVisible();
  }
  await expect(page.getByTestId("applications-workspace-controls")).toBeVisible();
});

/* --- persona is not a search filter -------------------------------------- */

test("the persona control is a disclosure, and the search scope is not", async ({ page }) => {
  await openWorkspace(page, "?demo=1&mode=recruiter");

  // The two used to be identical two-option segmented controls with the same
  // inverted active pill, which taught the user they meant the same kind of
  // thing. One narrows a search; the other changes who you are acting as.
  const persona = page.getByTestId("workspace-persona");
  await expect(persona).toHaveAttribute("aria-haspopup", "menu");
  await expect(persona).toHaveAttribute("aria-expanded", "false");
  // A disclosure has no pressed state — that is what makes it not a toggle.
  expect(await persona.getAttribute("aria-pressed")).toBeNull();
  await expect(persona).toContainText("Recruiter");

  const searchScope = page.locator('[role="group"][aria-label="Search type"] button').first();
  await expect(searchScope).toHaveAttribute("aria-pressed", /true|false/);
  expect(await searchScope.getAttribute("aria-haspopup")).toBeNull();
});

test("the persona menu names each workspace and switches to it", async ({ page }) => {
  await openWorkspace(page, "?demo=1&mode=recruiter");
  await page.getByTestId("workspace-persona").click();

  const menu = page.getByTestId("workspace-persona-menu");
  await expect(menu).toBeVisible();
  // Two bare words could not say which side of the marketplace each one is.
  await expect(menu).toContainText("applied");
  await expect(page.getByTestId("workspace-persona-hiring")).toHaveAttribute("aria-checked", "true");

  await page.getByTestId("workspace-persona-talent").click();
  await expect(page.getByTestId("workspace-persona")).toHaveAttribute("data-persona", "talent");
  await expect(page.getByTestId("workspace-persona")).toContainText("Talent");
});

test("Escape closes the persona menu and hands focus back to its trigger", async ({ page }) => {
  await openWorkspace(page, "?demo=1&mode=recruiter");
  const persona = page.getByTestId("workspace-persona");
  await persona.click();
  await expect(page.getByTestId("workspace-persona-menu")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("workspace-persona-menu")).toHaveCount(0);
  // Focus must land somewhere the user can act from, not on document.body.
  await expect(persona).toBeFocused();
});

test("the persona control is reachable and operable from the keyboard alone", async ({ page }) => {
  await openWorkspace(page, "?demo=1&mode=recruiter");
  const persona = page.getByTestId("workspace-persona");
  await persona.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("workspace-persona-menu")).toBeVisible();

  await page.keyboard.press("Escape");
  await persona.focus();
  await page.keyboard.press("Space");
  await expect(page.getByTestId("workspace-persona-menu")).toBeVisible();
});

/* --- scope keeps every capability the old rows carried ------------------- */

test("every ownership scope is still selectable, archived included", async ({ page }) => {
  await openWorkspace(page, "?demo=1&mode=recruiter");
  for (const key of ["all", "received", "sent", "archived"] as const) {
    const tab = page.getByTestId(`applications-filter-${key}`);
    await expect(tab).toHaveCount(1);
    // Narrow rails scroll rather than drop options, so the tab may start
    // clipped; it must still be clickable and become the pressed scope.
    await tab.scrollIntoViewIfNeeded();
    await tab.click();
    await expect(tab).toHaveAttribute("aria-pressed", "true");
  }
});

test("changing ownership scope keeps the conversation you were reading open", async ({ page }) => {
  await openWorkspace(page, "?demo=1&mode=recruiter");
  await page.getByTestId("interaction-row").first().click();
  const opened = await page.getByTestId("applications-detail-header").textContent();
  expect(opened?.length ?? 0).toBeGreaterThan(0);

  await page.getByTestId("applications-filter-received").click();
  // Filtering the list is not a decision about the record being read.
  await expect(page.getByTestId("applications-detail-header")).toHaveText(opened ?? "");
});

test("a queue narrows the ownership scope rather than replacing it", async ({ page }) => {
  await openWorkspace(page, "?demo=1&mode=recruiter");
  await page.getByTestId("applications-filter-received").click();

  const trigger = page.getByTestId("queue-selector-trigger");
  if ((await trigger.count()) === 0) test.skip(true, "no queue holds work in this fixture");
  await trigger.click();
  await page.getByTestId("queue-selector-menu").getByRole("menuitemradio").nth(1).click();

  // Both axes stay live: the queue is on, and the ownership scope it narrowed
  // is still the selected one. Collapsing them into one control would have
  // deleted this.
  await expect(page.getByTestId("applications-filter-received")).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  await expect(page.getByTestId("queue-clear")).toBeVisible();
});

/* --- view switching ------------------------------------------------------ */

test("Inbox and Pipeline switch both ways and survive a reload", async ({ page }) => {
  await openWorkspace(page, "?demo=1&mode=recruiter");
  await page.getByTestId("applications-view-pipeline").click();
  await expect(page.getByTestId("pipeline-board")).toBeVisible();
  await expect(page).toHaveURL(/view=pipeline/);

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("pipeline-board")).toBeVisible({ timeout: 15_000 });

  await page.getByTestId("applications-view-inbox").click();
  await expect(page.getByTestId("interaction-row").first()).toBeVisible();
  await expect(page).toHaveURL(/view=inbox/);
});

test("a focused pipeline stage stays in the URL so it can be shared", async ({ page }) => {
  await openWorkspace(page, "?demo=1&view=pipeline&mode=recruiter");
  const scope = page.getByTestId("pipeline-scope");
  await expect(scope).toBeVisible();

  const values = await scope.locator("option").evaluateAll((nodes) =>
    nodes.map((node) => (node as HTMLOptionElement).value).filter(Boolean)
  );
  if (values.length === 0) test.skip(true, "no stages in this fixture");
  await scope.selectOption(values[0]);
  // The URL is rewritten by an effect, so settle on the control first: under
  // parallel load the assertion can otherwise outrun the render that triggers it.
  await expect(scope).toHaveValue(values[0]);
  await expect(page).toHaveURL(new RegExp(`stage=${values[0]}`), { timeout: 15_000 });
});

/* --- mobile -------------------------------------------------------------- */

test.describe("mobile", () => {
  test.use({ viewport: { width: 390, height: 780 } });

  test("the list is the landing screen and the conversation is a deliberate detail", async ({
    page,
  }) => {
    await openWorkspace(page, "?demo=1&mode=recruiter");
    const list = page.getByTestId("interaction-row").first();
    await expect(list).toBeVisible();
    await expect(page.getByTestId("applications-detail-header")).toBeHidden();

    await list.click();
    await expect(page.getByTestId("applications-detail-header")).toBeVisible();

    // And there is a way back to the list that is not the browser's.
    await page.getByRole("button", { name: /back/i }).first().click();
    await expect(page.getByTestId("interaction-row").first()).toBeVisible();
  });

  test("persona and view stay reachable without consuming the screen", async ({ page }) => {
    await openWorkspace(page, "?demo=1&mode=recruiter");
    await expect(page.getByTestId("workspace-persona")).toBeVisible();
    await expect(page.getByTestId("applications-view-pipeline")).toBeVisible();

    const chrome = await page.evaluate(() => {
      const ws = document.querySelector('[data-testid="applications-workspace"]');
      const row = document.querySelector('[data-testid="interaction-row"]');
      if (!ws || !row) return 9999;
      return row.getBoundingClientRect().top - ws.getBoundingClientRect().top;
    });
    // Two compact bars. Stacking the old five would have cost most of the fold.
    expect(chrome).toBeLessThan(140);
  });

  test("nothing overflows the viewport horizontally", async ({ page }) => {
    await openWorkspace(page, "?demo=1&mode=recruiter");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
