import { expect, test, type Page } from "@playwright/test";

/**
 * What a recruiter is actually shown, for the page that got it wrong.
 *
 * The defect this covers was reported against a screen, not against a payload:
 * a paid freelance brief presented as an "Internship", with no pay at all, an
 * empty Work section on a page full of work, and a question asking how pay was
 * measured about a page that printed its rate.
 *
 * Everything here runs on the `labelled-pay-conflict` development fixture — the
 * same sanitised page the backend tests use, exposed to the browser so both
 * halves assert against one page rather than drifting apart. No provider call
 * is made, which is what makes it affordable to check every viewport. An
 * earlier version of this file drove the live URL once per width; eight real
 * imports at ~35s each never finished inside the shell budget, and paying a
 * provider call to re-check a breakpoint proves nothing about the breakpoint.
 */

const CONTROLLER_EMAIL = "qa-controller@example.com";
const CONTROLLER_PASSWORD = "LocalQaController123!";
const SHOTS = "/tmp/creatorjobs-import-integrity";

const WIDTHS = [
  { name: "mobile-390", width: 390, height: 844 },
  { name: "mobile-430", width: 430, height: 932 },
  { name: "tablet-834", width: 834, height: 1112 },
  { name: "desktop-1280", width: 1280, height: 900 },
  { name: "wide-1680", width: 1680, height: 1000 },
];

async function loginController(page: Page) {
  await page.goto("/auth?mode=login", { waitUntil: "domcontentloaded" });
  await page.getByPlaceholder("Email").fill(CONTROLLER_EMAIL);
  await page.getByPlaceholder("Password").fill(CONTROLLER_PASSWORD);
  await page.locator("form").getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page).toHaveURL(/\/you/);
}

/** Start one deterministic import and wait for it to stop being in progress. */
async function openScenario(page: Page, scenario: string) {
  await page.goto("/post-job/import", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("import-development-scenario")).toBeVisible();
  await page.getByTestId("import-development-scenario").selectOption(scenario);
  await page.getByTestId("open-import-review-fixture").click();

  // The settlement contract, watched rather than assumed: an import that starts
  // must reach a question, a draft, or a stated failure. Never a spinner that
  // outlives the work. This is the browser-level form of the invariant that
  // lib/importJob/settlement.ts enforces in code.
  await expect
    .poll(
      async () => {
        // A settled fixture hands off to the ordinary Post Job editor, which is
        // a navigation rather than a word on the page. "Continue manually" is
        // deliberately not a settle signal: it is offered *during* processing
        // too, and treating it as one asserted against a half-prepared screen.
        if (new URL(page.url()).pathname === "/post-job") return "settled";
        if ((await page.getByRole("button", { name: /Open job draft/i }).count()) > 0) {
          return "settled";
        }
        if ((await page.getByTestId("draft-assistant-failure").count()) > 0) return "failed";
        if ((await page.getByTestId("conversation-turn").count()) > 0) return "question";
        return "waiting";
      },
      { timeout: 90_000, message: "the import never left the processing state" }
    )
    .not.toBe("waiting");
}

/** Every visible word on the page, lower-cased (CSS uppercases some headings). */
async function visibleText(page: Page) {
  return (await page.locator("body").innerText()).toLowerCase();
}

/**
 * The candidate preview the assistant prepared, at whatever width we are at.
 *
 * This is the surface the defect was reported against: one view of the whole
 * job, rather than the Post Job editor, which opens on step one where pay is
 * several steps away. Above `lg` it is an always-visible rail; below it the
 * same preview is a collapsed `<details>`, so on a phone it has to be opened
 * before its text exists in the accessibility tree at all.
 */
async function candidatePreviewText(page: Page) {
  const rail = page.getByTestId("draft-assistant-preview-rail");
  const collapsed = page.getByTestId("draft-assistant-preview-mobile");

  if (await rail.isVisible().catch(() => false)) {
    await expect(rail).toContainText(/./, { timeout: 30_000 });
    return (await rail.innerText()).toLowerCase();
  }

  await expect(collapsed).toBeVisible({ timeout: 30_000 });
  if (!(await collapsed.evaluate((node: HTMLDetailsElement) => node.open))) {
    await collapsed.getByText(/Preview what candidates see/i).click();
  }
  await expect(collapsed).toContainText(/./, { timeout: 30_000 });
  return (await collapsed.innerText()).toLowerCase();
}

test.describe("the page whose markup contradicts its own copy", () => {
  for (const width of WIDTHS) {
    test(`is read truthfully at ${width.name}`, async ({ page }) => {
      await page.setViewportSize({ width: width.width, height: width.height });
      await loginController(page);
      await openScenario(page, "labelled-pay-conflict");

      const text = await candidatePreviewText(page);

      // The rate the employer printed, in the product's own words.
      expect(text).toMatch(/5,?000/);

      // The engagement the employer labelled — not the one their syndicated
      // markup declared. This is the assertion the original report was about.
      expect(text).not.toMatch(/internship/);

      // A page full of work must not present an empty Work section.
      expect(text).toMatch(/reels|captions|carousel|community/);

      // "Remote · Remote" was a real regression: the mode and the place both
      // rendering the same word.
      expect(text).not.toMatch(/remote\s*[·•]\s*remote/);
      expect(text).not.toMatch(/remote-friendly/);

      // Applications run through CreatorJobs. A source's contact address must
      // never reach a recruiter-facing surface.
      expect(text).not.toContain("larkfield.invalid");
      expect(text).not.toMatch(/hiring@/);

      // No question about anything the page stated plainly.
      expect(text).not.toMatch(/how is (the )?pay measured/);
      expect(text).not.toMatch(/is this a full-time role/);

      await page.screenshot({
        path: `${SHOTS}/labelled-${width.name}.png`,
        fullPage: true,
      });
    });
  }

  test("never scrolls sideways and keeps its actions reachable", async ({ page }) => {
    for (const width of WIDTHS) {
      await page.setViewportSize({ width: width.width, height: width.height });
      if (width === WIDTHS[0]) await loginController(page);
      await openScenario(page, "labelled-pay-conflict");

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      // Grid children default to min-width:auto, which is what produced
      // horizontal overflow at 390 and 430 before.
      expect(overflow, `horizontal overflow at ${width.name}`).toBeLessThanOrEqual(1);

      const actions = page.getByRole("button");
      const count = await actions.count();
      for (let index = 0; index < Math.min(count, 12); index += 1) {
        const action = actions.nth(index);
        if (!(await action.isVisible())) continue;
        const box = await action.boundingBox();
        if (!box) continue;
        expect(box.x, `an action starts off-screen at ${width.name}`).toBeGreaterThanOrEqual(-1);
        expect(
          box.x + box.width,
          `an action runs past the right edge at ${width.name}`
        ).toBeLessThanOrEqual(width.width + 1);
      }
    }
  });
});

test.describe("one import never inherits from another", () => {
  /**
   * A → B → C → A, with three deliberately unlike sources.
   *
   * The risk is not that a field is wrong but that it is *someone else's*. Each
   * step asserts the absence of the previous source's facts, which is the only
   * form of this test that can fail for the right reason.
   */
  test("carries nothing source-owned between three imports", async ({ page }) => {
    await loginController(page);

    // A — the labelled page: INR monthly pay, remote, social work.
    await openScenario(page, "labelled-pay-conflict");
    const a = await visibleText(page);
    expect(a).toMatch(/5,?000/);

    // B — a Chennai school video editor: onsite, a different craft entirely.
    await openScenario(page, "shine-school-editor");
    const b = await visibleText(page);
    expect(b, "A's rate reached B").not.toMatch(/5,?000/);
    expect(b, "A's employer reached B").not.toMatch(/larkfield/);
    expect(b, "A's work reached B").not.toMatch(/carousel|hinglish/);

    // C — a title naming several crafts, which asks a question rather than
    // settling. A source that stops mid-conversation must not leak either.
    await openScenario(page, "multi-craft");
    const c = await visibleText(page);
    expect(c, "B's city reached C").not.toMatch(/chennai/);
    expect(c, "A's rate reached C").not.toMatch(/5,?000/);
    expect(c, "A's employer reached C").not.toMatch(/larkfield/);

    // Back to A. The same source read again must not now carry C's facts.
    await openScenario(page, "labelled-pay-conflict");
    const again = await visibleText(page);
    expect(again, "C's craft question reached A").not.toMatch(/which craft/);
    expect(again, "B's city reached A").not.toMatch(/chennai/);
    expect(again).toMatch(/5,?000/);
  });

  test("a fresh import starts empty", async ({ page }) => {
    await loginController(page);
    await openScenario(page, "labelled-pay-conflict");

    await page.goto("/post-job/import", { waitUntil: "domcontentloaded" });
    const fresh = await visibleText(page);
    expect(fresh, "a new import began pre-populated").not.toMatch(/5,?000/);
    expect(fresh).not.toMatch(/larkfield/);
    expect(fresh).not.toMatch(/hinglish/);
  });
});
