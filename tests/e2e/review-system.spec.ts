import { expect, test, type BrowserContext } from "@playwright/test";
import { encode } from "next-auth/jwt";

const SESSION_SECRET = "e2e-secret";
const ENGAGEMENT_ID = "30000000-0000-4000-8000-000000000001";
const REVIEW_ID = "30000000-0000-4000-8000-000000000002";

async function signIn(context: BrowserContext) {
  const sessionToken = await encode({
    token: {
      name: "Demo Owner",
      email: "owner-e2e@example.com",
      sub: "e2e-owner",
      username: "demo-owner",
      displayName: "Demo Owner",
      backendAccessToken: "e2e-review-token",
      backendTokenType: "bearer",
      backendUserId: "e2e-owner",
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

function engagement(reviewState: "available" | "submitted") {
  return {
    id: ENGAGEMENT_ID,
    source_type: "job_application",
    source_record_id: "30000000-0000-4000-8000-000000000003",
    status: "completed",
    context_label: "Finance explainer edit",
    counterpart_name: "Rhea Kapoor",
    started_at: "2026-07-01T09:00:00Z",
    response_due_at: null,
    finalized_at: "2026-07-08T09:00:00Z",
    review_window_ends_at: "2030-07-22T09:00:00Z",
    available_actions: reviewState === "available" ? ["write_review"] : ["edit_review"],
    review_state: reviewState,
  };
}

test("review dialog keeps a draft, submits blind feedback, and fits mobile", async ({ page, context }) => {
  await signIn(context);
  await page.setViewportSize({ width: 390, height: 844 });
  let submitted = false;
  let submittedPayload: Record<string, unknown> | null = null;

  await page.route("**/api/v1/me/reviews?*", async (route) => {
    const myReview = submitted
      ? {
          id: REVIEW_ID,
          engagement_id: ENGAGEMENT_ID,
          direction: "talent_to_recruiter",
          overall_rating: 5,
          dimension_ratings: { brief_clarity: 5 },
          public_feedback: "Clear scope and thoughtful feedback throughout.",
          status: "submitted",
          submitted_at: "2026-07-10T09:00:00Z",
          published_at: null,
          editable: true,
        }
      : null;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        mode: "talent",
        received: { summary: { avg_rating: 0, review_count: 0 }, items: [] },
        opportunities: submitted
          ? []
          : [{ engagement: engagement("available"), direction: "talent_to_recruiter", my_review: null }],
        written: submitted
          ? [{ engagement: engagement("submitted"), direction: "talent_to_recruiter", my_review: myReview }]
          : [],
      }),
    });
  });
  await page.route(`**/api/v1/me/engagements/${ENGAGEMENT_ID}/review`, async (route) => {
    submittedPayload = route.request().postDataJSON() as Record<string, unknown>;
    submitted = true;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: REVIEW_ID,
        engagement_id: ENGAGEMENT_ID,
        direction: "talent_to_recruiter",
        overall_rating: 5,
        dimension_ratings: { brief_clarity: 5 },
        public_feedback: "Clear scope and thoughtful feedback throughout.",
        status: "submitted",
        submitted_at: "2026-07-10T09:00:00Z",
        published_at: null,
        editable: true,
      }),
    });
  });

  await page.goto("/you");
  await page.getByRole("button", { name: "Reviews", exact: true }).click();
  await page.getByRole("tab", { name: "Your feedback" }).click();
  const leaveFeedback = page.getByRole("button", { name: "Leave feedback" });
  await expect(leaveFeedback).toBeVisible();
  await leaveFeedback.click();

  const dialog = page.getByRole("dialog", { name: "Share feedback" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("not told whether you submitted");
  await dialog.getByRole("radio", { name: "5 stars" }).first().click();
  await dialog.getByRole("radio", { name: "5 stars" }).nth(1).click();
  const feedback = dialog.getByLabel("Public feedback");
  await feedback.fill("Clear scope and thoughtful feedback throughout.");

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(leaveFeedback).toBeFocused();
  await leaveFeedback.click();
  await expect(page.getByLabel("Public feedback")).toHaveValue(
    "Clear scope and thoughtful feedback throughout."
  );
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);

  await page.getByRole("button", { name: "Submit feedback" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("Awaiting publication")).toBeVisible();
  expect(submittedPayload).toMatchObject({
    overall_rating: 5,
    dimension_ratings: { brief_clarity: 5 },
    public_feedback: "Clear scope and thoughtful feedback throughout.",
  });
});

test("review workspace distinguishes a load failure from a genuine empty state", async ({ page, context }) => {
  await signIn(context);
  let failing = true;
  await page.route("**/api/v1/me/reviews?*", async (route) => {
    if (failing) {
      await route.fulfill({ status: 503, contentType: "application/json", body: '{"detail":"Unavailable"}' });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        mode: "talent",
        received: { summary: { avg_rating: 0, review_count: 0 }, items: [] },
        opportunities: [],
        written: [],
      }),
    });
  });

  await page.goto("/you");
  await page.getByRole("button", { name: "Reviews", exact: true }).click();
  await page.getByRole("tab", { name: "Your feedback" }).click();
  await expect(page.getByText("Couldn’t load your feedback")).toBeVisible();

  failing = false;
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByText("No feedback actions yet.")).toBeVisible();
  await expect(page.getByText("Couldn’t load your feedback")).toHaveCount(0);
});
