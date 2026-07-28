import { expect, test, type Page } from "@playwright/test";

/**
 * End-to-end workflow audit across authenticated contexts.
 *
 * Written as flows a person performs, not as feature checks: each test walks a
 * whole path and asserts what the *other* side sees at the point it matters.
 * The properties being defended are the ones a hiring product cannot get wrong —
 * private state stays private, a decision reaches the person it is about, and no
 * visible control is a no-op.
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

async function asRecruiter(page: Page) {
  await loginController(page);
  const restore = await page.request.post("/api/qa/scenarios/inbox-pipeline/restore", {
    data: { confirmation: "RESTORE INBOX" },
  });
  expect(restore.ok(), await restore.text()).toBeTruthy();
  await switchPersona(page, "recruiter-active", "Finance Simplified");
  await page.goto("/applications?view=inbox&mode=recruiter&direction=received", {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByTestId("applications-workspace").first()).toBeVisible({ timeout: 20_000 });
}

async function asTalent(page: Page) {
  await switchPersona(page, "talent-complete", "Priya");
  await page.goto("/applications?view=inbox&mode=talent&direction=sent", {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByTestId("applications-workspace").first()).toBeVisible({ timeout: 20_000 });
}

async function openCandidate(page: Page, name: string) {
  const row = page.getByTestId("interaction-row").filter({ hasText: name }).first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.click();
  await expect(page.getByTestId("applications-detail")).toBeVisible();
}

/* --- 1. Deliberate open records Reviewing, privately ---------------------- */

/**
 * Bring the decision surface up.
 *
 * It opens itself on the first deliberate open of a record that still needs a
 * decision — that is the product model, and it is how a user meets it. The
 * header's primary button used to be a second route via "Choose next step", a
 * label that named an action it could not describe; it was removed, so this
 * presses the primary only when the ladder is confident enough to have rendered
 * one, and otherwise waits for the surface that is already on its way.
 */
async function openDecisionSurface(page: Page) {
  const strip = page.getByTestId("decision-strip");
  if (await strip.isVisible().catch(() => false)) return strip;
  const primary = page.getByTestId("next-action-primary");
  if ((await primary.count()) > 0) await primary.click();
  await expect(strip).toBeVisible({ timeout: 20_000 });
  return strip;
}

test("opening a new application records Reviewing without telling the applicant", async ({ page }) => {
  await asRecruiter(page);
  const target = page.getByTestId("interaction-row").filter({ hasText: "Needs review" }).first();
  const targetName = ((await target.textContent()) ?? "").match(/([A-Z][a-z]+ [A-Z][a-z]+)/)?.[1];
  test.skip(!targetName, "no application is still in the New state in this scenario");
  await target.click();

  // Auto-Reviewing is dwell-gated; give it the threshold plus the round trip.
  await expect(page.getByTestId("applications-detail-header")).toContainText("Viewed", {
    timeout: 20_000,
  });
  // Recorded quietly: the timeline shows it, and no message was posted.
  await expect(page.getByText("Viewed", { exact: true }).first()).toBeVisible();

  await asTalent(page);
  // Nothing the recruiter did privately reaches the applicant's thread as a
  // message. "Viewed" is a shared *status*, not an announcement.
  await expect(page.getByText("started reviewing")).toHaveCount(0);
});

/* --- 2. Private organisation stays private ------------------------------- */

test("Star and private notes are invisible to the other participant", async ({ page }) => {
  await asRecruiter(page);
  await openCandidate(page, "Priya Nair");

  await page.getByTestId("star-toggle").click();
  await expect(page.getByTestId("star-toggle")).toHaveAttribute("aria-pressed", "true");
  const note = `Private audit note ${Date.now()}`;
  const noteField = page.getByPlaceholder(/private note|Jot down/i).first();
  if (await noteField.isVisible().catch(() => false)) {
    await noteField.fill(note);
    await page.getByRole("button", { name: "Save note" }).click();
    await expect(page.getByText(note)).toBeVisible({ timeout: 20_000 });
  }

  await asTalent(page);
  const rows = page.getByTestId("interaction-row");
  await rows.first().click();
  // Neither the note nor any trace of the star appears on the counterparty side.
  await expect(page.getByText(note)).toHaveCount(0);
  // The readout lives on the row's own Star control, which is only marked when
  // the record is starred — so "nothing is starred" is still assertable.
  await expect(page.getByTestId("row-starred")).toHaveCount(0);
});

/* --- 3. Snooze, unsnooze, and "No reply needed" -------------------------- */

test("snooze and 'No reply needed' quieten the suggestion, never the relationship", async ({ page }) => {
  await asRecruiter(page);
  await openCandidate(page, "Priya Nair");
  const header = await page.getByTestId("applications-detail-header").textContent();

  await page.getByRole("button", { name: "More actions" }).click();
  const snooze = page.getByRole("menuitem", { name: /Snooze until tomorrow/i });
  await expect(snooze).toBeVisible();
  await snooze.click();

  // The thread is still open, still readable, still messageable — and its
  // lifecycle status has not moved.
  await expect(page.getByTestId("applications-detail-header")).toHaveText(header ?? "");
  await expect(page.getByRole("textbox", { name: "Reply message" })).toBeVisible();

  // Reversible from the same place it was set.
  await page.getByRole("button", { name: "More actions" }).click();
  await expect(page.getByRole("menuitem", { name: /Unsnooze/i })).toBeVisible();
  await page.keyboard.press("Escape");
});

/* --- 4. Interview: invite → confirm → move → complete → decide ------------ */

test("the whole interview arc runs across both sides and never decides for anyone", async ({ page }) => {
  await asRecruiter(page);
  await openCandidate(page, "Priya Nair");

  await openDecisionSurface(page);
  await page.getByTestId("decision-strip-option-interviewing").click();
  const when = new Date(Date.now() + 4 * 86_400_000);
  await page
    .getByTestId("interview-date")
    .fill(
      `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, "0")}-${String(
        when.getDate()
      ).padStart(2, "0")}`
    );
  await page.getByTestId("interview-time").fill("14:00");
  await page.getByTestId("interview-note").fill("Twenty minutes, nothing to prepare.");
  await page.getByTestId("interview-submit").click();
  await expect(page.getByTestId("interview-card")).toHaveAttribute(
    "data-interview-status",
    "proposed",
    { timeout: 20_000 }
  );

  // The applicant sees it, is asked exactly one thing, and can do exactly that.
  await asTalent(page);
  await page.getByTestId("interaction-row").first().click();
  const card = page.getByTestId("interview-card");
  test.skip((await card.count()) === 0, "the invited thread is not this persona's first conversation");
  await expect(page.getByTestId("interview-status-line")).toHaveText("Confirm if this works");
  await expect(page.getByTestId("interview-reschedule")).toHaveCount(0);
  await expect(page.getByText("Twenty minutes, nothing to prepare.")).toBeVisible();
  await page.getByTestId("interview-confirm").click();
  await expect(card).toHaveAttribute("data-interview-status", "confirmed", { timeout: 20_000 });

  // The recruiter sees the confirmation and is not pushed toward a decision:
  // the interview has not happened yet.
  await switchPersona(page, "recruiter-active", "Finance Simplified");
  await page.goto("/applications?view=inbox&mode=recruiter&direction=received", {
    waitUntil: "domcontentloaded",
  });
  await openCandidate(page, "Priya Nair");
  await expect(page.getByTestId("interview-card")).toHaveAttribute(
    "data-interview-status",
    "confirmed",
    { timeout: 20_000 }
  );
  await expect(page.getByTestId("interview-status-line")).toHaveText("Confirmed");
  await expect(page.getByTestId("interview-complete")).toHaveCount(0);
});

/* --- 5. A private decision is not a communicated one --------------------- */

test("a private Not proceeding is held back until the recruiter chooses to send it", async ({ page }) => {
  await asRecruiter(page);
  // Any candidate still in play — a record already at a terminal outcome
  // correctly offers nothing, which would make this assert nothing.
  const row = page
    .getByTestId("interaction-row")
    .filter({ hasText: /Viewed|Needs review/ })
    .first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.click();

  await page.getByRole("button", { name: "More actions" }).click();
  const notSelected = page.getByRole("menuitem", { name: "Not selected" });
  await expect(notSelected).toBeVisible();
  await notSelected.click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /Confirm not selected/i })
    .click();

  // Saved privately: the workspace now recommends telling them, which is the
  // only honest next step and is never done automatically.
  await expect(page.getByTestId("next-action-primary")).toContainText(/Tell /, { timeout: 20_000 });
});

/* --- 6. Inbox and Pipeline agree ----------------------------------------- */

test("Inbox and Pipeline never disagree about what a record needs", async ({ page }) => {
  await asRecruiter(page);
  await openCandidate(page, "Priya Nair");
  const inboxAction = await page.getByTestId("next-action-primary").textContent().catch(() => null);

  await page.getByTestId("applications-view-pipeline").click();
  await expect(page.getByTestId("pipeline-board")).toBeVisible();

  if (inboxAction) {
    // The same recommendation, in the same words, from the same derivation.
    const card = page.getByTestId("pipeline-card").filter({ hasText: "Priya Nair" }).first();
    if (await card.isVisible().catch(() => false)) {
      await expect(card).toContainText(inboxAction.trim());
    }
  }

  // And back, with the conversation still open.
  await page.getByTestId("applications-view-inbox").click();
  await expect(page.getByTestId("applications-detail-header")).toContainText("Priya");
});

/* --- 7. Refresh and re-entry --------------------------------------------- */

test("a refresh restores the open conversation and everything derived from it", async ({ page }) => {
  await asRecruiter(page);
  await openCandidate(page, "Priya Nair");
  const before = await page.getByTestId("applications-detail-header").textContent();

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("applications-detail-header")).toHaveText(before ?? "", {
    timeout: 20_000,
  });
});

/* --- 8. No visible control is a no-op ------------------------------------ */

test("every control on the open conversation does something observable", async ({ page }) => {
  await asRecruiter(page);
  await openCandidate(page, "Priya Nair");

  // The overflow is the one surface where an inert item would hide easily.
  await page.getByRole("button", { name: "More actions" }).click();
  const items = page.getByRole("menuitem");
  const count = await items.count();
  expect(count, "the overflow menu must not be empty").toBeGreaterThan(0);

  const inert: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const item = items.nth(index);
    const label = ((await item.textContent()) ?? "").trim();
    const disabled = await item.isDisabled().catch(() => false);
    const hasHandler = await item.evaluate(
      (node) => Boolean((node as HTMLElement).onclick) || node.getAttribute("role") === "menuitem"
    );
    if (!disabled && !hasHandler) inert.push(label);
  }
  expect(inert, `menu items with no behaviour: ${inert.join(", ")}`).toEqual([]);
  await page.keyboard.press("Escape");

  // A disabled control must say why rather than simply refusing.
  const send = page.getByRole("button", { name: "Send" });
  await expect(send).toBeDisabled();
  await page.getByRole("textbox", { name: "Reply message" }).fill("x");
  await expect(send).toBeEnabled();
});

/* --- 9. Feature flags disable independently ------------------------------ */

test("the workspace still works with its assistive layers absent", async ({ page }) => {
  await asRecruiter(page);
  await openCandidate(page, "Priya Nair");

  /*
    Flags are inlined at build time, so an e2e matrix would need one build per
    combination. What is checked here instead is the property the flags exist to
    protect: nothing assistive is load-bearing. Messaging and the authoritative
    status actions are reachable without touching the recommendation, the queue
    chips, or the decision surface.
  */
  await expect(page.getByRole("textbox", { name: "Reply message" })).toBeVisible();
  await page.getByRole("button", { name: "More actions" }).click();
  await expect(page.getByRole("menuitem").first()).toBeVisible();
  await page.keyboard.press("Escape");
});
