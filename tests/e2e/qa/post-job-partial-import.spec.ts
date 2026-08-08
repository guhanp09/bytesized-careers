import { expect, test, type Page } from "@playwright/test";

/**
 * The other handoff: an import carried into a blank Post Job form.
 *
 * There are two ways an import reaches the editor. The familiar one applies the
 * native draft and arrives at `/post-job?draftId=<id>`, where the form hydrates
 * from the stored job. The other arrives at `/post-job?importDraftId=<id>` with
 * no job behind it at all — the recruiter pressed "Continue manually in the full
 * editor", or the assistant routed them there — and a *different* hydration path
 * reads the import draft's fields straight into form state
 * (`components/PostJobPage.tsx:1858`, gated on `partialImportDraftId`). Only on
 * save does a job get created and the import draft attached to it.
 *
 * Mutation testing is what found this. Blanking the title, the currency and the
 * experience on that path each survived the entire browser suite, including a
 * helper that polls for a non-empty title — because every existing test
 * re-navigates to `?draftId=` before asserting anything, which hydrates through
 * the other path entirely. The partial handoff had no coverage of any kind.
 *
 * It is also the worse path to lose data on. A recruiter is only here because
 * the assistant could not finish, so what survived extraction is all they have,
 * and there is no stored job to recover it from.
 *
 * Expected values are the fixture's own, written out as literals below rather
 * than read back from anything the form touches.
 */

const CONTROLLER_EMAIL = "qa-controller@example.com";
const CONTROLLER_PASSWORD = "LocalQaController123!";

/** What `multi-craft` states, copied from the fixture by hand. */
const MULTI_CRAFT = {
  title: "Visual Content Creator - Video Editing, VFX & Animation",
  experience: "25 years",
  currency: "INR",
  amount: 29167,
  unit: "per month",
};

/** What `checkpoint-trial` states — a draft the assistant genuinely paused on. */
const CHECKPOINT_TRIAL = {
  title: "Thumbnail designer for a gaming channel",
  currency: "INR",
  amount: 40000,
  unit: "per month",
};

async function login(page: Page) {
  await page.goto("/auth?mode=login", { waitUntil: "domcontentloaded" });
  await page.getByPlaceholder("Email").fill(CONTROLLER_EMAIL);
  await page.getByPlaceholder("Password").fill(CONTROLLER_PASSWORD);
  await page.locator("form").getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page).toHaveURL(/\/you/);
}

/**
 * Prepare a fixture import and return its *import draft* id.
 *
 * The import screen publishes the id in its own URL as `?draft=<id>`
 * (`ImportJobPageClient.tsx:71`), which is the same value it later hands to
 * `/post-job?importDraftId=`.
 */
async function prepareImport(page: Page, scenario: string) {
  await page.goto("/post-job/import", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("import-development-scenario")).toBeVisible();
  await page.getByTestId("import-development-scenario").selectOption(scenario);
  await page.getByTestId("open-import-review-fixture").click();

  await expect
    .poll(() => new URL(page.url()).searchParams.get("draft"), { timeout: 90_000 })
    .toBeTruthy();
  return new URL(page.url()).searchParams.get("draft") as string;
}

/** Arrive the way the product arrives, and wait for the fields to land. */
async function openPartialHandoff(page: Page, importDraftId: string) {
  await page.goto(`/post-job?importDraftId=${importDraftId}`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.locator("#job-title")).toBeVisible({ timeout: 60_000 });
  await expect
    .poll(async () => (await page.locator("#job-title").first().inputValue()).length, {
      timeout: 60_000,
    })
    .toBeGreaterThan(0);
}

/** Save, and return the id of the job the save created. */
async function saveAndCaptureJob(page: Page) {
  const writes: number[] = [];
  const listener = (r: { url(): string; status(): number; request(): { method(): string } }) => {
    if (/\/api\/v1\/jobs/.test(r.url()) && r.request().method() !== "GET") {
      writes.push(r.status());
    }
  };
  page.on("response", listener as never);

  await page.getByRole("button", { name: /save draft/i }).first().click();
  await expect
    .poll(() => new URL(page.url()).pathname, { timeout: 30_000 })
    .toBe("/drafts");

  page.off("response", listener as never);
  expect(writes.length, "no write reached the backend").toBeGreaterThan(0);
  expect(writes.every((status) => status < 400), `save failed: ${writes}`).toBeTruthy();

  const created = new URL(page.url()).searchParams.get("draftId");
  expect(created, "the save did not report which job it created").toBeTruthy();
  return created as string;
}

/** Reopen a saved job at one step, with nothing left in memory. */
async function openSection(page: Page, draftId: string, section: string) {
  await page.goto("/you", { waitUntil: "domcontentloaded" });
  await page.goto(`/post-job?draftId=${draftId}&section=${section}`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForTimeout(2_500);
}

const compensation = (page: Page) => ({
  currency: page.getByLabel("Compensation currency"),
  amount: page.getByLabel(/Compensation amount|Minimum compensation/),
  unit: page.getByLabel("Compensation unit"),
});

test.describe("an import carried into a blank editor", () => {
  test("the imported title reaches the control", async ({ page }) => {
    await login(page);
    const importDraftId = await prepareImport(page, "multi-craft");
    await openPartialHandoff(page, importDraftId);

    // Nothing has been saved yet, so this value exists only in form state. If
    // it is wrong here, the first save writes the wrong job and there is no
    // stored draft to recover from.
    expect(await page.locator("#job-title").first().inputValue()).toBe(
      MULTI_CRAFT.title
    );
  });

  test("the imported pay survives the save that creates the job", async ({ page }) => {
    await login(page);
    const importDraftId = await prepareImport(page, "multi-craft");
    await openPartialHandoff(page, importDraftId);

    const draftId = await saveAndCaptureJob(page);
    await openSection(page, draftId, "budget");

    const control = compensation(page);
    const amount = await control.amount.first().inputValue();
    // A currency lost between the import draft and the new job turns ₹29,167
    // into a bare number, and the next reader supplies their own symbol.
    expect(await control.currency.inputValue()).toBe(MULTI_CRAFT.currency);
    expect(Number(amount)).toBe(MULTI_CRAFT.amount);
    expect(await control.unit.inputValue()).toBe(MULTI_CRAFT.unit);
  });

  test("the imported experience is not rounded into a band", async ({ page }) => {
    await login(page);
    const importDraftId = await prepareImport(page, "multi-craft");
    await openPartialHandoff(page, importDraftId);

    const draftId = await saveAndCaptureJob(page);
    await openSection(page, draftId, "experience");

    // "25 years" is representable by no suggestion this control offers, which
    // is exactly why it is the fixture's value.
    expect(await page.locator("#job-experience").first().inputValue()).toBe(
      MULTI_CRAFT.experience
    );
  });

  test("the title a recruiter corrects here is the title that is saved", async ({
    page,
  }) => {
    await login(page);
    const importDraftId = await prepareImport(page, "multi-craft");
    await openPartialHandoff(page, importDraftId);

    const corrected = "Corrected before the job existed PARTIAL_SENTINEL_3140";
    await page.locator("#job-title").first().fill(corrected);
    await page.locator("#job-title").first().blur();

    const draftId = await saveAndCaptureJob(page);
    await openSection(page, draftId, "basics");

    expect(await page.locator("#job-title").first().inputValue()).toBe(corrected);
  });

  test("saving the handoff creates exactly one job", async ({ page }) => {
    await login(page);
    const importDraftId = await prepareImport(page, "multi-craft");
    await openPartialHandoff(page, importDraftId);

    const unique = "Single job check PARTIAL_SENTINEL_7781";
    await page.locator("#job-title").first().fill(unique);
    await page.locator("#job-title").first().blur();
    await saveAndCaptureJob(page);

    await page.goto("/drafts", { waitUntil: "domcontentloaded" });
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByText(unique).first()).toBeVisible({ timeout: 30_000 });

    // Counted by draft identity: a drafts card links to several sections of the
    // same job, so counting title text says two for one draft.
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
    expect(ids.size, `the handoff created more than one job: ${[...ids]}`).toBe(1);
  });
});

/**
 * "Continue manually" ends the conversation; it does not leave the page.
 *
 * Worth writing down, because the obvious reading is wrong and cost a run. The
 * canvas button calls the backend (`continueJobImportManually`) and the
 * recruiter stays on the import screen, now with the conversation closed and
 * the ordinary "Open job draft" handoff available. It is `openNativeDraft` that
 * chooses the destination, and it routes to `?importDraftId=` whenever the
 * draft cannot be applied natively.
 *
 * So the assertions below are about where the recruiter's data ends up, not
 * which URL carried it. The URL shape is the product's decision and it makes it
 * on state these tests deliberately do not pin.
 */
test.describe("the recruiter's own way out of the conversation", () => {
  test.describe.configure({ timeout: 120_000 });

  /** End the conversation early, then take the ordinary handoff. */
  async function continueManuallyIntoTheEditor(page: Page) {
    const continueManually = page.getByTestId("conversation-continue-manually");
    await expect(continueManually).toBeVisible({ timeout: 90_000 });
    await continueManually.click();

    const open = page.getByRole("button", { name: /Open job draft/i });
    await expect(open.first()).toBeVisible({ timeout: 90_000 });
    await open.first().click();

    await expect
      .poll(() => new URL(page.url()).pathname, { timeout: 60_000 })
      .toBe("/post-job");
    await expect(page.locator("#job-title")).toBeVisible({ timeout: 60_000 });
    await expect
      .poll(async () => (await page.locator("#job-title").first().inputValue()).length, {
        timeout: 60_000,
      })
      .toBeGreaterThan(0);
  }

  test("Continue manually carries the paused draft into the editor", async ({
    page,
  }) => {
    await login(page);
    // A checkpointed fixture stops with a question outstanding, which is the
    // only state where the product offers this button at all.
    await prepareImport(page, "checkpoint-trial");
    await continueManuallyIntoTheEditor(page);

    expect(await page.locator("#job-title").first().inputValue()).toBe(
      CHECKPOINT_TRIAL.title
    );
  });

  test("what the assistant settled before pausing still reaches the job", async ({
    page,
  }) => {
    await login(page);
    await prepareImport(page, "checkpoint-trial");
    await continueManuallyIntoTheEditor(page);

    const draftId = await saveAndCaptureJob(page);
    await openSection(page, draftId, "budget");

    // The conversation stopped early; everything it had already decided must
    // still arrive. Losing it here is silent — the recruiter abandoned the
    // assistant precisely because it could not finish, so there is nothing to
    // compare against.
    const control = compensation(page);
    expect(await control.currency.inputValue()).toBe(CHECKPOINT_TRIAL.currency);
    expect(Number(await control.amount.first().inputValue())).toBe(
      CHECKPOINT_TRIAL.amount
    );
    expect(await control.unit.inputValue()).toBe(CHECKPOINT_TRIAL.unit);
  });
});
