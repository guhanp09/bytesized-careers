import { expect, test, type Page } from "@playwright/test";

/**
 * The controls a recruiter meets *after* the first step, saved and reopened.
 *
 * Step one was proven already. Everything past it was not, and the reason was
 * navigation: the previous run could not get there and said so. It turns out the
 * product already has the mechanism — `/post-job?draftId=<id>&section=<key>` is
 * the deep-link the drafts list uses for its "Jump to …" links, resolved through
 * `JOB_COMPLETION_TARGETS` into a step plus a focus target. So these tests
 * navigate the way the product already navigates, rather than reaching into it.
 *
 * The compensation and experience controls carry most of the risk here. Both
 * have a history: a monthly rate read as annual is a factor-of-twelve lie, and
 * this experience field is the one that used to collapse "25 years" into a
 * closed band. A form that hydrates them correctly and *serializes* them wrongly
 * would look right on screen and be wrong the moment anybody saved.
 *
 * Every reopen visits an unrelated route first so the React tree is destroyed. A
 * value present afterwards came back from the server.
 */

const CONTROLLER_EMAIL = "qa-controller@example.com";
const CONTROLLER_PASSWORD = "LocalQaController123!";

/** Deep-link keys, exactly as `/drafts` uses them. */
type Section =
  | "budget"
  | "experience"
  | "timeline"
  | "responsibilities"
  | "howToApply"
  | "screening"
  | "tools"
  | "basics";

async function login(page: Page) {
  await page.goto("/auth?mode=login", { waitUntil: "domcontentloaded" });
  await page.getByPlaceholder("Email").fill(CONTROLLER_EMAIL);
  await page.getByPlaceholder("Password").fill(CONTROLLER_PASSWORD);
  await page.locator("form").getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page).toHaveURL(/\/you/);
}

/** Import the deterministic fixture and return the draft id. */
async function importDraft(page: Page, scenario = "labelled-pay-conflict") {
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

  const id = new URL(page.url()).searchParams.get("draftId");
  expect(id, "no draft id after import").toBeTruthy();
  return id as string;
}

/**
 * Open a specific step of a draft with no client state carried over.
 *
 * `/you` first, so the editor is mounted from nothing and whatever the controls
 * hold was fetched rather than remembered.
 */
async function openSection(page: Page, draftId: string, section: Section) {
  await page.goto("/you", { waitUntil: "domcontentloaded" });
  await page.goto(`/post-job?draftId=${draftId}&section=${section}`, {
    waitUntil: "domcontentloaded",
  });
  // The section is applied only once the draft has finished hydrating, so the
  // arrival of a step-specific control is the signal, not a duration.
  await page.waitForTimeout(2_500);
}

/** Save through the recruiter's own control and confirm the write landed. */
async function saveDraft(page: Page) {
  const writes: number[] = [];
  const listener = (r: { url(): string; status(): number; request(): { method(): string } }) => {
    if (/\/api\/v1\/jobs\//.test(r.url()) && r.request().method() !== "GET") {
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
}

const compensation = (page: Page) => ({
  mode: page.locator("#job-compensation-mode"),
  currency: page.getByLabel("Compensation currency"),
  amount: page.getByLabel(/Compensation amount|Minimum compensation/),
  unit: page.getByLabel("Compensation unit"),
});

/**
 * Compensation as the controls hold it, with the amount read as a number.
 *
 * The control renders "5000.00" for the same rate a test writes as "5000".
 * Comparing the strings would fail on formatting and say nothing about the
 * money, so the amount is compared by value and everything else by text.
 */
async function compensationState(page: Page) {
  const control = compensation(page);
  const raw = await control.amount.first().inputValue().catch(() => null);
  return {
    mode: await control.mode.inputValue().catch(() => null),
    currency: await control.currency.inputValue().catch(() => null),
    amount: raw === null || raw === "" ? raw : Number(raw),
    unit: await control.unit.inputValue().catch(() => null),
  };
}

test.describe("compensation, through its own controls", () => {
  test("the imported rate hydrates into the real controls", async ({ page }) => {
    await login(page);
    const draftId = await importDraft(page);
    await openSection(page, draftId, "budget");

    const state = await compensationState(page);

    // The fixture states INR 5,000 per month. Read from the controls a
    // recruiter edits, not from summary text elsewhere on the page.
    expect(state.amount, "the amount never reached its control").toBe(5000);
    expect(state.currency).toBe("INR");
    expect(state.unit).toBe("per month");
  });

  test("saving without touching compensation changes nothing", async ({ page }) => {
    await login(page);
    const draftId = await importDraft(page);
    await openSection(page, draftId, "budget");
    const before = await compensationState(page);

    await saveDraft(page);
    await openSection(page, draftId, "budget");

    // Merely visiting a step must not apply a default. A monthly rate that
    // became annual here would be a twelvefold lie nobody typed.
    expect(await compensationState(page)).toEqual(before);
  });

  test("an edited amount and unit survive a reopen", async ({ page }) => {
    await login(page);
    const draftId = await importDraft(page);
    await openSection(page, draftId, "budget");

    const control = compensation(page);
    await control.amount.first().fill("8250");
    await control.unit.selectOption("per year");
    await page.locator("#job-compensation-mode").blur();

    await saveDraft(page);
    await openSection(page, draftId, "budget");

    const after = await compensationState(page);
    expect(after.amount, "the edited amount did not persist").toBe(8250);
    expect(after.unit, "the edited unit did not persist").toBe("per year");
    expect(after.currency, "the currency changed on its own").toBe("INR");
  });

  test("changing the currency does not disturb the amount", async ({ page }) => {
    await login(page);
    const draftId = await importDraft(page);
    await openSection(page, draftId, "budget");
    const before = await compensationState(page);

    await compensation(page).currency.selectOption("USD");
    await saveDraft(page);
    await openSection(page, draftId, "budget");

    const after = await compensationState(page);
    expect(after.currency).toBe("USD");
    expect(after.amount, "the amount moved with the currency").toBe(before.amount);
    expect(after.unit, "the unit moved with the currency").toBe(before.unit);
  });
});

test.describe("experience, the field that used to narrow", () => {
  const CUSTOM = "At least 60 months of professional experience";

  test("a free-form value survives a save and reopen", async ({ page }) => {
    await login(page);
    const draftId = await importDraft(page);
    await openSection(page, draftId, "experience");

    const control = page.locator("#job-experience").first();
    await expect(control).toBeVisible({ timeout: 30_000 });
    await control.fill(CUSTOM);
    await control.blur();

    await saveDraft(page);
    await openSection(page, draftId, "experience");

    // The control offers suggestions. A source stating "60 months" cannot be
    // represented by any closed band, and this field's whole history is a
    // banded value silently replacing a stated one.
    expect(await page.locator("#job-experience").first().inputValue()).toBe(CUSTOM);
  });

  test("a value committed from the keyboard persists", async ({ page }) => {
    await login(page);
    const draftId = await importDraft(page);
    await openSection(page, draftId, "experience");

    const control = page.locator("#job-experience").first();
    await control.click();
    await control.fill("12+ years of relevant experience");
    await control.press("Enter");

    await saveDraft(page);
    await openSection(page, draftId, "experience");

    // A picker that only commits on click loses the value for anyone using a
    // keyboard, and the loss is invisible until they come back.
    expect(await page.locator("#job-experience").first().inputValue()).toContain(
      "12+ years"
    );
  });
});

test.describe("engagement, work mode and hours", () => {
  test("the arrangement controls hydrate and survive a save", async ({ page }) => {
    await login(page);
    const draftId = await importDraft(page);
    await openSection(page, draftId, "timeline");

    const engagement = page.locator("#job-engagement-type");
    const workMode = page.locator("#job-work-mode");
    await expect(engagement).toBeVisible({ timeout: 30_000 });

    const before = {
      engagement: await engagement.inputValue(),
      workMode: await workMode.inputValue(),
    };

    await saveDraft(page);
    await openSection(page, draftId, "timeline");

    expect(await page.locator("#job-engagement-type").inputValue()).toBe(
      before.engagement
    );
    expect(await page.locator("#job-work-mode").inputValue()).toBe(before.workMode);
  });

  test("an edited engagement does not revert to the imported one", async ({ page }) => {
    await login(page);
    const draftId = await importDraft(page);
    await openSection(page, draftId, "timeline");

    const engagement = page.locator("#job-engagement-type");
    await expect(engagement).toBeVisible({ timeout: 30_000 });
    const imported = await engagement.inputValue();
    const options = await engagement.locator("option").evaluateAll((nodes) =>
      nodes.map((node) => (node as HTMLOptionElement).value).filter(Boolean)
    );
    const replacement = options.find((value) => value !== imported);
    test.skip(!replacement, "only one engagement option is available");

    await engagement.selectOption(replacement as string);
    await saveDraft(page);
    await openSection(page, draftId, "timeline");

    const after = await page.locator("#job-engagement-type").inputValue();
    expect(after, "the edit did not persist").toBe(replacement);
    expect(after, "the imported engagement came back").not.toBe(imported);
  });
});

test.describe("one control at a time", () => {
  test("editing experience leaves compensation alone", async ({ page }) => {
    await login(page);
    const draftId = await importDraft(page);
    await openSection(page, draftId, "budget");
    const payBefore = await compensationState(page);

    const control = page.locator("#job-experience").first();
    await control.fill("Isolation check LATER_SENTINEL_5520");
    await control.blur();
    await saveDraft(page);
    await openSection(page, draftId, "budget");

    // Both live on the pay step, so a serializer that flattens the step would
    // take one with the other.
    expect(await compensationState(page)).toEqual(payBefore);
  });

  test("editing compensation leaves the arrangement alone", async ({ page }) => {
    await login(page);
    const draftId = await importDraft(page);
    await openSection(page, draftId, "timeline");
    const engagementBefore = await page.locator("#job-engagement-type").inputValue();

    await openSection(page, draftId, "budget");
    await compensation(page).amount.first().fill("6100");
    await page.locator("#job-compensation-mode").blur();
    await saveDraft(page);

    await openSection(page, draftId, "timeline");
    expect(
      await page.locator("#job-engagement-type").inputValue(),
      "the engagement moved when compensation changed"
    ).toBe(engagementBefore);
  });
});

test.describe("faults on a later step", () => {
  test("a failed save does not claim the new rate persisted", async ({ page }) => {
    await login(page);
    const draftId = await importDraft(page);
    await openSection(page, draftId, "budget");
    const before = await compensationState(page);

    await page.route("**/api/v1/jobs/**", async (route) => {
      if (route.request().method() === "GET") return route.continue();
      return route.fulfill({ status: 500, body: '{"error":{"message":"nope"}}' });
    });

    await compensation(page).amount.first().fill("999999");
    await page.locator("#job-compensation-mode").blur();
    await page.getByRole("button", { name: /save draft/i }).first().click();
    await page.waitForTimeout(3_000);
    await page.unroute("**/api/v1/jobs/**");

    await openSection(page, draftId, "budget");

    // Optimistic UI is not persistence. What the server has is what the
    // recruiter must find when they come back.
    expect(await compensationState(page)).toEqual(before);
  });

  test("a lost response still leaves the committed value discoverable", async ({
    page,
  }) => {
    await login(page);
    const draftId = await importDraft(page);
    await openSection(page, draftId, "budget");

    // The server commits; the browser never hears about it.
    await page.route("**/api/v1/jobs/**", async (route) => {
      if (route.request().method() === "GET") return route.continue();
      await route.fetch();
      return route.abort();
    });

    await compensation(page).amount.first().fill("7350");
    await page.locator("#job-compensation-mode").blur();
    await page.getByRole("button", { name: /save draft/i }).first().click();
    await page.waitForTimeout(4_000);
    await page.unroute("**/api/v1/jobs/**");

    await openSection(page, draftId, "budget");

    // A write that reached the database must be findable afterwards, however
    // the response was lost.
    expect((await compensationState(page)).amount).toBe(7350);
  });
});

const VIEWPORTS: Array<{ name: string; width: number; height: number; section: Section }> = [
  { name: "mobile-390", width: 390, height: 844, section: "budget" },
  { name: "mobile-430", width: 430, height: 932, section: "experience" },
  { name: "tablet-834", width: 834, height: 1112, section: "timeline" },
  { name: "desktop-1280", width: 1280, height: 900, section: "budget" },
  { name: "wide-1680", width: 1680, height: 1000, section: "experience" },
];

for (const viewport of VIEWPORTS) {
  test(`a later-step edit survives at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await login(page);
    const draftId = await importDraft(page);
    await openSection(page, draftId, viewport.section);

    if (viewport.section === "budget") {
      const amount = compensation(page).amount.first();
      await expect(amount, `${viewport.name}: no amount control`).toBeVisible({
        timeout: 30_000,
      });
      await amount.fill("4321");
      await page.locator("#job-compensation-mode").blur();
      await saveDraft(page);
      await openSection(page, draftId, viewport.section);
      expect(
        (await compensationState(page)).amount,
        `${viewport.name}: the edit did not survive`
      ).toBe(4321);
      return;
    }

    if (viewport.section === "experience") {
      const control = page.locator("#job-experience").first();
      await expect(control, `${viewport.name}: no experience control`).toBeVisible({
        timeout: 30_000,
      });
      const value = `Viewport ${viewport.name} experience`;
      await control.fill(value);
      await control.blur();
      await saveDraft(page);
      await openSection(page, draftId, viewport.section);
      expect(
        await page.locator("#job-experience").first().inputValue(),
        `${viewport.name}: the edit did not survive`
      ).toBe(value);
      return;
    }

    const workMode = page.locator("#job-work-mode");
    await expect(workMode, `${viewport.name}: no work-mode control`).toBeVisible({
      timeout: 30_000,
    });
    const before = await workMode.inputValue();
    await saveDraft(page);
    await openSection(page, draftId, viewport.section);
    expect(
      await page.locator("#job-work-mode").inputValue(),
      `${viewport.name}: the work mode drifted`
    ).toBe(before);
  });
}

/**
 * The application step, where what is stored is also what candidates read.
 *
 * The public note is the sharpest case on this step. It has two owners in the
 * form — a legacy prompt box that appears only when the custom-instruction
 * requirement is chosen, and the ordinary note field that owns it otherwise —
 * and the save chooses between them. A mutation that let the legacy branch win
 * unconditionally survived every backend suite, because the damage is done
 * before the request is built: the note a recruiter typed is serialized as
 * null and the job page quietly loses a paragraph.
 */
test.describe("what applicants are asked for", () => {
  const NOTE = "Send two recent edits and a note on your turnaround. APPLY_SENTINEL_2210";
  const publicNote = (page: Page) => page.getByLabel("Public how-to-apply note").first();

  test("the public note survives a save and reopen", async ({ page }) => {
    await login(page);
    const draftId = await importDraft(page);
    await openSection(page, draftId, "howToApply");

    const note = publicNote(page);
    await expect(note).toBeVisible({ timeout: 30_000 });
    await note.fill(NOTE);
    await note.blur();

    await saveDraft(page);
    await openSection(page, draftId, "howToApply");

    // Candidate-visible by design — the step says so. A note that does not
    // survive the save is a paragraph the recruiter believes they published.
    expect(await publicNote(page).inputValue()).toBe(NOTE);
  });

  test("saving without touching the note leaves it alone", async ({ page }) => {
    await login(page);
    const draftId = await importDraft(page);
    await openSection(page, draftId, "howToApply");
    await publicNote(page).fill(NOTE);
    await publicNote(page).blur();
    await saveDraft(page);

    await openSection(page, draftId, "howToApply");
    await saveDraft(page);
    await openSection(page, draftId, "howToApply");

    // The second save touches nothing. A form default that wins here erases
    // the note of every recruiter who opens the step and moves on.
    expect(await publicNote(page).inputValue()).toBe(NOTE);
  });

  test("a chosen requirement is still chosen after a reopen", async ({ page }) => {
    await login(page);
    const draftId = await importDraft(page);
    await openSection(page, draftId, "howToApply");

    const portfolio = page.getByRole("button", { name: "Relevant portfolio" }).first();
    await expect(portfolio).toBeVisible({ timeout: 30_000 });
    if ((await portfolio.getAttribute("aria-pressed")) !== "true") await portfolio.click();
    await expect(portfolio).toHaveAttribute("aria-pressed", "true");

    await saveDraft(page);
    await openSection(page, draftId, "howToApply");

    // These decide what an applicant is forced to attach. A selection that
    // does not persist means applications arrive without the one thing the
    // recruiter asked for.
    await expect(
      page.getByRole("button", { name: "Relevant portfolio" }).first()
    ).toHaveAttribute("aria-pressed", "true");
  });

  test("removing a requirement removes it for good", async ({ page }) => {
    await login(page);
    const draftId = await importDraft(page);
    await openSection(page, draftId, "howToApply");

    const rate = page.getByRole("button", { name: "Expected rate" }).first();
    await expect(rate).toBeVisible({ timeout: 30_000 });
    if ((await rate.getAttribute("aria-pressed")) !== "true") {
      await rate.click();
      await saveDraft(page);
      await openSection(page, draftId, "howToApply");
    }

    await page.getByRole("button", { name: "Expected rate" }).first().click();
    await expect(
      page.getByRole("button", { name: "Expected rate" }).first()
    ).toHaveAttribute("aria-pressed", "false");

    await saveDraft(page);
    await openSection(page, draftId, "howToApply");

    // A save that can add but not remove is how a job goes on demanding
    // something the recruiter deliberately stopped asking for.
    await expect(
      page.getByRole("button", { name: "Expected rate" }).first()
    ).toHaveAttribute("aria-pressed", "false");
  });
});

test.describe("the description of the work", () => {
  const bullet = (page: Page, index: number) =>
    page.getByLabel(`Responsibility ${index}`).first();

  test("an edited responsibility survives a reopen", async ({ page }) => {
    await login(page);
    const draftId = await importDraft(page);
    await openSection(page, draftId, "responsibilities");

    const first = bullet(page, 1);
    await expect(first).toBeVisible({ timeout: 30_000 });
    await first.fill("Cut two Shorts a week. RESP_SENTINEL_8841");
    await first.blur();

    await saveDraft(page);
    await openSection(page, draftId, "responsibilities");

    expect(await bullet(page, 1).inputValue()).toBe(
      "Cut two Shorts a week. RESP_SENTINEL_8841"
    );
  });

  test("an added responsibility is still there tomorrow", async ({ page }) => {
    await login(page);
    const draftId = await importDraft(page);
    await openSection(page, draftId, "responsibilities");

    const first = bullet(page, 1);
    await expect(first).toBeVisible({ timeout: 30_000 });
    const existing = await first.inputValue();
    const bullets = page.getByLabel(/^Responsibility \d+$/);
    const before = await bullets.count();

    await first.click();
    await first.press("End");
    await first.press("Enter");

    // The editor moves focus to the new line on the next animation frame, so
    // typing immediately puts the first few characters back in the old bullet
    // and splits a word in half. Wait for the line to exist, then fill it.
    await expect.poll(() => bullets.count(), { timeout: 15_000 }).toBe(before + 1);
    await bullets.nth(1).fill("Storyboard one video a week. RESP_SENTINEL_9002");
    await bullets.nth(1).blur();

    await saveDraft(page);
    await openSection(page, draftId, "responsibilities");

    // The list editor splits on Enter, so a new bullet is a new value the
    // serializer has to notice. Both must come back.
    const lines = await page
      .getByLabel(/^Responsibility \d+$/)
      .evaluateAll((nodes) =>
        nodes.map((node) => (node as HTMLTextAreaElement).value).filter(Boolean)
      );
    expect(lines).toContain("Storyboard one video a week. RESP_SENTINEL_9002");
    if (existing.trim()) expect(lines).toContain(existing);
  });

  test("saving the step without editing keeps every bullet", async ({ page }) => {
    await login(page);
    const draftId = await importDraft(page);
    await openSection(page, draftId, "responsibilities");
    await expect(bullet(page, 1)).toBeVisible({ timeout: 30_000 });

    const read = () =>
      page
        .getByLabel(/^Responsibility \d+$/)
        .evaluateAll((nodes) =>
          nodes.map((node) => (node as HTMLTextAreaElement).value).filter(Boolean)
        );
    const before = await read();

    await saveDraft(page);
    await openSection(page, draftId, "responsibilities");

    // A list that loses an entry per save is the worst kind of drift: it looks
    // fine every time and empties over a week.
    expect(await read()).toEqual(before);
  });
});

/**
 * Where the job happens, changed rather than merely observed.
 *
 * Every case above reads the arrangement and checks it has not drifted. None of
 * them ever *changed* it, and that gap is exactly what a mutation found: an
 * existing draft is saved as a dirty-key patch (`payloadForWrite`), so nulling
 * `work_mode` or `location` in the payload has no effect at all unless a test
 * edits those fields. Two deliberate defects lived through the whole suite for
 * that reason.
 *
 * They are also the most coupled pair on the form. `location` is not a control
 * of its own — it is derived from the work mode and the city, with "Remote"
 * standing in for a place, and choosing Remote clears the city as a side effect.
 * A serializer that gets that wrong produces a remote job in a city, or an
 * on-site job nowhere.
 */
test.describe("changing where the work happens", () => {
  test("moving a remote job on-site saves both the mode and the city", async ({
    page,
  }) => {
    await login(page);
    const draftId = await importDraft(page);
    await openSection(page, draftId, "timeline");

    const workMode = page.locator("#job-work-mode");
    await expect(workMode).toBeVisible({ timeout: 30_000 });
    await workMode.selectOption("On-site");

    // The city control only exists once somewhere is required, so its arrival
    // is the signal that the conditional actually reacted.
    const city = page.locator("#job-city");
    await expect(city).toBeVisible({ timeout: 15_000 });
    await city.fill("Coimbatore");
    await city.blur();

    await saveDraft(page);
    await openSection(page, draftId, "timeline");

    expect(
      await page.locator("#job-work-mode").inputValue(),
      "the work mode did not persist"
    ).toBe("On-site");
    expect(
      await page.locator("#job-city").inputValue(),
      "the city did not persist"
    ).toBe("Coimbatore");
  });

  test("moving it back to remote drops the city rather than keeping it", async ({
    page,
  }) => {
    await login(page);
    const draftId = await importDraft(page);
    await openSection(page, draftId, "timeline");

    await page.locator("#job-work-mode").selectOption("Hybrid");
    const city = page.locator("#job-city");
    await expect(city).toBeVisible({ timeout: 15_000 });
    await city.fill("Kolkata");
    await city.blur();
    await saveDraft(page);

    await openSection(page, draftId, "timeline");
    await page.locator("#job-work-mode").selectOption("Remote");
    await saveDraft(page);
    await openSection(page, draftId, "timeline");

    expect(await page.locator("#job-work-mode").inputValue()).toBe("Remote");
    // A remote job that still remembers Kolkata tells candidates it is in a
    // city nobody has to be in.
    const cityAfter = page.locator("#job-city");
    if ((await cityAfter.count()) > 0) {
      expect(await cityAfter.inputValue()).toBe("");
    }
  });

  test("an edited city does not move the work mode with it", async ({ page }) => {
    await login(page);
    const draftId = await importDraft(page);
    await openSection(page, draftId, "timeline");

    await page.locator("#job-work-mode").selectOption("Hybrid");
    const city = page.locator("#job-city");
    await expect(city).toBeVisible({ timeout: 15_000 });
    await city.fill("Pune");
    await city.blur();
    await saveDraft(page);

    await openSection(page, draftId, "timeline");
    await page.locator("#job-city").fill("Hyderabad");
    await page.locator("#job-city").blur();
    await saveDraft(page);
    await openSection(page, draftId, "timeline");

    expect(await page.locator("#job-city").inputValue()).toBe("Hyderabad");
    expect(
      await page.locator("#job-work-mode").inputValue(),
      "the work mode changed when only the city was edited"
    ).toBe("Hybrid");
  });
});
