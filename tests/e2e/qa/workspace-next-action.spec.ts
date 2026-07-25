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

test("the recommended action is reachable without ever opening the overflow menu", async ({ page }) => {
  await openRecruiterInbox(page);
  await page.getByTestId("interaction-row").filter({ hasText: "Priya Nair" }).first().click();

  const primary = page.getByTestId("next-action-primary");
  await expect(primary).toBeVisible();
  // The overflow menu must not have been opened to get here.
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(primary).not.toHaveText("");
});

test("a low-confidence recommendation offers a choice instead of guessing an outcome", async ({ page }) => {
  await openRecruiterInbox(page);
  await page.getByTestId("interaction-row").filter({ hasText: "Priya Nair" }).first().click();

  const primary = page.getByTestId("next-action-primary");
  const actionKey = await primary.getAttribute("data-action-key");

  if (actionKey === "choose-next-step") {
    await expect(primary).toHaveText("Choose next step");
    await primary.click();
    // It opens the decision surface rather than committing anything.
    await expect(page.getByTestId("decision-strip")).toBeVisible();
  } else {
    // Any other recommendation must be one of the well-evidenced ones.
    expect([
      "reply",
      "record-decision",
      "share-decision",
      "confirm-start",
      "resolve-legacy-stage",
    ]).toContain(actionKey);
  }
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

test("messaging stays immediately available and does not change lifecycle state", async ({ page }) => {
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

  const primary = page.getByTestId("next-action-primary");
  await expect(primary).toBeVisible();
  await primary.focus();
  await expect(primary).toBeFocused();
  await primary.press("Enter");
  // Something observable must happen — never a silent no-op. Which outcome is
  // correct depends on the recommendation, so accept any legitimate one.
  await expect
    .poll(async () => {
      const [strip, notify, dialog, menu] = await Promise.all([
        page.getByTestId("decision-strip").count(),
        page.getByTestId("stage-notify-prompt").count(),
        page.getByRole("dialog").count(),
        page.getByRole("menu").count(),
      ]);
      const composerFocused = await page
        .getByRole("textbox", { name: "Reply message" })
        .evaluate((node) => node === document.activeElement)
        .catch(() => false);
      return strip + notify + dialog + menu > 0 || composerFocused;
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
  await expect(star).toBeVisible();
  await expect(star).toHaveAttribute("aria-pressed", "false");
  await star.click();
  await expect(star).toHaveAttribute("aria-pressed", "true");
  // A quiet row marker, not a badge cluster.
  await expect(row.getByTestId("row-starred")).toBeVisible();

  // Durable across a full reload.
  await page.reload({ waitUntil: "domcontentloaded" });
  await row.click();
  await expect(page.getByTestId("star-toggle")).toHaveAttribute("aria-pressed", "true");

  // Starring changed no lifecycle state.
  await expect(page.getByTestId("applications-detail-header")).toContainText("New");

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
  await star.click();
  // Optimistically on, then rolled back to the authoritative value.
  await expect(star).toHaveAttribute("aria-pressed", "false");
  await page.unroute("**/preferences/star");
});
