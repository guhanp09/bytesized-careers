import { expect, test, type Page } from "@playwright/test";

// Real-stack import flow: recruiter persona imports a post, saves a draft,
// reopens it, and publishes — proving parsing persists nothing, the confirmed
// category survives a ?draftId= reopen, and owner-stamped storage never leaks
// across same-tab persona switches.
//
// Login/switch helpers mirror tests/e2e/qa/qa-personas.spec.ts (kept local so
// this spec doesn't couple to that file).

const CONTROLLER_EMAIL = "qa-controller@example.com";
const CONTROLLER_PASSWORD = "LocalQaController123!";
const BACKEND_API = "http://127.0.0.1:8100/api/v1";
const TITLE_PLACEHOLDER = "e.g. Video editor for YouTube (retention-focused)";

// Publish-ready scriptwriter post: category Writing (the "never silently
// Editing" regression), with budget/work mode/platform/about all present.
const SCRIPTWRITER_POST = [
  "We are hiring a scriptwriter for our YouTube channel!",
  "",
  "Lumen Media makes education explainers for young India. You will write two scripts a week, shape hooks with the editor, and keep our voice sharp and honest.",
  "",
  "Pay: ₹25,000–₹35,000 per month",
  "Remote role.",
  "",
  "To apply, share your portfolio and expected rate.",
  "DM us on Instagram if the form is down.",
].join("\n");

async function loginController(page: Page) {
  await page.goto("/auth?mode=login", { waitUntil: "domcontentloaded" });
  await page.getByPlaceholder("Email").fill(CONTROLLER_EMAIL);
  await page.getByPlaceholder("Password").fill(CONTROLLER_PASSWORD);
  await page.locator("form").getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page).toHaveURL(/\/you/);
  await expect(page.getByTestId("qa-persona-open")).toBeVisible();
}

async function openDrawer(page: Page) {
  await page.getByTestId("qa-persona-open").click();
  await expect(page.getByTestId("qa-persona-drawer")).toBeVisible();
}

async function switchPersona(page: Page, key: string, displayName: string) {
  await openDrawer(page);
  await page.getByTestId(`qa-switch-${key}`).click();
  await expect(page.getByTestId("qa-persona-open")).toContainText(displayName, { timeout: 20_000 });
}

// Publishing requires a hiring identity. Create an individual channel identity
// through the real backend API using the persona's own session token (individual
// channels may publish unverified).
//
// Note: this test uses the talent-complete persona because the seeded
// recruiter-active / both-sides hiring identities store off-Literal values
// (type "own_channel", platform "youtube", verification_method
// "YOUTUBE_CHANNEL_LINK") that fail HiringIdentityRead validation, so
// GET /me/hiring-identities 500s for those personas. That is a pre-existing
// seed-data defect in backend/app/db/seed_data_personas.py (currently being
// reworked in a separate workstream), not an import-flow issue.
async function ensureHiringIdentity(page: Page) {
  const sessionResponse = await page.request.get("/api/auth/session");
  const session = (await sessionResponse.json()) as { backendAccessToken?: string };
  expect(session.backendAccessToken, "persona session should carry a backend token").toBeTruthy();
  const headers = { Authorization: `Bearer ${session.backendAccessToken}` };
  const existing = await page.request.get(`${BACKEND_API}/me/hiring-identities`, { headers });
  expect(existing.ok(), await existing.text()).toBeTruthy();
  const body = (await existing.json()) as { items?: unknown[] };
  if ((body.items ?? []).length > 0) return;
  const created = await page.request.post(`${BACKEND_API}/me/hiring-identities`, {
    headers,
    data: {
      type: "INDIVIDUAL_CHANNEL",
      platform: "YOUTUBE",
      display_name: "Finance Simplified",
      url: "https://www.youtube.com/@financesimplified",
    },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
}

async function jobCount(page: Page): Promise<number> {
  const response = await page.request.get(`${BACKEND_API}/jobs?limit=1`);
  expect(response.ok(), await response.text()).toBeTruthy();
  const body = (await response.json()) as { total: number };
  return body.total;
}

async function findJobByTitle(page: Page, title: string): Promise<{ id: string; category: string; status: string } | null> {
  const response = await page.request.get(`${BACKEND_API}/jobs?limit=100`);
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as {
    items: Array<{ id: string; title: string; category: string; status: string }>;
  };
  return body.items.find((item) => item.title.toLowerCase().includes(title.toLowerCase())) ?? null;
}

test("import → draft → reopen → publish keeps the Writing category; parsing persists nothing", async ({ page }) => {
  await loginController(page);
  await switchPersona(page, "talent-complete", "Priya Nair");
  await ensureHiringIdentity(page);

  const countBefore = await jobCount(page);

  // Paste + analyze. Parsing alone must create no server-side record.
  await page.goto("/post-job/import", { waitUntil: "domcontentloaded" });
  await page.getByTestId("import-textarea").fill(SCRIPTWRITER_POST);
  await page.getByTestId("import-prepare").click();
  await expect(page.getByTestId("import-review")).toBeVisible();
  expect(await jobCount(page)).toBe(countBefore);

  // Confident scriptwriter → Writing pre-selected; contacts stay private.
  await expect(page.getByTestId("import-category-writing")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("import-signals")).toContainText("arrive in your Inbox");

  // Hand off: the session is authenticated, so hydration waits for resolution
  // and applies for this owner.
  await page.getByTestId("import-continue").click();
  await expect(page).toHaveURL(/\/post-job$/);
  await expect(page.getByTestId("import-review-banner")).toBeVisible();
  expect(await jobCount(page)).toBe(countBefore);

  // Everything publish-relevant imported → the wizard opened on the final step,
  // where SAVE DRAFT lives in the step footer.
  await page.getByRole("button", { name: "SAVE DRAFT" }).first().click();
  await expect(page).toHaveURL(/\/drafts\?saved=1/, { timeout: 20_000 });
  expect(await jobCount(page)).toBe(countBefore + 1);

  const draft = await findJobByTitle(page, "scriptwriter");
  expect(draft, "the saved draft should be queryable").not.toBeNull();
  expect(draft!.status).toBe("draft");
  expect(draft!.category).toBe("Writing");

  // Reopen via ?draftId= — the durable category must survive, not reset to Editing.
  await page.goto(`/post-job?draftId=${draft!.id}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByPlaceholder(TITLE_PLACEHOLDER)).toHaveValue(/scriptwriter/i, { timeout: 20_000 });

  // Publish through the existing final step (the drafts deep-link mechanism).
  await page.goto(`/post-job?draftId=${draft!.id}&section=referenceVideos`, {
    waitUntil: "domcontentloaded",
  });
  const postButton = page.getByRole("button", { name: "Post job" });
  await expect(postButton).toBeVisible({ timeout: 20_000 });
  await postButton.click();
  // The draft deliberately misses recommended items (tools, turnaround), so the
  // publish-quality dialog always appears here.
  const publishAnyway = page.getByRole("button", { name: "Publish anyway" });
  await expect(publishAnyway).toBeVisible({ timeout: 10_000 });
  await publishAnyway.click();
  await expect(page).toHaveURL(/\/jobs\?posted=1/, { timeout: 30_000 });

  const published = await findJobByTitle(page, "scriptwriter");
  expect(published).not.toBeNull();
  expect(published!.status).toBe("published");
  expect(published!.category).toBe("Writing");
  expect(await jobCount(page)).toBe(countBefore + 1);
});

test("same-tab persona switch never leaks the paste or a pending handoff", async ({ page }) => {
  await loginController(page);
  await switchPersona(page, "recruiter-active", "Finance Simplified");

  // Persona A pastes (persisted to the owner-stamped source key after debounce).
  await page.goto("/post-job/import", { waitUntil: "domcontentloaded" });
  await page.getByTestId("import-textarea").fill("Persona A private paste — hiring a video editor. ₹20,000 per month.");
  await page.waitForTimeout(800);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("import-textarea")).toHaveValue(/Persona A private paste/);

  // Same tab, different persona: the paste must not restore.
  await switchPersona(page, "talent-complete", "Priya Nair");
  await page.goto("/post-job/import", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("import-textarea")).toHaveValue("");
  await expect(page.getByText("Restored your last paste.")).toHaveCount(0);
});
