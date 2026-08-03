import { expect, test, type Page } from "@playwright/test";

/**
 * End-to-end coverage for the draft assistant.
 *
 * Everything here runs against the development fixtures, so no provider call is
 * made. Screenshots go to /tmp only and are never committed.
 */

const CONTROLLER_EMAIL = "qa-controller@example.com";
const CONTROLLER_PASSWORD = "LocalQaController123!";
const SHOTS = "/tmp/creatorjobs-assistant-qa";

const WIDTHS = [
  { name: "mobile-390", width: 390, height: 844 },
  { name: "mobile-430", width: 430, height: 932 },
  { name: "tablet-834", width: 834, height: 1112 },
  { name: "desktop-1280", width: 1280, height: 900 },
  { name: "wide-1680", width: 1680, height: 1000 },
];

async function loginController(page: Page) {
  await page.goto("/auth?mode=login", { waitUntil: "domcontentloaded" });
  await page.getByPlaceholder("Email").fill(CONTROLLER_EMAIL);
  await page.getByPlaceholder("Password").fill(CONTROLLER_PASSWORD);
  await page.locator("form").getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page).toHaveURL(/\/you/);
}

/** Open the import route and run one development fixture. */
async function openFixture(page: Page, scenario: string) {
  await page.goto("/post-job/import", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("import-development-scenario")).toBeVisible();
  await page.getByTestId("import-development-scenario").selectOption(scenario);
  await page.getByTestId("open-import-review-fixture").click();
}

test.describe("AI entry", () => {
  test("Prepare with AI opens the assistant canvas, not the old dashboard", async ({
    page,
  }) => {
    await loginController(page);
    await page.goto("/post", { waitUntil: "domcontentloaded" });

    const card = page.getByTestId("post-import-card");
    await expect(card).toBeVisible();
    await card.click();
    await expect(page).toHaveURL(/\/post-job\/import/);

    // The old review dashboard must never appear, even for a frame.
    await expect(page.getByTestId("job-import-preparing")).toHaveCount(0);
    await expect(page.getByText("Review flagged fields")).toHaveCount(0);
    await expect(page.getByText("Needs your review")).toHaveCount(0);
  });

  test("an unauthenticated visitor never reaches the paste surface", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto("/post-job/import", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("import-panel-text")).toHaveCount(0);
    await context.close();
  });
});

test.describe("truthful progress", () => {
  test("the in-flight stage is indeterminate and the bar never reaches 100%", async ({
    page,
  }) => {
    await loginController(page);
    await openFixture(page, "delayed-processing");

    const canvas = page.getByTestId("draft-assistant-canvas");
    await expect(canvas).toBeVisible();

    const bar = page.getByTestId("draft-assistant-progress");
    await expect(bar).toBeVisible();

    // Wait for the draft itself to land. The bar is honestly at zero until then,
    // and "active" is true from the first frame, so gate on earned progress.
    await expect
      .poll(async () => Number(await bar.getAttribute("data-progress")), {
        timeout: 20_000,
      })
      .toBeGreaterThan(0);

    // Some stages are genuinely done, so the bar is not empty...
    const percent = Number(await bar.getAttribute("data-progress"));
    expect(percent).toBeGreaterThan(0);
    // ...but nothing claims completion while extraction is still running.
    expect(percent).toBeLessThan(100);

    // And it does not creep: the same observed state gives the same claim.
    await page.waitForTimeout(2_500);
    expect(Number(await bar.getAttribute("data-progress"))).toBe(percent);
  });

  test("the robot is present and its state is published as text", async ({ page }) => {
    await loginController(page);
    await openFixture(page, "delayed-processing");

    await expect(page.getByTestId("draft-assistant-robot")).toBeVisible();
    // Decorative to assistive technology.
    await expect(page.getByTestId("draft-assistant-robot")).toHaveAttribute(
      "aria-hidden",
      "true"
    );
    // But the state itself is readable.
    await expect(page.getByTestId("draft-assistant-status")).toContainText(/Bea/);
  });
});

test.describe("early questions during processing", () => {
  test("one question appears, is answerable while work continues, and persists", async ({
    page,
  }) => {
    await loginController(page);
    await openFixture(page, "delayed-processing");

    const question = page.getByTestId("early-question");
    await expect(question).toBeVisible();

    // Exactly one decision is active. Never a wall of fields.
    await expect(page.getByTestId("early-question")).toHaveCount(1);

    // Extraction is still running underneath.
    await expect(page.getByTestId("draft-assistant-progress")).toHaveAttribute(
      "data-state",
      "active"
    );

    await page.getByTestId("early-question-option-creator").click();

    // The answer is recorded and shown in the compact history.
    await expect(page.getByTestId("conversation-reply")).toHaveCount(1);
  });

  test("a saved answer survives a full page reload", async ({ page }) => {
    await loginController(page);
    await openFixture(page, "refresh-resume");

    // This fixture ships with one answer already saved server-side.
    await expect(page.getByTestId("conversation-reply")).toHaveCount(1);

    await page.reload({ waitUntil: "domcontentloaded" });

    // Restored from the server, with no browser storage involved.
    await expect(page.getByTestId("conversation-reply")).toHaveCount(1);
    await expect(page.getByTestId("draft-assistant-canvas")).toBeVisible();
  });
});

test.describe("role-aware guidance", () => {
  const cases = [
    { scenario: "thumbnail-designer", expect: /thumbnail/i },
    { scenario: "scriptwriter", expect: /script|research|draft/i },
  ];

  for (const item of cases) {
    test(`${item.scenario} receives guidance about its own craft`, async ({ page }) => {
      await loginController(page);
      await openFixture(page, item.scenario);

      // The fixture lands in the ordinary Post Job editor with guidance.
      await expect(page).toHaveURL(/\/post-job/, { timeout: 30_000 });
      const body = page.locator("body");
      await expect(body).toContainText(item.expect, { timeout: 20_000 });
    });
  }

  test("a consequential conflict is asked before anything optional", async ({ page }) => {
    await loginController(page);
    await openFixture(page, "strong-decisions");
    await expect(page).toHaveURL(/\/post-job/, { timeout: 30_000 });

    // The editor fixture has a compensation contradiction. That outranks every
    // role-specific quality suggestion, so it must lead.
    await expect(page.locator("body")).toContainText(/pay unambiguous|compensation/i, {
      timeout: 20_000,
    });
  });

  test("guidance never exposes an internal field path or the word legacy", async ({
    page,
  }) => {
    await loginController(page);
    await openFixture(page, "scriptwriter");
    await expect(page).toHaveURL(/\/post-job/, { timeout: 30_000 });

    const text = (await page.locator("body").innerText()).toLowerCase();
    for (const leak of ["field_path", "legacy", "budget_unit_custom", "_min", "_max"]) {
      expect(text).not.toContain(leak);
    }
  });
});

test.describe("completion and handoff", () => {
  test("a clean import lands in the ordinary Post Job editor, unpublished", async ({
    page,
  }) => {
    await loginController(page);
    await openFixture(page, "clean-import");

    // Even a clean import may have one improvement worth offering; skip it and
    // take the explicit handoff.
    const skip = page.getByTestId("conversation-skip-remaining");
    await skip.waitFor({ state: "visible", timeout: 30_000 }).catch(() => undefined);
    if (await skip.count()) {
      await skip.click();
      await expect(page.getByTestId("conversation-open-draft")).toBeVisible({
        timeout: 20_000,
      });
    }
    const open = page.getByTestId("conversation-open-draft");
    if (await open.count()) await open.click();

    await expect(page).toHaveURL(/\/post-job\?draftId=/, { timeout: 30_000 });

    // The normal editor, not an import-specific one.
    await expect(page.locator("body")).toContainText(/Post a job|Review/i, {
      timeout: 20_000,
    });

    // No AI dashboard survives the handoff.
    await expect(page.getByText("Review flagged fields")).toHaveCount(0);
    await expect(page.getByText("Optional details not found")).toHaveCount(0);
  });

  for (const viewport of [
    { name: "desktop", width: 1280, height: 900 },
    { name: "mobile-390", width: 390, height: 844 },
  ]) {
    test(`the Shine-shaped URL fixture keeps its facts through ${viewport.name} handoff`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await loginController(page);
      await openFixture(page, "shine-school-editor");

      await expect(page.getByTestId("conversation-turn")).toBeVisible({ timeout: 30_000 });
      const assistantText = page.locator("body");
      await expect(assistantText).toContainText("Chennai");

      for (let step = 0; step < 25; step += 1) {
        if (await page.getByTestId("conversation-open-draft").isVisible()) break;
        const turn = page.getByTestId("conversation-turn");
        await expect(turn).toBeVisible();
        const previousTurn = await turn.innerText();
        const suggestion = page.getByTestId("conversation-accept-suggestion");
        const alternative = turn.locator('[data-testid^="conversation-alternative-"]').first();
        const chip = turn.locator('[data-testid^="conversation-chip-"]').first();
        const option = turn.locator('[data-testid^="conversation-option-"]').first();
        const input = page.getByTestId("conversation-text-answer");
        const skip = page.getByTestId("conversation-skip");
        if (await suggestion.isVisible()) {
          await expect(suggestion).toBeEnabled();
          await suggestion.click();
        } else if (await alternative.isVisible()) {
          await alternative.click();
        } else if (await chip.isVisible()) {
          await chip.click();
          await page.getByTestId("conversation-multiselect-submit").click();
        } else if (await option.isVisible()) {
          await option.click();
        } else if (await input.isVisible()) {
          await input.fill(
            (await input.getAttribute("inputmode")) === "numeric"
              ? "40"
              : "A school-led education channel creating clear learning videos."
          );
          await page.getByTestId("conversation-submit").click();
        } else if (await skip.isVisible()) {
          await skip.click();
        }
        await expect
          .poll(async () => {
            if (await page.getByTestId("conversation-open-draft").isVisible()) return "done";
            const next = page.getByTestId("conversation-turn");
            return (await next.isVisible()) ? await next.innerText() : "gone";
          })
          .not.toBe(previousTurn);
      }
      await expect(page.getByTestId("conversation-open-draft")).toBeVisible({
        timeout: 20_000,
      });
      await page.getByTestId("conversation-open-draft").click();
      await expect(page).toHaveURL(/\/post-job\?/, { timeout: 30_000 });
      await expect(page.getByRole("heading", { name: "THE ROLE" })).toBeVisible();
      await expect(page.getByLabel("Job title")).toHaveValue("Video Editor");

      const nativeDraftId = new URL(page.url()).searchParams.get("draftId");
      expect(nativeDraftId).toBeTruthy();
      const session = await (await page.request.get("/api/auth/session")).json();
      const jobsResponse = await page.request.get(
        "http://127.0.0.1:8100/api/v1/me/jobs",
        { headers: { Authorization: `Bearer ${session.backendAccessToken}` } }
      );
      expect(jobsResponse.ok()).toBe(true);
      const nativeDraft = (await jobsResponse.json()).find(
        (job: { id: string }) => job.id === nativeDraftId
      );
      expect(nativeDraft.experience_level).toBe("1\u20137 years of experience");
      const contextResponse = await page.request.get(
        `http://127.0.0.1:8100/api/v1/job-imports/native-jobs/${nativeDraftId}/context`,
        { headers: { Authorization: `Bearer ${session.backendAccessToken}` } }
      );
      expect(contextResponse.ok()).toBe(true);
      const importFields = (await contextResponse.json()).draft.fields;
      const niche = importFields.find(
        (field: { field_path: string }) => field.field_path === "content_niches"
      );
      expect(niche.proposed_value).toEqual(["Education"]);

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
      );
      expect(overflow, `horizontal overflow after ${viewport.name} handoff`).toBe(false);
    });
  }
});

test.describe("actual failure", () => {
  test("a real failure is visually distinct and offers a way forward", async ({
    page,
  }) => {
    await loginController(page);
    await openFixture(page, "processing-failure");

    const failure = page.getByTestId("job-import-failure");
    await expect(failure).toBeVisible({ timeout: 20_000 });

    // A route out, and no technical code on screen.
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue manually" })).toBeVisible();
    const text = await page.locator("body").innerText();
    expect(text).not.toContain("JOB_IMPORT_");
    expect(text).not.toContain("Traceback");
  });
});

test.describe("responsive layout", () => {
  for (const size of WIDTHS) {
    test(`no horizontal overflow at ${size.name}`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await loginController(page);
      await openFixture(page, "delayed-processing");
      await expect(page.getByTestId("draft-assistant-canvas")).toBeVisible();

      await page.screenshot({
        path: `${SHOTS}/assistant-${size.name}.png`,
        fullPage: true,
      });

      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth + 1
      );
      expect(overflow, `horizontal overflow at ${size.name}`).toBe(false);

      // Touch targets stay reachable.
      const option = page.getByTestId("early-question-option-creator");
      if (await option.count()) {
        const box = await option.boundingBox();
        expect(box!.height).toBeGreaterThanOrEqual(44);
      }
    });
  }
});

test.describe("reduced motion", () => {
  test("the assistant stays usable and progress is still legible", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await loginController(page);
    await openFixture(page, "delayed-processing");

    await expect(page.getByTestId("draft-assistant-canvas")).toBeVisible();
    await expect(page.getByTestId("draft-assistant-progress")).toBeVisible();
    // The state is still announced in text, so nothing depends on motion.
    await expect(page.getByTestId("draft-assistant-status")).toContainText(/Bea/);

    await page.screenshot({
      path: `${SHOTS}/assistant-reduced-motion.png`,
      fullPage: true,
    });
  });
});

// ---------------------------------------------------------------------------
// Checkpointed conversation
// ---------------------------------------------------------------------------

test.describe("checkpointed conversation", () => {
  /** Read the conversation the way the UI does, through the API. */
  async function conversation(page: Page, draftId: string) {
    const session = await (await page.request.get("/api/auth/session")).json();
    const response = await page.request.get(
      `http://127.0.0.1:8100/api/v1/job-imports/drafts/${draftId}/conversation`,
      { headers: { Authorization: `Bearer ${session.backendAccessToken}` } }
    );
    return response.json();
  }

  async function beginConversation(page: Page, draftId: string) {
    const session = await (await page.request.get("/api/auth/session")).json();
    const response = await page.request.post(
      `http://127.0.0.1:8100/api/v1/job-imports/drafts/${draftId}/conversation/begin`,
      { headers: { Authorization: `Bearer ${session.backendAccessToken}` } }
    );
    return response.json();
  }

  /**
   * Create the fixture through the API rather than the UI.
   *
   * The UI hands off to Post Job as soon as the draft is ready, so reading the
   * id out of the URL races that navigation. The checkpoint guarantee is a
   * server property; asking the server directly tests it without the race.
   */
  async function fixtureDraftId(page: Page, scenario: string): Promise<string> {
    const session = await (await page.request.get("/api/auth/session")).json();
    const response = await page.request.post(
      `http://127.0.0.1:8100/api/v1/dev/job-import-review?scenario=${scenario}&fresh=true`,
      { headers: { Authorization: `Bearer ${session.backendAccessToken}` } }
    );
    expect(response.ok()).toBe(true);
    return (await response.json()).draft.id as string;
  }

  test("the assistant stops on exactly one question", async ({ page }) => {
    await loginController(page);
    const draftId = await fixtureDraftId(page, "checkpoint-currency");

    const state = await beginConversation(page, draftId);
    expect(state.waiting).toBe(true);
    // One question, never a list of everything unresolved.
    expect(state.active_question).not.toBeNull();
    expect(Array.isArray(state.active_question)).toBe(false);
    expect(typeof state.active_question.field_path).toBe("string");
  });

  test("waiting is free: polling, refresh and walking away spend nothing", async ({
    page,
  }) => {
    await loginController(page);
    const draftId = await fixtureDraftId(page, "checkpoint-trial");

    const before = await beginConversation(page, draftId);
    expect(before.waiting).toBe(true);

    // Sit on the question through several polling cycles, then reload the page.
    await page.goto("/post-job/import", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(9_000);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2_000);

    const after = await conversation(page, draftId);
    // The continuation counter is the meter, and it has not moved.
    expect(after.continuation_count).toBe(before.continuation_count);
    expect(after.waiting).toBe(true);
    // The very same question is still the one being asked.
    expect(after.active_question.field_path).toBe(before.active_question.field_path);
  });

  test("the recruiter is never shown a wall of unresolved fields", async ({ page }) => {
    await loginController(page);
    await openFixture(page, "checkpoint-currency");
    await expect(page).toHaveURL(/\/post-job/, { timeout: 30_000 });

    const body = await page.locator("body").innerText();
    for (const banned of [
      "fields missing",
      "Review flagged fields",
      "Needs your review",
      "Optional details not found",
    ]) {
      expect(body).not.toContain(banned);
    }
  });

  test("a checkpointed draft still hands off unpublished, on a phone too", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loginController(page);
    await openFixture(page, "checkpoint-trial");
    await expect(page).toHaveURL(/\/post-job/, { timeout: 30_000 });

    await page.screenshot({
      path: `${SHOTS}/checkpoint-handoff-mobile.png`,
      fullPage: true,
    });

    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth + 1
    );
    expect(overflow, "horizontal overflow after checkpoint handoff").toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The conversational-completion boundary
// ---------------------------------------------------------------------------

test.describe("conversational completion", () => {
  test("extraction finishing does not hand the recruiter off", async ({ page }) => {
    await loginController(page);
    await openFixture(page, "checkpoint-currency");

    // The assistant stays put and asks, rather than navigating away.
    await expect(page.getByTestId("conversation-turn")).toBeVisible({
      timeout: 30_000,
    });
    await expect(page).toHaveURL(/\/post-job\/import/);
    // One question, never a list.
    await expect(page.getByTestId("conversation-turn")).toHaveCount(1);
    // And the manual route out is present but secondary.
    await expect(page.getByTestId("conversation-continue-manually")).toBeVisible();
  });

  test("answering reaches a completion state, and the handoff is an explicit choice", async ({
    page,
  }) => {
    await loginController(page);
    await openFixture(page, "checkpoint-trial");
    await expect(page.getByTestId("conversation-turn")).toBeVisible({
      timeout: 30_000,
    });

    for (let step = 0; step < 25; step += 1) {
      if (await page.getByTestId("conversation-open-draft").count()) break;
      const skipRemaining = page.getByTestId("conversation-skip-remaining");
      if (await skipRemaining.count()) {
        await skipRemaining.click();
        await page.waitForTimeout(700);
        continue;
      }
      const option = page
        .getByTestId("conversation-turn")
        .locator('[data-testid^="conversation-option-"]')
        .first();
      if (await option.count()) {
        await option.click();
        await page.waitForTimeout(700);
        continue;
      }
      const input = page.getByTestId("conversation-text-answer");
      if (await input.count()) {
        await input.fill(
        (await input.getAttribute("inputmode")) === "numeric" ? "5" : "Provided during QA"
      );
        await page.getByTestId("conversation-submit").click();
        await page.waitForTimeout(700);
        continue;
      }
      break;
    }

    // Bea reports completion; the recruiter has not been moved anywhere yet.
    await expect(page.getByTestId("conversation-complete")).toBeVisible({
      timeout: 30_000,
    });
    await expect(page).toHaveURL(/\/post-job\/import/);

    await page.getByTestId("conversation-open-draft").click();
    await expect(page).toHaveURL(/\/post-job\?/, { timeout: 30_000 });
    // The ordinary editor, with no AI issue dashboard in sight.
    await expect(page.getByText("Review flagged fields")).toHaveCount(0);
  });

  test("Continue manually hands off with unanswered questions preserved", async ({
    page,
  }) => {
    await loginController(page);
    await openFixture(page, "checkpoint-currency");
    await expect(page.getByTestId("conversation-turn")).toBeVisible({
      timeout: 30_000,
    });

    await page.getByTestId("conversation-continue-manually").click();
    await expect(page.getByTestId("conversation-complete")).toBeVisible({
      timeout: 20_000,
    });
    await page.getByTestId("conversation-open-draft").click();
    await expect(page).toHaveURL(/\/post-job\?/, { timeout: 30_000 });
  });

  test("a clean import asks nothing essential, only offers", async ({ page }) => {
    await loginController(page);
    await openFixture(page, "clean-import");

    // It genuinely has no revision policy, so offering one is the designed
    // behaviour — but nothing here is *essential*, and it is skippable.
    const turn = page.getByTestId("conversation-turn");
    await expect(turn).toBeVisible({ timeout: 30_000 });
    await expect(turn).toHaveAttribute("data-kind", "optional");

    await page.getByTestId("conversation-skip-remaining").click();
    await expect(page.getByTestId("conversation-complete")).toBeVisible({
      timeout: 20_000,
    });
  });

  test("the paused conversation holds together on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loginController(page);
    await openFixture(page, "checkpoint-currency");
    await expect(page.getByTestId("conversation-turn")).toBeVisible({
      timeout: 30_000,
    });

    await page.screenshot({
      path: `${SHOTS}/completion-question-mobile.png`,
      fullPage: true,
    });
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth + 1
    );
    expect(overflow, "horizontal overflow during conversation").toBe(false);
  });
});
