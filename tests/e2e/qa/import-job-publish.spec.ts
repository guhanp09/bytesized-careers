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

/**
 * Drive the assistant canvas to completion, then open the draft.
 *
 * Extraction finishing no longer hands the recruiter off: the assistant asks
 * everything it identified first. These specs care about what happens *after*
 * that conversation, so this walks it to the end the way a recruiter would.
 */
async function completeAssistant(page: Page) {
  // Give the canvas a chance to appear at all; a clean import may skip it.
  await page
    .getByTestId("conversation-turn")
    .or(page.getByTestId("conversation-open-draft"))
    .first()
    .waitFor({ state: "visible", timeout: 30_000 })
    .catch(() => undefined);

  for (let step = 0; step < 25; step += 1) {
    const done = page.getByTestId("conversation-open-draft");
    if (await done.count()) {
      await done.click();
      return;
    }
    const turn = page.getByTestId("conversation-turn");
    if (!(await turn.count())) return;

    const field = await turn.locator("h2").getAttribute("data-field");

    const skip = page.getByTestId("conversation-skip-remaining");
    if (await skip.count()) {
      await skip.click();
    } else {
      // A conflict renders the source's own candidate answers instead of a
      // menu or a text box, so it needs its own branch.
      const alternative = turn.locator('[data-testid^="conversation-alternative-"]').first();
      const option = turn.locator('[data-testid^="conversation-option-"]').first();
      const suggestion = page.getByTestId("conversation-accept-suggestion");
      const input = page.getByTestId("conversation-text-answer");
      if (await alternative.count()) {
        await alternative.click();
      } else if (await suggestion.count()) {
        await suggestion.click();
      } else if (await option.count()) {
        await option.click();
      } else if (await input.count()) {
        const numeric = (await input.getAttribute("inputmode")) === "numeric";
        await input.fill(numeric ? "5" : "Provided during QA");
        await page.getByTestId("conversation-submit").click();
      } else {
        return;
      }
    }

    // Each action is a server round trip. Wait for the turn to actually change
    // rather than re-reading the DOM that is still on screen.
    await expect
      .poll(
        async () => {
          if (await page.getByTestId("conversation-open-draft").count()) return "done";
          const next = page.getByTestId("conversation-turn");
          if (!(await next.count())) return "gone";
          return await next.locator("h2").getAttribute("data-field");
        },
        { timeout: 20_000 }
      )
      .not.toBe(field);
  }
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
  await completeAssistant(page);
  await expect(page).toHaveURL(/\/post-job\?draftId=/, { timeout: 20_000 });
  await expect(page.getByTestId("conversational-import-guidance")).toBeVisible();
  await expect(page.getByText(/I’ve built a strong first draft/i)).toBeVisible();
  const activeQuestion = page.locator("#import-guidance-question");
  await expect(activeQuestion).toBeVisible();
  if (/make the pay unambiguous/i.test((await activeQuestion.textContent()) ?? "")) {
    await page.getByRole("button", { name: "30000", exact: true }).click();
    await expect(activeQuestion).not.toHaveText(/make the pay unambiguous/i);
  }
  await expect(
    page.getByRole("heading", { name: /clarify where this role can be done/i })
  ).toBeVisible();
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

  const remoteChoice = page.getByRole("button", { name: "remote", exact: true });
  await expect(remoteChoice).toBeVisible();
  await remoteChoice.click();
  const nextHeading = page.locator("#import-guidance-question");
  await expect(nextHeading).toBeVisible();
  await expect(nextHeading).not.toHaveText(/clarify where this role can be done/i);
  const nextHeadingText = await nextHeading.textContent();

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("conversational-import-guidance")).toBeVisible();
  await expect(page.locator("#import-guidance-question")).toHaveText(nextHeadingText ?? "");

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
  await completeAssistant(page);
  await expect(page).toHaveURL(/\/post-job\?draftId=/, { timeout: 20_000 });
  const privateUrl = page.url();

  await switchPersona(page, "talent-complete", "Priya Nair");
  await page.goto(privateUrl, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("conversational-import-guidance")).toHaveCount(0);
  await expect(page.getByText(/job draft could not be found/i)).toBeVisible();
});

test("clean and role-specific fixtures produce only useful guided work", async ({ page }) => {
  await loginController(page);
  await switchPersona(page, "recruiter-active", "Finance Simplified");

  await page.goto("/post-job/import", { waitUntil: "domcontentloaded" });
  await page.getByTestId("import-development-scenario").selectOption("clean-import");
  await page.getByTestId("open-import-review-fixture").click();
  await completeAssistant(page);
  await expect(page).toHaveURL(/\/post-job\?draftId=/, { timeout: 20_000 });
  await expect(
    page.getByRole("heading", { name: "Your draft is ready to edit." })
  ).toBeVisible();
  await expect(
    page.locator("h2:visible").filter({ hasText: "Content strategist for an education brand" }).first()
  ).toBeVisible();
  await expect(page.getByText(/essential decisions? left/i)).toHaveCount(0);

  await page.goto("/post-job/import", { waitUntil: "domcontentloaded" });
  await page.getByTestId("import-development-scenario").selectOption("thumbnail-designer");
  await page.getByTestId("open-import-review-fixture").click();
  await completeAssistant(page);
  await expect(page).toHaveURL(/\/post-job\?draftId=/, { timeout: 20_000 });
  await expect(
    page.getByRole("heading", { name: /confirm the closest creator role/i })
  ).toBeVisible();
  await page.getByText("What I found").click();
  await expect(
    page.getByTestId("import-guidance-evidence").getByText(/Create bold thumbnails/i)
  ).toBeVisible();
  await page.getByRole("button", { name: "Use Thumbnail designer" }).click();
  await expect(page.getByText(/optional improvement/i)).toBeVisible();
  await expect(page.getByRole("button", { name: "Not now" })).toBeVisible();
  await page.getByRole("button", { name: "Not now" }).click();
  const skipRemaining = page.getByRole("button", { name: "Skip remaining suggestions" });
  if (await skipRemaining.count()) await skipRemaining.click();
  await expect(
    page.getByRole("heading", { name: "Your draft is ready to edit." })
  ).toBeVisible();
});

test("development processing failure stays separate and retryable", async ({ page }) => {
  await loginController(page);
  await switchPersona(page, "both-sides", "Aditi Verma");
  await page.goto("/post-job/import", { waitUntil: "domcontentloaded" });
  await page.getByTestId("import-development-scenario").selectOption("processing-failure");
  await page.getByTestId("open-import-review-fixture").click();
  await expect(page.getByTestId("job-import-failure")).toBeVisible();
  await expect(
    // Bea reports the failure in her own voice; the surface is otherwise
    // unchanged and still offers Retry, manual completion and a fresh start.
    page.getByRole("heading", { name: "I couldn’t finish this draft" })
  ).toBeVisible();
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByTestId("job-import-failure")).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue manually" })).toBeVisible();
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
    await completeAssistant(page);
    await expect(page).toHaveURL(/\/post-job\?draftId=/, { timeout: 20_000 });
    await expect(page.getByTestId("conversational-import-guidance")).toBeVisible();
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 320, height: 720 },
      // Halving a 1440px CSS viewport exercises the layout at its 200% zoom equivalent.
      { width: 720, height: 450 },
    ]) {
      await page.setViewportSize(viewport);
      const decisionButton = page.getByRole("button", { name: "remote", exact: true });
      if (await decisionButton.count()) {
        const box = await decisionButton.boundingBox();
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      }
      const overflow = await page.evaluate(() => {
        const overflowing =
          document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;
        const elements = overflowing
          ? Array.from(document.querySelectorAll<HTMLElement>("body *"))
              .filter((element) => {
                const rect = element.getBoundingClientRect();
                return rect.right > document.documentElement.clientWidth + 1 || rect.left < -1;
              })
              .slice(0, 8)
              .map((element) => ({
                tag: element.tagName,
                id: element.id,
                className: String(element.className),
                text: element.innerText?.slice(0, 80),
                right: element.getBoundingClientRect().right,
              }))
          : [];
        return { overflowing, elements };
      });
      expect(overflow.overflowing, `${viewport.width}px overflow: ${JSON.stringify(overflow.elements)}`).toBe(false);
    }
  });
});
