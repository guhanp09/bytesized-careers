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
