import { expect, test, type Page } from "@playwright/test";

/**
 * Phase A behavioural coverage: the promoted primary action, the skippable
 * decision surface, and the derived work-state indicator.
 *
 * These drive the real UI rather than asserting on rendered markup — every
 * assertion here is about what a user can actually do.
 */

const CONTROLLER_EMAIL = "qa-controller@example.com";
const CONTROLLER_PASSWORD = "LocalQaController123!";

async function loginController(page: Page) {
  await page.goto("/auth?mode=login", { waitUntil: "domcontentloaded" });
  await page.getByPlaceholder("Email").fill(CONTROLLER_EMAIL);
  await page.getByPlaceholder("Password").fill(CONTROLLER_PASSWORD);
  await page.locator("form").getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page).toHaveURL(/\/you/);
}

async function switchPersona(page: Page, key: string, displayName: string) {
  await page.getByTestId("qa-persona-open").click();
  await expect(page.getByTestId("qa-persona-drawer")).toBeVisible();
  await page.getByTestId(`qa-switch-${key}`).click();
  await expect(page.getByTestId("qa-persona-open")).toContainText(displayName, { timeout: 20_000 });
}

async function restoreScenario(page: Page, key: string, confirmation: string) {
  const response = await page.request.post(`/api/qa/scenarios/${key}/restore`, {
    data: { confirmation },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
}

async function returnToController(page: Page) {
  await page.getByTestId("qa-persona-open").click();
  await expect(page.getByTestId("qa-persona-drawer")).toBeVisible();
  await page.getByRole("button", { name: "Return to Guhan" }).click();
  await expect(page.getByTestId("qa-persona-open")).toContainText("QA personas", { timeout: 20_000 });
}

async function openRecruiterInbox(page: Page) {
  await loginController(page);
  await restoreScenario(page, "inbox-pipeline", "RESTORE INBOX");
  await switchPersona(page, "recruiter-active", "Finance Simplified");
  await page.goto("/applications?view=inbox&mode=recruiter&direction=received", {
    waitUntil: "domcontentloaded",
  });
}

test("what to do next is reachable without ever opening the overflow menu", async ({ page }) => {
  await openRecruiterInbox(page);
  await page.getByTestId("interaction-row").filter({ hasText: "Priya Nair" }).first().click();

  /*
    Two legitimate shapes, and the overflow menu is neither.

    A well-evidenced recommendation is a labelled primary button. Where the
    ladder is not confident there is deliberately no button at all — the
    workspace used to render "Choose next step" there, which named an action it
    could not describe and, with the decision flag off, did nothing when
    pressed. What stands in its place is the decision surface itself, offering
    the real choices rather than a euphemism for them.
  */
  const primary = page.getByTestId("next-action-primary");
  const strip = page.getByTestId("decision-strip");
  await expect
    .poll(async () => (await primary.count()) + (await strip.count()))
    .toBeGreaterThan(0);

  if ((await primary.count()) > 0) {
    await expect(primary).toBeVisible();
    await expect(primary).not.toHaveText("");
  } else {
    await expect(strip).toBeVisible();
    await expect(strip.locator('[data-testid^="decision-strip-option-"]').first()).toBeVisible();
  }
  // Nothing above required opening a menu.
  await expect(page.getByRole("menu")).toHaveCount(0);
});

test("a low-confidence recommendation offers a choice instead of guessing an outcome", async ({ page }) => {
  await openRecruiterInbox(page);
  await page.getByTestId("interaction-row").filter({ hasText: "Priya Nair" }).first().click();

  const primary = page.getByTestId("next-action-primary");
  if ((await primary.count()) === 0) {
    // No recommendation the system can stand behind, so it makes none — and the
    // decision surface asks instead of guessing.
    await expect(page.getByTestId("decision-strip")).toBeVisible();
    return;
  }

  const actionKey = await primary.getAttribute("data-action-key");
  // A guess must never reach the header. "Choose next step" in particular is
  // gone: a recommendation the system cannot make is better expressed by not
  // making one.
  expect(actionKey).not.toBe("choose-next-step");
  // Reply is deliberately absent: the composer is pinned below with the
  // person's name in its placeholder, so a header button that focused it was
  // the same click twice.
  expect([
    "record-decision",
    "share-decision",
    "confirm-start",
    "confirm-interview",
    "resolve-legacy-stage",
  ]).toContain(actionKey);
});

test("the decision surface never covers the composer and never steals focus", async ({ page }) => {
  await openRecruiterInbox(page);
  await page.getByTestId("interaction-row").filter({ hasText: "Priya Nair" }).first().click();

  const composer = page.getByRole("textbox", { name: "Reply message" });
  await expect(composer).toBeVisible();

  const strip = page.getByTestId("decision-strip");
  if (await strip.count()) {
    // Structurally above the composer, so it cannot occlude it.
    const stripBox = await strip.boundingBox();
    const composerBox = await composer.boundingBox();
    expect(stripBox && composerBox).toBeTruthy();
    expect(stripBox!.y + stripBox!.height).toBeLessThanOrEqual(composerBox!.y + 2);
  }

  // Typing is never interrupted: focus stays in the composer.
  await composer.click();
  await composer.type("Checking that focus is never stolen");
  await expect(composer).toBeFocused();
  await expect(composer).toHaveValue(/never stolen/);
});

test("the decision surface is dismissible and stays dismissed for that record", async ({ page }) => {
  await openRecruiterInbox(page);
  // A genuinely new application — the case the surface exists for.
  const newApplication = page
    .getByTestId("interaction-row")
    .filter({ hasText: "Priya Nair" })
    .filter({ hasText: "Shorts editor for a fitness creator" });
  await newApplication.click();

  const strip = page.getByTestId("decision-strip");
  await expect(strip).toBeVisible();

  await page.getByTestId("decision-strip-dismiss").click();
  await expect(strip).toHaveCount(0);
  // Dismissing must not have changed the record's stage.
  await expect(page.getByTestId("applications-detail-header")).toContainText("New");

  // Navigating away and back must not resurrect it.
  await page.getByTestId("interaction-row").first().click();
  await newApplication.click();
  await expect(page.getByTestId("decision-strip")).toHaveCount(0);

  // Nor may a full reload, because the dismissal is persisted per user.
  await page.reload({ waitUntil: "domcontentloaded" });
  await newApplication.click();
  await expect(page.getByTestId("decision-strip")).toHaveCount(0);
});

test("the decision surface commits a real stage change when a choice is taken", async ({ page }) => {
  await openRecruiterInbox(page);
  const newApplication = page
    .getByTestId("interaction-row")
    .filter({ hasText: "Priya Nair" })
    .filter({ hasText: "Shorts editor for a fitness creator" });
  await newApplication.click();

  const strip = page.getByTestId("decision-strip");
  await expect(strip).toBeVisible();
  await strip.getByTestId("decision-strip-option-reviewing").click();

  // The surface closes and the change is authoritative, not cosmetic.
  await expect(strip).toHaveCount(0);
  await expect(page.getByTestId("applications-detail-header")).toContainText("Viewed");
  await page.reload({ waitUntil: "domcontentloaded" });
  await newApplication.click();
  await expect(page.getByTestId("applications-detail-header")).toContainText("Viewed");
});

test("messaging stays immediately available and does not change lifecycle state @synthetic:message", async ({ page }) => {
  await openRecruiterInbox(page);
  await page.getByTestId("interaction-row").filter({ hasText: "Priya Nair" }).first().click();

  const header = page.getByTestId("applications-detail-header");
  const before = (await header.innerText()).replace(/\s+/g, "");

  const composer = page.getByRole("textbox", { name: "Reply message" });
  await composer.fill("A plain freeform message.");
  await page.getByTestId("applications-detail").getByRole("button", { name: "Send", exact: true }).click();
  await expect(composer).toHaveValue("");

  // A freeform send must never silently move the relationship forward.
  await expect
    .poll(async () => (await header.innerText()).replace(/\s+/g, ""))
    .toBe(before);
});

test("the work-state indicator never overstates certainty", async ({ page }) => {
  await openRecruiterInbox(page);
  const chips = page.getByTestId("work-state-chip");
  const count = await chips.count();

  for (let index = 0; index < count; index += 1) {
    const chip = chips.nth(index);
    const key = await chip.getAttribute("data-work-state");
    const text = (await chip.innerText()).trim();
    // "Needs your reply" may only appear for the explicitly-evidenced state.
    if (/needs your reply/i.test(text)) {
      expect(key).toBe("needs_reply");
    }
    if (key === "review_latest") {
      expect(text).toMatch(/Review latest message/i);
    }
  }
});

test("Inbox and Pipeline agree on what a record needs", async ({ page }) => {
  await openRecruiterInbox(page);
  await expect(page.getByTestId("interaction-row").first()).toBeVisible();

  /**
   * A person can apply to several roles, so the applicant name alone does not
   * identify a record — name plus role does.
   */
  const stateFor = async (rowId: string, chipId: string, name: string, role: string) => {
    const rows = page.getByTestId(rowId).filter({ hasText: name }).filter({ hasText: role });
    if ((await rows.count()) !== 1) return { unique: false, state: null as string | null };
    const chip = rows.first().getByTestId(chipId);
    const state = (await chip.count()) ? await chip.getAttribute("data-work-state") : null;
    return { unique: true, state };
  };

  // Two records for the same person whose derived states differ, so this would
  // catch a genuine divergence rather than trivially matching "no state".
  const records = [
    ["Priya Nair", "Long-form video editor for a finance YouTube channel"],
    ["Priya Nair", "Shorts editor for a fitness creator"],
    ["Aditi Verma", "Shorts editor for a fitness creator"],
  ] as const;

  const inboxStates = new Map<string, string | null>();
  for (const [name, role] of records) {
    const found = await stateFor("interaction-row", "work-state-chip", name, role);
    if (found.unique) inboxStates.set(`${name}|${role}`, found.state);
  }

  await page.goto("/applications?view=pipeline&mode=recruiter&direction=received", {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByTestId("pipeline-board")).toBeVisible();

  let compared = 0;
  const distinct = new Set<string | null>();
  for (const [name, role] of records) {
    const key = `${name}|${role}`;
    if (!inboxStates.has(key)) continue;
    const found = await stateFor("pipeline-row", "pipeline-work-state", name, role);
    if (!found.unique) continue;
    // Both views read the same derivation, so they cannot disagree.
    expect(found.state, `work state for ${key}`).toBe(inboxStates.get(key));
    distinct.add(found.state);
    compared += 1;
  }
  expect(compared, "expected records uniquely visible in both views").toBeGreaterThan(1);
  expect(distinct.size, "records compared should not all share one state").toBeGreaterThan(1);
});

test("mobile keeps the list calm and acts from the opened conversation", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openRecruiterInbox(page);

  // Row-level action buttons are desktop-only; the list must not be crowded.
  // Counted in one pass rather than awaited per element, so the assertion stays
  // fast and deterministic regardless of how many rows are present.
  await expect(page.getByTestId("interaction-row").first()).toBeVisible();
  const visibleRowActions = await page
    .getByTestId("row-next-action")
    .evaluateAll((nodes) => nodes.filter((node) => (node as HTMLElement).offsetParent !== null).length);
  expect(visibleRowActions, "list rows must stay calm on mobile").toBe(0);

  await page.getByTestId("interaction-row").filter({ hasText: "Priya Nair" }).first().click();
  await expect(page.getByTestId("applications-detail")).toBeVisible();
  // Messaging remains reachable on a narrow viewport.
  await expect(page.getByRole("textbox", { name: "Reply message" })).toBeVisible();
});

test("the recommended action is operable by keyboard", async ({ page }) => {
  await openRecruiterInbox(page);
  await page.getByTestId("interaction-row").filter({ hasText: "Priya Nair" }).first().click();

  /*
    Whichever of the two surfaces this record gets, it has to be operable from
    the keyboard — that is the claim, not that a particular button exists.
  */
  const primary = page.getByTestId("next-action-primary");
  const control =
    (await primary.count()) > 0
      ? primary
      : // A decision *option*, not merely the first button in the strip — that
        // one is the dismiss control, and dismissing is the one outcome this
        // test cannot tell apart from a silent no-op.
        page.getByTestId("decision-strip").locator('[data-testid^="decision-strip-option-"]').first();
  await expect(control).toBeVisible();
  const headerBefore = (await page.getByTestId("applications-detail-header").innerText()).replace(/\s+/g, "");
  await control.focus();
  await expect(control).toBeFocused();
  await control.press("Enter");

  /*
    Something observable must happen — never a silent no-op. Which outcome is
    correct depends on the recommendation, and "a surface opened" is only some
    of them: taking a decision option can *commit* a stage instead, which shows
    up as the header changing rather than as anything appearing. Both count.
  */
  await expect
    .poll(async () => {
      const [strip, notify, dialog, menu, scheduler] = await Promise.all([
        page.getByTestId("decision-strip").count(),
        page.getByTestId("stage-notify-prompt").count(),
        page.getByRole("dialog").count(),
        page.getByRole("menu").count(),
        page.getByTestId("interview-scheduler").count(),
      ]);
      const composerFocused = await page
        .getByRole("textbox", { name: "Reply message" })
        .evaluate((node) => node === document.activeElement)
        .catch(() => false);
      const headerNow = (await page
        .getByTestId("applications-detail-header")
        .innerText()
        .catch(() => ""))
        .replace(/\s+/g, "");
      return (
        strip + notify + dialog + menu + scheduler > 0 ||
        composerFocused ||
        (headerNow.length > 0 && headerNow !== headerBefore)
      );
    })
    .toBe(true);
});

test("composer intents are optional accelerators, never a required step", async ({ page }) => {
  await openRecruiterInbox(page);
  await page
    .getByTestId("interaction-row")
    .filter({ hasText: "Priya Nair" })
    .filter({ hasText: "Shorts editor" })
    .click();

  const composer = page.getByRole("textbox", { name: "Reply message" });
  const header = page.getByTestId("applications-detail-header");
  // Deliberately opening a new application is itself the reviewed/viewed
  // transition. Let that server-owned lifecycle change settle before proving
  // that ordinary messages and optional composer intents do not change it.
  await expect(header).toContainText("Viewed");
  const stageBefore = (await header.innerText()).replace(/\s+/g, "");

  // Freeform is available immediately, with no intent selected.
  await composer.fill("Plain message, no intent chosen.");
  await page.getByTestId("applications-detail").getByRole("button", { name: "Send", exact: true }).click();
  await expect(composer).toHaveValue("");
  // ...and it changes nothing about the relationship.
  await expect.poll(async () => (await header.innerText()).replace(/\s+/g, "")).toBe(stageBefore);

  // Choosing an asking intent pre-fills an editable draft.
  const intents = page.getByTestId("composer-intents");
  await expect(intents).toBeVisible();
  await page.getByTestId("composer-intent-request_portfolio").click();
  await expect(composer).not.toHaveValue("");
  await expect(page.getByTestId("composer-intent-request_portfolio")).toHaveAttribute(
    "aria-pressed",
    "true"
  );

  // The draft remains fully editable.
  await composer.fill("Rewritten entirely before sending.");
  await expect(composer).toHaveValue("Rewritten entirely before sending.");

  // Toggling the intent off returns to a plain send.
  await page.getByTestId("composer-intent-request_portfolio").click();
  await expect(page.getByTestId("composer-intent-request_portfolio")).toHaveAttribute(
    "aria-pressed",
    "false"
  );

  // Selecting an intent never moved the stage.
  await expect.poll(async () => (await header.innerText()).replace(/\s+/g, "")).toBe(stageBefore);
});

test("a consequential intent routes to the confirmed action, never a message", async ({ page }) => {
  await openRecruiterInbox(page);
  await page
    .getByTestId("interaction-row")
    .filter({ hasText: "Priya Nair" })
    .filter({ hasText: "Shorts editor" })
    .click();

  // The decision surface and the intent chips answer the same question, so only
  // one shows at a time. Close the surface to reach the chips.
  const strip = page.getByTestId("decision-strip");
  if (await strip.count()) await page.getByTestId("decision-strip-dismiss").click();
  await expect(page.getByTestId("composer-intents")).toBeVisible();
  const notProceeding = page.getByTestId("composer-intent-not_proceeding");
  await expect(notProceeding).toBeVisible();

  await notProceeding.click();
  // It opens the existing confirmation rather than sending anything.
  const dialog = page.getByRole("dialog", { name: /not selected/i });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  // Escaping leaves the record untouched.
  await expect(page.getByTestId("applications-detail-header")).toContainText("New");
});

test("only one chip row is ever on screen", async ({ page }) => {
  await openRecruiterInbox(page);
  await page
    .getByTestId("interaction-row")
    .filter({ hasText: "Priya Nair" })
    .filter({ hasText: "Shorts editor" })
    .click();

  // The decision surface owns the moment while it is open.
  const strip = page.getByTestId("decision-strip");
  await expect(strip).toBeVisible();
  await expect(page.getByTestId("composer-intents")).toHaveCount(0);

  // Closing it hands the moment back to the composer.
  await page.getByTestId("decision-strip-dismiss").click();
  await expect(strip).toHaveCount(0);
  await expect(page.getByTestId("composer-intents")).toBeVisible();
});

test("Star is private, durable, and independent per participant", async ({ page }) => {
  await openRecruiterInbox(page);
  const row = page
    .getByTestId("interaction-row")
    .filter({ hasText: "Priya Nair" })
    .filter({ hasText: "Shorts editor" });
  await row.click();

  const star = page.getByTestId("star-toggle");
  const header = page.getByTestId("applications-detail-header");
  // Opening a new application is itself the server-owned Viewed transition.
  // Let that settle before proving the private Star preference cannot change
  // the shared application lifecycle.
  await expect(header).toContainText("Viewed");
  const lifecycleBeforeStar = (await header.innerText()).replace(/\s+/g, "");
  await expect(star).toBeVisible();
  await expect(star).toHaveAttribute("aria-pressed", "false");
  const persisted = page.waitForResponse(
    (response) =>
      response.request().method() === "PUT" &&
      /\/preferences\/star$/.test(new URL(response.url()).pathname)
  );
  await star.click();
  await expect(star).toHaveAttribute("aria-pressed", "true");
  /*
    A quiet row marker, not a badge cluster — and it lives on the row's Star
    control rather than beside the timestamp, because a readout in one place and
    the control in another was the same fact drawn twice. The control is a
    sibling of the row button (a button may not nest inside one), so it is
    addressed through the row's wrapper.
  */
  await expect(row.locator("xpath=..").getByTestId("row-starred")).toBeVisible();

  // `aria-pressed` changes optimistically. Durability begins when the server
  // acknowledges the idempotent write, not when that local paint occurs.
  const persistedResponse = await persisted;
  expect(persistedResponse.ok(), await persistedResponse.text()).toBeTruthy();

  // Durable across a full reload.
  await page.reload({ waitUntil: "domcontentloaded" });
  await row.click();
  await expect(page.getByTestId("star-toggle")).toHaveAttribute("aria-pressed", "true");

  // Starring changed no lifecycle state.
  await expect
    .poll(async () => (await header.innerText()).replace(/\s+/g, ""))
    .toBe(lifecycleBeforeStar);

  // The applicant sees nothing of it, and can save the same thread themselves.
  await returnToController(page);
  await switchPersona(page, "talent-complete", "Priya Nair");
  await page.goto("/applications?view=inbox&mode=talent", { waitUntil: "domcontentloaded" });
  await page.getByTestId("applications-filter-sent").click();
  await page
    .getByTestId("interaction-row")
    .filter({ hasText: "Shorts editor for a fitness creator" })
    .first()
    .click();
  const talentStar = page.getByTestId("star-toggle");
  await expect(talentStar).toBeVisible();
  // Independent: the recruiter's star is invisible here.
  await expect(talentStar).toHaveAttribute("aria-pressed", "false");
});

test("a failed Star write rolls back instead of showing a star the server refused", async ({ page }) => {
  await openRecruiterInbox(page);
  await page
    .getByTestId("interaction-row")
    .filter({ hasText: "Priya Nair" })
    .filter({ hasText: "Shorts editor" })
    .click();

  const star = page.getByTestId("star-toggle");
  await expect(star).toHaveAttribute("aria-pressed", "false");

  await page.route("**/preferences/star", (route) =>
    route.fulfill({ status: 503, contentType: "application/json", body: '{"detail":"nope"}' })
  );
  const refused = page.waitForResponse(
    (response) =>
      response.request().method() === "PUT" &&
      /\/preferences\/star$/.test(new URL(response.url()).pathname)
  );
  await star.click();
  expect((await refused).status()).toBe(503);
  // Optimistically on, then rolled back to the authoritative value.
  await expect(star).toHaveAttribute("aria-pressed", "false");
  await page.unroute("**/preferences/star");
});

test("queues filter the list and only advertise work that exists", async ({ page }) => {
  await openRecruiterInbox(page);
  const trigger = page.getByTestId("queue-selector-trigger");
  await expect(trigger).toBeVisible();

  await trigger.click();
  const menu = page.getByTestId("queue-selector-menu");
  // "Everything" leads the menu and is checked by default, so no filter is a
  // state you can see rather than the absence of one.
  const everything = page.getByTestId("queue-chip-all");
  await expect(everything).toHaveAttribute("aria-checked", "true");

  /*
    The menu lists every category, not only the ones with work in them — that is
    the point of the exhaustive model: the parts add up to Everything, and a
    category at zero is information ("nothing is snoozed") rather than an
    omission. So the filtering claim is made against the first category that
    actually has records.
  */
  /*
    Addressed by key, not by excluding the text "Everything". That exclusion was
    written when the Everything row was exactly that word; it since grew a
    count — the denominator the categories add up to — and `/^Everything$/`
    stopped matching "Everything190", so the row it was meant to skip became the
    first "queue" the test picked and selected, which clears the filter instead
    of applying one.
  */
  const queues = menu.locator('[data-queue-key]:not([data-queue-key="all"])');
  const count = await queues.count();
  expect(count, "the menu should offer categories").toBeGreaterThan(0);

  const advertisedOf = async (index: number) =>
    Number.parseInt((await queues.nth(index).getAttribute("data-queue-count")) ?? "0", 10);
  let index = 0;
  let advertised = await advertisedOf(index);
  while (advertised === 0 && index < count - 1) {
    index += 1;
    advertised = await advertisedOf(index);
  }
  expect(advertised, "no category advertised any work at all").toBeGreaterThan(0);
  const first = queues.nth(index);

  // The category filters to exactly the number it advertises.
  await first.click();
  await expect(page.getByTestId("interaction-row")).toHaveCount(advertised);
  // Active, the queue names itself on the trigger and grows its own clear.
  await expect(page.getByTestId("queue-clear")).toBeVisible();

  // Clearing restores the full list without reopening the menu.
  await page.getByTestId("queue-clear").click();
  await expect(page.getByTestId("queue-clear")).toHaveCount(0);
  await expect(page.getByTestId("interaction-row").first()).toBeVisible();

  // And "Everything" inside the menu does the same job for anyone already there.
  await page.getByTestId("queue-selector-trigger").click();
  await queues.nth(index).click();
  await expect(page.getByTestId("interaction-row")).toHaveCount(advertised);
  await page.getByTestId("queue-selector-trigger").click();
  await page.getByTestId("queue-chip-all").click();
  await expect(page.getByTestId("queue-clear")).toHaveCount(0);
});

test("snooze quietens the recommendation without touching the relationship", async ({ page }) => {
  await openRecruiterInbox(page);
  const row = page
    .getByTestId("interaction-row")
    .filter({ hasText: "Priya Nair" })
    .filter({ hasText: "Shorts editor" });
  await row.click();

  const header = page.getByTestId("applications-detail-header");
  const before = (await header.innerText()).replace(/\s+/g, "");

  await page.getByTestId("applications-detail").getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Snooze until tomorrow" }).click();

  // No lifecycle change, and the thread itself is still fully available.
  await expect.poll(async () => (await header.innerText()).replace(/\s+/g, "")).toBe(before);
  await expect(page.getByRole("textbox", { name: "Reply message" })).toBeVisible();

  // It survives a reload and is reversible.
  await page.reload({ waitUntil: "domcontentloaded" });
  await row.click();
  await page.getByTestId("applications-detail").getByRole("button", { name: "More actions" }).click();
  await expect(page.getByRole("menuitem", { name: "Unsnooze" })).toBeVisible();
  await page.getByRole("menuitem", { name: "Unsnooze" }).click();
  await expect.poll(async () => (await header.innerText()).replace(/\s+/g, "")).toBe(before);
});

test("'No reply needed' is offered only when something suggests a reply", async ({ page }) => {
  await openRecruiterInbox(page);
  // A record with unread inbound activity carries a reply recommendation.
  const withActivity = page.getByTestId("interaction-row").filter({ hasText: "Aditi Verma" }).first();
  await withActivity.click();

  await page.getByTestId("applications-detail").getByRole("button", { name: "More actions" }).click();
  const dismiss = page.getByRole("menuitem", { name: "No reply needed" });
  if (!(await dismiss.count())) {
    // Nothing is recommending a reply here, which is itself the correct
    // behaviour: the control must not appear with nothing to dismiss.
    await expect(page.getByRole("menuitem", { name: "Put back in my queue" })).toHaveCount(0);
    return;
  }

  const header = page.getByTestId("applications-detail-header");
  const before = (await header.innerText()).replace(/\s+/g, "");
  await dismiss.click();
  // Corrects the recommendation, never the lifecycle — and is reversible.
  await expect.poll(async () => (await header.innerText()).replace(/\s+/g, "")).toBe(before);
  await page.getByTestId("applications-detail").getByRole("button", { name: "More actions" }).click();
  await expect(page.getByRole("menuitem", { name: "Put back in my queue" })).toBeVisible();
});
