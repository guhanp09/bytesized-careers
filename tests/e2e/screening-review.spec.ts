import { test, expect, type BrowserContext } from "@playwright/test";
import { encode } from "next-auth/jwt";
import { anchor, openRecord, openWorkspace } from "./scenarioAnchors";

/**
 * Reviewing what was asked, and what came back.
 *
 * The questions have always arrived as one structured message. The answers used
 * to come back as prose, which cannot say which question it is answering — so a
 * reviewer paired sentences with prompts by eye and a required question could be
 * skipped without anything noticing.
 *
 * These read the canonical scenario, which now contains all three states a
 * reviewer has to be able to tell apart: answered, deliberately skipped, and
 * not yet answered.
 */

const SESSION_SECRET = "e2e-secret";

async function signIn(context: BrowserContext) {
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
    },
    secret: SESSION_SECRET,
  });
  await context.addCookies([
    { name: "next-auth.session-token", value: sessionToken, domain: "127.0.0.1", path: "/", httpOnly: true, sameSite: "Lax" },
  ]);
}

test.beforeEach(async ({ context }) => {
  await signIn(context);
});

test("a fully answered screening reads as questions and answers, in one place", async ({ page }) => {
  const target = anchor("default", "every question answered", { persona: "recruiter" });
  await openWorkspace(page, { scenario: "default", mode: "recruiter", view: "inbox" });
  const detail = await openRecord(page, target);

  // The ask.
  await expect(detail.getByText("Screening questions").first()).toBeVisible();
  await expect(detail.getByText(/retention judgement/i).first()).toBeVisible();

  // And the answers, structured, against the questions as they were asked.
  const answers = detail.getByTestId("screening-answers-card");
  await expect(answers).toBeVisible();
  await expect(answers).toContainText("3 of 3 answered");
  await expect(answers).toContainText(/moved the strongest visual to the cold open/i);

  // One authoritative surface: the answers are not repeated in the context rail.
  const rail = page.getByTestId("applications-detail").locator("aside");
  if ((await rail.count()) > 0) {
    await expect(rail.getByTestId("screening-answers-card")).toHaveCount(0);
  }
});

test("a skipped optional question is shown as skipped, not omitted", async ({ page }) => {
  const target = anchor("default", "optional question deliberately skipped", { persona: "recruiter" });
  await openWorkspace(page, { scenario: "default", mode: "recruiter", view: "inbox" });
  const detail = await openRecord(page, target);

  const answers = detail.getByTestId("screening-answers-card");
  await expect(answers).toBeVisible();
  // Dropping the blank would make "they chose not to say" indistinguishable
  // from "we never asked", which is the distinction a decision rests on.
  await expect(answers).toContainText("2 of 3 answered");
  await expect(answers).toContainText(/Skipped — this one was optional/i);
  await expect(answers).toContainText(/Anything else the hiring team should know/i);
});

test("questions still outstanding show no answers card at all", async ({ page }) => {
  const target = anchor("default", "not yet answered", { persona: "recruiter" });
  await openWorkspace(page, { scenario: "default", mode: "recruiter", view: "inbox" });
  const detail = await openRecord(page, target);

  await expect(detail.getByText("Screening questions").first()).toBeVisible();
  await expect(detail.getByTestId("screening-answers-card")).toHaveCount(0);
  // And the recruiter is not offered a form to answer their own questions.
  await expect(detail.getByTestId("screening-answer-open")).toHaveCount(0);
});

test("the answers stand apart from the human messages around them", async ({ page }) => {
  const target = anchor("default", "every question answered", { persona: "recruiter" });
  await openWorkspace(page, { scenario: "default", mode: "recruiter", view: "inbox" });
  const detail = await openRecord(page, target);

  // A structured block, never folded into somebody's run of sentences — a
  // sender's name over a block they did not write is a misattribution.
  const groups = await detail.evaluate((node) =>
    Array.from(node.querySelectorAll('[data-testid="message-group"]')).map((group) => ({
      bubbles: group.querySelectorAll('[data-testid="chat-message"]').length,
      hasAnswers: group.querySelector('[data-testid="screening-answers-card"]') !== null,
    }))
  );
  for (const group of groups) {
    if (group.hasAnswers) expect(group.bubbles).toBe(1);
  }
});
