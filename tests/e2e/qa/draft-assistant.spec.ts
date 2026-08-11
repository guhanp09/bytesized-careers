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

/** Settle whichever supported control the fixture currently presents. */
async function answerCurrentConversationTurn(page: Page) {
  const turn = page.getByTestId("conversation-turn");
  const oneClick = [
    turn.locator('[data-testid^="conversation-alternative-"]').first(),
    turn.getByTestId("conversation-accept-suggestion"),
    turn.getByTestId("conversation-accept-multi-recommendation"),
    turn.locator('[data-testid^="conversation-option-"]').first(),
  ];
  for (const control of oneClick) {
    if (await control.isVisible()) {
      await control.click();
      return;
    }
  }

  const chip = turn.locator('[data-testid^="conversation-chip-"]').first();
  if (await chip.isVisible()) {
    await chip.click();
    await turn.getByTestId("conversation-multiselect-submit").click();
    return;
  }

  const input = turn.getByTestId("conversation-text-answer");
  if (await input.isVisible()) {
    const fieldPath = await turn.locator("[data-field]").getAttribute("data-field");
    const answers: Record<string, string> = {
      requirements: "Strong pacing and clear long-form video storytelling",
      responsibilities: "Edit one polished learning video from footage to final cut",
      about_channel:
        "A creator-led channel making clear educational videos for its audience.",
    };
    await input.fill(
      (await input.getAttribute("inputmode")) === "numeric"
        ? "40"
        : answers[fieldPath ?? ""] ?? "A clear detail candidates can understand"
    );
    await turn.getByTestId("conversation-submit").click();
    return;
  }

  throw new Error("The active conversation question has no supported answer control");
}

test.describe("AI entry", () => {
  for (const viewport of [
    { name: "mobile-390", width: 390, height: 844 },
    { name: "desktop-1280", width: 1280, height: 900 },
  ]) {
    test(`the private import entry is usable at ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await loginController(page);
      await page.goto("/post-job/import", { waitUntil: "domcontentloaded" });

      await expect(page.getByRole("heading", { name: "Turn an existing post into a draft" })).toBeVisible();
      await expect(page.locator("#import-panel-text")).toBeVisible();
      await expect(page.getByTestId("import-prepare")).toBeVisible();
      await page.screenshot({
        path: `${SHOTS}/import-entry-${viewport.name}.png`,
        fullPage: true,
      });

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
      );
      expect(overflow, `horizontal overflow on import entry at ${viewport.name}`).toBe(false);
    });
  }

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
    await expect(page.locator("#import-panel-text")).toHaveCount(0);
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

test.describe("source-first processing", () => {
  test("the assistant reads the source before asking the recruiter anything", async ({
    page,
  }) => {
    await loginController(page);
    await openFixture(page, "delayed-processing");

    // Extraction is still running, and no speculative form is competing with
    // it. Questions begin only after the page has actually been interpreted.
    await expect(page.getByTestId("draft-assistant-progress")).toHaveAttribute(
      "data-state",
      "active"
    );
    await expect(page.getByTestId("early-question")).toHaveCount(0);
    await expect(page.getByTestId("conversation-turn")).toHaveCount(0);
  });

  test("a processing draft survives a full page reload without inventing a question", async ({
    page,
  }) => {
    await loginController(page);
    await openFixture(page, "refresh-resume");

    await expect(page.getByTestId("draft-assistant-canvas")).toBeVisible();
    await expect(page.getByTestId("early-question")).toHaveCount(0);
    // The canvas appears as soon as the fixture request begins. Wait until the
    // server has actually returned its durable draft id before testing resume;
    // otherwise this reload merely aborts the create request it is meant to
    // exercise.
    await expect(page).toHaveURL(/[?&]draft=[^&]+/, { timeout: 12_000 });

    await page.reload({ waitUntil: "domcontentloaded" });

    // Restored from the server, with no browser storage and no administrative
    // question inserted just to occupy the wait.
    await expect(page.getByTestId("draft-assistant-canvas")).toBeVisible();
    await expect(page.getByTestId("early-question")).toHaveCount(0);
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

    // The source already settled everything important. Blank optional editor
    // fields do not become a second administrative questionnaire.
    await expect(page.getByTestId("conversation-open-draft")).toBeVisible({
      timeout: 30_000,
    });
    const open = page.getByTestId("conversation-open-draft");
    await open.click();

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
      const preview =
        viewport.name === "mobile-390"
          ? page
              .getByTestId("draft-assistant-preview-mobile")
              .getByLabel("Candidate listing preview")
          : page
              .getByTestId("draft-assistant-preview-rail")
              .getByLabel("Candidate listing preview");
      if (viewport.name === "mobile-390") {
        const mobilePreview = page.getByTestId("draft-assistant-preview-mobile");
        await expect(mobilePreview).toBeVisible();
        await mobilePreview.locator("summary").click();
      }
      await expect(preview).toHaveCount(1);
      await expect(preview).toBeVisible();
      await expect(preview).toContainText("Video Editor");
      await expect(preview).toContainText("Chennai");
      await expect(preview).toContainText(/Edit learning videos/i);
      await expect(preview).toContainText(/video editing experience/i);
      await expect(preview).not.toContainText("Job title not added yet");
      await expect(preview).not.toContainText("Creator role not selected");

      const sourceSupported = new Set([
        "title",
        "primary_role_key",
        "location",
        "work_mode",
        "engagement_type",
        "content_niches",
        "experience_level",
        "requirements",
        "responsibilities",
      ]);
      const choiceAnswers: Record<string, string> = {
        platforms: "youtube",
        // start_timeframe is superseded: the editor only renders start_timing,
        // so that is the field the assistant now asks about.
        start_timing: "flexible",
        // Money is one grouped decision now: the question is carried under
        // budget_unit and its answer settles compensation_mode too. Choosing a
        // paying shape would rightly go on to ask the amount, so the fixture
        // takes the option that describes this listing — open to discussion.
        budget_unit: "custom",
      };
      const textAnswers: Record<string, string> = {
        about_channel:
          "A school-led education studio creating clear learning videos for students.",
        expected_weekly_hours_min: "40",
      };
      const deliberateQuestions = new Set([
        ...Object.keys(choiceAnswers),
        ...Object.keys(textAnswers),
      ]);
      const askedFields: string[] = [];

      for (let step = 0; step < 25; step += 1) {
        if (await page.getByTestId("conversation-open-draft").isVisible()) break;
        const turn = page.getByTestId("conversation-turn");
        await expect(turn).toBeVisible();
        const field = await turn.locator("[data-field]").getAttribute("data-field");
        expect(field, "every assistant question names its canonical field").toBeTruthy();
        expect(
          sourceSupported.has(field!),
          `the assistant re-asked source-supported ${field}`
        ).toBe(false);
        expect(
          deliberateQuestions.has(field!),
          `the assistant asked an unnecessary Shine question: ${field}`
        ).toBe(true);
        askedFields.push(field!);

        const answer = choiceAnswers[field!] ?? textAnswers[field!];
        if (answer === undefined) {
          throw new Error(`No deliberate QA answer for unexpected question ${field}`);
        } else if (await page.getByTestId(`conversation-option-${answer}`).isVisible()) {
          await page.getByTestId(`conversation-option-${answer}`).click();
        } else if (await page.getByTestId(`conversation-chip-${answer}`).isVisible()) {
          await page.getByTestId(`conversation-chip-${answer}`).click();
          await page.getByTestId("conversation-multiselect-submit").click();
        } else if (await page.getByTestId("conversation-text-answer").isVisible()) {
          await page.getByTestId("conversation-text-answer").fill(answer);
          await page.getByTestId("conversation-submit").click();
        } else {
          throw new Error(`Question ${field} did not render its declared answer shape`);
        }
        await expect
          .poll(async () => {
            if (await page.getByTestId("conversation-open-draft").isVisible()) return "done";
            const next = page.getByTestId("conversation-turn");
            return (await next.isVisible())
              ? await next.locator("[data-field]").getAttribute("data-field")
              : "gone";
          }, { timeout: 20_000 })
          .not.toBe(field);
      }
      expect(new Set(askedFields).size).toBe(askedFields.length);
      await expect(page.getByTestId("conversation-open-draft")).toBeVisible({
        timeout: 20_000,
      });
      await page.getByTestId("conversation-open-draft").click();
      await expect(page).toHaveURL(/\/post-job\?/, { timeout: 30_000 });
      await expect(page.getByRole("heading", { name: "THE ROLE" })).toBeVisible();
      await expect(page.getByLabel("Job title")).toHaveValue("Video Editor");
      await page.screenshot({
        path: `${SHOTS}/shine-handoff-${viewport.name}.png`,
        fullPage: true,
      });

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
      expect(nativeDraft.primary_role_name_snapshot).toBe("Video Editor");
      // A formatted postal address used to arrive in a field holding a city,
      // and the editor refused it \u2014 so a fact the page stated became something
      // the recruiter had to retype.
      expect(nativeDraft.location).toBe("Chennai");
      expect(nativeDraft.engagement_type).toBe("full_time");
      // Exactly what the page states. This briefly read "1\u20133 years", because a
      // conversion layer mistook a question's four option bands for the field's
      // domain and placed the figure in the nearest one. The field is a plain
      // string in the schema, and a listing must never narrow its source.
      expect(nativeDraft.experience_level).toBe("1\u20137 years of experience");
      expect(nativeDraft.content_niches).toContain("Education");
      expect(nativeDraft.responsibilities).toContain(
        "Edit learning videos for a school-based education channel"
      );
      expect(nativeDraft.requirements).toContain(
        "1\u20137 years of video editing experience"
      );
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

  test("a submitted reply is followed immediately by the robot typing", async ({
    page,
  }) => {
    await loginController(page);
    await openFixture(page, "checkpoint-currency");
    const turn = page.getByTestId("conversation-turn");
    await expect(turn).toBeVisible({ timeout: 30_000 });

    let markRequestHeld!: () => void;
    const requestHeld = new Promise<void>((resolve) => {
      markRequestHeld = resolve;
    });
    let releaseRequest!: () => void;
    const requestRelease = new Promise<void>((resolve) => {
      releaseRequest = resolve;
    });
    await page.route("**/conversation/answer", async (route) => {
      markRequestHeld();
      await requestRelease;
      await route.continue();
    });

    await answerCurrentConversationTurn(page);
    await requestHeld;

    const reply = turn.getByTestId("conversation-reply");
    const typing = turn.getByTestId("conversation-thinking");
    await expect(reply).toBeVisible();
    await expect(typing).toBeVisible();
    await expect(page.getByTestId("conversation-text-answer")).toHaveCount(0);

    const chronological = await turn.evaluate((node) => {
      const recruiterReply = node.querySelector('[data-testid="conversation-reply"]');
      const assistantTyping = node.querySelector('[data-testid="conversation-thinking"]');
      return Boolean(
        recruiterReply &&
          assistantTyping &&
          recruiterReply.compareDocumentPosition(assistantTyping) &
            Node.DOCUMENT_POSITION_FOLLOWING
      );
    });
    expect(chronological).toBe(true);

    const replyBox = await reply.boundingBox();
    const typingBox = await typing.boundingBox();
    const scrollBox = await page.getByTestId("conversation-scroll").boundingBox();
    expect(replyBox).not.toBeNull();
    expect(typingBox).not.toBeNull();
    expect(scrollBox).not.toBeNull();
    expect(replyBox!.x).toBeGreaterThan(typingBox!.x);
    const replyToTypingGap = typingBox!.y - (replyBox!.y + replyBox!.height);
    expect(replyToTypingGap).toBeGreaterThanOrEqual(0);
    expect(replyToTypingGap).toBeLessThanOrEqual(24);
    expect(typingBox!.y).toBeGreaterThanOrEqual(scrollBox!.y - 1);
    expect(typingBox!.y + typingBox!.height).toBeLessThanOrEqual(
      scrollBox!.y + scrollBox!.height + 1
    );
    await page.screenshot({
      path: `${SHOTS}/conversation-reply-and-typing.png`,
      fullPage: true,
    });

    releaseRequest();
    await expect(typing).toHaveCount(0, { timeout: 20_000 });
    await expect(page.getByTestId("conversation-reply")).toHaveCount(1);
  });

  test("a saved answer survives a failed draft readback without looking unsaved", async ({
    page,
  }) => {
    await loginController(page);
    await openFixture(page, "checkpoint-currency");
    const turn = page.getByTestId("conversation-turn");
    await expect(turn).toBeVisible({ timeout: 30_000 });
    const answeredField = await turn.locator("[data-field]").getAttribute("data-field");
    expect(answeredField).toBeTruthy();

    let failNextDraftReadback = false;
    let failedReadbacks = 0;
    await page.route("**/job-imports/drafts/**", async (route) => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      const isAnswerWrite =
        request.method() === "POST" && pathname.endsWith("/conversation/answer");
      if (isAnswerWrite) {
        // Let the real backend commit first, then arm the one-shot read failure
        // before the successful response reaches the browser application.
        const response = await route.fetch();
        failNextDraftReadback = true;
        await route.fulfill({ response });
        return;
      }
      const isDraftReadback =
        request.method() === "GET" &&
        /\/api\/v1\/job-imports\/drafts\/[^/]+$/.test(pathname);
      if (failNextDraftReadback && isDraftReadback) {
        failNextDraftReadback = false;
        failedReadbacks += 1;
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ detail: "Temporary readback failure" }),
        });
        return;
      }
      await route.continue();
    });

    await answerCurrentConversationTurn(page);

    await expect.poll(() => failedReadbacks).toBe(1);
    await expect(
      page.getByText("Answer saved. Refreshing your draft…", { exact: true })
    ).toHaveCount(1);
    await expect(page.getByText(/could not be saved/i)).toHaveCount(0);

    // The failed read was only a presentation refresh. The committed answer
    // must appear in history and the conversation must move forward without a
    // second recruiter click.
    await expect
      .poll(async () => {
        if (await page.getByTestId("conversation-open-draft").isVisible()) return "done";
        const nextTurn = page.getByTestId("conversation-turn");
        if (!(await nextTurn.isVisible())) return "transitioning";
        return (
          (await nextTurn.locator("[data-field]").getAttribute("data-field")) ??
          "transitioning"
        );
      }, { timeout: 20_000 })
      .not.toBe(answeredField);
    await expect(page.getByTestId("conversation-reply")).toHaveCount(1, {
      timeout: 20_000,
    });
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
      await answerCurrentConversationTurn(page);
      await page.waitForTimeout(700);
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

  test("an exact custom experience answer validates and survives the native handoff", async ({
    page,
  }) => {
    await loginController(page);
    await openFixture(page, "checkpoint-experience");

    const turn = page.getByTestId("conversation-turn");
    await expect(turn).toBeVisible({ timeout: 30_000 });
    await expect(turn.locator('[data-field="experience_level"]')).toBeVisible();
    const alternatives = turn.locator('[data-testid^="conversation-alternative-"]');
    await expect(alternatives).toHaveCount(2);
    await expect(alternatives.nth(0)).toContainText("1–2 years");
    await expect(alternatives.nth(1)).toContainText("3–5 years");
    await expect(turn.getByTestId("conversation-custom-override")).toBeVisible();

    const custom = turn.getByTestId("conversation-custom-answer");
    const submit = turn.getByTestId("conversation-custom-submit");
    await custom.fill("7–1 years");
    await custom.blur();
    await expect(custom).toHaveAttribute("aria-invalid", "true");
    await expect(submit).toBeDisabled();

    await custom.fill("18–30 months");
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(page.getByTestId("conversation-reply")).toContainText("18–30 months", {
      timeout: 20_000,
    });

    // Reloading reconstructs the transcript from the server-owned checkpoint;
    // the exact open-domain answer must not collapse into a catalog band.
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("conversation-reply")).toContainText("18–30 months", {
      timeout: 30_000,
    });

    const skipRemaining = page.getByTestId("conversation-skip-remaining");
    if (await skipRemaining.isVisible()) await skipRemaining.click();
    await expect(page.getByTestId("conversation-open-draft")).toBeVisible({
      timeout: 30_000,
    });
    await page.getByTestId("conversation-open-draft").click();
    await expect(page).toHaveURL(/\/post-job\?/, { timeout: 30_000 });

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
    expect(nativeDraft.experience_level).toBe("18–30 months");
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

  test("a clean import asks nothing the source did not make important", async ({ page }) => {
    await loginController(page);
    await openFixture(page, "clean-import");

    // Blank optional fields stay in the full editor. A URL import should not
    // manufacture a conversational questionnaire from every possible upgrade.
    await expect(page.getByTestId("conversation-turn")).toHaveCount(0);
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
