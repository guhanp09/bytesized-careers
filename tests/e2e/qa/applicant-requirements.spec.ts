import { expect, test, type Page } from "@playwright/test";

/**
 * Every requirement a recruiter can ask for, answered by a real candidate.
 *
 * The invariant: a recruiter must never be able to select "What applicants must
 * include" unless CreatorJobs gives the candidate a way to provide it and the
 * recruiter a way to receive it. A matching key name is not proof — one of them
 * (`reference_links`) matched perfectly and was silently discarded on the job
 * side, so nobody was ever asked.
 *
 * This drives the real controls on a seeded job that declares all eight
 * job-selectable requirements, submits through the real endpoint, and then reads
 * the answers back.
 */

const BACKEND = "http://127.0.0.1:8100/api/v1";
const SHOTS = "/tmp/creatorjobs-requirements-qa";

/** The eight requirements a job can ask for, and how each is answered. */
const REQUIREMENTS = [
  "expected_rate",
  "relevant_portfolio",
  "turnaround",
  "working_hours",
  "relevant_experience",
  "tools_workflow",
  "start_availability",
  "fit_note",
] as const;

async function login(page: Page, email: string, password: string) {
  await page.goto("/auth?mode=login", { waitUntil: "domcontentloaded" });
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password").fill(password);
  await page.locator("form").getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page).toHaveURL(/\/you/);
}

/** The seeded job that declares every requirement, found by its own data. */
async function jobRequiringEverything(page: Page) {
  const response = await page.request.get(`${BACKEND}/jobs?limit=50`);
  expect(response.ok(), await response.text()).toBeTruthy();
  const body = (await response.json()) as { items?: unknown[] } | unknown[];
  const items = (Array.isArray(body) ? body : (body.items ?? [])) as Array<{
    id: string;
    title: string;
    application_requirements?: string[];
  }>;
  const job = items.find(
    (row) => (row.application_requirements ?? []).length >= 6
  );
  expect(job, "no seeded job declares enough applicant requirements to test").toBeTruthy();
  return job!;
}

test("a candidate can satisfy every requirement a job asks for", async ({ page }) => {
  await login(page, "qa-controller@example.com", "LocalQaController123!");
  const job = await jobRequiringEverything(page);

  // Identity, before anything is asserted about the page.
  await page.goto(`/jobs/${job.id}`, { waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("heading", { name: job.title, exact: false }).first()
  ).toBeVisible({ timeout: 30_000 });
  expect(page.url()).toContain(job.id);

  // The public page must not leak the private screening section.
  const publicBody = await page.locator("body").innerText();
  expect(publicBody).not.toMatch(/Screening questions?/);

  await page.getByRole("button", { name: /Apply/i }).first().click();

  // Every declared requirement must render a control the candidate can use.
  const declared = job.application_requirements ?? [];
  for (const key of declared) {
    if (!REQUIREMENTS.includes(key as (typeof REQUIREMENTS)[number])) continue;
    await expect(
      page.locator(`[data-requirement-key="${key}"]`),
      `${key} is required by this job but renders no candidate control`
    ).toBeVisible({ timeout: 30_000 });
  }

  await page.screenshot({ path: `${SHOTS}/application-form.png`, fullPage: true });

  // A requirement the job did not ask for must not appear.
  for (const key of REQUIREMENTS) {
    if (declared.includes(key)) continue;
    await expect(page.locator(`[data-requirement-key="${key}"]`)).toHaveCount(0);
  }
});

test("the server refuses an application that skips a required answer", async ({ page }) => {
  await login(page, "qa-controller@example.com", "LocalQaController123!");
  const job = await jobRequiringEverything(page);
  const session = (await (await page.request.get("/api/auth/session")).json()) as {
    backendAccessToken?: string;
  };

  // The browser validates before submitting, so this goes straight at the API —
  // the path a stale client or a hand-built request would take.
  const response = await page.request.post(`${BACKEND}/jobs/${job.id}/applications`, {
    headers: { Authorization: `Bearer ${session.backendAccessToken}` },
    data: { cover_note: "Skipping the requirements.", first_message_answers: {} },
  });

  expect(response.status(), await response.text()).toBe(422);
  expect(await response.text()).toContain("Missing required first-message details");
});


/**
 * Fill whatever control a requirement rendered.
 *
 * Deliberately generic: the point is that the candidate can satisfy each
 * requirement through the real UI, not that the test knows every widget. A key
 * whose shell contains nothing fillable fails loudly, which is the defect worth
 * catching.
 */
async function satisfy(page: Page, key: string) {
  const shell = page.locator(`[data-requirement-key="${key}"]`);
  await expect(shell).toBeVisible({ timeout: 20_000 });

  // Portfolio offers a link alternative when the profile has no project.
  const linkInstead = shell.getByRole("button", { name: /Attach a link instead/i });
  if (await linkInstead.count()) {
    await linkInstead.click();
  }

  if (key === "tools_workflow") {
    const toolInput = shell.locator("input").first();
    if (await toolInput.count()) {
      await toolInput.fill("Adobe Premiere Pro");
      await toolInput.press("Enter");
      return;
    }
  }

  const textbox = shell.locator("input:not([type=hidden]), textarea").first();
  if (await textbox.count()) {
    const type = await textbox.getAttribute("type");
    const value =
      key === "expected_rate" || type === "number"
        ? "25000"
        : key === "turnaround"
          ? "3"
          : type === "date"
            ? "2026-12-01"
            : // Link-valued requirements reject prose, and rightly so. The
              // fixture rewrite added `resume` to this job, which is why a
              // filler that only knew about the portfolio started leaving the
              // modal open on "Enter a valid link" with no request ever sent.
              key === "relevant_portfolio" || key === "resume"
              ? "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
              : "Answered by the candidate during QA.";
    await textbox.fill(value);
    // Portfolio and tools are pickers: typing proposes, Enter commits. Leaving
    // the text uncommitted is why the modal still said "Select at least one
    // item" while the box looked filled.
    if (key === "relevant_portfolio" || key === "tools_workflow") {
      await textbox.press("Enter");
    }
    return;
  }

  const select = shell.locator("select").first();
  if (await select.count()) {
    const options = await select.locator("option").allTextContents();
    expect(options.length, `${key} has an empty select`).toBeGreaterThan(1);
    await select.selectOption({ index: 1 });
    return;
  }

  throw new Error(`${key} rendered no control a candidate could fill`);
}

test("a candidate submits every answer and the recruiter receives them", async ({ page }) => {
  await login(page, "qa-controller@example.com", "LocalQaController123!");

  // Applying needs a candidate, not the listing's owner.
  await page.getByTestId("qa-persona-open").click();
  await expect(page.getByTestId("qa-persona-drawer")).toBeVisible();
  await page.getByTestId("qa-switch-talent-complete").click();
  await expect(page.getByTestId("qa-persona-open")).toContainText("Priya Nair", {
    timeout: 20_000,
  });

  const job = await jobRequiringEverything(page);
  await page.goto(`/jobs/${job.id}`, { waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("heading", { name: job.title, exact: false }).first()
  ).toBeVisible({ timeout: 30_000 });

  await page.getByRole("button", { name: /^Apply/i }).first().click();

  for (const key of job.application_requirements ?? []) {
    await satisfy(page, key);
  }
  await page.screenshot({ path: `${SHOTS}/filled-application.png`, fullPage: true });

  const send = page.getByRole("button", { name: /Send application/i });
  await expect(send).toBeEnabled();
  await send.click();

  // The real endpoint, not a stub. The button reports the outcome: "Sent" once
  // the application lands, and the modal surfaces an error otherwise.
  // Success closes the modal, so the proof is the state it leaves behind.
  await expect(page.getByRole("button", { name: /Send application/i })).toHaveCount(0, {
    timeout: 60_000,
  });
  await page.screenshot({ path: `${SHOTS}/after-submit.png`, fullPage: true });

  // The answers must actually have persisted, not merely left the browser.
  const session = (await (await page.request.get("/api/auth/session")).json()) as {
    backendAccessToken?: string;
  };
  const mine = await page.request.get(`${BACKEND}/me/applications/sent`, {
    headers: { Authorization: `Bearer ${session.backendAccessToken}` },
  });
  expect(mine.ok(), await mine.text()).toBeTruthy();
  const applications = (await mine.json()) as Array<{
    job_id?: string;
    first_message_answers?: Record<string, unknown>;
  }>;
  const submitted = applications.find((row) => row.job_id === job.id);
  expect(submitted, "the submitted application was not persisted").toBeTruthy();

  // Every requirement the job asked for came back with an answer attached.
  const answers = submitted!.first_message_answers ?? {};
  for (const key of job.application_requirements ?? []) {
    expect(
      answers[key],
      `${key} was required and submitted but no answer persisted`
    ).toBeTruthy();
  }
});
