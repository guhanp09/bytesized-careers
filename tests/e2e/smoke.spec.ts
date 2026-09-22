import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { encode } from "next-auth/jwt";

const SESSION_SECRET = "e2e-secret";

async function signInAsCandidate(context: BrowserContext) {
  const sessionToken = await encode({
    token: {
      name: "Candidate E2E",
      email: "candidate-e2e@example.com",
      sub: "e2e-candidate",
      username: "candidate-e2e",
      displayName: "Candidate E2E",
      backendAccessToken: "e2e-offline-token",
      backendTokenType: "bearer",
      backendUserId: "e2e-candidate",
      accountType: "TALENT",
      provider: "google",
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
  "access-control-allow-methods": "GET,OPTIONS",
  "access-control-allow-headers": "authorization,content-type",
  "content-type": "application/json",
};

async function stubNoExistingApplication(page: Page, jobId: string) {
  await page.route(`**/api/v1/jobs/${jobId}/application`, async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: corsHeaders, body: "" });
      return;
    }
    await route.fulfill({ status: 200, headers: corsHeaders, body: "null" });
  });
}

const routeChecks = [
  { path: "/", text: "Recent Job Listings" },
  { path: "/jobs", text: "Video editor" },
  { path: "/jobs/1", text: "Long-form YouTube editor" },
  { path: "/talent", text: "Retention editor" },
  { path: "/talent/mock-talent-retention-editor", text: "RETENTION EDITOR" },
  { path: "/u/aarav-mehta", text: "Aarav Mehta" },
  { path: "/you", text: "Sign in to open your workspace." },
  { path: "/post", text: "Create talent listing" },
  { path: "/post-job", text: "Who are you hiring for?" },
  { path: "/post-talent", text: "Welcome back" },
  { path: "/support", text: "Contact CreatorJobs" },
  { path: "/terms", text: "Beta notice" },
  { path: "/privacy", text: "Public by design" },
  { path: "/auth", text: "Welcome back" },
];

for (const route of routeChecks) {
  test(`smoke loads ${route.path}`, async ({ page }) => {
    const response = await page.goto(route.path, { waitUntil: "domcontentloaded" });
    expect(response?.status(), `${route.path} should not server error`).toBeLessThan(500);
    await expect(page.locator("body")).not.toContainText(
      /Application error|Unhandled Runtime Error|Internal Server Error/i
    );
    await expect(page.getByText(route.text, { exact: false }).first()).toBeVisible();
  });
}

test("post chooser routes to both publishing flows", async ({ page }) => {
  await page.goto("/post");
  await page.getByRole("link", { name: "Post a job" }).click();
  await expect(page).toHaveURL(/\/post-job$/);
  await expect(page.getByRole("heading", { name: "Who are you hiring for?" })).toBeVisible();

  await page.goto("/post");
  await page.getByRole("link", { name: "Create talent listing" }).click();
  await expect(page).toHaveURL(/\/post-talent|\/auth/);
  await expect(page.locator("body")).toContainText(/Create talent listing|Welcome back/);
});

test("frontend health endpoint is deployment-check friendly", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.status()).toBe(200);
  await expect(response).toBeOK();
  const body = await response.json();
  expect(body.status).toBe("ok");
  expect(body.service).toBe("creatorjobs-web");
});

test("unauthenticated you page is not mislabeled as backend storage offline", async ({ page }) => {
  await page.goto("/you", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Sign in to open your workspace.")).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Backend storage is offline");
});

test("homepage hero stat block cycles through stats with a progress indicator", async ({ page }) => {
  await page.goto("/");

  const label = page.getByTestId("hero-stat-label");
  await expect(label).toBeVisible();
  await expect(page.getByTestId("hero-stat-source")).toHaveAttribute(
    "href",
    "https://www.bcg.com/publications/2025/india-from-content-to-commerce-mapping-indias-creator-economy"
  );
  // The progress bar under the stat acts as the rotation indicator.
  await expect(page.getByTestId("hero-stat-progress")).toBeVisible();

  // It rotates on a steady cadence (~5s). Poll until the stat changes, with generous
  // headroom so this is not coupled to exact timing.
  const first = (await label.textContent())?.trim() ?? "";
  expect(first.length).toBeGreaterThan(0);
  await expect(async () => {
    const current = (await label.textContent())?.trim() ?? "";
    expect(current).not.toBe(first);
  }).toPass({ timeout: 12_000 });
});

test("homepage recent job cards use full-card navigation without redundant card CTA", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Recent Job Listings" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recent Talent Listings" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Open roles from content creators, channels, brands, and agencies.");
  await expect(page.locator("body")).not.toContainText("Talent currently open to content work.");
  await expect(page.locator("body")).not.toContainText("Featured talent");
  const recentJobs = page.locator("section.home-rise-delay-jobs").first();
  const recentTalent = page.locator("section.home-rise-delay-talent").first();
  const firstTalentCard = recentTalent.locator('div[role="link"]').first();
  await expect(firstTalentCard).toBeVisible();
  await expect(recentTalent).not.toContainText("No recent talent listings yet.");
  await expect(recentJobs.getByRole("link", { name: /View jobs/i })).toBeVisible();
  await expect(recentTalent.getByRole("link", { name: /View talent/i })).toBeVisible();
  await expect(page.locator("body")).not.toContainText(/View role/i);
  await expect(firstTalentCard.getByRole("button", { name: "Save" })).toBeVisible();

  const firstCard = recentJobs.locator('div[role="link"]').first();
  const firstSave = firstCard.getByRole("button", { name: "Save" });
  await expect(firstSave).toBeVisible();
  await firstSave.click();
  await expect(page).toHaveURL(/\/auth\?mode=login/);

  await page.goto("/");
  await recentJobs.locator('div[role="link"]').first().click();
  await expect(page).toHaveURL(/\/jobs\//);

  await page.goto("/");
  await firstTalentCard.click();
  await expect(page).toHaveURL(/\/talent\//);
});

test("homepage Browse by category section sits between How it works and Recent jobs, with no fake counts", async ({
  page,
}) => {
  await page.goto("/");

  const section = page.getByTestId("browse-categories");
  await expect(section.getByRole("heading", { name: "Browse by category" })).toBeVisible();
  await expect(section.getByText("Explore", { exact: true })).toBeVisible();

  // Cards use creator-economy role labels (not generic category names).
  for (const role of [
    "Video Editor",
    "Thumbnail Designer",
    "Shorts Editor",
    "Designer",
    "Motion Graphics Artist",
    "Script Writer",
    "Voice Over Artist",
    "Channel Manager",
    "Creative Director",
  ]) {
    await expect(section.getByRole("link", { name: role, exact: true })).toBeVisible();
  }

  // Each card links to the jobs feed via the existing ?q= convention.
  await expect(section.getByRole("link", { name: "Video Editor", exact: true })).toHaveAttribute(
    "href",
    /^\/jobs\?q=/
  );

  // Old generic single-word category labels are gone.
  await expect(section.getByText("Editing", { exact: true })).toHaveCount(0);
  await expect(section.getByText("Thumbnails", { exact: true })).toHaveCount(0);

  await expect(section.getByRole("link", { name: "All categories" })).toHaveAttribute("href", "/jobs");

  // No job counts / fake totals are shown (e.g. "840 jobs", "0 jobs").
  await expect(section.getByText(/\d+\s*jobs/i)).toHaveCount(0);

  // Ordering: after How it works, before Recent Job Listings.
  const order = await page.evaluate(() => {
    const how = document.querySelector("[data-testid='howitworks-flow']");
    const browse = document.querySelector("[data-testid='browse-categories']");
    const recent = Array.from(document.querySelectorAll("h2")).find(
      (h) => h.textContent?.trim() === "Recent Job Listings"
    );
    if (!how || !browse || !recent) return false;
    return Boolean(
      how.compareDocumentPosition(browse) & Node.DOCUMENT_POSITION_FOLLOWING &&
        browse.compareDocumentPosition(recent) & Node.DOCUMENT_POSITION_FOLLOWING
    );
  });
  expect(order).toBe(true);
});

test("homepage capability section sits before FAQ and states implemented behavior", async ({ page }) => {
  await page.goto("/");

  const section = page.getByTestId("home-comparison");
  await expect(section.getByRole("heading", { name: "Creator hiring in one workspace" })).toBeVisible();
  await expect(section.getByText("Product capabilities", { exact: true })).toBeVisible();
  await expect(section.getByText("Available in CreatorJobs beta", { exact: true })).toBeVisible();
  await expect(section.getByText("Applications and hiring requests", { exact: true })).toBeVisible();
  await expect(section.getByText("Portfolio-based public profiles", { exact: true })).toBeVisible();
  await expect(section).not.toContainText(/UPI payments|unlimited free|freelance platforms|fiverr|upwork/i);

  // Ordering: comparison appears before the FAQ.
  const order = await page.evaluate(() => {
    const comparison = document.querySelector("[data-testid='home-comparison']");
    const faq = Array.from(document.querySelectorAll("h2")).find((h) => h.textContent?.trim() === "Questions we get a lot");
    if (!comparison || !faq) return false;
    return Boolean(comparison.compareDocumentPosition(faq) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  expect(order).toBe(true);
});

test("job alerts stay unavailable until subscription and delivery are durable", async ({ page, request }) => {
  await page.goto("/");

  await expect(page.getByTestId("home-job-alerts")).toHaveCount(0);
  await expect(page.getByTestId("job-alerts-popup")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(/job alerts|delivered to your inbox|get first pick/i);

  await page.evaluate(() => window.dispatchEvent(new Event("cj:job-alerts")));
  await expect(page.getByTestId("job-alerts-popup")).toHaveCount(0);

  const response = await request.post("/api/job-alerts", {
    data: { email: "creator@example.com" },
  });
  expect(response.status()).toBe(404);
});

test("free beta exposes no pretend checkout", async ({ page }) => {
  const response = await page.goto("/pricing/checkout?kind=talent_listing");

  expect(response?.status()).toBe(404);
  await expect(page.locator("body")).not.toContainText(/Standard price|Launch beta adjustment|₹4,999|₹499|₹7,499|₹999/);
});

test("homepage shows the honest beta banner, value, how-it-works, and FAQ sections without overflow", async ({
  page,
}) => {
  await page.goto("/");

  // New honest sections render with their real headings.
  await expect(page.getByText("Free during beta", { exact: false }).first()).toBeVisible();
  await expect(page.getByText(/why creatorjobs/i).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Everything creator work needs" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Use CreatorJobs as talent" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Questions we get a lot" })).toBeVisible();

  // Why CreatorJobs cards describe implemented context/workflows, not unsupported outcomes.
  await expect(page.getByText("Profile context in one place")).toBeVisible();
  await expect(page.getByText("Creator-native role details")).toBeVisible();
  await expect(page.getByText("Applications and requests together")).toBeVisible();
  await expect(page.getByText("Free during beta", { exact: true }).last()).toBeVisible();

  // How-it-works toggle swaps the steps + CTA between Talent and Recruiter.
  const howPanel = page.getByTestId("howitworks-panel");
  const howFlow = page.getByTestId("howitworks-flow");
  const howCta = page.getByTestId("howitworks-cta");
  await expect(howFlow).toBeVisible();
  await expect(page.getByTestId("howitworks-connectors")).toBeVisible();
  await expect(page.getByTestId("howitworks-step-start")).toContainText("Create your profile");
  await expect(page.getByTestId("howitworks-branches").locator("[data-testid^='howitworks-branch-']")).toHaveCount(2);
  await expect(howPanel.getByText("Browse jobs")).toBeVisible();
  await expect(howPanel.getByText("Publish a talent listing")).toBeVisible();
  await expect(page.getByTestId("howitworks-step-end")).toContainText("Apply or respond");
  await expect(howCta).toHaveText(/Create your free profile/);
  await expect(howCta).toHaveAttribute("href", "/you");
  await page.getByTestId("howitworks-tab-recruiter").click();
  await expect(page.getByRole("heading", { name: "Use CreatorJobs for hiring" })).toBeVisible();
  await expect(page.getByTestId("howitworks-step-start")).toContainText("Create your hiring profile");
  await expect(page.getByTestId("howitworks-branches").locator("[data-testid^='howitworks-branch-']")).toHaveCount(2);
  await expect(howPanel.getByText("Browse talent")).toBeVisible();
  await expect(howPanel.getByText("Publish a job listing")).toBeVisible();
  await expect(page.getByTestId("howitworks-step-end")).toContainText("Review and decide");
  await expect(howCta).toHaveText(/Create your hiring profile/);
  await expect(howCta).toHaveAttribute("href", "/you");

  // No fabricated trust signals were introduced.
  await expect(page.locator("body")).not.toContainText(/Hires Made|Verified Creators|Loved by creators/i);
  await expect(page.locator("body")).not.toContainText(/Why not just use Fiverr/i);

  // FAQ uses an accessible native disclosure: the answer reveals on open.
  const faq = page.getByText("Is CreatorJobs free during beta?", { exact: false });
  await expect(faq).toBeVisible();
  await faq.click();
  await expect(page.getByText(/no payment method is required to publish/i)).toBeVisible();

  // No horizontal overflow at desktop, tablet, and mobile widths.
  for (const width of [1440, 834, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow, `no horizontal overflow at ${width}px`).toBeLessThanOrEqual(1);
    await expect(page.getByTestId("howitworks-flow")).toBeVisible();
    await expect(page.getByTestId("howitworks-branches").locator("[data-testid^='howitworks-branch-']")).toHaveCount(2);
  }
});

test("homepage FAQ section is centered, uses new heading, has View full FAQ link, and old heading is gone", async ({
  page,
}) => {
  await page.goto("/");

  // New centered heading; old heading must not appear.
  await expect(page.getByRole("heading", { name: "Questions we get a lot" })).toBeVisible();
  await expect(page.getByText("Questions, answered")).toHaveCount(0);

  // FAQ eyebrow label.
  await expect(page.getByText("FAQ", { exact: true }).first()).toBeVisible();

  // "View full FAQ" link points to the real /faq route.
  const faqLink = page.getByRole("link", { name: /View full FAQ/i });
  await expect(faqLink).toBeVisible();
  await expect(faqLink).toHaveAttribute("href", "/faq");
});

test("/faq page renders FAQ content", async ({ page }) => {
  await page.goto("/faq");
  await expect(page.getByRole("heading", { name: "Questions we get a lot" })).toBeVisible();
  await expect(page.getByText("Is CreatorJobs free during beta?")).toBeVisible();
  await expect(page.getByText("Who can post a job?")).toBeVisible();
});

test("job apply exposes requirements on the listing and opens the structured preflight modal", async ({ context, page }) => {
  await signInAsCandidate(context);
  await stubNoExistingApplication(page, "1");
  // Mock job "1" declares every job-context first-message requirement.
  await page.goto("/jobs/1", { waitUntil: "domcontentloaded" });

  // Candidates can inspect requested materials, while private screening prompts
  // are delivered only after a successful application.
  await expect(page.getByRole("heading", { name: "Required application materials" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Screening questions" })).toHaveCount(0);
  await expect(page.getByTestId("job-apply-requirements")).toHaveCount(0);
  const applyButton = page.getByTestId("job-apply-button").first();
  await expect(applyButton).toHaveText("Apply");
  await applyButton.click();

  const modal = page.getByTestId("first-message-modal-job");
  await expect(modal).toBeVisible();
  await expect(modal).toContainText("Complete your opening message");

  const requirements = modal.getByTestId("job-apply-requirements");
  await expect(requirements).toBeVisible();
  // Context-specific (job) requester labels render as their own fields.
  await expect(requirements.getByText("Expected rate", { exact: false })).toBeVisible();
  await expect(requirements.getByText("Relevant portfolio", { exact: false })).toBeVisible();
  await expect(requirements.getByText("Fit note", { exact: false })).toBeVisible();
});

test("job apply modal blocks an empty submit with calm inline validation", async ({ context, page }) => {
  await signInAsCandidate(context);
  await stubNoExistingApplication(page, "1");
  await page.goto("/jobs/1", { waitUntil: "domcontentloaded" });
  const applyButton = page.getByTestId("job-apply-button").first();
  await expect(applyButton).toHaveText("Apply");
  await applyButton.click();

  const modal = page.getByTestId("first-message-modal-job");
  await expect(modal).toBeVisible();

  // Submitting with empty required fields surfaces validation and creates nothing
  // (the modal stays open; no redirect/navigation occurs).
  await modal.getByTestId("first-message-modal-submit").click();
  await expect(modal).toBeVisible();
  await expect(modal.getByText("is required.", { exact: false }).first()).toBeVisible();
  expect(page.url()).toContain("/jobs/1");

  // Closing the modal dismisses it without applying.
  await modal.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByTestId("first-message-modal-job")).toHaveCount(0);
});

test("a job stored with an external application mode keeps its instructions but applies internally", async ({ context, page }) => {
  await signInAsCandidate(context);
  await stubNoExistingApplication(page, "15");
  // Job 15 still carries an external application mode in the fixture, but
  // `applicationPreflightForJob` pins every application to `internal` on
  // purpose — a stored external mode "belongs to some other hiring process the
  // platform never saw and cannot record". The instructions stay visible; the
  // off-platform link must not.
  await page.goto("/jobs/15", { waitUntil: "domcontentloaded" });

  await expect(page.getByTestId("job-apply-panel").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "How to apply" })).toBeVisible();
  await expect(
    page.locator('a[href="https://example.com/creatorjobs-demo/partnerships-application"]')
  ).toHaveCount(0);
  const applyButton = page.getByTestId("job-apply-button").first();
  await expect(applyButton).toHaveText("Apply");
});

test("talent hire opens the first-message requirements modal for recruiters", async ({ page }) => {
  // The retention-editor mock listing exercises every talent-context requirement.
  await page.goto("/talent/mock-talent-retention-editor", { waitUntil: "domcontentloaded" });

  await expect(page.getByTestId("talent-request-requirements")).toHaveCount(0);
  await page.getByTestId("talent-hire-button").first().click();

  const modal = page.getByTestId("first-message-modal-talent");
  await expect(modal).toBeVisible();
  await expect(modal).toContainText("Complete your hiring request");

  const requirements = modal.getByTestId("talent-request-requirements");
  await expect(requirements).toBeVisible();
  // Context-specific (talent) requester labels differ from the job side.
  await expect(requirements.getByText("Project budget", { exact: false })).toBeVisible();
  await expect(requirements.getByText("Project brief", { exact: false })).toBeVisible();
});

test("talent hire modal blocks an empty submit with calm inline validation", async ({ page }) => {
  await page.goto("/talent/mock-talent-retention-editor", { waitUntil: "domcontentloaded" });
  await page.getByTestId("talent-hire-button").first().click();

  const modal = page.getByTestId("first-message-modal-talent");
  await expect(modal).toBeVisible();

  // Submitting with empty required fields surfaces validation and sends nothing
  // (the modal stays open; no redirect/navigation occurs).
  await modal.getByTestId("first-message-modal-submit").click();
  await expect(modal).toBeVisible();
  await expect(modal.getByText("is required.", { exact: false }).first()).toBeVisible();
  expect(page.url()).toContain("/talent/mock-talent-retention-editor");

  // Closing the modal dismisses it without sending the request.
  await modal.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByTestId("first-message-modal-talent")).toHaveCount(0);
});

test("talent detail without requirements requests without opening the modal", async ({ page }) => {
  // The scriptwriter mock listing declares no first-message requirements
  // (most other talent listings carry demo requirement sets).
  await page.goto("/talent/mock-talent-scriptwriter", { waitUntil: "domcontentloaded" });

  // The detail page renders the actions panel for both desktop and mobile layouts,
  // so the hire button appears more than once; first() keeps the assertion strict-safe.
  await expect(page.getByTestId("talent-hire-button").first()).toBeVisible();
  await expect(page.getByTestId("talent-request-requirements")).toHaveCount(0);
  await page.getByTestId("talent-hire-button").first().click();
  await expect(page.getByTestId("first-message-modal-talent")).toHaveCount(0);
});

test("unknown routes render a branded 404 with recovery links, not a raw error", async ({ page }) => {
  const response = await page.goto("/this-route-does-not-exist", { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  await expect(page.getByText("We couldn’t find that page.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Go home" })).toHaveAttribute("href", "/");
  await expect(page.getByRole("link", { name: "Browse jobs" })).toHaveAttribute("href", "/jobs");
  await expect(page.locator("body")).not.toContainText(
    /Application error|Unhandled Runtime Error|This page could not be found/i
  );
});

test("listing cards do not show unproven featured badges", async ({ page }) => {
  await page.goto("/jobs");
  await expect(page.locator('[role="link"]').first()).toBeVisible();
  await expect(page.locator('[role="link"]').filter({ hasText: "Featured" })).toHaveCount(0);

  await page.goto("/talent");
  await expect(page.locator('div[role="link"]').first()).toBeVisible();
  await expect(page.locator('div[role="link"]').filter({ hasText: "Featured" })).toHaveCount(0);
});
