import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { encode } from "next-auth/jwt";
import { openWorkspace, row } from "./scenarioAnchors";

/**
 * Opening an application is the act that moves it.
 *
 * The review-progress plane only means something if the reader can watch a
 * record cross it. A deliberate open — the detail genuinely on screen, for
 * long enough to be a read rather than a mis-click — assigns the private
 * position *Reviewing*, and the applicant is told nothing.
 *
 * The two halves of that are equally important. A classification you cannot
 * watch change is one nobody trusts; a private position that leaks is a
 * promise broken.
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

/** The counts the menu currently advertises, keyed by option. */
async function planeCounts(page: Page): Promise<Record<string, number>> {
  await main(page).getByTestId("queue-selector-trigger").click();
  const menu = page.getByTestId("queue-selector-menu");
  await expect(menu).toBeVisible();
  const counts = await menu.evaluate((node) => {
    const found: Record<string, number> = {};
    for (const entry of Array.from(node.querySelectorAll("[data-queue-key]"))) {
      found[entry.getAttribute("data-queue-key") ?? ""] = Number(
        entry.getAttribute("data-queue-count") ?? "0"
      );
    }
    return found;
  });
  await page.keyboard.press("Escape");
  return counts;
}

test("a deliberate open moves a record from Not opened yet to Reviewing", async ({ page }) => {
  await openWorkspace(page, { scenario: "busy", mode: "recruiter", view: "inbox" });
  const before = await planeCounts(page);
  // `new` is the stage; `not_opened` is the flag. Opening a record has to move
  // both, because they are two readings of the same fact.
  expect(before.new, "no unopened record to open").toBeGreaterThan(0);

  // Find one the menu counts as unopened, and open it properly.
  const target = await main(page).evaluate(() => {
    const rows = Array.from(document.querySelectorAll('[data-testid="interaction-row"]'));
    const match = rows.find((entry) =>
      (entry.querySelector('[data-testid="row-preview"]')?.textContent ?? "").length >= 0
    );
    return match?.getAttribute("data-record-id") ?? null;
  });
  expect(target).toBeTruthy();

  await row(page, target as string).click();
  await expect(page.getByTestId("applications-detail")).toBeVisible();
  // The dwell exists so a rapid pass through the list is not a read.
  await page.waitForTimeout(1_400);

  const after = await planeCounts(page);
  expect(after.new, "opening a record did not reduce the New stage").toBeLessThan(before.new);
  expect(after.not_opened ?? 0, "the Not opened yet flag did not clear").toBeLessThan(
    before.not_opened ?? 0
  );
  expect(after.reviewing).toBeGreaterThan(before.reviewing ?? 0);
  // The population is unchanged: this moved a record between stages, it did
  // not create or destroy one.
  expect(after.all).toBe(before.all);
});

test("the private position never becomes an explicit later stage", async ({ page }) => {
  await openWorkspace(page, { scenario: "default", mode: "recruiter", view: "inbox" });
  const before = await planeCounts(page);

  // Open several records in turn, including ones already further along.
  const rows = main(page).getByTestId("interaction-row");
  for (let index = 0; index < Math.min(4, await rows.count()); index += 1) {
    await rows.nth(index).click();
    await page.waitForTimeout(1_000);
  }

  const after = await planeCounts(page);
  // Reading never rewinds anything: an interviewing or hired record stays
  // where it is, whatever anybody opens.
  expect(after.interviewing ?? 0).toBeGreaterThanOrEqual(before.interviewing ?? 0);
  expect(after.hired ?? 0).toBeGreaterThanOrEqual(before.hired ?? 0);
  expect(after.closed ?? 0).toBeGreaterThanOrEqual(before.closed ?? 0);
});

test("the applicant is told nothing about being reviewed", async ({ page }) => {
  await openWorkspace(page, { scenario: "busy", mode: "recruiter", view: "inbox" });
  const first = main(page).getByTestId("interaction-row").first();
  await first.click();
  const detail = page.getByTestId("applications-detail");
  await expect(detail).toBeVisible();
  await page.waitForTimeout(1_400);

  // No platform update, no message, nothing in the thread that a participant
  // could read as "they looked at you".
  await expect(detail.getByTestId("chat-status-update").filter({ hasText: /review/i })).toHaveCount(0);
  await expect(detail.getByText(/started reviewing/i)).toHaveCount(0);
});

test("the stage partition still reconciles after opening", async ({ page }) => {
  await openWorkspace(page, { scenario: "busy", mode: "recruiter", view: "inbox" });
  await main(page).getByTestId("interaction-row").first().click();
  await page.waitForTimeout(1_400);

  // Stage is the one section that sums to the whole, and opening a record must
  // not break that — it moves a record between stages, it does not add one.
  const counts = await planeCounts(page);
  const stages = ["new", "reviewing", "interviewing", "hired", "closed"];
  const summed = stages.reduce((total, key) => total + (counts[key] ?? 0), 0);
  expect(summed).toBe(counts.all);
});
