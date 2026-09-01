import { expect, test, type Page } from "@playwright/test";

/**
 * The recruiter's half: the order they meet the sections in, and the answers
 * they receive back.
 *
 * The order is a product decision, not decoration. A recruiter who reaches
 * "Screening questions" before anywhere to request a portfolio types "Upload
 * your portfolio" as a question, and it stops being a field the form can fill.
 * So this measures the rendered page rather than trusting the JSX.
 */

const SHOTS = "/tmp/creatorjobs-recruiter-qa";
const BACKEND = "http://127.0.0.1:8100/api/v1";

const WIDTHS = [
  { name: "mobile-390", width: 390, height: 844 },
  { name: "mobile-430", width: 430, height: 932 },
  { name: "tablet-834", width: 834, height: 1112 },
  { name: "desktop-1280", width: 1280, height: 900 },
  { name: "wide-1680", width: 1680, height: 1000 },
];

async function login(page: Page) {
  await page.goto("/auth?mode=login", { waitUntil: "domcontentloaded" });
  await page.getByPlaceholder("Email").fill("qa-controller@example.com");
  await page.getByPlaceholder("Password").fill("LocalQaController123!");
  await page.locator("form").getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page).toHaveURL(/\/you/);
}

/** Open the import fixture and hand off to the real Post Job editor. */
async function openPostJobApplicationCard(page: Page) {
  await page.goto("/post-job/import", { waitUntil: "domcontentloaded" });
  await page.getByTestId("import-development-scenario").selectOption("multi-craft");
  await page.getByTestId("open-import-review-fixture").click();

  const turn = page.getByTestId("conversation-turn");
  await expect(turn.locator('[data-testid^="conversation-option-"]').first()).toBeVisible({
    timeout: 30_000,
  });
  await turn.locator('[data-testid^="conversation-option-"]').first().click();

  const open = page.getByRole("button", { name: "Open job draft" });
  await expect(open).toBeVisible({ timeout: 60_000 });
  await open.click();
  await expect(page).toHaveURL(/\/post-job\?/, { timeout: 60_000 });

  // Deep-link straight to the application step. Clicking Continue through the
  // whole flow stalls on an intermediate step for this persona, and the section
  // parameter is the product's own way of jumping there.
  const url = new URL(page.url());
  url.searchParams.set("section", "howToApply");
  await page.goto(url.toString(), { waitUntil: "domcontentloaded" });

  await expect(page.getByText("What applicants must include")).toBeVisible({
    timeout: 30_000,
  });
}

test("the recruiter meets the note, then requirements, then screening", async ({ page }) => {
  await login(page);
  await openPostJobApplicationCard(page);

  // DOM order, measured in the rendered page rather than read off the source.
  const order = await page.evaluate(() => {
    // Lower-cased because the requirements heading is CSS-uppercased, and
    // innerText returns the transformed text rather than the source string.
    const text = document.body.innerText.toLowerCase();
    return {
      note: text.indexOf("public how-to-apply note"),
      requirements: text.indexOf("what applicants must include"),
      screening: text.indexOf("screening questions"),
      duplicates: (text.match(/what applicants must include/g) || []).length,
    };
  });

  expect(order.note, "the note heading is missing").toBeGreaterThan(-1);
  expect(order.requirements).toBeGreaterThan(order.note);
  expect(order.screening).toBeGreaterThan(order.requirements);
  // Exactly one requirements section; a read-only duplicate once sat here too.
  expect(order.duplicates).toBe(1);

  // Accessibility-tree order, from Playwright's ARIA snapshot of the live page.
  // This is a rendered accessibility tree, not a source read — but it is not a
  // screen reader, and is not claimed as one.
  const aria = (await page.locator("body").ariaSnapshot()).toLowerCase();
  const aNote = aria.indexOf("public how-to-apply note");
  const aReq = aria.indexOf("what applicants must include");
  const aScreen = aria.indexOf("screening questions");
  expect(aNote, "the note is absent from the accessibility tree").toBeGreaterThan(-1);
  expect(aReq).toBeGreaterThan(aNote);
  expect(aScreen).toBeGreaterThan(aReq);

  await page.screenshot({ path: `${SHOTS}/post-job-order.png`, fullPage: true });
});

test("keyboard traversal reaches requirements before screening", async ({ page }) => {
  await login(page);
  await openPostJobApplicationCard(page);

  // The card prefixes its ids with useId(), so match the stable suffix.
  await page.locator('[id$="-how-to-apply"]').first().focus();

  // Tab forward until a screening control is reached, recording what came
  // first. A requirement checkbox must appear before any screening control.
  let sawRequirement = false;
  let sawScreeningFirst = false;
  for (let i = 0; i < 60; i += 1) {
    await page.keyboard.press("Tab");
    const where = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return { requirement: false, screening: false };
      return {
        requirement: Boolean(el.closest("[data-quality-target='job-first-message']")),
        screening: Boolean(el.closest("[data-screening-questions]")) ||
          (el.getAttribute("placeholder") || "").toLowerCase().includes("question"),
      };
    });
    if (where.requirement) sawRequirement = true;
    if (where.screening && !sawRequirement) sawScreeningFirst = true;
    if (where.screening && sawRequirement) break;
  }

  expect(sawRequirement, "tabbing never reached an applicant-requirement control").toBeTruthy();
  expect(sawScreeningFirst, "a screening control received focus before requirements").toBeFalsy();
});

for (const vp of WIDTHS) {
  test(`the application card holds together at ${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await login(page);
    await openPostJobApplicationCard(page);

    await page.screenshot({ path: `${SHOTS}/post-job-${vp.name}.png`, fullPage: true });

    const body = await page.locator("body").innerText();
    // The controls removed earlier must not have crept back in.
    for (const gone of [
      "Application route",
      "Apply on another site",
      "External application URL",
      "Application deadline",
      "Add timeline",
    ]) {
      expect(body, `${gone} reappeared at ${vp.name}`).not.toContain(gone);
    }

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow, `${vp.name} scrolls horizontally`).toBeLessThanOrEqual(1);
  });
}

test("the recruiter can read the answers a candidate submitted", async ({ page }) => {
  await login(page);

  // The controller owns no listings, so applications arrive for the recruiter
  // persona instead.
  await page.getByTestId("qa-persona-open").click();
  await expect(page.getByTestId("qa-persona-drawer")).toBeVisible();
  await page.getByTestId("qa-switch-recruiter-active").click();
  // Wait for the identity to actually change; the drawer closing is not proof,
  // and the session token is what the API call below depends on.
  await expect(page.getByTestId("qa-persona-open")).not.toContainText("Guhan QA Controller", {
    timeout: 30_000,
  });

  const session = (await (await page.request.get("/api/auth/session")).json()) as {
    backendAccessToken?: string;
  };
  const received = await page.request.get(`${BACKEND}/me/applications/received`, {
    headers: { Authorization: `Bearer ${session.backendAccessToken}` },
  });
  expect(received.ok(), await received.text()).toBeTruthy();
  const rows = (await received.json()) as Array<{
    id: string;
    first_message_answers?: Record<string, unknown>;
  }>;
  const withAnswers = rows.find(
    (row) => Object.keys(row.first_message_answers ?? {}).length > 0
  );
  if (!withAnswers) {
    test.skip(true, "this persona has received no application carrying answers");
  }

  // Browser proof, not only the API: the workspace must surface the answers.
  // The workspace opens in Pipeline; the per-application conversation with its
  // submitted details lives in the Inbox view.
  await page.goto("/applications?view=inbox&mode=recruiter&direction=received", {
    waitUntil: "domcontentloaded",
  });

  // Prove the browser surface for the same record the API established carries
  // answers. Row order is activity-driven and the first record may legitimately
  // be an unrelated historical application with no submitted requirements.
  const row = page.locator(
    `[data-testid="interaction-row"][data-record-id="${withAnswers!.id}"]`
  );
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.click();

  // At least one submitted standard detail must be readable to the recruiter.
  const labels = Object.keys(withAnswers!.first_message_answers ?? {});
  const readable = [
    "Expected rate",
    "Relevant portfolio",
    "Turnaround",
    "Working hours",
    "Relevant experience",
    "Tools",
    "Start availability",
    "Fit note",
  ];
  await expect(async () => {
    const body = await page.locator("body").innerText();
    const found = readable.filter((label) => body.includes(label));
    expect(
      found.length,
      `no submitted requirement was visible to the recruiter (answers on record: ${labels.join(", ")})`
    ).toBeGreaterThan(0);
  }).toPass({ timeout: 30_000 });

  await page.screenshot({ path: `${SHOTS}/recruiter-application.png`, fullPage: true });
});
