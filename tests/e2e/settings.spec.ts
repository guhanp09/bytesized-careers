import { expect, test, type BrowserContext, type Page, type Route } from "@playwright/test";
import { encode } from "next-auth/jwt";

const SESSION_SECRET = "e2e-secret";

async function signInAsOwner(context: BrowserContext, overrides: Record<string, unknown> = {}) {
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
      ...overrides,
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

  test("renders the redesigned settings surface with only functional rows", async ({ page, context }) => {
    await signInAsOwner(context);

    await page.goto("/settings", { waitUntil: "domcontentloaded" });

    for (const id of [
      "account",
      "profile-visibility",
      "work-preferences",
      "connected-accounts",
      "notifications",
      "security",
      "data-support",
    ]) {
      await expect(page.getByTestId(`settings-section-${id}`)).toBeVisible();
    }

    // The plan row states the honest beta pricing position.
    await expect(page.getByTestId("settings-row-account-plan")).toContainText("no payment method");

    // Account deletion is truthful: routed through support, not a fake control.
    const deleteRow = page.getByTestId("settings-row-support-delete-account");
    await expect(deleteRow).toContainText("support team");
    await expect(deleteRow.getByRole("link", { name: "Contact support" })).toHaveAttribute("href", "/support");

    // Security reflects the real session: Google sign-in, no password reset row.
    await expect(page.getByTestId("settings-row-security-signin-method")).toContainText("Google");
    await expect(page.getByTestId("settings-row-security-password-reset")).toHaveCount(0);

    // No dead placeholder rows anywhere on the page.
    await expect(page.getByRole("button", { name: "Disabled" })).toHaveCount(0);
    await expect(page.getByText("Coming soon")).toHaveCount(0);
    await expect(page.getByText("Requires backend")).toHaveCount(0);
    await expect(page.getByText("Not wired yet")).toHaveCount(0);
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

    // Copying the public profile link confirms inline without navigation.
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const publicProfileRow = page.getByTestId("settings-row-account-public-profile");
    await publicProfileRow.getByRole("button", { name: "Copy link" }).click();
    await expect(publicProfileRow).toContainText("Link copied");
    await expect(page).toHaveURL(/\/settings$/);
  });

  test("signs out from the security section", async ({ page, context }) => {
    // Sign-out + auth-redirect roundtrips are slow while the whole suite loads
    // the shared server; give this flow the extended budget.
    test.slow();
    await signInAsOwner(context);

    await page.goto("/settings", { waitUntil: "domcontentloaded" });
    await page.getByTestId("settings-row-security-sign-out").getByRole("button", { name: "Sign out" }).click();

    await page.waitForURL("**/");
    // The session is gone: revisiting settings now redirects to login.
    await page.goto("/settings", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/auth\?mode=login&next=%2Fsettings$/);
  });

  test("credentials users can send a password reset email", async ({ page, context }) => {
    await signInAsOwner(context, { provider: "credentials", providerAccountId: undefined });

    await page.route("**/api/v1/auth/password-reset/request", async (route) => {
      await fulfillJson(route, {
        ok: true,
        message: "If an account exists for this email, we sent a password reset link.",
      });
    });

    await page.goto("/settings", { waitUntil: "domcontentloaded" });

    const resetRow = page.getByTestId("settings-row-security-password-reset");
    await expect(resetRow).toContainText("owner-e2e@example.com");
    await expect(page.getByTestId("settings-row-security-signin-method")).toContainText("Email & password");

    await resetRow.getByRole("button", { name: "Send reset email" }).click();
    await expect(resetRow).toContainText("Reset link sent");
    await expect(resetRow.getByRole("button", { name: "Sent" })).toBeDisabled();
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
