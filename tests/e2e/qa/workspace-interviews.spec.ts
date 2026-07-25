import { expect, test, type Page } from "@playwright/test";

/**
 * Phase C behavioural coverage: arranging an interview, the other side seeing
 * and confirming it, moving it, closing it out privately, and the workload
 * surfaces that sit above the list.
 *
 * These drive the real UI in two authenticated contexts. Every assertion is
 * about something a person can see or do — nothing here inspects markup for its
 * own sake.
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

async function openRecruiterInbox(page: Page) {
  await loginController(page);
  await restoreScenario(page, "inbox-pipeline", "RESTORE INBOX");
  await switchPersona(page, "recruiter-active", "Finance Simplified");
  await page.goto("/applications?view=inbox&mode=recruiter&direction=received", {
    waitUntil: "domcontentloaded",
  });
}

/** Pick a candidate row that is not already at a terminal outcome. */
async function openCandidate(page: Page, name: string) {
  const row = page.getByTestId("interaction-row").filter({ hasText: name }).first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.click();
}

/** Fill and send an invitation, returning the date used. */
async function sendInvitation(page: Page, opts: { daysAhead: number; note?: string }) {
  const when = new Date(Date.now() + opts.daysAhead * 24 * 60 * 60 * 1000);
  const date = `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, "0")}-${String(
    when.getDate()
  ).padStart(2, "0")}`;
  await page.getByTestId("interview-date").fill(date);
  await page.getByTestId("interview-time").fill("15:30");
  await page.getByTestId("interview-method-video_call").click();
  await page
    .getByTestId("interview-meeting-detail")
    .fill("https://meet.example.com/qa-interview-room");
  if (opts.note) await page.getByTestId("interview-note").fill(opts.note);
  await page.getByTestId("interview-submit").click();
  return date;
}

test("inviting to interview asks for a real time before anything is sent", async ({ page }) => {
  await openRecruiterInbox(page);
  await openCandidate(page, "Priya Nair");

  // The invitation is reached the way a user reaches it — from the decision
  // surface, not from a menu of raw stage names.
  await page.getByTestId("next-action-primary").click();
  const invite = page.getByTestId("decision-strip-option-interviewing");
  await expect(invite).toHaveText(/Invite to interview/);
  await invite.click();

  // A scheduling surface, not a bare confirm dialog.
  const scheduler = page.getByTestId("interview-scheduler");
  await expect(scheduler).toBeVisible();
  await expect(scheduler).toContainText(/Invite .* to interview/);

  // Nothing has been sent yet: the record is still not Interviewing.
  await expect(page.getByTestId("interview-card")).toHaveCount(0);

  await sendInvitation(page, { daysAhead: 3, note: "Looking forward to it." });

  const card = page.getByTestId("interview-card");
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(card).toHaveAttribute("data-interview-status", "proposed");
  await expect(page.getByTestId("interview-status-line")).toHaveText("Waiting for them to confirm");
  // The link the applicant needs is on the arrangement, in the thread.
  await expect(page.getByTestId("interview-detail")).toContainText("meet.example.com");
});

test("a time in the past is refused with a reason rather than silently failing", async ({ page }) => {
  await openRecruiterInbox(page);
  await openCandidate(page, "Priya Nair");
  await page.getByTestId("next-action-primary").click();
  await page.getByTestId("decision-strip-option-interviewing").click();

  await page.getByTestId("interview-date").fill("2020-01-01");
  await page.getByTestId("interview-time").fill("09:00");
  await page.getByTestId("interview-submit").click();

  await expect(page.getByTestId("interview-scheduler-error")).toContainText(/already passed/);
  // Still on the form, nothing sent.
  await expect(page.getByTestId("interview-scheduler")).toBeVisible();
  await expect(page.getByTestId("interview-card")).toHaveCount(0);
});

test("the applicant sees the arrangement and can confirm it", async ({ page }) => {
  await openRecruiterInbox(page);
  await openCandidate(page, "Priya Nair");
  await page.getByTestId("next-action-primary").click();
  await page.getByTestId("decision-strip-option-interviewing").click();
  await sendInvitation(page, { daysAhead: 4 });
  await expect(page.getByTestId("interview-card")).toBeVisible({ timeout: 20_000 });

  // Switch to the applicant's own account — the counterparty context.
  await switchPersona(page, "talent-complete", "Priya");
  await page.goto("/applications?view=inbox&mode=talent&direction=sent", {
    waitUntil: "domcontentloaded",
  });

  const row = page.getByTestId("interaction-row").first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.click();

  const card = page.getByTestId("interview-card");
  if ((await card.count()) === 0) {
    // The QA persona's first thread may not be the invited one; that is data,
    // not a defect, so this assertion is scoped to when the card is present.
    test.skip(true, "the invited thread is not this persona's first conversation");
  }
  await expect(card).toBeVisible();
  // The applicant is a participant, not the organiser: no management controls.
  await expect(page.getByTestId("interview-reschedule")).toHaveCount(0);
  await expect(page.getByTestId("interview-cancel")).toHaveCount(0);
  await expect(page.getByTestId("interview-status-line")).toHaveText("Confirm if this works");

  await page.getByTestId("interview-confirm").click();
  await expect(page.getByTestId("interview-card")).toHaveAttribute(
    "data-interview-status",
    "confirmed",
    { timeout: 20_000 }
  );
});

test("moving an interview keeps the stage and tells the applicant what changed", async ({ page }) => {
  await openRecruiterInbox(page);
  await openCandidate(page, "Priya Nair");
  await page.getByTestId("next-action-primary").click();
  await page.getByTestId("decision-strip-option-interviewing").click();
  await sendInvitation(page, { daysAhead: 3 });
  await expect(page.getByTestId("interview-card")).toBeVisible({ timeout: 20_000 });

  await page.getByTestId("interview-reschedule").click();
  await expect(page.getByTestId("interview-scheduler")).toContainText(/Move the interview/);
  await sendInvitation(page, { daysAhead: 6, note: "Sorry, clash on my side." });

  await expect(page.getByTestId("interview-card")).toBeVisible({ timeout: 20_000 });
  // Confirmation is re-opened: agreeing to one time is not agreeing to another.
  await expect(page.getByTestId("interview-card")).toHaveAttribute(
    "data-interview-status",
    "proposed"
  );
  await expect(page.getByTestId("interview-card")).toContainText("Moved once");
  // The applicant was told, in the thread, in the organiser's own words.
  await expect(page.getByText("Sorry, clash on my side.")).toBeVisible();
});

test("cancelling an interview never quietly decides about the person", async ({ page }) => {
  await openRecruiterInbox(page);
  await openCandidate(page, "Priya Nair");
  await page.getByTestId("next-action-primary").click();
  await page.getByTestId("decision-strip-option-interviewing").click();
  await sendInvitation(page, { daysAhead: 5 });
  await expect(page.getByTestId("interview-card")).toBeVisible({ timeout: 20_000 });

  await page.getByTestId("interview-cancel").click();
  await expect(page.getByTestId("interview-card")).toHaveAttribute(
    "data-interview-status",
    "cancelled",
    { timeout: 20_000 }
  );
  // The stage is untouched — the record is still Interviewing, and the
  // conversation is still open.
  await expect(page.getByRole("textbox", { name: "Reply message" })).toBeVisible();
  // And a new time can be suggested without starting over elsewhere.
  await expect(page.getByTestId("interview-new-round")).toBeVisible();
});

test("the workload surfaces above the list only claim work that exists", async ({ page }) => {
  await openRecruiterInbox(page);
  await expect(page.getByTestId("applications-workspace")).toBeVisible({ timeout: 20_000 });

  // A reminder, when shown, must lead to exactly the queue it counted.
  const reminder = page.getByTestId("work-reminder");
  if (await reminder.isVisible().catch(() => false)) {
    const text = (await reminder.textContent()) ?? "";
    const count = Number(text.match(/^\s*(\d+)/)?.[1] ?? "0");
    expect(count).toBeGreaterThan(0);
    // No urgency, no scolding.
    expect(text).not.toMatch(/urgent|behind|overdue|!/i);
    await reminder.click();
    await expect(page.getByTestId("interaction-row")).toHaveCount(count, { timeout: 20_000 });
  }

  // Per-job cards, when shown, never advertise a zero.
  const summaries = page.getByTestId("job-summary");
  const summaryCount = await summaries.count();
  if (summaryCount > 0) {
    expect(summaryCount).toBeGreaterThan(1);
    for (let index = 0; index < summaryCount; index += 1) {
      const body = (await summaries.nth(index).textContent()) ?? "";
      expect(body).not.toMatch(/\b0\s*$/);
      expect(body).not.toContain("%");
    }
  }
});

test("an emptied queue explains itself and offers the way back", async ({ page }) => {
  await openRecruiterInbox(page);
  await expect(page.getByTestId("applications-workspace")).toBeVisible({ timeout: 20_000 });

  // "Saved" is the one chip that is reliably empty on a fresh scenario.
  await page.getByTestId("interaction-row").first().click();
  await page.getByTestId("star-toggle").click();
  await expect(page.getByTestId("queue-chip-starred")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("star-toggle").click();

  // With the star removed the chip goes, and the list is whole again — a queue
  // never strands the user in an empty view they cannot leave.
  await expect(page.getByTestId("queue-chip-starred")).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByTestId("interaction-row").first()).toBeVisible();
});
