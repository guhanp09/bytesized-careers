import { expect, test, type Page } from "@playwright/test";

async function dismissHiringDialog(page: Page) {
  const hiringDialog = page.getByRole("dialog", { name: "Who are you hiring for?" });
  const cancelHiringDialog = hiringDialog.getByRole("button", { name: "Cancel" }).first();
  await cancelHiringDialog
    .waitFor({ state: "visible", timeout: 3_000 })
    .then(async () => {
      await cancelHiringDialog.click();
      await expect(hiringDialog).toBeHidden();
    })
    .catch(() => undefined);
}

test("post-job no longer asks recruiters for language requirements", async ({ page }) => {
  await page.goto("/post-job?section=tools");
  await dismissHiringDialog(page);

  const form = page.locator("form");
  // ?section=tools now lands on the Tools & tags screen — languages are gone.
  await expect(form.getByRole("heading", { name: "TOOLS & TAGS" })).toBeVisible();
  await expect(form.getByRole("region", { name: "Language requirements" })).toHaveCount(0);
  await expect(form.getByRole("button", { name: /Add language/ })).toHaveCount(0);

  // Tools and tags remain fully functional.
  await expect(form.locator('[data-quality-target="job-tools"]')).toBeVisible();
  await expect(form.getByLabel("Add a job tag")).toBeVisible();
});

test("post-job gives trial, evaluation, applications, and references their own screens", async ({ page }) => {
  // Screening questions live on the dedicated Evaluation screen.
  await page.goto("/post-job?section=screening");
  await dismissHiringDialog(page);

  const form = page.locator("form");
  await expect(form.getByRole("heading", { name: "EVALUATION" })).toBeVisible();
  await expect(form.getByRole("heading", { name: "Screening questions" })).toBeVisible();
  await form.getByRole("button", { name: /Add question/ }).click();
  const question = form.locator('section[id^="job-question-"]').first();
  await expect(question.getByRole("heading", { name: "Question 1" })).toBeVisible();
  await question.getByLabel("Question", { exact: true }).fill("Which sample best shows retention-led pacing?");
  await question.getByLabel("Response required").check();
  await question.getByLabel("Answer guidance", { exact: true }).fill("Name one sample and explain your role.");
  await expect(form.getByText("What applicants must include")).toHaveCount(0);

  // Public application requirements live on the dedicated Applications screen.
  await page.goto("/post-job?section=howToApply");
  await dismissHiringDialog(page);
  await expect(form.getByRole("heading", { name: "APPLICATION REQUIREMENTS" })).toBeVisible();
  await expect(form.getByLabel("Public how-to-apply note")).toBeVisible();
  await expect(form.getByText("What applicants must include")).toBeVisible();
  await expect(form.getByTestId("custom-instruction-editor")).toHaveCount(0);
  await expect(form.getByText("Reference videos")).toHaveCount(0);

  // References live on the final Review screen.
  await page.goto("/post-job?section=referenceVideos");
  await dismissHiringDialog(page);

  await expect(form.getByRole("heading", { name: "Reference videos" })).toBeVisible();
  await expect(form.locator('[data-quality-target="job-reference-video"]')).toBeVisible();
  await expect(form.getByText("YouTube video URL")).toBeVisible();
  await expect(form.getByText("What to reference")).toBeVisible();
  await expect(form.getByText("Timestamp notes")).toBeVisible();
  await expect(form.getByText("What applicants must include")).toHaveCount(0);
});

test("post-job reference videos support timestamp rows and multiple videos", async ({ page }) => {
  await page.goto("/post-job?section=referenceVideos");
  await dismissHiringDialog(page);

  const form = page.locator("form");
  const referenceStep = form.locator('[data-quality-target="job-reference-video"]');
  await expect(referenceStep).toBeVisible();

  await referenceStep.getByRole("button", { name: "Add timestamp" }).click();
  await expect(referenceStep.getByLabel("Timestamp 2", { exact: true })).toBeVisible();

  const firstTimestamp = referenceStep.getByLabel("Timestamp 1", { exact: true });
  await firstTimestamp.fill("4:4");
  await firstTimestamp.blur();
  await expect(firstTimestamp).toHaveValue("4:04");

  const secondTimestamp = referenceStep.getByLabel("Timestamp 2", { exact: true });
  await secondTimestamp.fill("33");
  await secondTimestamp.blur();
  await expect(secondTimestamp).toHaveValue("33:00");

  await secondTimestamp.fill("abc");
  await expect(secondTimestamp).toHaveValue("");

  await secondTimestamp.fill("1:99");
  await secondTimestamp.blur();
  await expect(referenceStep.getByText("Use 0:12, 4:04, or 1:02:03.")).toBeVisible();

  await referenceStep.getByPlaceholder("e.g. Pacing + retention reference").fill("Pacing reference");
  await referenceStep.getByPlaceholder("https://www.youtube.com/watch?v=...").fill("https://www.youtube.com/watch?v=abc12345678");
  await referenceStep.getByRole("button", { name: "Add another video" }).click();
  await expect(referenceStep.getByText("Video 2")).toBeVisible();

  await referenceStep.getByPlaceholder("e.g. Pacing + retention reference").fill("Hook reference");
  await referenceStep.getByPlaceholder("https://www.youtube.com/watch?v=...").fill("https://www.youtube.com/watch?v=def12345678");
  await referenceStep.getByRole("button", { name: "Add another video" }).click();
  await expect(referenceStep.getByText("Video 3")).toBeVisible();

  await referenceStep.getByPlaceholder("e.g. Pacing + retention reference").fill("Retention reference");
  await referenceStep.getByPlaceholder("https://www.youtube.com/watch?v=...").fill("https://www.youtube.com/watch?v=ghi12345678");
  await referenceStep.getByRole("button", { name: "Add another video" }).click();
  await expect(referenceStep.getByText("Maximum 3 reference videos")).toBeVisible();
  await expect(referenceStep.getByRole("button", { name: "Add another video" })).toBeDisabled();
});
