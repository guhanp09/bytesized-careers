import { expect, test, type Locator, type Page } from "@playwright/test";

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
/**
 * Press "Open job draft" and prove it did something.
 *
 * The previous version clicked and returned, so a click that landed on a node
 * mid-re-render — or while the control was momentarily disabled during a save —
 * looked identical to success, and the caller then failed on the URL assertion
 * with no clue why. Opening the draft is an async round trip followed by a
 * route change, so the only honest completion signal is the route itself.
 */
async function finishAssistant(page: Page) {
  const done = page.getByTestId("conversation-open-draft");
  for (let attempt = 0; attempt < 3; attempt += 1) {
    // The control disables itself while an answer or conversion is in flight.
    await expect(done).toBeEnabled({ timeout: 15_000 });
    await done.click({ timeout: 10_000 }).catch(() => undefined);
    // The route is the only honest signal. The completion card can re-render
    // and take the button with it without anything having happened, so treating
    // its disappearance as success is exactly how this failure stayed invisible.
    const opened = await page
      .waitForURL(/\/post-job\?(draftId|importDraftId)=/, { timeout: 20_000 })
      .then(() => true)
      .catch(() => false);
    if (opened) return;
    // Re-rendered without navigating: let the canvas settle, then press again.
    await page
      .getByTestId("conversation-open-draft")
      .waitFor({ state: "visible", timeout: 15_000 })
      .catch(() => undefined);
  }
  throw new Error("Open job draft never produced a handoff");
}

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
    if (await done.isVisible().catch(() => false)) {
      await finishAssistant(page);
      return;
    }
    const turn = page.getByTestId("conversation-turn");
    if (!(await turn.isVisible())) {
      await done
        .or(turn)
        .first()
        .waitFor({ state: "visible", timeout: 5_000 })
        .catch(() => undefined);
      if (await done.isVisible()) {
        await finishAssistant(page);
        return;
      }
      continue;
    }

    const turnSignature = await turn.textContent({ timeout: 1_000 }).catch(() => null);
    if (!turnSignature) continue;

    const skip = page.getByTestId("conversation-skip-remaining");
    if (await skip.isVisible()) {
      await expect
        .poll(
          async () =>
            (await done.isVisible()) ||
            !(await skip.isVisible()) ||
            (await skip.isEnabled()),
          { timeout: 5_000 }
        )
        .toBe(true);
      if (await done.isVisible()) continue;
      if (await skip.isVisible()) {
        await skip.click();
      } else {
        continue;
      }
    } else {
      // A conflict renders the source's own candidate answers instead of a
      // menu or a text box, so it needs its own branch.
      const alternative = turn.locator('[data-testid^="conversation-alternative-"]').first();
      const chip = turn.locator('[data-testid^="conversation-chip-"]').first();
      const option = turn.locator('[data-testid^="conversation-option-"]').first();
      const suggestion = page.getByTestId("conversation-accept-suggestion");
      const input = page.getByTestId("conversation-text-answer");
      const dateInput = page.getByTestId("conversation-date-answer");
      const activateCurrent = async (control: Locator) => {
        await expect
          .poll(
            async () => {
              if (await done.isVisible()) return true;
              const current = await turn.textContent({ timeout: 500 }).catch(() => null);
              if (!current || current !== turnSignature) return true;
              return (await control.isVisible()) && (await control.isEnabled());
            },
            { timeout: 5_000 }
          )
          .toBe(true);
        if (await done.isVisible()) return false;
        const current = await turn.textContent({ timeout: 500 }).catch(() => null);
        if (!current || current !== turnSignature) return false;
        return control
          .click({ timeout: 2_000 })
          .then(() => true)
          .catch(() => false);
      };
      if (await alternative.count()) {
        if (!(await activateCurrent(alternative))) continue;
      } else if (await chip.count()) {
        if (!(await activateCurrent(chip))) continue;
        if (!(await activateCurrent(page.getByTestId("conversation-multiselect-submit")))) continue;
      } else if (await suggestion.count()) {
        if (!(await activateCurrent(suggestion))) continue;
      } else if (await option.count()) {
        if (!(await activateCurrent(option))) continue;
      } else if (await dateInput.count()) {
        // A date field has its own control. Without this branch the helper fell
        // through to the silent return below and never pressed Open job draft,
        // which surfaced as an unexplained URL assertion failure.
        await dateInput.fill("2027-01-15");
        await page.getByTestId("conversation-submit").click();
      } else if (await input.count()) {
        const numeric = (await input.getAttribute("inputmode")) === "numeric";
        await input.fill(numeric ? "5" : "Provided during QA");
        await page.getByTestId("conversation-submit").click();
      } else if (await done.isVisible().catch(() => false)) {
        await finishAssistant(page);
        return;
      } else {
        // Never return quietly. A turn this helper cannot answer is a gap in
        // the helper or a new control in the product, and both need saying.
        const shown = (await turn.textContent().catch(() => "")) ?? "";
        throw new Error(
          `completeAssistant cannot answer this turn: ${shown.slice(0, 200)}`
        );
      }
    }

    // Each action is a server round trip. Wait for the turn to actually change
    // rather than re-reading the DOM that is still on screen.
    await expect
      .poll(
        async () => {
          if (await page.getByTestId("conversation-open-draft").isVisible()) return "done";
          const next = page.getByTestId("conversation-turn");
          if (!(await next.isVisible())) return "gone";
          return (await next.textContent({ timeout: 500 }).catch(() => null)) ?? "gone";
        },
        { timeout: 20_000 }
      )
      .not.toBe(turnSignature);
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
  // The conversation happened on the assistant canvas. What opens here is the
  // ordinary Post Job editor with its fields already filled in — no guidance
  // panel, no question, nothing to repair.
  await expect(page.getByTestId("conversational-import-guidance")).toHaveCount(0);
  await expect(page.locator("#import-guidance-question")).toHaveCount(0);
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

  // The import context survives a refresh even though nothing is being asked.
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/post-job\?draftId=/);

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

  // Both fixtures now finish their conversation on the assistant canvas and
  // hand over an ordinary editor. What matters here is that the draft arrives
  // filled in, with none of the old review furniture following it.
  for (const [scenario, title] of [
    ["clean-import", "Content strategist for an education brand"],
    ["thumbnail-designer", "Thumbnail designer for a science channel"],
  ] as const) {
    await page.goto("/post-job/import", { waitUntil: "domcontentloaded" });
    await page.getByTestId("import-development-scenario").selectOption(scenario);
    await page.getByTestId("open-import-review-fixture").click();
    await completeAssistant(page);
    await expect(page).toHaveURL(/\/post-job\?draftId=/, { timeout: 30_000 });

    // Pre-filled, not blank: the title survived the handoff.
    await expect(page.locator("body")).toContainText(title, { timeout: 20_000 });

    // And none of the guidance panel, counters or review vocabulary remains.
    await expect(page.getByTestId("conversational-import-guidance")).toHaveCount(0);
    await expect(page.getByText(/essential decisions? left/i)).toHaveCount(0);
    await expect(page.getByText("Review flagged fields")).toHaveCount(0);
  }
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
    // The ordinary editor, pre-filled — the conversation already happened.
    await expect(page.getByTestId("conversational-import-guidance")).toHaveCount(0);
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
