import { expect, test } from "@playwright/test";

test("the Post Job chooser keeps manual creation and offers private import", async ({ page }) => {
  await page.goto("/post", { waitUntil: "domcontentloaded" });
  const importCard = page.getByTestId("post-import-card").first();
  await expect(importCard).toBeVisible();
  await expect(importCard).toContainText("Already wrote a hiring post?");
  await expect(page.getByRole("link", { name: /post a job/i }).first()).toBeVisible();
  await importCard.click();
  await expect(page).toHaveURL(/\/post-job\/import$/);
});

test("an unauthenticated import visit explains the private account boundary", async ({ page }) => {
  await page.goto("/post-job/import", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Import job details" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sign in to import a job" })).toBeVisible();
  await expect(page.getByText(/source, evidence, and review decisions are private/i)).toBeVisible();
  await expect(page.getByTestId("import-textarea")).toHaveCount(0);
  await expect(page.getByText(/OpenAI|GPT-|model selector/i)).toHaveCount(0);
});

test("legacy owner-stamped handoff data cannot hydrate for an unauthenticated visitor", async ({
  page,
}) => {
  await page.goto("/post-job/import", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    window.sessionStorage.setItem(
      "creatorjobs:jobImport:handoff:v1",
      JSON.stringify({
        version: 1,
        createdAt: Date.now(),
        owner: "someone-else",
        initialStep: "basics",
        prefill: { title: "Private leaked title" },
        meta: {},
      })
    );
  });
  await page.goto("/post-job?import=1", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Private leaked title")).toHaveCount(0);
});

test.describe("mobile viewport", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the private import sign-in state has no horizontal overflow", async ({ page }) => {
    await page.goto("/post-job/import", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Sign in to import a job" })).toBeVisible();
    const noHorizontalScroll = await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
    );
    expect(noHorizontalScroll).toBe(true);
  });
});
