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

test("post-job uses explicit structured language rows without legacy picker defaults", async ({ page }) => {
  await page.goto("/post-job?section=tools");

  await dismissHiringDialog(page);

  const form = page.locator("form");
  await expect(form.getByRole("heading", { name: "Skills that matter for the work" })).toBeVisible();

  const languages = form.getByRole("region", { name: "Language requirements" });
  await expect(languages).toBeVisible();
  await expect(
    languages.getByText("No structured language requirement. Candidates will not be excluded by an implied proficiency level."),
  ).toBeVisible();
  await expect(languages.getByRole("button", { name: "Other", exact: true })).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "Choose another language" })).toHaveCount(0);

  const rows = languages.locator('section[id^="job-language-"]');
  await languages.getByRole("button", { name: /Add language/ }).click();
  await expect(rows).toHaveCount(1);

  const firstLanguage = rows.nth(0);
  await expect(firstLanguage.getByRole("heading", { name: "Language 1" })).toBeVisible();
  await expect(firstLanguage.getByLabel("Language", { exact: true })).toHaveValue("");
  await expect(firstLanguage.getByLabel("Priority", { exact: true })).toHaveValue("");
  await expect(firstLanguage.getByLabel("Proficiency", { exact: true })).toHaveValue("");

  await firstLanguage.getByLabel("Language", { exact: true }).fill("Spanish");
  await firstLanguage.getByLabel("Priority", { exact: true }).selectOption("required");
  await firstLanguage.getByLabel("Proficiency", { exact: true }).selectOption("professional");
  const contentUnderstanding = firstLanguage.getByRole("button", { name: "Content Understanding" });
  await contentUnderstanding.click();
  await expect(contentUnderstanding).toHaveAttribute("aria-pressed", "true");
  await firstLanguage
    .getByLabel("Language context", { exact: true })
    .fill("Understand spoken interviews and on-screen text.");

  await languages.getByRole("button", { name: /Add language/ }).click();
  await expect(rows).toHaveCount(2);
  const secondLanguage = rows.nth(1);
  await secondLanguage.getByLabel("Language", { exact: true }).fill("Tamil");
  await secondLanguage.getByLabel("Priority", { exact: true }).selectOption("preferred");
  await secondLanguage.getByRole("button", { name: "Speaking" }).click();

  await secondLanguage.getByRole("button", { name: "Move language 2 up" }).click();
  await expect(rows.nth(0).getByLabel("Language", { exact: true })).toHaveValue("Tamil");
  await expect(rows.nth(1).getByLabel("Language", { exact: true })).toHaveValue("Spanish");

  await rows.nth(0).getByRole("button", { name: "Remove language 1" }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.nth(0).getByLabel("Language", { exact: true })).toHaveValue("Spanish");
  await expect(rows.nth(0).getByLabel("Priority", { exact: true })).toHaveValue("required");
});

test("post-job splits application requirements and reference videos into separate steps", async ({ page }) => {
  await page.goto("/post-job?section=howToApply");
  await dismissHiringDialog(page);

  const form = page.locator("form");
  await expect(form.getByRole("heading", { name: "APPLICATION REQUIREMENTS" })).toBeVisible();
  await expect(form.getByRole("heading", { name: "Screening questions" })).toBeVisible();
  await expect(form.getByLabel("Public how-to-apply note")).toBeVisible();
  await expect(form.getByText("What applicants must include")).toBeVisible();
  await form.getByRole("button", { name: /Add question/ }).click();
  const question = form.locator('section[id^="job-question-"]').first();
  await expect(question.getByRole("heading", { name: "Question 1" })).toBeVisible();
  await question.getByLabel("Question", { exact: true }).fill("Which sample best shows retention-led pacing?");
  await question.getByLabel("Response required").check();
  await question.getByLabel("Answer guidance", { exact: true }).fill("Name one sample and explain your role.");
  await expect(form.getByTestId("custom-instruction-editor")).toHaveCount(0);
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
