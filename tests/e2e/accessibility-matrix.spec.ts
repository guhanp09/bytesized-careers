import { expect, test, type BrowserContext, type Locator, type Page, type Route } from "@playwright/test";
import { encode } from "next-auth/jwt";

import { expectAxeClean } from "./axeAudit";
import { openWorkspace } from "./scenarioAnchors";

const SESSION_SECRET = "e2e-secret";
const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,OPTIONS",
  "access-control-allow-headers": "authorization,content-type",
  "content-type": "application/json",
};

type PublicRoute = {
  label: string;
  path: string;
  ready: (page: Page) => Locator;
};

const PUBLIC_ROUTES: PublicRoute[] = [
  {
    label: "home",
    path: "/",
    ready: (page) => page.getByRole("heading", { name: "Recent Job Listings" }),
  },
  {
    label: "jobs results",
    path: "/jobs",
    ready: (page) => page.locator('div[role="link"]').first(),
  },
  {
    label: "jobs empty search",
    path: "/jobs?q=no-such-creator-role-4f53c9",
    ready: (page) => page.getByText("No matching jobs found"),
  },
  {
    label: "job detail",
    path: "/jobs/1",
    ready: (page) => page.getByRole("heading", { name: /Long-form YouTube editor/i }),
  },
  {
    label: "talent results",
    path: "/talent",
    ready: (page) => page.getByRole("link", { name: /Open talent listing: Retention editor/i }),
  },
  {
    label: "talent empty search",
    path: "/talent?q=no-such-creator-role-4f53c9",
    ready: (page) => page.getByText("No matching talent found"),
  },
  {
    label: "talent detail",
    path: "/talent/mock-talent-retention-editor",
    ready: (page) => page.getByRole("heading", { name: /RETENTION EDITOR/i }),
  },
  {
    label: "public profile",
    path: "/u/aarav-mehta",
    ready: (page) => page.getByRole("heading", { name: "Aarav Mehta" }),
  },
  {
    label: "public portfolio project",
    path: "/u/aarav-mehta/projects/aarav-mehta-sample-1",
    ready: (page) => page.getByText("No reviews yet"),
  },
  {
    label: "post chooser",
    path: "/post",
    ready: (page) => page.getByRole("link", { name: "Post a job" }),
  },
  {
    label: "post job first step",
    path: "/post-job",
    ready: (page) => page.getByRole("heading", { name: "Who are you hiring for?" }),
  },
  {
    label: "AI import signed-out boundary",
    path: "/post-job/import",
    ready: (page) => page.getByRole("heading", { name: "Sign in to import a job" }),
  },
  {
    label: "FAQ",
    path: "/faq",
    ready: (page) => page.getByRole("heading", { name: "Questions we get a lot" }),
  },
  {
    label: "support",
    path: "/support",
    ready: (page) => page.getByRole("heading", { name: "Support" }),
  },
  {
    label: "terms",
    path: "/terms",
    ready: (page) => page.getByRole("heading", { name: "Terms" }),
  },
  {
    label: "privacy",
    path: "/privacy",
    ready: (page) => page.getByRole("heading", { name: "Privacy" }),
  },
  {
    label: "login",
    path: "/auth?mode=login",
    ready: (page) => page.getByRole("heading", { name: "Welcome back" }),
  },
  {
    label: "password reset",
    path: "/auth/reset",
    ready: (page) => page.getByRole("heading", { name: "Password reset" }),
  },
  {
    label: "not found",
    path: "/this-route-does-not-exist-a11y",
    ready: (page) => page.getByRole("heading", { name: "Page not found" }),
  },
];

async function openRoute(page: Page, route: PublicRoute): Promise<void> {
  const response = await page.goto(route.path, { waitUntil: "domcontentloaded" });
  expect(response?.status(), `${route.path} returned a server error`).toBeLessThan(500);
  await expect(route.ready(page).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("body")).not.toContainText(
    /Application error|Unhandled Runtime Error|Internal Server Error/i
  );
}

async function signIn(
  context: BrowserContext,
  options: { accountType?: "TALENT" | "BOTH" } = {}
): Promise<void> {
  const accountType = options.accountType ?? "BOTH";
  const sessionToken = await encode({
    token: {
      name: "Accessibility Owner",
      email: "a11y-owner@example.com",
      sub: "a11y-owner",
      username: "a11y-owner",
      displayName: "Accessibility Owner",
      backendAccessToken: "e2e-offline-token",
      backendTokenType: "bearer",
      backendUserId: "a11y-owner",
      accountType,
      onboardingIntent: accountType === "TALENT" ? "LOOKING_FOR_WORK" : "BOTH",
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

async function fulfillJson(route: Route, body: unknown): Promise<void> {
  if (route.request().method() === "OPTIONS") {
    await route.fulfill({ status: 204, headers: CORS_HEADERS, body: "" });
    return;
  }
  await route.fulfill({ status: 200, headers: CORS_HEADERS, body: JSON.stringify(body) });
}

test.describe("whole-document WCAG A/AA route sweep", () => {
  for (const route of PUBLIC_ROUTES) {
    test(route.label, async ({ page }, testInfo) => {
      await openRoute(page, route);
      await expectAxeClean(page, `${route.label} (${testInfo.project.name})`);
    });
  }
});

test.describe("interactive customer states", () => {
  test("talent portfolio details dialog", async ({ page }, testInfo) => {
    await openRoute(page, PUBLIC_ROUTES.find((route) => route.label === "talent detail")!);
    await page
      .getByRole("button", {
        name: /View portfolio project details: Education channel retention edit/i,
      })
      .click({ position: { x: 36, y: 92 } });
    await expect(
      page.getByRole("dialog", {
        name: /Portfolio project details: Education channel retention edit/i,
      })
    ).toBeVisible();
    await expectAxeClean(page, `talent portfolio dialog (${testInfo.project.name})`);
  });

  test("candidate application dialog", async ({ page, context }, testInfo) => {
    await signIn(context, { accountType: "TALENT" });
    await page.route("**/api/v1/jobs/1/application", (route) => fulfillJson(route, null));
    await page.goto("/jobs/1", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /Long-form YouTube editor/i })).toBeVisible();
    const apply = page.locator('[data-testid="job-apply-button"]:visible:not(:disabled)').first();
    await expect(apply).toBeVisible();
    await apply.click();
    await expect(page.getByTestId("first-message-modal-job")).toBeVisible();
    await expectAxeClean(page, `candidate application dialog (${testInfo.project.name})`);
  });

  async function openApplications(page: Page, context: BrowserContext): Promise<void> {
    await signIn(context);
    await openWorkspace(page, {
      // Semantic accessibility uses the bounded 29-record edge corpus. The
      // dedicated paging/performance suites own the 199/329-record load cases;
      // duplicating those here turns an axe scan into an accidental load test.
      scenario: "edge",
      mode: "recruiter",
      view: "inbox",
    });
  }

  test("applications Inbox", async ({ page, context }, testInfo) => {
    await openApplications(page, context);
    await expectAxeClean(page, `applications inbox (${testInfo.project.name})`);
  });

  test("applications filter menu", async ({ page, context }, testInfo) => {
    await openApplications(page, context);
    await page.getByTestId("queue-selector-trigger").click();
    await expect(page.getByTestId("queue-selector-menu")).toBeVisible();
    await expectAxeClean(page, `applications filter menu (${testInfo.project.name})`);
  });

  test("applications conversation", async ({ page, context }, testInfo) => {
    await openApplications(page, context);
    await page.getByRole("main").getByTestId("interaction-row").first().click();
    await expect(page.getByTestId("applications-detail")).toBeVisible();
    await expectAxeClean(page, `applications conversation (${testInfo.project.name})`);
  });

  test("applications Pipeline", async ({ page, context }, testInfo) => {
    await openApplications(page, context);
    await page.getByTestId("applications-view-pipeline").click();
    await expect(page.getByTestId("pipeline-board")).toBeVisible();
    await expectAxeClean(page, `applications pipeline (${testInfo.project.name})`);
  });
});

test.describe("viewport and motion states", () => {
  test("mobile navigation and 320px home remain operable", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await openRoute(page, PUBLIC_ROUTES[0]);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow, "home scrolls sideways at 320px").toBeLessThanOrEqual(1);
    const menuButton = page.getByRole("button", { name: "Menu" });
    const mainNavigation = page.getByRole("navigation", { name: /main/i }).first();
    await expect(mainNavigation).toBeVisible();
    await menuButton.click();
    await expect(mainNavigation).toBeHidden();
    await expect(menuButton).toHaveAttribute("aria-expanded", "false");
    await menuButton.click();
    await expect(mainNavigation).toBeVisible();
    await expect(menuButton).toHaveAttribute("aria-expanded", "true");
    await expectAxeClean(page, `mobile navigation (${testInfo.project.name})`);
  });

  test("applications remain valid at 200% equivalent zoom", async ({ page, context }, testInfo) => {
    await signIn(context);
    await page.setViewportSize({ width: 640, height: 450 });
    await openWorkspace(page, {
      scenario: "edge",
      mode: "recruiter",
      view: "inbox",
    });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow, "Applications scrolls sideways at 200% equivalent zoom").toBeLessThanOrEqual(1);
    await expectAxeClean(page, `applications at 200% zoom (${testInfo.project.name})`);
  });

  test("reduced-motion home has no running finite animation", async ({ page }, testInfo) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openRoute(page, PUBLIC_ROUTES[0]);
    const running = await page.evaluate(() =>
      document
        .getAnimations()
        .filter((animation) => {
          const timing = animation.effect?.getTiming();
          return timing?.iterations !== Infinity && animation.playState === "running";
        })
        .map(
          (animation) =>
            ((animation.effect as KeyframeEffect | null)?.target as Element | null)?.className ??
            "unknown"
        )
    );
    expect(running, `finite animations still running: ${running.join(" | ")}`).toEqual([]);
    await expectAxeClean(page, `reduced-motion home (${testInfo.project.name})`);
  });
});
