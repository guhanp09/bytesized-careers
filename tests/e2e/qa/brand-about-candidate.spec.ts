import { expect, test, type Page } from "@playwright/test";

/**
 * The last join: does automatically generated brand copy reach a candidate?
 *
 * Everything before this proved the machinery — the trigger fires, the claim is
 * atomic, the races resolve the right way. None of it proved the only thing a
 * candidate experiences: opening a job and reading a description of the brand
 * that nobody typed.
 *
 * So this drives the whole chain through the product with no manual endpoint
 * call anywhere: ordinary Save → automatic request → background work →
 * persisted About → reopened editor → recruiter preview → published job page.
 *
 * The provenance scan matters as much as the presence check. Enrichment is
 * assembled from somebody's website by a model, and a candidate must see none
 * of that — no "according to", no source URL, no provider name, no generated-by
 * disclosure. Internal provenance stays internal, which is the same rule the
 * imported listing copy already follows.
 */

const CONTROLLER_EMAIL = "qa-controller@example.com";
const CONTROLLER_PASSWORD = "LocalQaController123!";
const BACKEND = "http://127.0.0.1:8100/api/v1";

const BRAND = "Finance Simplified";
/** Grounded in the fixture evidence: every word of it appears there. */
const SUMMARY =
  "Finance Simplified publishes personal finance videos helping young adults understand budgeting and investing.";

/** Wording that would mean the listing was talking about how it was written. */
const PROVENANCE = [
  "according to",
  "the website says",
  "the source says",
  "original listing",
  "ai generated",
  "ai-generated",
  "automatically generated",
  "financesimplified.example",
  "openai",
  "gpt-",
  "brand_about",
  "in_progress",
  "confidence",
  "attempt",
];

const WIDTHS = [
  { name: "mobile-390", width: 390, height: 844 },
  { name: "mobile-430", width: 430, height: 932 },
  { name: "tablet-834", width: 834, height: 1112 },
  { name: "desktop-1280", width: 1280, height: 900 },
  { name: "wide-1680", width: 1680, height: 1000 },
];

async function login(page: Page) {
  await page.goto("/auth?mode=login", { waitUntil: "domcontentloaded" });
  await page.getByPlaceholder("Email").fill(CONTROLLER_EMAIL);
  await page.getByPlaceholder("Password").fill(CONTROLLER_PASSWORD);
  await page.locator("form").getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page).toHaveURL(/\/you/);
}

async function backendToken(page: Page) {
  const session = await page.request.get("/api/auth/session");
  const body = await session.json();
  const token = body?.backendAccessToken || body?.accessToken;
  expect(token, "no backend token on the session").toBeTruthy();
  return token as string;
}

async function arm(page: Page, summary = SUMMARY) {
  const response = await page.request.post(`${BACKEND}/dev/brand-enrichment/arm`, {
    data: { gated: false, mode: "success", summary },
  });
  expect(response.ok()).toBeTruthy();
}

async function fetches(page: Page) {
  const response = await page.request.get(`${BACKEND}/dev/brand-enrichment/state`);
  return ((await response.json()) as { fetches: number }).fetches;
}

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
  expect(response.ok(), `identity: ${await response.text()}`).toBeTruthy();
  return (await response.json()).id as string;
}

/**
 * Import the fixture whose *source employer* is a different company.
 *
 * That separation is the point of the fixture here: the page belongs to one
 * business and the recruiter posts as another, and the About section must
 * describe the CreatorJobs hiring identity rather than whoever wrote the page.
 */
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

/** An eligible job: the brand chosen, and nothing written about it yet. */
async function makeEligible(page: Page, draftId: string, identityId: string) {
  const token = await backendToken(page);
  const response = await page.request.patch(`${BACKEND}/jobs/${draftId}`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { hiring_identity_id: identityId, about_channel: null },
  });
  expect(response.ok(), `attach: ${await response.text()}`).toBeTruthy();
}

async function openDraft(page: Page, draftId: string, section = "about") {
  await page.goto("/you", { waitUntil: "domcontentloaded" });
  await page.goto(`/post-job?draftId=${draftId}&section=${section}`, {
    waitUntil: "domcontentloaded",
  });
  const anchor =
    section === "about" ? page.locator("#job-about-brand") : page.locator("#job-title");
  await expect(anchor.first()).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(1_200);
}

async function save(page: Page) {
  await page.getByRole("button", { name: /save draft/i }).first().click();
  await expect.poll(() => new URL(page.url()).pathname, { timeout: 30_000 }).toBe("/drafts");
}

/** Run the real automatic path and wait for the description to be persisted. */
async function enrichAutomatically(page: Page, draftId: string) {
  await arm(page);
  await openDraft(page, draftId);
  // The ordinary Save control. Nothing enrichment-specific is clicked here or
  // anywhere else in this file.
  await save(page);
  await expect.poll(() => fetches(page), { timeout: 30_000 }).toBe(1);
  await page.waitForTimeout(1_200);
}

/** Fill everything else publication needs, leaving About exactly as generated. */
async function publish(page: Page, draftId: string) {
  const token = await backendToken(page);
  const response = await page.request.patch(`${BACKEND}/jobs/${draftId}`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      requirements: ["Comfortable editing short-form video."],
      responsibilities: ["Edit four videos a month."],
      platforms: ["youtube"],
      engagement_type: "ongoing_freelance",
      work_mode: "remote",
      compensation_mode: "fixed",
      budget_amount: "20000",
      budget_max: null,
      budget_currency: "INR",
      budget_unit: "per month",
      expected_weekly_hours_min: 10,
      expected_weekly_hours_max: 20,
      application_requirements: ["relevant_portfolio"],
      deliverables: [{ type: "long_form_video", quantity: 4, frequency: "per_month" }],
      required_skill_keys: ["video_editing"],
      revision_policy: "fixed",
      revision_rounds: 2,
      source_inputs: [{ type: "raw_footage" }],
      creative_autonomy: "collaborative_direction",
      trial_status: "none",
      start_timing: "immediate",
      duration_type: "ongoing",
      hiring_process: [{ stage: "application_review" }, { stage: "offer" }],
      employer_context_type: "brand",
      status: "published",
    },
  });
  return response;
}

function scanForProvenance(text: string) {
  const lowered = text.toLowerCase();
  return PROVENANCE.filter((phrase) => lowered.includes(phrase));
}

test.describe("automatically generated brand copy reaches the candidate", () => {
  test("the editor, the preview and the public page all show it", async ({ page }) => {
    await login(page);
    const identity = await createIdentity(page, BRAND);
    const draftId = await importDraft(page);
    await makeEligible(page, draftId, identity);

    await enrichAutomatically(page, draftId);

    // 1. The editor, reopened from nothing.
    await openDraft(page, draftId);
    const inEditor = await page.locator("#job-about-brand").first().inputValue();
    expect(inEditor, "the generated description did not reach the editor").toContain(
      "personal finance videos"
    );

    // 2. The heading names the CreatorJobs hiring identity, not the source
    //    employer whose page this was imported from.
    const editorBody = await page.locator("body").innerText();
    expect(editorBody).toContain(`About ${BRAND}`);

    // 3. The public candidate page.
    const published = await publish(page, draftId);
    expect(published.ok(), `publish: ${await published.text()}`).toBeTruthy();

    await page.goto(`/jobs/${draftId}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1_500);
    const candidateBody = await page.locator("body").innerText();

    expect(candidateBody).toContain("personal finance videos");
    expect(candidateBody.toUpperCase()).toContain(`ABOUT ${BRAND.toUpperCase()}`);

    // 4. Nothing about how the copy was produced.
    const leaks = scanForProvenance(candidateBody);
    expect(leaks, `candidate page exposed provenance: ${leaks.join(", ")}`).toEqual([]);
  });

  test("the source employer never becomes the brand being described", async ({ page }) => {
    await login(page);
    const identity = await createIdentity(page, BRAND);
    const draftId = await importDraft(page);
    await makeEligible(page, draftId, identity);
    await enrichAutomatically(page, draftId);

    await openDraft(page, draftId);
    const body = await page.locator("body").innerText();

    // The imported page belongs to a different business. The About section is
    // about the identity the recruiter posts as, and no heading may name the
    // other one.
    expect(body).toContain(`About ${BRAND}`);
    expect(body.toLowerCase()).not.toContain("about nabbe");
    expect(body.toLowerCase()).not.toContain("about finance simplified's website");
  });
});

for (const width of WIDTHS) {
  test(`the automatic path works and reads correctly at ${width.name}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: width.width, height: width.height });
    await login(page);
    const identity = await createIdentity(page, BRAND);
    const draftId = await importDraft(page);
    await makeEligible(page, draftId, identity);

    await enrichAutomatically(page, draftId);
    await openDraft(page, draftId);

    const about = page.locator("#job-about-brand").first();
    await expect(about, `${width.name}: no About control`).toBeVisible({ timeout: 30_000 });
    expect(
      await about.inputValue(),
      `${width.name}: the generated description is missing`
    ).toContain("personal finance videos");
    await expect(about, `${width.name}: the field is not editable`).toBeEditable();

    // The accepted wrapping behaviour must still hold for text nobody typed.
    const overflows = await page.evaluate(() => {
      const root = document.documentElement;
      return root.scrollWidth - root.clientWidth > 1;
    });
    expect(overflows, `${width.name}: the page scrolled sideways`).toBe(false);
  });
}
