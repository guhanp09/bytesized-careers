import { expect, test } from "@playwright/test";

import {
  armProbe,
  countClientEnrichmentMutations,
  createNativeDraft,
  ensureIdentity,
  getBrandAboutState,
  importBrandDiscoveryDraft,
  login,
  openDraft,
  patchJob,
  probeState,
  saveDraft,
  waitForGeneratedAbout,
} from "./brand-about-helpers";

test.describe("server-owned automatic brand About", () => {
  test("the actual import handoff discovers once without a client enrichment mutation", async ({
    page,
  }) => {
    await login(page);
    await ensureIdentity(page, "Finance Simplified");
    const forbiddenMutations = countClientEnrichmentMutations(page);
    await armProbe(page);

    const jobId = await importBrandDiscoveryDraft(page);
    const generated = await waitForGeneratedAbout(page, jobId);
    expect(generated).toContain("personal finance videos");

    const first = await probeState(page);
    expect(first.searches).toBe(1);
    expect(first.fetches).toBe(1);
    expect(first.model_calls).toBe(1);
    expect(forbiddenMutations, "the browser invoked the compatibility endpoint").toEqual([]);

    await openDraft(page, jobId);
    await expect(page.getByText("About the brand", { exact: true })).toHaveCount(1);
    await expect(page.locator('label[for="job-about-brand"]')).toHaveText("About the brand");
    await expect(page.getByText("Candidate-facing introduction", { exact: true })).toHaveCount(0);
    await expect(page.locator("#job-about-brand").first()).toBeEditable();

    await saveDraft(page);
    for (let index = 0; index < 5; index += 1) {
      await openDraft(page, jobId);
    }
    await openDraft(page, jobId);
    for (let index = 0; index < 5; index += 1) {
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.locator("#job-about-brand").first()).toBeVisible();
    }

    const after = await probeState(page);
    expect(after.searches).toBe(1);
    expect(after.fetches).toBe(1);
    expect(after.model_calls).toBe(1);
    expect(forbiddenMutations).toEqual([]);
  });

  test("search, fetch, and synthesis failures never block ordinary Save", async ({ page }) => {
    await login(page);
    const identityId = await ensureIdentity(page, "Finance Simplified");
    const cases = [
      { mode: "search_failure" as const, calls: [1, 0, 0] },
      { mode: "fetch_failure" as const, calls: [1, 1, 0] },
      { mode: "model_decline" as const, calls: [1, 1, 1] },
    ];

    for (const current of cases) {
      const jobId = await createNativeDraft(page, `Failure remains optional: ${current.mode}`);
      await armProbe(page, { mode: current.mode });
      await patchJob(page, jobId, { hiring_identity_id: identityId });

      await expect
        .poll(async () => (await getBrandAboutState(page, jobId)).status, {
          timeout: 30_000,
        })
        .not.toBe("in_progress");
      const state = await getBrandAboutState(page, jobId);
      expect(state.about_channel).toBeNull();

      await openDraft(page, jobId);
      await expect(page.locator("#job-about-brand").first()).toBeEditable();
      await saveDraft(page);
      expect(new URL(page.url()).pathname).toBe("/drafts");

      const counts = await probeState(page);
      expect([counts.searches, counts.fetches, counts.model_calls]).toEqual(current.calls);
    }
  });
});
