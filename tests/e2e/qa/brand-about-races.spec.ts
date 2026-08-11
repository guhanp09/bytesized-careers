import { expect, test } from "@playwright/test";

import {
  armProbe,
  createNativeDraft,
  ensureIdentity,
  getBrandAboutState,
  login,
  openDraft,
  patchJob,
  probeState,
  releaseProbe,
  saveDraft,
  waitForAttemptStarted,
  waitForGeneratedAbout,
} from "./brand-about-helpers";

const RECRUITER_COPY = "Recruiter-authored Finance Simplified description.";

test.describe("brand About ownership and concurrency", () => {
  test("text typed while discovery is in flight wins exactly", async ({ page }) => {
    await login(page);
    const identityId = await ensureIdentity(page, "Finance Simplified");
    const jobId = await createNativeDraft(page, "Typing race");
    await armProbe(page, { gated: true });

    const trigger = patchJob(page, jobId, { hiring_identity_id: identityId });
    await waitForAttemptStarted(page);
    await openDraft(page, jobId);
    await page.locator("#job-about-brand").first().fill(RECRUITER_COPY);
    await saveDraft(page);

    await releaseProbe(page);
    await trigger;
    await expect
      .poll(async () => (await getBrandAboutState(page, jobId)).status)
      .toBe("recruiter_owned");
    await openDraft(page, jobId);
    await expect(page.locator("#job-about-brand").first()).toHaveValue(RECRUITER_COPY);
  });

  test("deleting generated copy is a lasting recruiter decision", async ({ page }) => {
    await login(page);
    const identityId = await ensureIdentity(page, "Finance Simplified");
    const jobId = await createNativeDraft(page, "Deletion wins");
    await armProbe(page);
    await patchJob(page, jobId, { hiring_identity_id: identityId });
    await waitForGeneratedAbout(page, jobId);
    const before = await probeState(page);

    await openDraft(page, jobId);
    await page.locator("#job-about-brand").first().fill("");
    await saveDraft(page);
    for (let index = 0; index < 3; index += 1) {
      await openDraft(page, jobId);
      await expect(page.locator("#job-about-brand").first()).toHaveValue("");
      await saveDraft(page);
    }

    const state = await getBrandAboutState(page, jobId);
    const after = await probeState(page);
    expect(state.status).toBe("recruiter_owned");
    expect(state.about_channel).toBeNull();
    expect(after.searches - before.searches).toBe(0);
    expect(after.fetches - before.fetches).toBe(0);
    expect(after.model_calls - before.model_calls).toBe(0);
  });

  test("identity A can never write into identity B", async ({ page }) => {
    await login(page);
    const identityA = await ensureIdentity(page, "Finance Simplified");
    const identityB = await ensureIdentity(page, "Second Brand");
    const jobId = await createNativeDraft(page, "Identity switch race");
    await armProbe(page, {
      gated: true,
      summary: "Finance Simplified publishes personal finance videos BRAND_A_DESCRIPTION.",
    });

    const triggerA = patchJob(page, jobId, { hiring_identity_id: identityA });
    await waitForAttemptStarted(page);
    await patchJob(page, jobId, {
      hiring_identity_id: identityB,
      about_channel: "Second Brand recruiter description.",
    });
    await releaseProbe(page);
    await triggerA;

    await expect
      .poll(async () => (await getBrandAboutState(page, jobId)).status)
      .toBe("recruiter_owned");
    const state = await getBrandAboutState(page, jobId);
    expect(state.about_channel).toBe("Second Brand recruiter description.");
    expect(state.about_channel).not.toContain("BRAND_A_DESCRIPTION");
  });

  test("two simultaneous persisted triggers perform one expensive attempt", async ({ page }) => {
    await login(page);
    const identityId = await ensureIdentity(page, "Finance Simplified");
    const jobId = await createNativeDraft(page, "Concurrent trigger");
    await armProbe(page, { gated: true });

    const first = patchJob(page, jobId, { hiring_identity_id: identityId });
    const second = patchJob(page, jobId, { hiring_identity_id: identityId });
    await waitForAttemptStarted(page);
    await expect.poll(async () => (await probeState(page)).searches).toBe(1);
    await expect.poll(async () => (await probeState(page)).fetches).toBe(1);

    await releaseProbe(page);
    await Promise.all([first, second]);
    await waitForGeneratedAbout(page, jobId);
    const state = await probeState(page);
    expect(state.searches).toBe(1);
    expect(state.fetches).toBe(1);
    expect(state.model_calls).toBe(1);
  });
});
