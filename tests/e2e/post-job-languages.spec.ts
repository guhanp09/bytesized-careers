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

test("post-job Details languages support a searchable Other picker", async ({ page }) => {
  await page.goto("/post-job?section=turnaround");

  await dismissHiringDialog(page);

  const languages = page.locator('[data-quality-target="job-languages"]');
  await expect(languages).toBeVisible();
  await expect(languages.getByRole("button", { name: "Hindi" })).toBeVisible();
  await expect(languages.getByRole("button", { name: "English" })).toBeVisible();

  await languages.getByRole("button", { name: "Other" }).click();
  const picker = page.getByRole("dialog", { name: "Choose another language" });
  await expect(picker).toBeVisible();

  await picker.getByRole("textbox", { name: "Search languages" }).fill("Spanish");
  await picker.getByRole("option", { name: "Spanish" }).click();
  await expect(languages.getByRole("button", { name: "Spanish" })).toHaveCount(1);

  await picker.getByRole("textbox", { name: "Search languages" }).fill("Farsi");
  await picker.getByRole("option", { name: "Persian" }).click();
  await expect(languages.getByRole("button", { name: "Persian" })).toHaveCount(1);

  await picker.getByRole("textbox", { name: "Search languages" }).fill("Persian");
  await expect(picker.getByRole("option", { name: /Persian.*Selected|Persian/ })).toHaveCount(1);
  await expect(languages.getByRole("button", { name: "Persian" })).toHaveCount(1);
});

test("post-job splits application requirements and reference videos into separate steps", async ({ page }) => {
  await page.goto("/post-job?section=howToApply");
  await dismissHiringDialog(page);

  const form = page.locator("form");
  await expect(form.getByRole("heading", { name: "APPLICATION REQUIREMENTS" })).toBeVisible();
  await expect(form.getByText("How to apply")).toHaveCount(0);
  await expect(form.getByText("What applicants must include")).toBeVisible();
  await expect(form.getByRole("button", { name: /Custom instruction/ })).toBeVisible();
  await form.getByRole("button", { name: /Custom instruction/ }).click();
  await expect(form.getByTestId("custom-instruction-editor")).toBeVisible();
  await expect(form.getByText("Reference videos")).toHaveCount(0);

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
  await expect(referenceStep.getByLabel("Timestamp 2")).toBeVisible();

  const firstTimestamp = referenceStep.getByLabel("Timestamp 1");
  await firstTimestamp.fill("4:4");
  await firstTimestamp.blur();
  await expect(firstTimestamp).toHaveValue("4:04");

  const secondTimestamp = referenceStep.getByLabel("Timestamp 2");
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
