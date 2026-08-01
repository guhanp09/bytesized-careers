import { expect, test, type Page } from "@playwright/test";

const CONTROLLER_EMAIL = "qa-controller@example.com";
const CONTROLLER_PASSWORD = "LocalQaController123!";
const BACKEND_API = "http://127.0.0.1:8100/api/v1";

async function loginController(page: Page) {
  await page.goto("/auth?mode=login", { waitUntil: "domcontentloaded" });
  await page.getByPlaceholder("Email").fill(CONTROLLER_EMAIL);
  await page.getByPlaceholder("Password").fill(CONTROLLER_PASSWORD);
  await page.locator("form").getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page).toHaveURL(/\/you/);
  await expect(page.getByTestId("qa-persona-open")).toBeVisible();
}

async function switchPersona(page: Page, key: string, displayName: string) {
  await page.getByTestId("qa-persona-open").click();
  await expect(page.getByTestId("qa-persona-drawer")).toBeVisible();
  await page.getByTestId(`qa-switch-${key}`).click();
  await expect(page.getByTestId("qa-persona-open")).toContainText(displayName, {
    timeout: 20_000,
  });
}

async function backendSession(page: Page) {
  const response = await page.request.get("/api/auth/session");
  const session = (await response.json()) as {
    backendAccessToken?: string;
    backendUserId?: string;
  };
  expect(session.backendAccessToken).toBeTruthy();
  expect(session.backendUserId).toBeTruthy();
  return {
    headers: { Authorization: `Bearer ${session.backendAccessToken}` },
    userId: session.backendUserId!,
  };
}

test("development fixture opens the canonical private Post Job draft with import guidance", async ({
  page,
}) => {
  await loginController(page);
  await switchPersona(page, "talent-complete", "Priya Nair");
  const session = await backendSession(page);

  await page.goto("/post-job/import", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("import-textarea")).toBeVisible();
  await page.getByTestId("open-import-review-fixture").click();
  await expect(page).toHaveURL(/\/post-job\?draftId=/, { timeout: 20_000 });
  await expect(page.getByTestId("unified-import-guidance")).toBeVisible();
  await expect(page.getByText("Draft created from your job post")).toBeVisible();
  await expect(page.locator("#job-title")).toHaveValue(
    "YouTube video editor for a finance creator"
  );
  await expect(page.getByText(/OpenAI|GPT-|model selector/i)).toHaveCount(0);
  await expect(page.getByTestId("provider-import-review")).toHaveCount(0);

  const nativeDraftId = new URL(page.url()).searchParams.get("draftId");
  expect(nativeDraftId).toBeTruthy();
  const contextResponse = await page.request.get(
    `${BACKEND_API}/job-imports/native-jobs/${nativeDraftId}/context`,
    { headers: session.headers }
  );
  expect(contextResponse.ok(), await contextResponse.text()).toBeTruthy();
  const context = (await contextResponse.json()) as {
    draft: { id: string; fields: Array<{ field_path: string }> };
  };
  expect(context.draft.fields.some((field) => field.field_path === "title")).toBe(true);

  const useSuggestion = page.getByRole("button", { name: "Use suggestion" }).first();
  await expect(useSuggestion).toBeVisible();
  await useSuggestion.click();
  await expect(page.locator("#job-primary-role")).not.toHaveValue("");

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("unified-import-guidance")).toBeVisible();
  await expect(page.locator("#job-primary-role")).not.toHaveValue("");

  const publicRead = await page.request.get(`${BACKEND_API}/jobs/${nativeDraftId}`);
  expect(publicRead.status()).toBe(404);

  const duplicate = await page.request.post(
    `${BACKEND_API}/job-imports/drafts/${context.draft.id}/apply`,
    { headers: session.headers, data: { mode: "create_new" } }
  );
  expect(duplicate.ok(), await duplicate.text()).toBeTruthy();
  expect((await duplicate.json()).created).toBe(false);
});

test("a private imported native draft is not readable after a same-tab persona switch", async ({
  page,
}) => {
  await loginController(page);
  await switchPersona(page, "recruiter-active", "Finance Simplified");
  await page.goto("/post-job/import", { waitUntil: "domcontentloaded" });
  await page.getByTestId("open-import-review-fixture").click();
  await expect(page).toHaveURL(/\/post-job\?draftId=/, { timeout: 20_000 });
  const privateUrl = page.url();

  await switchPersona(page, "talent-complete", "Priya Nair");
  await page.goto(privateUrl, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("unified-import-guidance")).toHaveCount(0);
  await expect(page.getByText(/job draft could not be found/i)).toBeVisible();
});

test("public URL entry rejects a local destination with a paste-text fallback", async ({
  page,
}) => {
  await loginController(page);
  await switchPersona(page, "recruiter-active", "Finance Simplified");
  await page.goto("/post-job/import", { waitUntil: "domcontentloaded" });
  const textTab = page.getByRole("tab", { name: "Paste text" });
  const urlTab = page.getByRole("tab", { name: "Public URL" });
  await textTab.focus();
  await textTab.press("ArrowRight");
  await expect(urlTab).toBeFocused();
  await expect(urlTab).toHaveAttribute("aria-selected", "true");
  await urlTab.press("ArrowRight");
  await expect(textTab).toBeFocused();
  await textTab.press("ArrowLeft");
  await expect(urlTab).toBeFocused();
  await page.getByTestId("import-url-input").fill("http://127.0.0.1:8100/api/v1/health");
  await page.getByTestId("import-url-prepare").click();
  await expect(page.getByText(/couldn’t read that page safely/i)).toBeVisible();
  await expect(page.getByText("Paste text instead")).toBeVisible();
  await expect(page.getByTestId("provider-import-review")).toHaveCount(0);
});

test.describe("mobile canonical import", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("import guidance and the normal form remain usable at 320px, 390px, and a 200% zoom equivalent", async ({
    page,
  }) => {
    await loginController(page);
    await switchPersona(page, "both-sides", "Aditi Verma");
    await page.goto("/post-job/import", { waitUntil: "domcontentloaded" });
    await page.getByTestId("open-import-review-fixture").click();
    await expect(page).toHaveURL(/\/post-job\?draftId=/, { timeout: 20_000 });
    await expect(page.getByTestId("unified-import-guidance")).toBeVisible();
    await expect(page.locator("#job-title")).toBeVisible();
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 320, height: 720 },
      // Halving a 1440px CSS viewport exercises the layout at its 200% zoom equivalent.
      { width: 720, height: 450 },
    ]) {
      await page.setViewportSize(viewport);
      const reviewButton = page.getByRole("button", { name: "Review field" }).first();
      if (await reviewButton.count()) {
        const box = await reviewButton.boundingBox();
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      }
      const noHorizontalScroll = await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
      );
      expect(noHorizontalScroll, `${viewport.width}px viewport overflows`).toBe(true);
    }
  });
});
