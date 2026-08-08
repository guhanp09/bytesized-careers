import { expect, test, type Page } from "@playwright/test";

/**
 * The join the previous campaign could not prove: save, leave, come back.
 *
 * Everything either side of it was already covered — the editor hydrates an
 * imported draft into real controls, and the API preserves meaning across
 * thousands of generated jobs. What nothing tested was whether a browser save
 * actually reaches persistence and comes back, because a recruiter's real
 * session is exactly that: edit, save, walk away, return tomorrow.
 *
 * The earlier attempt failed for a reason worth writing down, since it looked
 * exactly like a product defect. Saving a draft **redirects to /drafts**, and
 * the helper captured `page.url()` *after* the redirect — so it dutifully
 * "reopened" the drafts list and found no form. Nothing was wrong with the
 * product; the test was navigating to the wrong place and reporting an
 * environment limitation.
 *
 * So the editor URL is captured before saving, and every reopen destroys the
 * React tree by visiting an unrelated route first. A value that survives that
 * came from the server, not from memory.
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

/** Import the deterministic fixture and land in Post Job with it loaded. */
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
  await expect
    .poll(async () => (await page.locator("#job-title").first().inputValue()).length, {
      timeout: 30_000,
    })
    .toBeGreaterThan(0);

  // Captured *before* any save, because saving redirects to /drafts and the
  // post-redirect URL is not the editor.
  return page.url();
}

/** Save through the control a recruiter uses, and confirm the write landed. */
async function saveDraft(page: Page) {
  const writes: number[] = [];
  const listener = (response: { url(): string; status(): number; request(): { method(): string } }) => {
    if (/\/api\/v1\/jobs\//.test(response.url()) && response.request().method() !== "GET") {
      writes.push(response.status());
    }
  };
  page.on("response", listener as never);

  await page.getByRole("button", { name: /save draft/i }).first().click();
  // Saving leaves the editor. That redirect is the product's own signal that
  // the write completed, and waiting for it beats waiting for a duration.
  await expect
    .poll(() => new URL(page.url()).pathname, { timeout: 30_000 })
    .toBe("/drafts");

  page.off("response", listener as never);
  expect(writes.length, "no write reached the backend").toBeGreaterThan(0);
  expect(writes.every((status) => status < 400), `save failed: ${writes}`).toBeTruthy();
}

/**
 * Come back to the editor with nothing left in memory.
 *
 * An unrelated route is visited first so the React tree is torn down; a value
 * present afterwards was fetched from the server.
 */
async function reopen(page: Page, editorUrl: string) {
  await page.goto("/you", { waitUntil: "domcontentloaded" });
  await page.goto(editorUrl, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#job-title")).toBeVisible({ timeout: 60_000 });
  await expect
    .poll(async () => (await page.locator("#job-title").first().inputValue()).length, {
      timeout: 60_000,
    })
    .toBeGreaterThan(0);
}

async function controlValues(page: Page) {
  const value = async (selector: string) => {
    const control = page.locator(selector).first();
    if ((await control.count()) === 0) return null;
    return (await control.inputValue().catch(() => null)) ?? (await control.innerText());
  };
  return { title: await value("#job-title"), role: await value("#job-primary-role") };
}

test.describe("save, leave, and come back", () => {
  test("the canonical editor route survives a save unchanged", async ({ page }) => {
    await login(page);
    const editorUrl = await importIntoPostJob(page);
    const draftId = new URL(editorUrl).searchParams.get("draftId");

    await saveDraft(page);

    // The redirect carries the same id, so the draft does not become a
    // different entity by being saved. A future test reopening by an obsolete
    // identifier would be testing nothing.
    expect(new URL(page.url()).searchParams.get("draftId")).toBe(draftId);

    await reopen(page, editorUrl);
    expect(new URL(page.url()).searchParams.get("draftId")).toBe(draftId);
  });

  test("saving without editing changes nothing, twice over", async ({ page }) => {
    await login(page);
    const editorUrl = await importIntoPostJob(page);
    const before = await controlValues(page);

    // The purest invariant: opening a draft and pressing save is what a
    // recruiter does constantly, and a form default that overwrites an
    // imported value there destroys it with no error and nobody watching.
    await saveDraft(page);
    await reopen(page, editorUrl);
    const first = await controlValues(page);
    expect(first.title, "the title drifted on the first save").toBe(before.title);
    expect(first.role, "the role drifted on the first save").toBe(before.role);

    await saveDraft(page);
    await reopen(page, editorUrl);
    const second = await controlValues(page);
    // Drift on the second save is worse than on the first: it only shows up
    // for recruiters who edit twice.
    expect(second.title, "the title drifted on the second save").toBe(before.title);
    expect(second.role, "the role drifted on the second save").toBe(before.role);
  });

  test("a recruiter's edit survives two reopens", async ({ page }) => {
    await login(page);
    const editorUrl = await importIntoPostJob(page);
    const imported = (await controlValues(page)).title;
    const edited = "Recruiter corrected title REOPEN_SENTINEL_7742";

    await page.locator("#job-title").first().fill(edited);
    await page.locator("#job-title").first().blur();
    await saveDraft(page);

    for (const attempt of [1, 2]) {
      await reopen(page, editorUrl);
      const value = await page.locator("#job-title").first().inputValue();
      expect(value, `reopen ${attempt}: the edit did not persist`).toBe(edited);
      expect(value, `reopen ${attempt}: the imported title came back`).not.toBe(imported);
    }
  });

  test("editing one control does not move another across a save", async ({ page }) => {
    await login(page);
    const editorUrl = await importIntoPostJob(page);
    const roleBefore = (await controlValues(page)).role;

    await page.locator("#job-title").first().fill("Isolation REOPEN_SENTINEL_1180");
    await page.locator("#job-title").first().blur();
    await saveDraft(page);
    await reopen(page, editorUrl);

    // Coupling in form serialization would show up here rather than in the
    // form itself, because it is the save that flattens state.
    expect((await controlValues(page)).role).toBe(roleBefore);
  });

  test("a reload rehydrates from the server too", async ({ page }) => {
    await login(page);
    const editorUrl = await importIntoPostJob(page);
    const edited = "Reload check REOPEN_SENTINEL_3355";

    await page.locator("#job-title").first().fill(edited);
    await page.locator("#job-title").first().blur();
    await saveDraft(page);

    await page.goto(editorUrl, { waitUntil: "domcontentloaded" });
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("#job-title")).toBeVisible({ timeout: 60_000 });
    await expect
      .poll(async () => page.locator("#job-title").first().inputValue(), { timeout: 60_000 })
      .toBe(edited);
  });

  test("a fresh browser context sees the saved value", async ({ page, browser }) => {
    await login(page);
    const editorUrl = await importIntoPostJob(page);
    const edited = "Fresh context REOPEN_SENTINEL_9021";

    await page.locator("#job-title").first().fill(edited);
    await page.locator("#job-title").first().blur();
    await saveDraft(page);

    // Stronger than same-tab navigation: a new context shares no memory, no
    // store and no cache with the one that saved.
    const context = await browser.newContext();
    const fresh = await context.newPage();
    try {
      await login(fresh);
      await fresh.goto(editorUrl, { waitUntil: "domcontentloaded" });
      await expect(fresh.locator("#job-title")).toBeVisible({ timeout: 60_000 });
      await expect
        .poll(async () => fresh.locator("#job-title").first().inputValue(), {
          timeout: 60_000,
        })
        .toBe(edited);
    } finally {
      await context.close();
    }
  });

  test("a failed save does not claim to have persisted", async ({ page }) => {
    await login(page);
    const editorUrl = await importIntoPostJob(page);
    const original = (await controlValues(page)).title;

    await page.route("**/api/v1/jobs/**", async (route) => {
      if (route.request().method() === "GET") return route.continue();
      return route.fulfill({ status: 500, body: '{"error":{"message":"nope"}}' });
    });

    await page.locator("#job-title").first().fill("Should not persist SENTINEL_6613");
    await page.locator("#job-title").first().blur();
    await page.getByRole("button", { name: /save draft/i }).first().click();
    await page.waitForTimeout(3_000);

    await page.unroute("**/api/v1/jobs/**");
    await reopen(page, editorUrl);

    // Optimistic UI is not persistence. What the server has is what the
    // recruiter must find when they come back.
    expect(await page.locator("#job-title").first().inputValue()).toBe(original);
  });

  test("saving twice does not create a second job", async ({ page }) => {
    await login(page);
    const editorUrl = await importIntoPostJob(page);
    const unique = "Duplicate check REOPEN_SENTINEL_4408";

    await page.locator("#job-title").first().fill(unique);
    await page.locator("#job-title").first().blur();
    await saveDraft(page);
    await reopen(page, editorUrl);
    await saveDraft(page);

    // Counted through the recruiter's own drafts list rather than the API,
    // because `page.request` carries no bearer token — the app holds it in
    // memory, so an out-of-band call is unauthenticated and proves nothing.
    await page.goto("/drafts", { waitUntil: "domcontentloaded" });
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByText(unique).first()).toBeVisible({ timeout: 30_000 });

    // Counted by draft *identity*, not by how many times the title appears.
    // A drafts card links to each section of the same job and prints its title
    // more than once, so a text count says two for a single draft — which
    // reads exactly like a duplicate and is not one.
    const ids = new Set(
      await page
        .locator('a[href*="draftId="]')
        .evaluateAll((nodes) =>
          nodes
            .map((node) => (node as HTMLAnchorElement).getAttribute("href") ?? "")
            .map((href) => new URLSearchParams(href.split("?")[1] ?? "").get("draftId"))
            .filter((value): value is string => Boolean(value))
        )
    );

    expect(ids.size, `saving twice produced more than one draft: ${[...ids]}`).toBe(1);
  });
});

for (const width of WIDTHS) {
  test(`an edit saves and reopens at ${width.name}`, async ({ page }) => {
    await page.setViewportSize({ width: width.width, height: width.height });
    await login(page);
    const editorUrl = await importIntoPostJob(page);
    const edited = `Viewport ${width.name} REOPEN_SENTINEL`;

    await page.locator("#job-title").first().fill(edited);
    await page.locator("#job-title").first().blur();
    await saveDraft(page);
    await reopen(page, editorUrl);

    // A control the breakpoint hides or remounts would drop the edit here and
    // nowhere else, and only for recruiters on that size of screen.
    expect(
      await page.locator("#job-title").first().inputValue(),
      `${width.name}: the edit did not survive the round trip`
    ).toBe(edited);
  });
}
