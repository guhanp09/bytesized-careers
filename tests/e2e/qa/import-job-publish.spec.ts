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

test("development fixture → review decisions → native draft keeps import private", async ({
  page,
}) => {
  await loginController(page);
  await switchPersona(page, "talent-complete", "Priya Nair");
  const session = await backendSession(page);

  await page.goto("/post-job/import", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("import-textarea")).toBeVisible();
  await page.getByTestId("open-import-review-fixture").click();
  await expect(page.getByTestId("provider-import-review")).toBeVisible();
  await expect(page).toHaveURL(/\/post-job\/import\?draft=/);
  await expect(page.getByText("Found in source").first()).toBeVisible();
  await expect(page.getByText("Suggested — verify").first()).toBeVisible();
  await expect(page.getByText("Conflict — decision required")).toBeVisible();
  await expect(page.getByText("Check carefully").first()).toBeVisible();
  await expect(page.getByText(/Hiring a YouTube video editor/).first()).toBeVisible();
  await expect(page.getByText(/OpenAI|GPT-|model selector/i)).toHaveCount(0);

  const draftId = new URL(page.url()).searchParams.get("draft");
  expect(draftId).toBeTruthy();

  const title = page.getByTestId("provider-review-field-title");
  await title.getByRole("button", { name: "Accept", exact: true }).click();
  await expect(title.getByText("Confirmed by you")).toBeVisible();
  await title.getByRole("button", { name: "Reset decision" }).click();
  await expect(title.getByText("Not reviewed")).toBeVisible();
  await title.getByRole("button", { name: "Accept", exact: true }).click();

  const conflict = page.getByTestId("provider-review-field-budget_amount");
  await expect(conflict.getByText("30,000", { exact: true })).toBeVisible();
  await expect(conflict.getByText("35,000", { exact: true })).toBeVisible();
  await conflict.getByRole("button", { name: "Use this value" }).first().click();
  await expect(conflict.getByText("Confirmed by you")).toBeVisible();

  const read = await page.request.get(`${BACKEND_API}/job-imports/drafts/${draftId}`, {
    headers: session.headers,
  });
  expect(read.ok(), await read.text()).toBeTruthy();
  const draft = (await read.json()) as {
    fields: Array<{
      field_path: string;
      provenance_state: string;
      review_status: string;
      validation_errors: string[];
    }>;
  };
  for (const field of draft.fields) {
    if (
      field.provenance_state !== "missing" &&
      field.provenance_state !== "conflicting_source_values" &&
      field.review_status === "pending" &&
      field.validation_errors.length === 0
    ) {
      const response = await page.request.patch(
        `${BACKEND_API}/job-imports/drafts/${draftId}/fields/${field.field_path}`,
        { headers: session.headers, data: { action: "accept" } }
      );
      expect(response.ok(), await response.text()).toBeTruthy();
    }
  }

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("provider-import-review")).toBeVisible();
  const createDraft = page.getByTestId("create-native-job-draft");
  await expect(createDraft).toBeEnabled();
  await createDraft.click();
  await expect(page).toHaveURL(/\/post-job\?draftId=/, { timeout: 20_000 });

  const nativeDraftId = new URL(page.url()).searchParams.get("draftId");
  expect(nativeDraftId).toBeTruthy();
  const publicRead = await page.request.get(`${BACKEND_API}/jobs/${nativeDraftId}`);
  expect(publicRead.status()).toBe(404);

  const duplicate = await page.request.post(
    `${BACKEND_API}/job-imports/drafts/${draftId}/apply`,
    { headers: session.headers, data: { mode: "create_new" } }
  );
  expect(duplicate.ok(), await duplicate.text()).toBeTruthy();
  expect((await duplicate.json()).created).toBe(false);

  const publicList = await page.request.get(`${BACKEND_API}/jobs?limit=100`);
  expect(publicList.ok()).toBeTruthy();
  const publicText = await publicList.text();
  expect(publicText).not.toContain(draftId!);
  expect(publicText).not.toContain("development_fixture");
});

test("a private import draft is not readable after a same-tab persona switch", async ({
  page,
}) => {
  await loginController(page);
  await switchPersona(page, "recruiter-active", "Finance Simplified");
  await page.goto("/post-job/import", { waitUntil: "domcontentloaded" });
  await page.getByTestId("open-import-review-fixture").click();
  await expect(page.getByTestId("provider-import-review")).toBeVisible();
  const privateUrl = page.url();

  await switchPersona(page, "talent-complete", "Priya Nair");
  await page.goto(privateUrl, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("provider-import-review")).toHaveCount(0);
  await expect(page.getByTestId("import-textarea")).toBeVisible();
  await expect(page.getByText(/Import draft not found/i)).toBeVisible();
});

test("public URL entry rejects a local destination with an actionable private error", async ({
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
  await expect(page.getByText("That address is not a public website.")).toBeVisible();
  await expect(page.getByTestId("url-import-panel")).toBeVisible();
  await expect(page.getByTestId("provider-import-review")).toHaveCount(0);
});

test.describe("mobile review", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("review actions and conflict evidence remain usable without horizontal overflow", async ({
    page,
  }) => {
    await loginController(page);
    await switchPersona(page, "both-sides", "Aditi Verma");
    await page.goto("/post-job/import", { waitUntil: "domcontentloaded" });
    await page.getByTestId("open-import-review-fixture").click();
    await expect(page.getByTestId("provider-import-review")).toBeVisible();
    await expect(
      page.getByTestId("provider-review-field-budget_amount").getByRole("button", {
        name: "Use this value",
      }).first()
    ).toBeVisible();
    const noHorizontalScroll = await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
    );
    expect(noHorizontalScroll).toBe(true);
  });
});
