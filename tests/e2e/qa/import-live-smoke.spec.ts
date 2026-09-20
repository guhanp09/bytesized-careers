import { expect, test, type Page } from "@playwright/test";

/**
 * One real import, end to end, through the actual network.
 *
 * Everything else in the browser suite runs on deterministic fixtures, which is
 * right: they are fast, free, and they test the product rather than a third
 * party's uptime. But no fixture can prove the thing that actually broke — a
 * live import that reached no question, no draft and no failure, and simply kept
 * its spinner while the recruiter waited.
 *
 * That failure needed a real request to produce. The client abandoned POST
 * /process at 120s while the server allowed 2 × 90s, the cancellation raised
 * CancelledError (a BaseException, so no handler wrote a status), and the draft
 * stayed "processing" with nothing left to finish it. So there is exactly one
 * live test here, and what it asserts is the settlement contract rather than any
 * particular extracted fact: a started import reaches a state a recruiter can
 * act on.
 *
 * Kept out of the default run — see `test.skip` below — because it depends on a
 * third party being reachable and on a provider call, and a suite that fails
 * when someone else's site is down teaches you to ignore it. Run deliberately:
 *
 *     RUN_LIVE_IMPORT_SMOKE=1 npx playwright test -c playwright.qa.config.ts \
 *       tests/e2e/qa/import-live-smoke.spec.ts
 */

const CONTROLLER_EMAIL = "qa-controller@example.com";
const CONTROLLER_PASSWORD = "LocalQaController123!";

/**
 * A real, public, single-job page. No anti-bot measure is bypassed.
 *
 * Overridable, because live sources expire: a listing that 404s a month from
 * now would make this fail for a reason that says nothing about the product.
 */
const LIVE_URL =
  process.env.LIVE_IMPORT_URL ||
  "https://bebee.com/in/jobs/paid-content-creator-social-media-manager-nabbe--theirstack-714703540";

async function loginController(page: Page) {
  await page.goto("/auth?mode=login", { waitUntil: "domcontentloaded" });
  await page.getByPlaceholder("Email").fill(CONTROLLER_EMAIL);
  await page.getByPlaceholder("Password").fill(CONTROLLER_PASSWORD);
  await page.locator("form").getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page).toHaveURL(/\/you/);
}

test.describe("a real page, imported for real", () => {
  test.skip(
    process.env.RUN_LIVE_IMPORT_SMOKE !== "1",
    "live smoke: set RUN_LIVE_IMPORT_SMOKE=1 to run"
  );

  test("settles somewhere the recruiter can act on", async ({ page }) => {
    // Generous, and deliberately larger than the server's own worst case
    // (2 × 90s plus reconciliation). A shorter budget here would re-create the
    // very impatience that caused the defect, and would fail for the wrong
    // reason.
    test.setTimeout(360_000);

    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });

    await loginController(page);
    const started = Date.now();
    await page.goto("/post-job/import", { waitUntil: "domcontentloaded" });

    // The screen opens on "Paste text"; the URL panel does not exist until its
    // tab is chosen.
    await page.getByRole("tab", { name: "Public URL" }).click();
    await expect(page.getByTestId("url-import-panel")).toBeVisible();
    await page.getByTestId("import-url-input").fill(LIVE_URL);
    await page.getByTestId("import-url-prepare").click();

    const settlement = await expect
      .poll(
        async () => {
          if (new URL(page.url()).pathname === "/post-job") return "draft";
          if ((await page.getByRole("button", { name: /Open job draft/i }).count()) > 0) {
            return "draft";
          }
          if ((await page.getByTestId("draft-assistant-failure").count()) > 0) {
            return "recoverable-failure";
          }
          if ((await page.getByTestId("job-import-failure").count()) > 0) {
            return "recoverable-failure";
          }
          if ((await page.getByTestId("conversation-turn").count()) > 0) {
            return "question";
          }
          return "processing";
        },
        {
          timeout: 300_000,
          intervals: [2_000],
          message:
            "the live import never left the processing state — the defect this " +
            "spec exists to catch",
        }
      )
      .not.toBe("processing")
      .then(() => page.locator("body").innerText());

    const text = settlement.toLowerCase();

    // Recorded rather than asserted. Which state a live page settles to depends
    // on the page; that it settles at all is the contract.
    const reached = /couldn’t|couldn't|could not/.test(text)
      ? "recoverable-failure"
      : (await page.getByTestId("conversation-turn").count()) > 0
        ? "question"
        : "draft";
    console.log(`[live-smoke] ${LIVE_URL} -> ${reached} in ${Date.now() - started}ms`);

    // Whatever it settled to, the recruiter is never left without a next step.
    if (/couldn’t|couldn't|could not/.test(text)) {
      expect(text).toMatch(/retry|paste|continue manually|start it again/);
      // A failure explains itself in the recruiter's terms, never the server's.
      expect(text).not.toMatch(/openai|gpt|traceback|cloudflare|status code|enum/);
    }

    // A page whose markup or copy names a rate must not produce a money
    // question. This is the live form of the deterministic assertion.
    if (/5,?000/.test(text)) {
      expect(text).not.toMatch(/how is (the )?pay measured/);
    }

    // A failed upstream fetch legitimately logs its status, and this test is
    // pointed at a third-party page that may rate-limit or expire. What must
    // not appear is a client-side error — those are ours, and they are how a
    // screen stops updating without saying so.
    expect(
      consoleErrors.filter(
        (line) =>
          !/favicon|third-party|net::ERR|Failed to load resource/i.test(line)
      )
    ).toEqual([]);
  });
});
