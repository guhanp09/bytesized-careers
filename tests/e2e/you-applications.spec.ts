import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { encode } from "next-auth/jwt";
import { switchPersona } from "./workspacePersona";
import {
  anchor,
  manifest,
  openRecord,
  openWorkspace,
  revealRecord,
  row,
  type Anchor,
} from "./scenarioAnchors";
import { INBOX_PAGE_SIZE } from "../../lib/workspacePaging";

/*
  These specs were written against a hand-written nine-record fixture that no
  longer exists. They asserted its row counts, its people and its ordering, so
  they broke the moment Mock mode started serving the canonical corpus — and,
  worse, a failure said "a name moved" rather than naming the behaviour that had
  regressed.

  Every record is now addressed through the generated scenario index: a spec
  asks for the record demonstrating a condition, gets a deterministic id, and
  clicks it by `data-record-id`. Scenario selection is explicit per test, so no
  test depends on what ran before it.
*/

// Matches NEXTAUTH_SECRET in the test:e2e:server script. The backend is not
// running during e2e, so /you renders its offline shell with mock data.
const SESSION_SECRET = "e2e-secret";

async function signInAsOwner(context: BrowserContext) {
  // backendAccessToken makes YouHubClient attempt real backend calls; with the
  // backend down they fail as network errors, which triggers the offline
  // profile shell instead of the blocking persistence-unavailable error.
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

// Workflow actions live in the detail app-bar overflow menu.
async function openOverflow(page: Page) {
  await page.getByTestId("applications-detail").getByRole("button", { name: "More actions" }).click();
}

/** How many records of a kind a scenario holds, from the manifest. */
function countOf(scenario: "default" | "talent" | "recruiter", kind: "application" | "hiring_request") {
  return manifest(scenario).relationships.filter((rel) => rel.kind === kind).length;
}

test.describe("/you Applications workspace", () => {
  test.beforeEach(async ({ context }) => {
    await signInAsOwner(context);
  });

  test("signed-in /you uses the offline shell without the blocking backend-offline banner", async ({ page }) => {
    await page.goto("/you");
    await expect(page.locator("body")).not.toContainText("Backend storage is offline");
    await expect(page.locator("body")).toContainText(/Demo Owner|You/);
  });

  test("renders master-detail with the list beside an auto-selected detail", async ({ page }) => {
    await openWorkspace(page, { scenario: "default" });

    // Not a total row count: that would assert the generator's arithmetic. What
    // matters is that the list rendered, something is open, and the detail is
    // showing that record rather than a placeholder.
    const rows = page.getByTestId("interaction-row");
    await expect(rows.first()).toBeVisible();
    await expect(rows.first()).toHaveAttribute("aria-pressed", "true");

    const detail = page.getByTestId("applications-detail");
    await expect(detail).toBeVisible();
    await expect(detail.getByRole("heading").first()).toBeVisible();
    await expect(detail.getByText("No messages yet.")).toHaveCount(0);
  });

  test("talent mode shows applications sent and hiring requests received", async ({ page }) => {
    await openWorkspace(page, { scenario: "default", mode: "talent" });

    /*
      Two different numbers, and both matter.

      The *totals* live on the filter chips and are derived from the manifest —
      a talent sent every application and received every hiring request. The
      *rendered* rows are deliberately bounded, so the list is checked for being
      a bounded prefix rather than for containing everything.
    */
    await expect(page.getByTestId("applications-filter-sent")).toContainText(
      String(countOf("default", "application"))
    );
    await expect(page.getByTestId("applications-filter-received")).toContainText(
      String(countOf("default", "hiring_request"))
    );
    const rows = page.getByTestId("interaction-row");
    const rendered = await rows.count();
    expect(rendered).toBeGreaterThan(0);
    expect(rendered, "the inbox must not render the whole corpus").toBeLessThanOrEqual(INBOX_PAGE_SIZE);
    await expect(page.getByTestId("inbox-showing")).toContainText(
      `of ${countOf("default", "application") + countOf("default", "hiring_request")}`
    );

    const request = anchor("default", "Inbound hiring request awaiting a reply", { persona: "talent" });
    const detail = await openRecord(page, request);
    // The header answers "who am I talking to?" — the recruiter.
    await expect(detail.getByRole("heading", { name: request.counterpartyName })).toBeVisible();
    await expect(page).toHaveURL(/\/applications/);
  });

  test("accepting a received hiring request updates status from the detail pane", async ({ page }) => {
    await openWorkspace(page, { scenario: "default", mode: "talent" });
    const request = anchor("default", "Inbound hiring request awaiting a reply", { persona: "talent" });
    const detail = await openRecord(page, request);

    await openOverflow(page);
    await page.getByRole("menuitem", { name: "Accept request" }).click();
    const confirmation = page.getByRole("dialog", { name: "Accept this hiring request?" });
    await expect(confirmation).toBeVisible();
    await confirmation.getByRole("button", { name: "Confirm acceptance" }).click();
    // Status moves to the app-bar chip and terminal manager actions disappear.
    await expect(detail.getByText("Accepted", { exact: true })).toBeVisible();
    await openOverflow(page);
    await expect(page.getByRole("menuitem", { name: "Accept request" })).toHaveCount(0);
  });

  test("Sent, Received and Archived filters scope the list", async ({ page }) => {
    await openWorkspace(page, { scenario: "default", mode: "talent" });
    const rows = page.getByTestId("interaction-row");

    // Each filter's expected size comes from the manifest, so the assertion is
    // "the filter shows exactly the records that qualify" rather than a number
    // that happened to be true of the retired fixture.
    const applications = countOf("default", "application");
    const requests = countOf("default", "hiring_request");
    // The product's own rule (`isArchivedInteraction`): a record is archived if
    // the viewer archived it *or* it reached the archived stage. Counting only
    // the flag would assert a narrower rule than the filter implements.
    const archived = manifest("default").relationships.filter(
      (rel) => rel.archived || rel.stage === "archived"
    ).length;

    /*
      A filter changes the *total*, which the chip states, and restarts the
      rendering window. Both are asserted: a filter that narrowed the totals but
      left a stale window would show an empty list, and a filter that rendered
      everything would undo the bound.
    */
    const scopeTo = async (key: string, total: number) => {
      await page.getByTestId(`applications-filter-${key}`).click();
      if (total > 0) await expect(page.getByTestId(`applications-filter-${key}`)).toContainText(String(total));
      const shown = await rows.count();
      // At least a page, never the whole set, and never nothing. It can exceed
      // one page: the open conversation stays rendered across a filter change
      // when it still qualifies, so the window grows to reach it. That is the
      // selection guarantee, not a leak in the bound.
      expect(shown, `${key} rendered nothing`).toBeGreaterThan(0);
      expect(shown, `${key} rendered fewer than a page`).toBeGreaterThanOrEqual(
        Math.min(total, INBOX_PAGE_SIZE)
      );
      if (total > INBOX_PAGE_SIZE) {
        expect(shown, `${key} rendered the whole corpus`).toBeLessThan(total);
        await expect(page.getByTestId("inbox-showing")).toContainText(`of ${total}`);
      }
    };

    await scopeTo("sent", applications);
    await expect(rows.filter({ hasText: "Received hiring request" })).toHaveCount(0);

    await scopeTo("received", requests);
    await expect(rows.filter({ hasText: "Sent application" })).toHaveCount(0);

    await scopeTo("archived", archived);
    await scopeTo("all", applications + requests);
  });

  test("sent application: header is the counterparty and the job context card links to the job", async ({ page }) => {
    await openWorkspace(page, { scenario: "default", mode: "talent" });
    // Any application looks the same from the sent side; this one is indexed,
    // so it is guaranteed to exist and to carry a job.
    const application = anchor("default", "New · unread · portfolio attached", { persona: "recruiter" });
    const detail = await openRecord(page, application);

    // Header answers "who am I talking to?" — the hiring side — not the job title.
    await expect(detail.getByRole("heading").first()).toBeVisible();

    // The job lives in the context card, which is itself the link to the job.
    const jobCard = detail.locator(`a[href="/jobs/${application.jobId}"]`);
    await expect(jobCard).toBeVisible();
    await expect(jobCard.getByRole("heading", { name: application.jobTitle! })).toBeVisible();

    // No redundant label above the compact card.
    await expect(detail.getByText("Job you applied to")).toHaveCount(0);
  });

  test("sent hiring request: the talent context card is a compact mini-card linking to the profile", async ({
    page,
  }) => {
    await openWorkspace(page, { scenario: "default", mode: "recruiter" });
    const request = anchor("default", "Inbound hiring request awaiting a reply", { persona: "talent" });
    // Indexed for the talent side; from the recruiter's account it is the
    // *sent* side of the same record, which is what this test is about.
    const detail = await openRecord(page, request);

    const talent = manifest("default").relationships.find((rel) => rel.id === request.recordId)!;
    const person = manifest("default").actors.find((actor) => actor.id === talent.talent_id)!;

    await expect(detail.getByRole("heading", { name: person.display_name })).toBeVisible();

    // A compact card — the mirror of the job card — that is itself the link to
    // the talent profile. Addressed by its own test id: the header carries the
    // same href and, since it began showing the listing as its context line,
    // the same headline text, so filtering on either matches both.
    const talentCard = detail
      .locator(`a[href^="/u/${person.username}"]`)
      .filter({ has: page.getByTestId("inbox-talent-card") });
    await expect(talentCard).toBeVisible();
    await expect(talentCard).toContainText(/for creator-led channels/);

    // Same shape of information as the job card: rate, then numeric experience.
    await expect(talentCard).toContainText(/years|Less than 1 year/);
    // No availability status and no portfolio block in the compact card.
    await expect(talentCard.getByText(/^Available$|^Selective$|^Unavailable$/)).toHaveCount(0);
  });

  test("received hiring request: the context card is the viewer's own listing, not the recruiter", async ({
    page,
  }) => {
    await openWorkspace(page, { scenario: "default", mode: "talent" });
    const request = anchor("default", "Inbound hiring request awaiting a reply", { persona: "talent" });
    const detail = await openRecord(page, request);

    // Header answers "who am I talking to?" — the recruiter.
    await expect(detail.getByRole("heading", { name: request.counterpartyName })).toBeVisible();

    // The context card represents the viewer's own listing, and says so.
    await expect(detail.getByText("Your listing")).toBeVisible();

    // The recruiter is the header, not a second context card.
    await expect(detail.getByText(/Sent for your listing/)).toHaveCount(0);
  });

  test("recruiter mode shows received applications, and switching clears stale detail", async ({ page }) => {
    await openWorkspace(page, { scenario: "default", mode: "talent" });

    // Open a talent-mode record first so staleness is observable.
    const request = anchor("default", "Inbound hiring request awaiting a reply", { persona: "talent" });
    await openRecord(page, request);
    const staleHeading = request.counterpartyName;

    await switchPersona(page, "hiring");

    // Totals from the chips; the rendered list stays bounded.
    await expect(page.getByTestId("applications-filter-received")).toContainText(
      String(countOf("default", "application"))
    );
    await expect(page.getByTestId("applications-filter-sent")).toContainText(
      String(countOf("default", "hiring_request"))
    );
    const rows = page.getByTestId("interaction-row");
    expect(await rows.count()).toBeLessThanOrEqual(INBOX_PAGE_SIZE);

    const detail = page.getByTestId("applications-detail");
    await expect(detail.getByRole("heading", { name: staleHeading, exact: true })).toHaveCount(0);

    const application = anchor("default", "New · unread · portfolio attached", { persona: "recruiter" });
    await openRecord(page, application);
    // Header answers "who am I talking to?" — the applicant — and links to them.
    await expect(detail.getByRole("heading", { name: application.counterpartyName })).toBeVisible();
    await expect(detail.getByRole("heading", { name: application.jobTitle! })).toBeVisible();
    await openOverflow(page);
    await expect(page.getByRole("menuitem", { name: "Move to Reviewing" })).toBeVisible();
  });

  test("reply composer sends a local reply with quick actions", async ({ page }) => {
    await openWorkspace(page, { scenario: "default", mode: "recruiter" });
    const application = anchor("default", "New · unread · portfolio attached", { persona: "recruiter" });
    const detail = await openRecord(page, application);

    const composer = detail.getByRole("textbox", { name: "Reply message" });
    await expect(composer).toBeVisible();

    await detail.getByRole("button", { name: "Ask for portfolio" }).click();
    await expect(composer).toHaveValue(/work samples/);

    await detail.getByRole("button", { name: "Send", exact: true }).click();
    await expect(composer).toHaveValue("");
    // The reply lands as a right-aligned ("me") chat bubble.
    await expect(
      detail.locator('[data-testid="chat-message"][data-from="me"]').filter({ hasText: /work samples/ })
    ).toBeVisible();
  });

  test("marking an application not selected confirms and keeps the private decision revisitable", async ({ page }) => {
    await openWorkspace(page, { scenario: "default", mode: "recruiter" });
    const application = anchor("default", "New · unread · portfolio attached", { persona: "recruiter" });
    const detail = await openRecord(page, application);

    await openOverflow(page);
    await page.getByRole("menuitem", { name: "Not selected", exact: true }).click();
    const confirmation = page.getByRole("dialog", {
      name: "Mark this application as not selected?",
    });
    await expect(confirmation).toBeVisible();

    await confirmation.getByRole("button", { name: "Confirm not selected" }).click();
    await expect(detail.getByText("Declined", { exact: true })).toBeVisible();
    // The private decision can still be revised or explicitly shared later.
    await openOverflow(page);
    await expect(page.getByRole("menuitem", { name: "Move to Reviewing" })).toBeVisible();
    const firstName = application.counterpartyName.split(" ")[0];
    await expect(page.getByRole("menuitem", { name: `Share decision with ${firstName}` })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Not selected", exact: true })).toHaveCount(0);
  });

  test("a private decision is never shown to the participant", async ({ page }) => {
    // The indexed record exists precisely for this: the recruiter has decided,
    // and the applicant has not been told. Both sides are read here, because a
    // leak is only visible by comparing them.
    const priv = anchor("default", "Not proceeding · saved privately", { persona: "recruiter" });
    await openWorkspace(page, { scenario: "default", mode: "recruiter" });
    const detail = await openRecord(page, priv);
    await expect(detail.getByText("Declined", { exact: true })).toBeVisible();

    await switchPersona(page, "talent");
    await revealRecord(page, priv);
    const participantRow = row(page, priv);
    await participantRow.scrollIntoViewIfNeeded();
    // What the applicant sees is what they were told — Reviewing — never the
    // recruiter's private position.
    await expect(participantRow).toContainText(/Viewed|Reviewing/);
    await expect(participantRow).not.toContainText("Declined");
  });

  test("Shortlist is no longer offered as a stage", async ({ page }) => {
    // Retired in favour of a private Star (migration 0047): keeping someone in
    // mind is personal organisation, not a place in the funnel.
    await openWorkspace(page, { scenario: "default", mode: "recruiter" });
    const application = anchor("default", "New · unread · portfolio attached", { persona: "recruiter" });
    await openRecord(page, application);

    await openOverflow(page);
    await expect(page.getByRole("menuitem", { name: /Shortlist/ })).toHaveCount(0);
    // The stages that remain are real positions in the funnel.
    await expect(page.getByRole("menuitem", { name: "Move to Reviewing" })).toBeVisible();
  });

  test("a communicated legacy Shortlisted reads as Under consideration, never the raw stage", async ({ page }) => {
    const legacy = anchor("default", "Legacy Shortlisted · communicated", { persona: "recruiter" });
    await openWorkspace(page, { scenario: "default", mode: "talent" });
    await revealRecord(page, legacy);
    const participantRow = row(page, legacy);
    await participantRow.scrollIntoViewIfNeeded();
    await expect(participantRow).toBeVisible();
    // The stored stage is `shortlisted`; what the applicant reads is the label,
    // which must be "Under consideration". Asserted on the status rather than on
    // the row text: the recruiter's own message legitimately contains the word
    // "shortlist", and banning it from the row would be banning them from
    // saying it.
    await expect(participantRow.getByText("Under consideration")).toBeVisible();
    await expect(participantRow.getByText("Shortlisted", { exact: true })).toHaveCount(0);
  });

  test("narrow viewport shows list first, opens detail on tap, and returns via back", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openWorkspace(page, { scenario: "default" });

    const detail = page.getByTestId("applications-detail");
    await expect(detail).not.toBeVisible();

    const firstRow = page.getByTestId("interaction-row").first();
    await firstRow.click();
    await expect(detail).toBeVisible();
    await expect(firstRow).not.toBeVisible();

    await detail.getByRole("button", { name: "Applications" }).click();
    await expect(detail).not.toBeVisible();
    await expect(firstRow).toBeVisible();
  });

  test("conversation renders chat bubbles with sent-right / received-left alignment", async ({ page }) => {
    await openWorkspace(page, { scenario: "default", mode: "recruiter" });
    // An indexed record with a genuine back-and-forth, so both alignments exist.
    const talked: Anchor = anchor("default", "Engagement active · payment funded", { persona: "recruiter" });
    const detail = await openRecord(page, talked);

    await expect(detail.getByTestId("chat-message")).toHaveCount(talked.messageCount);
    await expect(detail.locator('[data-testid="chat-message"][data-from="me"]').first()).toBeVisible();
    await expect(detail.locator('[data-testid="chat-message"][data-from="other"]').first()).toBeVisible();

    // The job reference is a separate clickable row (a link), not a chat bubble.
    await expect(detail.locator('a[href^="/jobs/"]').first()).toBeVisible();
  });

  test("an answers-only hiring request renders a generated opening message, never a blank thread", async ({ page }) => {
    await openWorkspace(page, { scenario: "default", mode: "talent" });
    // This record carries structured answers and no typed message at all. The
    // inbox has to turn those into one real opening bubble from the requester,
    // because a blank conversation reads as broken.
    const answersOnly = anchor("default", "Answers only", { persona: "talent" });
    const detail = await openRecord(page, answersOnly);

    await expect(detail.getByTestId("chat-message")).toHaveCount(1);
    await expect(detail.locator('[data-testid="chat-message"][data-from="other"]')).toHaveCount(1);
    await expect(detail.getByText("No messages yet.")).toHaveCount(0);
    // The budget the requester answered is shown alongside the generated body.
    await expect(detail).toContainText("₹25,000");
  });

  test("Applications filters are All/Sent/Received/Archived and no longer include Drafts", async ({ page }) => {
    await openWorkspace(page, { scenario: "default" });
    await expect(page.getByTestId("applications-filter-all")).toBeVisible();
    await expect(page.getByTestId("applications-filter-sent")).toBeVisible();
    await expect(page.getByTestId("applications-filter-received")).toBeVisible();
    await expect(page.getByTestId("applications-filter-archived")).toBeVisible();
    // Drafts has moved out of Applications into its own parent tab.
    await expect(page.getByTestId("applications-filter-drafts")).toHaveCount(0);
  });

  test("the empty scenario shows a genuine empty state, not a broken one", async ({ page }) => {
    await openWorkspace(page, { scenario: "empty" });
    await expect(page.getByTestId("interaction-row")).toHaveCount(0);
    // Empty is a state the product has to say out loud; a blank pane reads as a
    // failure to load.
    await expect(page.getByTestId("applications-workspace")).toContainText(
      /Nothing|No applications|No conversations|nothing here|empty/i
    );
    await expect(page.getByTestId("scenario-error")).toHaveCount(0);
  });

  test("an unknown seed is refused with a named error rather than silently loading default", async ({ page }) => {
    await page.goto("/applications?demo=1&seed=staging", { waitUntil: "domcontentloaded" });
    const error = page.getByTestId("scenario-error");
    await expect(error).toBeVisible();
    await expect(error).toContainText("staging");
    await expect(error).toContainText("default");
    // And it must not have quietly loaded a dataset nobody asked for.
    await expect(page.getByTestId("interaction-row")).toHaveCount(0);
  });

  test("Drafts is no longer a tab inside the /you profile", async ({ page }) => {
    await page.goto("/you");
    await expect(page.locator("body")).toContainText(/Demo Owner|You/);
    // The profile tab nav must not expose a Drafts tab anymore.
    await expect(page.getByRole("button", { name: "Drafts", exact: true })).toHaveCount(0);
  });
});
