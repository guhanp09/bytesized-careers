import { expect, test, type Page } from "@playwright/test";

import {
  armProbe,
  backendToken,
  countClientEnrichmentMutations,
  ensureIdentity,
  importBrandDiscoveryDraft,
  login,
  noHorizontalDocumentOverflow,
  openDraft,
  saveDraft,
  waitForGeneratedAbout,
} from "./brand-about-helpers";

const BACKEND = "http://127.0.0.1:8100/api/v1";
const BRAND = "Finance Simplified";
const EDITED_ABOUT =
  "Finance Simplified publishes practical personal finance videos for young adults learning about budgeting and investing. Its channel also creates concise explainers for people new to managing their money.";
const VIEWPORTS = [
  { name: "390", width: 390, height: 844 },
  { name: "430", width: 430, height: 932 },
  { name: "834", width: 834, height: 1112 },
  { name: "1280", width: 1280, height: 900 },
  { name: "1680", width: 1680, height: 1000 },
];
const PROVENANCE = [
  "according to",
  "the website says",
  "the source says",
  "search result",
  "ai generated",
  "ai-generated",
  "automatically generated",
  "openai",
  "gpt-",
  "brand_about",
  "in_progress",
  "confidence",
  "attempt",
];

async function publish(page: Page, jobId: string) {
  const token = await backendToken(page);
  const response = await page.request.patch(`${BACKEND}/jobs/${jobId}`, {
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
  expect(response.ok(), `publish: ${await response.text()}`).toBeTruthy();
}

test("automatic brand copy remains editable and reaches candidates at every viewport", async ({
  page,
}) => {
  await login(page);
  await ensureIdentity(page, BRAND);
  const forbiddenMutations = countClientEnrichmentMutations(page);
  await armProbe(page);

  const jobId = await importBrandDiscoveryDraft(page);
  const generated = await waitForGeneratedAbout(page, jobId);
  expect(generated).toContain("personal finance videos");
  expect(forbiddenMutations, "Playwright observed a client enrichment mutation").toEqual([]);

  await openDraft(page, jobId);
  await expect(page.getByText("About the brand", { exact: true })).toHaveCount(1);
  const about = page.locator("#job-about-brand").first();
  await expect(about).toHaveValue(generated);
  await expect(about).toBeEditable();
  await about.fill(EDITED_ABOUT);
  await saveDraft(page);

  await openDraft(page, jobId);
  await expect(page.locator("#job-about-brand").first()).toHaveValue(EDITED_ABOUT);
  await publish(page, jobId);

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await openDraft(page, jobId);
    await expect(
      page.getByText("About the brand", { exact: true }),
      `${viewport.name}: native label`
    ).toHaveCount(1);
    await expect(page.locator("#job-about-brand").first()).toHaveValue(EDITED_ABOUT);
    await expect(page.locator("#job-about-brand").first()).toBeEditable();
    expect(await noHorizontalDocumentOverflow(page), `${viewport.name}: editor overflow`).toBe(true);

    await page.goto(`/jobs/${jobId}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByText(new RegExp(`ABOUT ${BRAND}`, "i")).first()).toBeVisible();
    const body = await page.locator("body").innerText();
    expect(body).toContain(EDITED_ABOUT);
    expect(
      PROVENANCE.filter((phrase) => body.toLowerCase().includes(phrase)),
      `${viewport.name}: candidate provenance leak`
    ).toEqual([]);
    expect(await noHorizontalDocumentOverflow(page), `${viewport.name}: candidate overflow`).toBe(true);
  }

  expect(forbiddenMutations).toEqual([]);
});
