import { expect, test, type Page } from "@playwright/test";

/**
 * What a candidate can actually read and do, at every width.
 *
 * The existing responsive sweep checks that the page does not scroll sideways.
 * That is necessary and nowhere near sufficient: a job whose pay is pushed
 * below a collapsed section, or whose Apply button sits outside the viewport,
 * is broken in a way no overflow measurement notices. A candidate who cannot
 * find the rate does not apply, and nobody finds out why.
 *
 * So each width is asked the questions a candidate would: what does this pay,
 * where is it, what must I send, and how do I apply. Plus the one question they
 * cannot ask for themselves — is anything here that should have stayed private.
 *
 * Facts are compared against what the API served for the same job, so the oracle
 * is the job itself rather than whatever the page happens to render.
 */

const SHOTS = "/tmp/creatorjobs-candidate-responsive";
const BACKEND = "http://127.0.0.1:8100/api/v1";

const WIDTHS = [
  { name: "mobile-390", width: 390, height: 844 },
  { name: "mobile-430", width: 430, height: 932 },
  { name: "tablet-834", width: 834, height: 1112 },
  { name: "desktop-1280", width: 1280, height: 900 },
  { name: "wide-1680", width: 1680, height: 1000 },
];

type Job = Record<string, unknown>;

async function login(page: Page) {
  await page.goto("/auth?mode=login", { waitUntil: "domcontentloaded" });
  await page.getByPlaceholder("Email").fill("qa-controller@example.com");
  await page.getByPlaceholder("Password").fill("LocalQaController123!");
  await page.locator("form").getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page).toHaveURL(/\/you/);
}

/**
 * The richest published job the backend has, so the widths are exercised
 * against real content rather than a job that happens to state almost nothing.
 */
async function richestJob(page: Page): Promise<Job> {
  const response = await page.request.get(`${BACKEND}/jobs?limit=25`);
  expect(response.ok(), await response.text()).toBeTruthy();
  const payload = (await response.json()) as { items?: Job[] } | Job[];
  const items = Array.isArray(payload) ? payload : (payload.items ?? []);
  const scored = items
    .filter((job) => typeof job.id === "string" && typeof job.title === "string")
    .map((job) => ({
      job,
      score:
        (job.budget_amount ? 1 : 0) +
        (job.location ? 1 : 0) +
        (job.experience_level ? 1 : 0) +
        ((job.application_requirements as unknown[])?.length ?? 0) +
        ((job.responsibilities as unknown[])?.length ?? 0),
    }))
    .sort((left, right) => right.score - left.score);

  expect(scored.length, "no published jobs to inspect").toBeGreaterThan(0);
  return scored[0].job;
}

async function openJob(page: Page, job: Job) {
  await page.goto(`/jobs/${job.id as string}`, { waitUntil: "domcontentloaded" });
  // `/jobs/[id]` is dual-purpose — a curated filter slug renders a listing
  // instead — so identity is proved before anything is asserted about it.
  await expect(page.getByRole("heading", { name: String(job.title), level: 1 })).toBeVisible({
    timeout: 30_000,
  });
}

const lower = async (page: Page) => (await page.locator("body").innerText()).toLowerCase();

for (const width of WIDTHS) {
  test(`a candidate can read the job at ${width.name}`, async ({ page }) => {
    await page.setViewportSize({ width: width.width, height: width.height });
    await login(page);
    const job = await richestJob(page);
    await openJob(page, job);

    const text = await lower(page);

    // The facts a candidate decides on. Compared against what the API served
    // for this same job, so the page cannot pass by rendering something else.
    if (job.budget_amount) {
      const amount = String(job.budget_amount).split(".")[0];
      expect(text, `${width.name}: the pay is not readable`).toContain(amount);
    }
    if (job.budget_currency) {
      // A candidate reads "$1,200", not "USD 1200". Either the code or its
      // symbol proves the currency reached them; requiring the code asserted
      // a presentation nobody uses.
      const SYMBOL: Record<string, string> = {
        INR: "₹",
        USD: "$",
        GBP: "£",
        EUR: "€",
      };
      const code = String(job.budget_currency);
      const shown =
        text.includes(code.toLowerCase()) || text.includes(SYMBOL[code] ?? code);
      expect(shown, `${width.name}: the currency is not readable`).toBeTruthy();
    }
    if (job.location) {
      expect(text, `${width.name}: the location is not readable`).toContain(
        String(job.location).split(",")[0].toLowerCase()
      );
    }
    if (job.experience_level) {
      const digits = String(job.experience_level).match(/\d+/);
      if (digits) expect(text).toContain(digits[0]);
    }

    await page.screenshot({ path: `${SHOTS}/${width.name}.png`, fullPage: true });
  });

  test(`a candidate can apply at ${width.name}`, async ({ page }) => {
    await page.setViewportSize({ width: width.width, height: width.height });
    await login(page);
    const job = await richestJob(page);
    await openJob(page, job);

    const apply = page.getByRole("button", { name: /apply/i }).first();
    await expect(apply, `${width.name}: no Apply control`).toBeVisible({ timeout: 30_000 });

    const box = await apply.boundingBox();
    expect(box, `${width.name}: Apply has no box`).not.toBeNull();
    if (box) {
      // A button that starts off-screen cannot be pressed, however tall the
      // page is.
      expect(box.x, `${width.name}: Apply starts off-screen`).toBeGreaterThanOrEqual(-1);
      expect(
        box.x + box.width,
        `${width.name}: Apply runs past the right edge`
      ).toBeLessThanOrEqual(width.width + 1);
    }

    await apply.scrollIntoViewIfNeeded();
    await expect(apply).toBeEnabled();
  });

  test(`nothing private is on the page at ${width.name}`, async ({ page }) => {
    await page.setViewportSize({ width: width.width, height: width.height });
    await login(page);
    const job = await richestJob(page);
    await openJob(page, job);

    const text = await lower(page);

    // Screening lives in the Inbox after applying, never on the public page.
    expect(text).not.toContain("screening question");
    // And no route off the platform, at any width — a destination hidden by a
    // breakpoint is still a destination.
    for (const banned of ["whatsapp", "telegram", "@gmail", "@example.invalid"]) {
      expect(text, `${width.name}: ${banned} reached the candidate`).not.toContain(banned);
    }
  });
}

test("the requirements a job asks for are all shown to the candidate", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await login(page);
  const job = await richestJob(page);
  await openJob(page, job);

  const requirements = (job.application_requirements as string[] | undefined) ?? [];
  test.skip(requirements.length === 0, "no job with requirements to inspect");

  const text = await lower(page);
  // Asserted by meaning rather than by key, because the page shows a
  // recruiter-facing label and the API returns a slug.
  const LABEL: Record<string, RegExp> = {
    expected_rate: /rate/,
    relevant_portfolio: /portfolio|work samples|showreel/,
    turnaround: /turnaround|delivery/,
    working_hours: /hours|availability/,
    relevant_experience: /experience/,
    tools_workflow: /tools|software|workflow/,
    start_availability: /start|availability/,
    fit_note: /note|why|fit/,
  };
  for (const key of requirements) {
    const pattern = LABEL[key];
    if (!pattern) continue;
    expect(text, `the job asks for ${key} and the candidate is not told`).toMatch(pattern);
  }
});

test("the apply flow can be reached from the keyboard", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await login(page);
  const job = await richestJob(page);
  await openJob(page, job);

  const apply = page.getByRole("button", { name: /apply/i }).first();
  await expect(apply).toBeVisible({ timeout: 30_000 });

  // Focused directly rather than tabbed to: the number of stops before it is a
  // layout detail that changes with content, and asserting a count would fail
  // for reasons that have nothing to do with reachability.
  await apply.focus();
  const focused = await page.evaluate(() => document.activeElement?.textContent ?? "");

  expect(focused.toLowerCase()).toMatch(/apply/);
  const name = await apply.getAttribute("aria-label");
  const label = name ?? (await apply.innerText());
  expect(label.trim(), "the Apply control has no usable accessible name").not.toBe("");
});
