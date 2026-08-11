import { expect, type Page } from "@playwright/test";

export const CONTROLLER_EMAIL = "qa-controller@example.com";
export const CONTROLLER_PASSWORD = "LocalQaController123!";
export const BACKEND = "http://127.0.0.1:8100/api/v1";
export const ENRICH_MUTATION = /\/api\/v1\/jobs\/[^/]+\/brand-about\/enrich$/;

export const GROUNDED_SUMMARY =
  "Finance Simplified publishes personal finance videos for young adults interested in budgeting and investing.";

export type ProbeState = {
  searches: number;
  fetches: number;
  model_calls: number;
  gated: boolean;
  started: boolean;
};

type HiringIdentity = {
  id: string;
  display_name: string;
  url?: string | null;
  description?: string | null;
};

export async function login(page: Page) {
  await page.goto("/auth?mode=login", { waitUntil: "domcontentloaded" });
  await page.getByPlaceholder("Email").fill(CONTROLLER_EMAIL);
  await page.getByPlaceholder("Password").fill(CONTROLLER_PASSWORD);
  await page.locator("form").getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page).toHaveURL(/\/you/);
}

export async function backendToken(page: Page): Promise<string> {
  const session = await page.request.get("/api/auth/session");
  const body = await session.json();
  const token = body?.backendAccessToken || body?.accessToken;
  expect(token, "no backend token on the session").toBeTruthy();
  return token as string;
}

export async function ensureIdentity(
  page: Page,
  displayName = "Finance Simplified",
  options: { url?: string | null; description?: string | null } = {}
): Promise<string> {
  const token = await backendToken(page);
  const listed = await page.request.get(`${BACKEND}/me/hiring-identities`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(listed.ok(), `identity list: ${await listed.text()}`).toBeTruthy();
  const matches = ((await listed.json()) as { items: HiringIdentity[] }).items.filter(
    (identity) => identity.display_name === displayName
  );
  expect(matches.length, `duplicate ${displayName} identities make the test ambiguous`).toBeLessThanOrEqual(1);

  if (matches.length === 1) {
    const identity = matches[0];
    const desiredUrl = options.url ?? null;
    const desiredDescription = options.description ?? null;
    if (
      (identity.url ?? null) !== desiredUrl ||
      (identity.description ?? null) !== desiredDescription
    ) {
      const updated = await page.request.patch(
        `${BACKEND}/me/hiring-identities/${identity.id}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          data: { url: desiredUrl, description: desiredDescription },
        }
      );
      expect(updated.ok(), `identity update: ${await updated.text()}`).toBeTruthy();
    }
    return identity.id;
  }

  const created = await page.request.post(`${BACKEND}/me/hiring-identities`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      type: "INDIVIDUAL_CHANNEL",
      platform: "YOUTUBE",
      display_name: displayName,
      // The identity API requires a stable channel locator. A handle satisfies
      // that product rule without supplying the official website that this
      // test is explicitly asking discovery to find.
      handle: `@${displayName.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 40)}`,
      url: options.url ?? null,
      description: options.description ?? null,
    },
  });
  expect(created.ok(), `identity create: ${await created.text()}`).toBeTruthy();
  return ((await created.json()) as HiringIdentity).id;
}

export async function createNativeDraft(page: Page, title: string): Promise<string> {
  const token = await backendToken(page);
  const response = await page.request.post(`${BACKEND}/jobs`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { title, status: "draft" },
  });
  expect(response.ok(), `draft create: ${await response.text()}`).toBeTruthy();
  return ((await response.json()) as { id: string }).id;
}

export async function patchJob(
  page: Page,
  jobId: string,
  data: Record<string, unknown>
) {
  const token = await backendToken(page);
  const response = await page.request.patch(`${BACKEND}/jobs/${jobId}`, {
    headers: { Authorization: `Bearer ${token}` },
    data,
  });
  expect(response.ok(), `job patch: ${await response.text()}`).toBeTruthy();
  return response;
}

export async function armProbe(
  page: Page,
  options: {
    gated?: boolean;
    mode?: "success" | "search_failure" | "fetch_failure" | "model_decline";
    summary?: string;
  } = {}
) {
  const response = await page.request.post(`${BACKEND}/dev/brand-enrichment/arm`, {
    data: {
      gated: options.gated ?? false,
      mode: options.mode ?? "success",
      summary: options.summary ?? GROUNDED_SUMMARY,
    },
  });
  expect(response.ok(), `probe arm: ${await response.text()}`).toBeTruthy();
}

export async function releaseProbe(page: Page) {
  const response = await page.request.post(`${BACKEND}/dev/brand-enrichment/release`);
  expect(response.ok(), `probe release: ${await response.text()}`).toBeTruthy();
}

export async function probeState(page: Page): Promise<ProbeState> {
  const response = await page.request.get(`${BACKEND}/dev/brand-enrichment/state`);
  expect(response.ok(), `probe state: ${await response.text()}`).toBeTruthy();
  return (await response.json()) as ProbeState;
}

export async function waitForAttemptStarted(page: Page) {
  await expect
    .poll(async () => (await probeState(page)).started, { timeout: 30_000 })
    .toBe(true);
}

export async function getBrandAboutState(page: Page, jobId: string) {
  const token = await backendToken(page);
  const response = await page.request.get(`${BACKEND}/jobs/${jobId}/brand-about/state`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(response.ok(), `brand state: ${await response.text()}`).toBeTruthy();
  return (await response.json()) as { status: string; about_channel: string | null };
}

export async function waitForGeneratedAbout(page: Page, jobId: string): Promise<string> {
  await expect
    .poll(async () => (await getBrandAboutState(page, jobId)).status, {
      timeout: 30_000,
    })
    .toBe("success");
  const state = await getBrandAboutState(page, jobId);
  expect(state.about_channel, "generated About was not persisted").toBeTruthy();
  return state.about_channel as string;
}

/** Import a URL-shaped fixture and explicitly hand its private draft to Post Job. */
export async function importBrandDiscoveryDraft(page: Page): Promise<string> {
  await page.goto("/post-job/import", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("import-development-scenario")).toBeVisible();
  await page.getByTestId("import-development-scenario").selectOption("brand-discovery");
  await page.getByTestId("open-import-review-fixture").click();
  const open = page.getByRole("button", { name: /Open job draft/i }).first();
  await expect(open).toBeVisible({ timeout: 90_000 });
  await open.click();
  await expect.poll(() => new URL(page.url()).pathname, { timeout: 60_000 }).toBe("/post-job");
  const jobId = new URL(page.url()).searchParams.get("draftId");
  expect(jobId, "the import handoff did not create a native draft").toBeTruthy();
  return jobId as string;
}

export async function openDraft(
  page: Page,
  jobId: string,
  section: "about" | "basics" = "about"
) {
  await page.goto(`/post-job?draftId=${jobId}&section=${section}`, {
    waitUntil: "domcontentloaded",
  });
  const anchor = section === "about" ? page.locator("#job-about-brand") : page.locator("#job-title");
  await expect(anchor.first()).toBeVisible({ timeout: 60_000 });
}

export async function saveDraft(page: Page) {
  await page.getByRole("button", { name: /save draft/i }).first().click();
  await expect.poll(() => new URL(page.url()).pathname, { timeout: 30_000 }).toBe("/drafts");
}

/** Observe forbidden legacy client mutations without intercepting product traffic. */
export function countClientEnrichmentMutations(page: Page): string[] {
  const paths: string[] = [];
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (request.method() === "POST" && ENRICH_MUTATION.test(pathname)) paths.push(pathname);
  });
  return paths;
}

export async function noHorizontalDocumentOverflow(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const root = document.documentElement;
    return root.scrollWidth - root.clientWidth <= 1;
  });
}
