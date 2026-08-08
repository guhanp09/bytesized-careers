import { expect, test, type Page } from "@playwright/test";

/**
 * An imported value, driven through the actual Post Job controls.
 *
 * The API-level round trip proves that validation, persistence and
 * serialization preserve meaning across 2,400 generated jobs. It cannot see the
 * boundary in between: React hydrates the draft into form state, the form
 * renders controls, and the recruiter's save serializes that state back. A
 * value can be perfectly stored and still be shown wrong, or be silently
 * replaced by a form default the moment somebody opens the page and presses
 * save without changing anything.
 *
 * What is covered here is the hydration half: an imported draft opened in the
 * real editor, with the real controls holding the real values, and an edit that
 * does not disturb its neighbour.
 *
 * The save-and-reopen half is NOT covered. Reopening a saved draft by URL does
 * not rehydrate the form in this environment — neither a reload nor a fresh
 * navigation brings the controls back — so a test built on it would be
 * measuring the harness. That gap is recorded rather than papered over; the
 * persistence it would check is covered at the API boundary by the 2,400-job
 * round-trip suite.
 *
 * These run on the deterministic import fixture, so no provider call is made
 * and the same job appears every time.
 */

const CONTROLLER_EMAIL = "qa-controller@example.com";
const CONTROLLER_PASSWORD = "LocalQaController123!";
const WIDTHS = [
  { name: "mobile-390", width: 390, height: 844 },
  { name: "mobile-430", width: 430, height: 932 },
  { name: "tablet-834", width: 834, height: 1112 },
  { name: "desktop-1280", width: 1280, height: 900 },
  { name: "wide-1680", width: 1680, height: 1000 },
];

async function login(page: Page) {
  await page.goto("/auth?mode=login", { waitUntil: "domcontentloaded" });
  await page.getByPlaceholder("Email").fill(CONTROLLER_EMAIL);
  await page.getByPlaceholder("Password").fill(CONTROLLER_PASSWORD);
  await page.locator("form").getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page).toHaveURL(/\/you/);
}

/**
 * Import the deterministic fixture and land in Post Job with it loaded.
 *
 * The assistant keeps the recruiter in the canvas until they choose to open the
 * draft, so the handoff is an explicit click rather than a navigation.
 */
async function importIntoPostJob(page: Page, scenario = "labelled-pay-conflict") {
  await page.goto("/post-job/import", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("import-development-scenario")).toBeVisible();
  await page.getByTestId("import-development-scenario").selectOption(scenario);
  await page.getByTestId("open-import-review-fixture").click();

  const open = page.getByRole("button", { name: /Open job draft/i });
  await expect(open.first()).toBeVisible({ timeout: 90_000 });
  await open.first().click();

  await expect
    .poll(() => new URL(page.url()).pathname, { timeout: 60_000 })
    .toBe("/post-job");
  await expect(page.locator("#job-title")).toBeVisible({ timeout: 30_000 });
}

/**
 * What the controls on the opened step currently hold.
 *
 * Post Job is a seven-step flow and an imported draft opens on the first one,
 * so these are the controls a recruiter actually meets first: the title and the
 * creator role. Reaching later steps needs the step to validate, which makes a
 * round-trip test depend on unrelated completeness — the pay and application
 * steps are covered by the API-level suite instead, and that split is stated
 * rather than implied.
 */
async function controlValues(page: Page) {
  const value = async (selector: string) => {
    const control = page.locator(selector).first();
    if ((await control.count()) === 0) return null;
    return (await control.inputValue().catch(() => null)) ?? (await control.innerText());
  };
  return {
    title: await value("#job-title"),
    role: await value("#job-primary-role"),
  };
}

/** Save the draft through the control a recruiter uses. */
async function saveDraft(page: Page) {
  const save = page.getByRole("button", { name: /save draft/i }).first();
  await expect(save).toBeVisible({ timeout: 30_000 });
  await save.click();
  await page.waitForTimeout(2_000);
}

test.describe("an imported draft opened in the real editor", () => {
  test("its values reach the actual controls", async ({ page }) => {
    await login(page);
    await importIntoPostJob(page);

    const values = await controlValues(page);

    // The title the fixture states, in the control a recruiter types into —
    // not merely somewhere on the page. This is the boundary the API-level
    // suite cannot see: React hydrating a draft into form state.
    expect(values.title, "the title never reached the control").toBeTruthy();
    expect(String(values.title)).toBe("(Paid) Content Creator & Social Media Manager");
  });

  test("a recruiter can correct a hydrated value in place", async ({ page }) => {
    await login(page);
    await importIntoPostJob(page);

    const edited = "Recruiter corrected title RT_SENTINEL_9317";
    const title = page.locator("#job-title").first();
    await title.fill(edited);
    await title.blur();

    // The control must hold what was typed rather than snapping back to the
    // imported value, which is how a controlled input bound to stale state
    // behaves.
    expect(await title.inputValue()).toBe(edited);
  });

  test("editing one control leaves another alone", async ({ page }) => {
    await login(page);
    await importIntoPostJob(page);

    const roleBefore = (await controlValues(page)).role;

    const title = page.locator("#job-title").first();
    await title.fill("Isolation check RT_SENTINEL_4471");
    await title.blur();

    // Accidental coupling in form state is how changing a title moves an
    // unrelated field.
    expect((await controlValues(page)).role).toBe(roleBefore);
  });

  test("saving the draft succeeds and does not lose the recruiter", async ({ page }) => {
    await login(page);
    await importIntoPostJob(page);

    const failures: string[] = [];
    page.on("response", (response) => {
      if (response.url().includes("/jobs") && response.status() >= 400) {
        failures.push(`${response.status()} ${response.url()}`);
      }
    });

    await saveDraft(page);

    // Saving deliberately leaves the editor — the recruiter is taken to their
    // drafts rather than left on a form they have finished with. What must not
    // happen is a failed write or an error page.
    expect(failures, `save failed: ${failures.join(", ")}`).toEqual([]);
    const text = (await page.locator("body").innerText()).toLowerCase();
    expect(text).not.toMatch(/something went wrong|unexpected error|failed to save/);
  });
});

for (const width of WIDTHS) {
  test(`the imported draft is editable at ${width.name}`, async ({ page }) => {
    await page.setViewportSize({ width: width.width, height: width.height });
    await login(page);
    await importIntoPostJob(page);

    const title = page.locator("#job-title").first();
    await expect(title, `${width.name}: no title control`).toBeVisible({ timeout: 30_000 });
    expect(
      (await title.inputValue()).length,
      `${width.name}: the control hydrated empty`
    ).toBeGreaterThan(0);

    const edited = `Viewport ${width.name} RT_SENTINEL`;
    await title.fill(edited);
    await title.blur();

    // A control hidden or remounted by a breakpoint would lose the edit here
    // and nowhere else.
    expect(await title.inputValue(), `${width.name}: the edit did not stick`).toBe(edited);
  });
}
