import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

const BACKEND = "http://127.0.0.1:8100/api/v1";

type PersonaCatalog = {
  password: string;
  personas: Array<{ key: string; email: string }>;
};

type HiringIdentity = {
  id: string;
  display_name: string;
  is_agency_represented: boolean;
  verification_status: string;
};

type CreatedJob = {
  id: string;
  title: string;
  posted_by_agency: boolean;
  channel_profile_slug?: string | null;
  agency_profile_slug?: string | null;
};

async function personaCredentials(request: APIRequestContext, personaKey: string) {
  const catalogResponse = await request.get(`${BACKEND}/dev/personas`);
  expect(catalogResponse.ok(), await catalogResponse.text()).toBeTruthy();
  const catalog = (await catalogResponse.json()) as PersonaCatalog;
  const persona = catalog.personas.find((item) => item.key === personaKey);
  expect(persona, `missing ${personaKey} from the disposable QA persona catalog`).toBeTruthy();
  return { email: persona!.email, password: catalog.password };
}

async function personaToken(request: APIRequestContext, personaKey: string): Promise<string> {
  const credentials = await personaCredentials(request, personaKey);
  const login = await request.post(`${BACKEND}/auth/login`, {
    data: credentials,
  });
  expect(login.ok(), await login.text()).toBeTruthy();
  return String((await login.json()).access_token);
}

async function verifiedIdentity(
  request: APIRequestContext,
  token: string,
  expectedName: string,
  represented: boolean,
): Promise<HiringIdentity> {
  const response = await request.get(`${BACKEND}/me/hiring-identities`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  const identities = ((await response.json()) as { items: HiringIdentity[] }).items;
  const matches = identities.filter(
    (identity) =>
      identity.display_name === expectedName &&
      identity.is_agency_represented === represented &&
      identity.verification_status === "VERIFIED",
  );
  expect(matches, `expected one verified ${expectedName} identity`).toHaveLength(1);
  return matches[0];
}

async function videoEditorRoleId(request: APIRequestContext): Promise<string> {
  const response = await request.get(`${BACKEND}/roles`);
  expect(response.ok(), await response.text()).toBeTruthy();
  const roles = (await response.json()) as { items: Array<{ id: string; name: string }> };
  const role = roles.items.find((item) => item.name === "Video Editor");
  expect(role, "the QA role seed must include Video Editor").toBeTruthy();
  return role!.id;
}

async function createPublishedJob(
  request: APIRequestContext,
  token: string,
  identityId: string,
  title: string,
  roleId: string,
): Promise<CreatedJob> {
  const response = await request.post(`${BACKEND}/jobs`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      title,
      primary_role_id: roleId,
      role_specialization: "Profile navigation QA",
      engagement_type: "one_time_project",
      platforms: ["youtube"],
      work_mode: "remote",
      start_timeframe: "ASAP",
      compensation_mode: "range",
      budget_amount: 1000,
      budget_max: 1500,
      budget_currency: "USD",
      budget_unit: "per video",
      deliverables: [{ type: "long_form_video", quantity: 1, frequency: "per_week" }],
      turnaround_value: 5,
      turnaround_unit: "business_days",
      turnaround_basis: "first_draft",
      about_channel: "A deterministic QA listing used to verify public profile navigation.",
      responsibilities: ["Keep public recruiter attribution connected to its owner profile"],
      requirements: ["Use the canonical CreatorJobs profile route"],
      application_mode: "internal",
      hiring_identity_id: identityId,
      status: "published",
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()) as CreatedJob;
}

async function archiveJob(request: APIRequestContext, token: string, jobId?: string) {
  if (!jobId) return;
  const response = await request.delete(`${BACKEND}/jobs/${jobId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(response.ok(), `cleanup failed for job ${jobId}: ${await response.text()}`).toBeTruthy();
}

async function expectHiringProfile(
  page: Page,
  username: string,
  displayName: string,
  jobTitle: string,
) {
  await page.goto(`/u/${username}?view=hiring`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: displayName, exact: true })).toBeVisible();
  await expect(page.getByRole("main").getByRole("button", { name: "Recruiter" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByText(jobTitle, { exact: true }).first()).toBeVisible();
}

test("real recruiter and agency jobs retain canonical public-profile entry links", async ({
  page,
  request,
}) => {
  const namespace = randomUUID();
  const directTitle = `Direct profile navigation ${namespace}`;
  const agencyTitle = `Agency profile navigation ${namespace}`;
  const directToken = await personaToken(request, "recruiter-active");
  const agencyToken = await personaToken(request, "recruiter-drafts");
  const talentToken = await personaToken(request, "talent-complete");
  const roleId = await videoEditorRoleId(request);
  const directIdentity = await verifiedIdentity(
    request,
    directToken,
    "Finance Simplified",
    false,
  );
  const agencyIdentity = await verifiedIdentity(request, agencyToken, "FitLab", true);
  let directJob: CreatedJob | undefined;
  let agencyJob: CreatedJob | undefined;
  let agencyApplicationId: string | undefined;

  try {
    directJob = await createPublishedJob(
      request,
      directToken,
      directIdentity.id,
      directTitle,
      roleId,
    );
    agencyJob = await createPublishedJob(
      request,
      agencyToken,
      agencyIdentity.id,
      agencyTitle,
      roleId,
    );

    expect(directJob).toMatchObject({
      posted_by_agency: false,
      channel_profile_slug: "dev_recruiter",
      agency_profile_slug: null,
    });
    expect(agencyJob).toMatchObject({
      posted_by_agency: true,
      channel_profile_slug: null,
      agency_profile_slug: "dev_brightlab",
    });

    await expectHiringProfile(page, "dev_recruiter", "Finance Simplified", directTitle);
    await expectHiringProfile(page, "dev_brightlab", "BrightLab Media", agencyTitle);
    const hiringForRails = await page.getByLabel("Hiring For channels").all();
    expect(hiringForRails.length).toBeGreaterThan(0);
    for (const hiringFor of hiringForRails) {
      await expect(hiringFor).toContainText("FitLab");
      await expect(hiringFor).not.toContainText("Science Daily");
      await expect(hiringFor).not.toContainText("Science Daily IG (agency)");
    }

    await page.goto("/jobs", { waitUntil: "domcontentloaded" });
    const directCard = page.locator('[role="link"][title="Open job"]:visible').filter({ hasText: directTitle }).first();
    await expect(directCard).toBeVisible();
    await expect(
      directCard.getByRole("link", { name: "Open Finance Simplified CreatorJobs profile" }),
    ).toHaveAttribute("href", "/u/dev_recruiter?view=hiring");
    await expect(
      directCard.getByRole("link", { name: "Open Finance Simplified channel or page" }),
    ).toHaveCount(0);

    const agencyCard = page.locator('[role="link"][title="Open job"]:visible').filter({ hasText: agencyTitle }).first();
    await expect(agencyCard).toBeVisible();
    await expect(
      agencyCard.getByRole("link", { name: "Open FitLab channel or page" }),
    ).toHaveAttribute("href", "https://www.youtube.com/@fitlab");
    const agencyProfileLink = agencyCard.getByRole("link", {
      name: "Open BrightLab Media CreatorJobs profile",
    });
    await expect(agencyProfileLink).toHaveAttribute("href", "/u/dev_brightlab?view=hiring");
    await agencyProfileLink.click();
    await expect(page).toHaveURL(/\/u\/dev_brightlab\?view=hiring$/);
    await expect(page.getByRole("heading", { name: "BrightLab Media", exact: true })).toBeVisible();

    await page.goto(`/jobs/${directJob.id}`, { waitUntil: "domcontentloaded" });
    await expect(
      page.getByTestId("posted-by-card").getByRole("link", {
        name: "Open Finance Simplified CreatorJobs profile",
      }),
    ).toHaveAttribute("href", "/u/dev_recruiter?view=hiring");

    await page.goto(`/jobs/${agencyJob.id}`, { waitUntil: "domcontentloaded" });
    await expect(
      page.getByTestId("posted-by-card").getByRole("link", {
        name: "Open BrightLab Media CreatorJobs profile",
      }),
    ).toHaveAttribute("href", "/u/dev_brightlab?view=hiring");

    const applicationResponse = await request.post(
      `${BACKEND}/jobs/${agencyJob.id}/applications`,
      {
        headers: { Authorization: `Bearer ${talentToken}` },
        data: {
          cover_note: `Profile navigation QA ${namespace}`,
          portfolio_item_ids: [],
          first_message_answers: {},
        },
      },
    );
    expect(applicationResponse.status(), await applicationResponse.text()).toBe(201);
    agencyApplicationId = String((await applicationResponse.json()).id);

    const talentCredentials = await personaCredentials(request, "talent-complete");
    await page.goto("/auth?mode=login", { waitUntil: "domcontentloaded" });
    await page.getByPlaceholder("Email").fill(talentCredentials.email);
    await page.getByPlaceholder("Password").fill(talentCredentials.password);
    await page.locator("form").getByRole("button", { name: "Log in", exact: true }).click();
    await expect(page).toHaveURL(/\/you/);

    await page.goto(
      `/applications?view=inbox&mode=talent&direction=sent&thread=${agencyApplicationId}`,
      { waitUntil: "domcontentloaded" },
    );
    const inboxHeader = page.getByTestId("applications-detail-header");
    await expect(inboxHeader.getByRole("link", { name: /BrightLab Media/ })).toHaveAttribute(
      "href",
      "/u/dev_brightlab?view=hiring",
    );

    await page.goto("/applications?view=pipeline&mode=talent&direction=sent", {
      waitUntil: "domcontentloaded",
    });
    const pipelineRow = page.locator(
      `[data-testid="pipeline-row"][data-record-id="${agencyApplicationId}"]`,
    );
    await expect(pipelineRow).toBeVisible();
    await expect(pipelineRow).toContainText("BrightLab Media");
    await expect(pipelineRow.getByTestId("pipeline-profile-link")).toHaveAttribute(
      "href",
      "/u/dev_brightlab?view=hiring",
    );
  } finally {
    if (agencyApplicationId) {
      const withdrawn = await request.post(`${BACKEND}/applications/${agencyApplicationId}/withdraw`, {
        headers: { Authorization: `Bearer ${talentToken}` },
      });
      expect(withdrawn.ok(), `application cleanup failed: ${await withdrawn.text()}`).toBeTruthy();
    }
    await archiveJob(request, directToken, directJob?.id);
    await archiveJob(request, agencyToken, agencyJob?.id);
  }
});
