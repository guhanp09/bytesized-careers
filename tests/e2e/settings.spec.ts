import { expect, test, type BrowserContext, type Page, type Route } from "@playwright/test";
import { encode } from "next-auth/jwt";

const SESSION_SECRET = "e2e-secret";

async function signInAsOwner(context: BrowserContext) {
  const sessionToken = await encode({
    token: {
      name: "Demo Owner",
      email: "owner-e2e@example.com",
      sub: "e2e-owner",
      username: "demo-owner",
      displayName: "Demo Owner",
      backendAccessToken: "e2e-offline-token",
      backendTokenType: "bearer",
      backendUserId: "e2e-owner",
      accountType: "BOTH",
      onboardingIntent: "BOTH",
      provider: "google",
      providerAccountId: "google-demo-owner",
    },
    secret: SESSION_SECRET,
  });
  await context.addCookies([
    {
      name: "next-auth.session-token",
      value: sessionToken,
      domain: "127.0.0.1",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,PATCH,OPTIONS",
  "access-control-allow-headers": "authorization,content-type",
  "content-type": "application/json",
};

async function fulfillJson(route: Route, payload: unknown, status = 200) {
  if (route.request().method() === "OPTIONS") {
    await route.fulfill({ status: 204, headers: corsHeaders, body: "" });
    return;
  }
  await route.fulfill({ status, headers: corsHeaders, body: JSON.stringify(payload) });
}

function profile(overrides: Record<string, unknown> = {}) {
  return {
    id: "e2e-owner",
    email: "owner-e2e@example.com",
    account_type: "BOTH",
    account_type_selected_at: null,
    onboarding_intent: "BOTH",
    onboarding_intent_selected_at: null,
    username: "demo-owner",
    username_change_count: 0,
    username_last_changed_at: null,
    display_name: "Demo Owner",
    headline: null,
    bio: null,
    skills: [],
    public_links: [],
    experience: [],
    availability_status: "selective",
    location: "Chennai, Tamil Nadu, India",
    timezone: "IST",
    avatar_mode: "generic",
    avatar_url: null,
    avatar_youtube_channel_id: null,
    banner_url: null,
    social_connections: {
      youtube: { connected: false },
      instagram: { connected: false, handle: null, url: null },
    },
    stats: {
      jobs_posted_count: 0,
      jobs_completed_count: 0,
      projects_count: 0,
      reviews_count: 0,
    },
    reviews: { avg_rating: 0, review_count: 0 },
    review_items: [],
    collaboration_preferences: {
      project_type_preference: null,
      turnaround: null,
      revisions: null,
      working_hours: "Flexible working hours",
      tools: null,
      styles: [],
      work_mode: null,
    },
    hiring_info: {
      hiring_type: null,
      website_or_social_url: null,
      primary_platform: null,
      platforms: [],
      niches: [],
      genres: [],
      formats: [],
      channels_or_pages_managed: null,
    },
    creator_platforms: [],
    roles: [],
    role_answers_summary: [],
    content_style: { primary_niche: null, format: [], tone: [], target_audience: null, editing_complexity: null },
    privacy_settings: {
      show_bio: true,
      show_links: true,
      show_skills: true,
      show_location: false,
      show_availability: false,
      show_youtube_badge: true,
    },
    profile_capabilities: {
      canApplyToJobs: false,
      canPostJobs: false,
      hasPortfolio: false,
      hasPublicProfile: true,
      hasHiringIdentity: false,
      hasVerifiedSocialOrChannel: false,
      isAdmin: false,
      applyMissingSections: [],
      postMissingSections: [],
    },
    can_change_username: true,
    username_next_change_at: null,
    ...overrides,
  };
}

function me(overrides: Record<string, unknown> = {}) {
  return {
    id: "e2e-owner",
    email: "owner-e2e@example.com",
    username: "demo-owner",
    display_name: "Demo Owner",
    account_type: "BOTH",
    account_type_selected_at: null,
    onboarding_intent: "BOTH",
    onboarding_intent_selected_at: null,
    profile_capabilities: {
      canApplyToJobs: false,
      canPostJobs: false,
      hasPortfolio: false,
      hasPublicProfile: true,
      hasHiringIdentity: false,
      hasVerifiedSocialOrChannel: false,
      isAdmin: false,
      applyMissingSections: [],
      postMissingSections: [],
    },
    email_verified: true,
    verified_youtube_channels: [],
    ...overrides,
  };
}

async function mockSettingsMutations(page: Page) {
  await page.route("**/api/v1/me/profile", async (route) => {
    const request = route.request();
    if (request.method() === "PATCH") {
      const body = JSON.parse(request.postData() || "{}");
      await fulfillJson(route, profile({
        display_name: body.display_name ?? "Demo Owner",
        username: body.username ?? "demo-owner",
      }));
      return;
    }
    await fulfillJson(route, profile());
  });

  await page.route("**/api/v1/me/privacy", async (route) => {
    const body = route.request().method() === "PATCH" ? JSON.parse(route.request().postData() || "{}") : {};
    await fulfillJson(route, profile({
      privacy_settings: {
        show_bio: body.show_bio ?? true,
        show_links: true,
        show_skills: true,
        show_location: false,
        show_availability: false,
        show_youtube_badge: true,
      },
    }));
  });

  await page.route("**/api/v1/me/onboarding-intent", async (route) => {
    const body = route.request().method() === "PATCH" ? JSON.parse(route.request().postData() || "{}") : {};
    await fulfillJson(route, me({ onboarding_intent: body.onboarding_intent || "BOTH" }));
  });

  await page.route("**/api/v1/me/youtube/refresh", async (route) => {
    await fulfillJson(route, {
      status: "ok",
      channels: [
        {
          id: "channel-1",
          channel_id: "UC-settings-e2e",
          title: "Settings E2E Channel",
          thumbnail_url: null,
        },
      ],
    });
  });

  await page.route("**/api/v1/notifications/mark-all-read", async (route) => {
    await fulfillJson(route, { status: "ok" });
  });
}

test.describe("Settings page", () => {
  test("signed-out users are redirected to login with the settings return path", async ({ page }) => {
    await page.goto("/settings", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/auth\?mode=login&next=%2Fsettings$/);
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  });

  test("authenticated users can open Settings from the profile dropdown", async ({ page, context }) => {
    await signInAsOwner(context);

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Profile" }).click();
    await expect(page.getByRole("menu")).toContainText("Settings");

    await page.getByRole("button", { name: /Settings/ }).click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  });

  test("renders the full inline settings surface with future rows disabled", async ({ page, context }) => {
    await signInAsOwner(context);

    await page.goto("/settings", { waitUntil: "domcontentloaded" });

    for (const id of [
      "account",
      "profile-visibility",
      "marketplace",
      "connected-accounts",
      "notifications",
      "payments",
      "privacy-data",
      "security",
      "preferences",
      "support-legal",
    ]) {
      await expect(page.getByTestId(`settings-section-${id}`)).toBeVisible();
    }

    await expect(page.getByText("CreatorJobs beta does not require a payment method")).toBeVisible();
    await expect(page.getByTestId("settings-row-privacy-delete")).toContainText("Requires backend");
    await expect(page.getByTestId("settings-row-privacy-delete").getByRole("button", { name: "Disabled" })).toBeDisabled();
  });

  test("edits supported account and privacy settings inline without leaving settings", async ({ page, context }) => {
    await signInAsOwner(context);
    await mockSettingsMutations(page);

    await page.goto("/settings", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/settings$/);

    await page.getByTestId("settings-row-account-display-name").getByRole("button", { name: "Edit" }).click();
    await page.getByLabel("Display name").fill("Inline Owner");
    await page.getByTestId("settings-row-account-display-name").getByRole("button", { name: "Save" }).click();
    await expect(page.getByTestId("settings-row-account-display-name")).toContainText("Inline Owner");
    await expect(page).toHaveURL(/\/settings$/);

    await page.getByTestId("settings-row-account-username").getByRole("button", { name: "Edit" }).click();
    await page.getByTestId("settings-row-account-username").locator("input").fill("https://bad.example");
    await page.getByTestId("settings-row-account-username").getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Use your profile username, not a URL.")).toBeVisible();
    await page.getByTestId("settings-row-account-username").locator("input").fill("inline_owner");
    await page.getByTestId("settings-row-account-username").getByRole("button", { name: "Save" }).click();
    await expect(page.getByTestId("settings-row-account-username")).toContainText("@inline_owner");
    await expect(page).toHaveURL(/\/settings$/);

    await page.getByTestId("settings-row-account-onboarding").getByRole("button", { name: "Edit" }).click();
    await page.getByRole("button", { name: /Getting hired/ }).click();
    await page.getByTestId("settings-row-account-onboarding").getByRole("button", { name: "Save" }).click();
    await expect(page.getByTestId("settings-row-account-onboarding")).toContainText("Getting hired");
    await expect(page).toHaveURL(/\/settings$/);

    await page.getByTestId("settings-row-privacy-show_bio").getByRole("switch", { name: "Toggle Bio" }).click();
    await expect(page.getByTestId("settings-row-privacy-show_bio")).toContainText("Hidden");
    await expect(page).toHaveURL(/\/settings$/);
  });

  test("refreshes connected YouTube channels inline", async ({ page, context }) => {
    await signInAsOwner(context);
    await mockSettingsMutations(page);

    await page.goto("/settings", { waitUntil: "domcontentloaded" });
    await page.getByTestId("settings-row-connected-youtube").getByRole("button", { name: /Refresh/ }).click();

    await expect(page.getByTestId("settings-row-connected-youtube")).toContainText("Settings E2E Channel");
    await expect(page).toHaveURL(/\/settings$/);
  });

  test("does not horizontally overflow on mobile", async ({ page, context }) => {
    await signInAsOwner(context);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/settings", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(150);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(2);
  });
});
