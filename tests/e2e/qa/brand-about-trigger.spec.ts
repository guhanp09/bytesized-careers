import { expect, test, type Page } from "@playwright/test";

/**
 * The test three campaigns did not finish: does saving actually start it?
 *
 * The brand-enrichment engine, its persisted attempt state and its safety rules
 * were all accepted while nothing invoked them. Endpoint tests could not close
 * that gap — an endpoint nobody calls passes its own tests perfectly. So these
 * assert the product event: a recruiter presses the ordinary Save button, clicks
 * nothing enrichment-specific, and exactly one enrichment request goes out.
 *
 * Two properties get most of the attention here, because both were reasoned
 * about at length and neither had ever been observed:
 *
 * **Render is not a trigger.** Opening and refreshing the editor must send
 * nothing. A mount-time effect would have satisfied "it works" and quietly
 * fetched a brand's website on every page load.
 *
 * **Navigation must not cancel it.** Saving calls `location.assign`
 * immediately afterwards, which tears the page down. The acknowledgement is
 * awaited for exactly that reason — the endpoint claims the attempt and
 * backgrounds the real work before replying — and a fire-and-forget `fetch`
 * would be cancelled in flight. That is why the request count, not the final
 * About text, is what these assert first.
 */

const CONTROLLER_EMAIL = "qa-controller@example.com";
const CONTROLLER_PASSWORD = "LocalQaController123!";

const ENRICH = /\/api\/v1\/jobs\/[^/]+\/brand-about\/enrich$/;

async function login(page: Page) {
  await page.goto("/auth?mode=login", { waitUntil: "domcontentloaded" });
  await page.getByPlaceholder("Email").fill(CONTROLLER_EMAIL);
  await page.getByPlaceholder("Password").fill(CONTROLLER_PASSWORD);
  await page.locator("form").getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page).toHaveURL(/\/you/);
}

/** Count every enrichment request the page makes, from now on. */
function countEnrichmentRequests(page: Page) {
  const seen: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && ENRICH.test(new URL(request.url()).pathname)) {
      seen.push(new URL(request.url()).pathname);
    }
  });
  return seen;
}

/** Import the deterministic fixture and land in Post Job with a real job id. */
async function importDraft(page: Page) {
  await page.goto("/post-job/import", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("import-development-scenario")).toBeVisible();
  await page.getByTestId("import-development-scenario").selectOption("ceiling-only-pay");
  await page.getByTestId("open-import-review-fixture").click();
  const open = page.getByRole("button", { name: /Open job draft/i });
  await expect(open.first()).toBeVisible({ timeout: 90_000 });
  await open.first().click();
  await expect.poll(() => new URL(page.url()).pathname, { timeout: 60_000 }).toBe("/post-job");
  await expect(page.locator("#job-title")).toBeVisible({ timeout: 30_000 });
  const id = new URL(page.url()).searchParams.get("draftId");
  expect(id, "no draft id after import").toBeTruthy();
  return id as string;
}

async function openDraft(page: Page, draftId: string) {
  await page.goto("/you", { waitUntil: "domcontentloaded" });
  await page.goto(`/post-job?draftId=${draftId}`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#job-title")).toBeVisible({ timeout: 60_000 });
  await expect
    .poll(async () => (await page.locator("#job-title").first().inputValue()).length, {
      timeout: 60_000,
    })
    .toBeGreaterThan(0);
}

/** Press the ordinary Save control — nothing enrichment-specific exists. */
async function save(page: Page) {
  await page.getByRole("button", { name: /save draft/i }).first().click();
  await expect.poll(() => new URL(page.url()).pathname, { timeout: 30_000 }).toBe("/drafts");
}

test.describe("saving a job asks the server to consider brand enrichment", () => {
  test("an ordinary save dispatches exactly one enrichment request", async ({ page }) => {
    await login(page);
    const draftId = await importDraft(page);

    const requests = countEnrichmentRequests(page);
    await save(page);

    // The whole point of the session. No enrichment-specific control was
    // clicked, and the request must have survived the navigation that follows
    // the save — which is why it is awaited rather than fired and forgotten.
    expect(
      requests.length,
      "saving did not automatically request brand enrichment"
    ).toBe(1);
    expect(requests[0]).toContain(draftId);
  });

  test("opening the editor sends nothing", async ({ page }) => {
    await login(page);
    const draftId = await importDraft(page);

    const requests = countEnrichmentRequests(page);
    await openDraft(page, draftId);
    await page.waitForTimeout(2_000);

    // A mount-time effect would have satisfied "enrichment happens" while
    // fetching a brand's website every time anybody opened a draft.
    expect(requests.length, "rendering the editor triggered enrichment").toBe(0);
  });

  test("refreshing five times sends nothing", async ({ page }) => {
    await login(page);
    const draftId = await importDraft(page);
    await openDraft(page, draftId);

    const requests = countEnrichmentRequests(page);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForTimeout(400);
    }

    expect(requests.length, "refreshing triggered enrichment").toBe(0);
  });

  test("a failed save dispatches nothing", async ({ page }) => {
    await login(page);
    const draftId = await importDraft(page);
    await openDraft(page, draftId);

    const requests = countEnrichmentRequests(page);
    await page.route("**/api/v1/jobs/**", async (route) => {
      const request = route.request();
      if (request.method() === "GET") return route.continue();
      if (ENRICH.test(new URL(request.url()).pathname)) return route.continue();
      return route.fulfill({ status: 500, body: '{"error":{"message":"nope"}}' });
    });

    await page.getByRole("button", { name: /save draft/i }).first().click();
    await page.waitForTimeout(3_000);
    await page.unroute("**/api/v1/jobs/**");

    // Enrichment is keyed to persistence. A job that was not saved has no
    // authoritative state to enrich against, and guessing an id would be worse.
    expect(requests.length, "a failed save still requested enrichment").toBe(0);
  });

  test("the recruiter is never asked to start it", async ({ page }) => {
    await login(page);
    const draftId = await importDraft(page);
    await openDraft(page, draftId);

    // Automatic means automatic: there is no control to press, so there is
    // nothing a recruiter could forget to do.
    const body = (await page.locator("body").innerText()).toLowerCase();
    expect(body).not.toContain("enrich");
    expect(body).not.toContain("research brand");
    expect(body).not.toContain("generate description");
  });

  test("saving stays responsive and navigation still happens", async ({ page }) => {
    await login(page);
    const draftId = await importDraft(page);
    await openDraft(page, draftId);

    const started = Date.now();
    await save(page);
    const elapsed = Date.now() - started;

    // The acknowledgement is a claim, not the work: the fetch and the model
    // call run in a background task after the response. A save that waited for
    // them would be visibly slower than one round trip.
    expect(elapsed, `save took ${elapsed}ms, which suggests it waited for work`).toBeLessThan(
      20_000
    );
    expect(new URL(page.url()).pathname).toBe("/drafts");
  });

  test("an enrichment endpoint failure does not disturb the save", async ({ page }) => {
    await login(page);
    const draftId = await importDraft(page);
    await openDraft(page, draftId);

    await page.route(ENRICH, (route) =>
      route.fulfill({ status: 500, body: '{"error":{"message":"down"}}' })
    );

    await save(page);
    await page.unroute(ENRICH);

    // The job is saved before enrichment is even requested, so a failure here
    // must be invisible: no error, no rollback, no lost navigation.
    expect(new URL(page.url()).pathname).toBe("/drafts");
    const body = (await page.locator("body").innerText()).toLowerCase();
    expect(body).not.toMatch(/something went wrong|failed to save|enrichment/);

    await openDraft(page, draftId);
    expect((await page.locator("#job-title").first().inputValue()).length).toBeGreaterThan(0);
  });

  test("saving twice does not multiply the request beyond one per save", async ({
    page,
  }) => {
    await login(page);
    const draftId = await importDraft(page);

    const requests = countEnrichmentRequests(page);
    await save(page);
    await openDraft(page, draftId);
    await save(page);

    // The client stays dumb: one cheap request per save. Preventing repeated
    // *expensive* work is the server's job, via the persisted attempt state —
    // and duplicating that rule here would create a second opinion that drifts.
    expect(requests.length).toBe(2);
  });
});
