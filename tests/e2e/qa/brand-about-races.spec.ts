import { expect, test, type Page } from "@playwright/test";

/**
 * The race guarantees, proven through the product rather than at the runner.
 *
 * Every one of these rules already had a unit test. None had ever been observed
 * happening: a recruiter typing while an attempt was genuinely in flight, a
 * brand switched mid-attempt, two tabs saving at once. Those are the situations
 * the rules exist for, and a rule that has only been tested by calling the
 * function it lives in has not been tested against the thing that goes wrong.
 *
 * The missing piece was the ability to stop time in the middle of an attempt.
 * Enrichment runs in a background task and normally finishes in milliseconds,
 * so a test could never get between "started" and "finished". A dev-only gate —
 * unreachable outside development or test — now holds the official fetch open
 * until the test releases it, which is what makes the sequences below possible.
 *
 * Counts are read from the same gate. "The endpoint was called" and "a brand's
 * website was actually fetched" are different facts, and the cost contract is
 * entirely about the second.
 */

const CONTROLLER_EMAIL = "qa-controller@example.com";
const CONTROLLER_PASSWORD = "LocalQaController123!";
const BACKEND = "http://127.0.0.1:8100/api/v1";

const BRAND_A_SUMMARY = "Finance Simplified publishes personal finance videos BRAND_A_DESCRIPTION.";
const BRAND_B_SUMMARY = "Finance Simplified publishes personal finance videos BRAND_B_DESCRIPTION.";

type ProbeState = { fetches: number; model_calls: number; gated: boolean; started: boolean };

async function login(page: Page) {
  await page.goto("/auth?mode=login", { waitUntil: "domcontentloaded" });
  await page.getByPlaceholder("Email").fill(CONTROLLER_EMAIL);
  await page.getByPlaceholder("Password").fill(CONTROLLER_PASSWORD);
  await page.locator("form").getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page).toHaveURL(/\/you/);
}

/** Talk to the dev gate directly — it needs no auth and owns no user data. */
async function arm(page: Page, options: { gated?: boolean; mode?: string; summary?: string } = {}) {
  const response = await page.request.post(`${BACKEND}/dev/brand-enrichment/arm`, {
    data: {
      gated: options.gated ?? true,
      mode: options.mode ?? "success",
      summary: options.summary ?? BRAND_A_SUMMARY,
    },
  });
  expect(response.ok(), "could not arm the enrichment gate").toBeTruthy();
}

async function release(page: Page) {
  const response = await page.request.post(`${BACKEND}/dev/brand-enrichment/release`);
  expect(response.ok()).toBeTruthy();
}

async function probeState(page: Page): Promise<ProbeState> {
  const response = await page.request.get(`${BACKEND}/dev/brand-enrichment/state`);
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as ProbeState;
}

/** Wait for an attempt to actually reach the gate — never a sleep. */
async function waitForAttemptStarted(page: Page) {
  await expect
    .poll(async () => (await probeState(page)).started, { timeout: 30_000 })
    .toBe(true);
}

/**
 * Create a hiring identity eligible for enrichment: a brand-owned URL, so the
 * server resolves it as high confidence without any name search.
 */
async function createIdentity(page: Page, displayName: string) {
  const token = await backendToken(page);
  const response = await page.request.post(`${BACKEND}/me/hiring-identities`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      type: "INDIVIDUAL_CHANNEL",
      platform: "YOUTUBE",
      display_name: displayName,
      url: "https://financesimplified.example",
    },
  });
  expect(response.ok(), `could not create identity: ${await response.text()}`).toBeTruthy();
  return (await response.json()).id as string;
}

/** The app holds its backend token in memory; borrow it from the session route. */
async function backendToken(page: Page) {
  const session = await page.request.get("/api/auth/session");
  const body = await session.json();
  const token = body?.backendAccessToken || body?.accessToken;
  expect(token, "no backend token on the session").toBeTruthy();
  return token as string;
}

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
  return new URL(page.url()).searchParams.get("draftId") as string;
}

async function openDraft(page: Page, draftId: string, section = "about") {
  await page.goto("/you", { waitUntil: "domcontentloaded" });
  await page.goto(`/post-job?draftId=${draftId}&section=${section}`, {
    waitUntil: "domcontentloaded",
  });
  // The deep link jumps to a step, and each step renders different controls —
  // waiting for the title field on the About step waits forever.
  const anchor =
    section === "about"
      ? page.locator("#job-about-brand")
      : section === "budget"
        ? page.getByLabel("Compensation currency")
        : page.locator("#job-title");
  await expect(anchor.first()).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(1_500);
}

async function save(page: Page) {
  await page.getByRole("button", { name: /save draft/i }).first().click();
  await expect.poll(() => new URL(page.url()).pathname, { timeout: 30_000 }).toBe("/drafts");
}

/**
 * Put the job into the state enrichment exists for: an eligible identity and an
 * empty About field.
 *
 * The import fixture fills About, which correctly makes the job ineligible —
 * enrichment never competes with content that is already there. Clearing it
 * here is the setup, not a workaround: it reproduces the recruiter who has
 * chosen a brand and not yet written anything about it.
 */
async function attachIdentity(page: Page, draftId: string, identityId: string) {
  const token = await backendToken(page);
  const response = await page.request.patch(`${BACKEND}/jobs/${draftId}`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { hiring_identity_id: identityId, about_channel: null },
  });
  expect(response.ok(), `could not attach identity: ${await response.text()}`).toBeTruthy();
}

async function aboutValue(page: Page) {
  const about = page.locator("#job-about-brand").first();
  if ((await about.count()) === 0) return null;
  return about.inputValue();
}

test.describe("brand enrichment races, through the browser", () => {
  test("recruiter text typed while an attempt runs is never replaced", async ({ page }) => {
    await login(page);
    const identity = await createIdentity(page, "Finance Simplified");
    const draftId = await importDraft(page);
    await attachIdentity(page, draftId, identity);

    await arm(page, { gated: true, summary: BRAND_A_SUMMARY });
    await openDraft(page, draftId);
    await save(page);
    await waitForAttemptStarted(page);

    // The attempt is genuinely mid-flight now: the fetch is held open. This is
    // the window every race rule exists for, and it has never been observable.
    await openDraft(page, draftId);
    const about = page.locator("#job-about-brand").first();
    await expect(about).toBeVisible({ timeout: 30_000 });
    await about.fill("Recruiter-authored Finance Simplified description.");
    await about.blur();
    await save(page);

    await release(page);
    await page.waitForTimeout(1_500);

    await openDraft(page, draftId);
    const finalText = await aboutValue(page);

    expect(finalText).toBe("Recruiter-authored Finance Simplified description.");
    expect(finalText).not.toContain("BRAND_A_DESCRIPTION");
  });

  test("a brand switched mid-attempt never receives the old brand's text", async ({
    page,
  }) => {
    await login(page);
    const identityA = await createIdentity(page, "Finance Simplified");
    const identityB = await createIdentity(page, "Second Brand");
    const draftId = await importDraft(page);
    await attachIdentity(page, draftId, identityA);

    await arm(page, { gated: true, summary: BRAND_A_SUMMARY });
    await openDraft(page, draftId);
    await save(page);
    await waitForAttemptStarted(page);

    // Switch brand while A's attempt is held open.
    await attachIdentity(page, draftId, identityB);

    await release(page);
    await page.waitForTimeout(1_500);

    await openDraft(page, draftId);
    const finalText = (await aboutValue(page)) || "";

    // P0 territory: A's description must never appear under B, not even briefly.
    expect(finalText).not.toContain("BRAND_A_DESCRIPTION");
    expect(finalText).not.toContain("BRAND_B_DESCRIPTION");
  });

  test("clearing generated text does not regenerate it", async ({ page }) => {
    await login(page);
    const identity = await createIdentity(page, "Finance Simplified");
    const draftId = await importDraft(page);
    await attachIdentity(page, draftId, identity);

    await arm(page, { gated: false, summary: BRAND_A_SUMMARY });
    await openDraft(page, draftId);
    await save(page);
    await expect.poll(async () => (await probeState(page)).fetches, { timeout: 30_000 }).toBe(1);
    await page.waitForTimeout(1_000);

    await openDraft(page, draftId);
    expect(await aboutValue(page)).toContain("BRAND_A_DESCRIPTION");

    const before = await probeState(page);
    const about = page.locator("#job-about-brand").first();
    await about.fill("");
    await about.blur();
    await save(page);

    await openDraft(page, draftId);
    await save(page);
    await page.waitForTimeout(1_500);
    await openDraft(page, draftId);

    // A field emptied on purpose looks identical to one never filled. Only the
    // persisted status distinguishes them, and regenerating would override a
    // decision somebody made deliberately.
    expect((await aboutValue(page)) || "").toBe("");
    const after = await probeState(page);
    expect(after.fetches - before.fetches, "clearing triggered another fetch").toBe(0);
    expect(after.model_calls - before.model_calls).toBe(0);
  });

  test("two concurrent saves produce one expensive attempt", async ({ page, browser }) => {
    await login(page);
    const identity = await createIdentity(page, "Finance Simplified");
    const draftId = await importDraft(page);
    await attachIdentity(page, draftId, identity);
    // Gated on purpose. Ungated, the first attempt finishes before the second
    // begins and the two never overlap — so the test passed even with the
    // atomic claim removed, which is not a concurrency test at all. Holding the
    // fetch open forces both attempts to be genuinely in flight together, which
    // is the only situation the claim exists for.
    await arm(page, { gated: true, summary: BRAND_A_SUMMARY });

    const second = await browser.newContext();
    const other = await second.newPage();
    try {
      await login(other);
      await openDraft(page, draftId);
      await openDraft(other, draftId);

      // Near-simultaneous saves from two contexts. Both clients request
      // enrichment; the database decides which one does the work.
      await Promise.all([save(page), save(other)]);
      await waitForAttemptStarted(page);
      await page.waitForTimeout(2_000);

      // Counted while the winner is still held at the gate, so a second
      // attempt that started would already have been counted here.
      const during = await probeState(page);
      expect(during.fetches, `two tabs caused ${during.fetches} fetches`).toBe(1);

      await release(page);
      await page.waitForTimeout(1_500);

      const after = await probeState(page);
      expect(after.fetches, "a second attempt ran after the first was released").toBe(1);
      expect(after.model_calls).toBe(1);
    } finally {
      await second.close();
    }
  });

  test("refreshing while an attempt runs starts nothing new", async ({ page }) => {
    await login(page);
    const identity = await createIdentity(page, "Finance Simplified");
    const draftId = await importDraft(page);
    await attachIdentity(page, draftId, identity);

    await arm(page, { gated: true, summary: BRAND_A_SUMMARY });
    await openDraft(page, draftId);
    await save(page);
    await waitForAttemptStarted(page);

    await openDraft(page, draftId);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForTimeout(400);
    }

    const state = await probeState(page);
    expect(state.fetches, "refreshing during an attempt started another").toBe(1);
    await release(page);
  });

  test("a held attempt does not block ordinary work", async ({ page }) => {
    await login(page);
    const identity = await createIdentity(page, "Finance Simplified");
    const draftId = await importDraft(page);
    await attachIdentity(page, draftId, identity);

    await arm(page, { gated: true, summary: BRAND_A_SUMMARY });
    await openDraft(page, draftId);
    const started = Date.now();
    await save(page);
    const savedIn = Date.now() - started;
    await waitForAttemptStarted(page);

    // The endpoint acknowledges by claiming and backgrounding the work, so a
    // save issued while the fetch is held open must still finish promptly. A
    // server that ran the work inline would stall here until the client's own
    // request timeout rescued it, which is seconds later and measurable.
    expect(savedIn, `save took ${savedIn}ms while enrichment was held`).toBeLessThan(6_000);

    // Enrichment is held open for the whole of this. The recruiter must not be
    // able to tell: no modal, no spinner over the editor, no blocked save.
    await page.goto("/drafts", { waitUntil: "domcontentloaded" });
    await openDraft(page, draftId, "budget");
    await expect(page.getByLabel("Compensation currency")).toBeVisible({ timeout: 30_000 });
    const body = (await page.locator("body").innerText()).toLowerCase();
    expect(body).not.toContain("finding brand");
    expect(body).not.toContain("enriching");

    await save(page);
    expect(new URL(page.url()).pathname).toBe("/drafts");
    await release(page);
  });

  test("a background failure leaves the job and the field usable", async ({ page }) => {
    await login(page);
    const identity = await createIdentity(page, "Finance Simplified");
    const draftId = await importDraft(page);
    await attachIdentity(page, draftId, identity);

    await arm(page, { gated: false, mode: "fetch_failure" });
    await openDraft(page, draftId);
    await save(page);
    await expect.poll(async () => (await probeState(page)).fetches, { timeout: 30_000 }).toBe(1);
    await page.waitForTimeout(1_000);

    await openDraft(page, draftId);

    // The brand's site was unreachable. That is an ordinary outcome: the field
    // is empty and editable, and nothing about it reaches the recruiter.
    expect((await aboutValue(page)) || "").toBe("");
    const body = (await page.locator("body").innerText()).toLowerCase();
    expect(body).not.toMatch(/enrichment|could not research|brand lookup/);
    // The About control is editable — the step renders, the job is intact, and
    // nothing about the failed lookup reached the recruiter.
    await expect(page.locator("#job-about-brand").first()).toBeEditable();
  });

  test("a successful attempt is not repeated by later saves", async ({ page }) => {
    await login(page);
    const identity = await createIdentity(page, "Finance Simplified");
    const draftId = await importDraft(page);
    await attachIdentity(page, draftId, identity);

    await arm(page, { gated: false, summary: BRAND_A_SUMMARY });
    await openDraft(page, draftId);
    await save(page);
    await expect.poll(async () => (await probeState(page)).fetches, { timeout: 30_000 }).toBe(1);
    await page.waitForTimeout(1_000);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await openDraft(page, draftId);
      await save(page);
      await page.waitForTimeout(800);
    }

    // Cheap endpoint requests repeat by design — the client stays dumb. The
    // expensive work must not.
    const state = await probeState(page);
    expect(state.fetches, "a settled job was enriched again").toBe(1);
    expect(state.model_calls).toBe(1);
  });
});
