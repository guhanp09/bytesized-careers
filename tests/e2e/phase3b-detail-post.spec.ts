import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

async function expectAnchoredPopupWithinViewport(page: Page, popup: Locator) {
  const box = await popup.boundingBox();
  const viewport = page.viewportSize();
  expect(box, "anchored popup should have a measurable bounding box").not.toBeNull();
  expect(viewport, "viewport should be available").not.toBeNull();
  if (!box || !viewport) return;

  expect(box.x, "popup should stay inside the left viewport edge").toBeGreaterThanOrEqual(0);
  expect(box.y, "popup should stay inside the top viewport edge").toBeGreaterThanOrEqual(0);
  expect(box.x + box.width, "popup should stay inside the right viewport edge").toBeLessThanOrEqual(viewport.width);
  expect(box.y + box.height, "popup should stay inside the bottom viewport edge").toBeLessThanOrEqual(viewport.height);

  await expect(popup.locator('[data-testid="anchored-popover-caret"]')).toHaveAttribute(
    "data-placement",
    /^(top|right|bottom|left)$/
  );
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow, "anchored popup should not create document-level horizontal overflow").toBeLessThanOrEqual(1);
}

test.describe("phase 3b detail and post surface polish", () => {
  test("job detail keeps a clear action panel without fake response metrics", async ({ page }) => {
    await page.goto("/jobs/1");

    await expect(page.getByRole("heading", { name: /Video editor for YouTube/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: "About the opportunity" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Creator context" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Reference videos" })).toBeVisible();
    const referenceRail = page.getByRole("region", { name: "Reference videos" });
    await expect(referenceRail).toBeVisible();
    await expect(referenceRail).toContainText("Pacing + retention reference");
    await expect(referenceRail).toContainText("Clean captions + sound style");
    await expect(referenceRail).toContainText("Structure + story flow reference");
    const firstReference = page.getByRole("button", { name: "View reference details: Pacing + retention reference" });
    await expect(firstReference).toBeVisible();
    await firstReference.click({ position: { x: 42, y: 78 } });
    const referenceDialog = page.getByRole("dialog", { name: "Reference video details: Pacing + retention reference" });
    await expect(referenceDialog).toBeVisible();
    await expectAnchoredPopupWithinViewport(page, referenceDialog);
    await expect(page).toHaveURL(/\/jobs\/1$/);
    await expect(referenceDialog).toContainText("What to Reference");
    await expect(referenceDialog).toContainText("Timestamp Notes");
    await expect(referenceDialog).toContainText("Hook pacing");
    await expect(referenceDialog).toContainText("Cold open hits immediately");
    await expect(referenceDialog.getByRole("link", { name: /Open Pacing \+ retention reference at 0 minutes 12 seconds on YouTube/ })).toHaveAttribute(
      "href",
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=12s"
    );
    await expect(referenceDialog.getByRole("link", { name: /Open on YouTube/ })).toHaveAttribute(
      "href",
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    );
    await page.keyboard.press("Escape");
    await expect(referenceDialog).toHaveCount(0);
    const secondReference = page.getByRole("button", { name: "View reference details: Clean captions + sound style" });
    await secondReference.click();
    const secondDialog = page.getByRole("dialog", { name: "Reference video details: Clean captions + sound style" });
    await expect(secondDialog).toBeVisible();
    await expect(secondDialog).toContainText("What to Reference");
    await expect(secondDialog).toContainText("Timestamp Notes");
    await expect(secondDialog).toContainText("Hook setup");
    await expect(secondDialog.getByRole("link", { name: /Open Clean captions \+ sound style at 0 minutes 31 seconds on YouTube/ })).toHaveAttribute(
      "href",
      "https://www.youtube.com/watch?v=3JZ_D3ELwOQ&t=31s"
    );
    await page.keyboard.press("Escape");
    await expect(secondDialog).toHaveCount(0);
    const creatorContextCard = page.getByTestId("job-creator-context-card");
    await expect(creatorContextCard).toBeVisible();
    await expect(creatorContextCard).toContainText("Content niches");
    await expect(creatorContextCard).toContainText("Finance");
    await expect(creatorContextCard).toContainText("Genres");
    await expect(creatorContextCard).toContainText("Explainers");
    await expect(creatorContextCard).toContainText("Formats hired for");
    await expect(creatorContextCard).toContainText("Long-form video");
    await expect(page.getByRole("heading", { name: "About the channel" })).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText("CREATOR CONTEXT");
    const applyButton = page.getByRole("button", { name: "Apply" });
    // The redundant pre-popup proposal textarea was removed: details are now
    // collected in the first-message requirements modal, so the action panel no
    // longer renders the textarea or its helper line.
    await expect(page.getByPlaceholder("Add a short proposal or context for the hiring team.")).toHaveCount(0);
    await expect(page.getByTestId("proposal-textarea-frame")).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText("A few quick details are required");
    await expect(applyButton).toBeVisible();

    const applyPanel = page.getByTestId("job-apply-panel");
    const postedByCard = page.getByTestId("posted-by-card").first();
    const safetyCard = page.getByTestId("job-safety-card");
    const saveButton = page.getByRole("button", { name: /Save/ });
    const shareButton = page.getByRole("button", { name: /Share/ });
    await expect(saveButton).toBeVisible();
    await expect(shareButton).toBeVisible();
    const applyButtonBounds = await applyButton.boundingBox();
    const applyPanelBounds = await applyPanel.boundingBox();
    const postedByBounds = await postedByCard.boundingBox();
    const creatorContextBounds = await creatorContextCard.boundingBox();
    const safetyBounds = await safetyCard.boundingBox();
    const saveBounds = await saveButton.boundingBox();
    const shareBounds = await shareButton.boundingBox();
    // Save/Share stay as a secondary row beneath the primary Apply action,
    // Save on the left and Share on the right (unchanged position).
    expect(saveBounds?.y ?? Number.NEGATIVE_INFINITY).toBeGreaterThan(
      applyButtonBounds?.y ?? Number.POSITIVE_INFINITY
    );
    expect(shareBounds?.y ?? Number.NEGATIVE_INFINITY).toBeGreaterThan(
      applyButtonBounds?.y ?? Number.POSITIVE_INFINITY
    );
    expect(saveBounds?.x ?? Number.POSITIVE_INFINITY).toBeLessThan(
      shareBounds?.x ?? Number.NEGATIVE_INFINITY
    );
    expect(applyPanelBounds?.y ?? Number.POSITIVE_INFINITY).toBeLessThan(
      postedByBounds?.y ?? Number.NEGATIVE_INFINITY
    );
    expect(postedByBounds?.y ?? Number.POSITIVE_INFINITY).toBeLessThan(
      creatorContextBounds?.y ?? Number.NEGATIVE_INFINITY
    );
    expect(creatorContextBounds?.y ?? Number.POSITIVE_INFINITY).toBeLessThan(
      safetyBounds?.y ?? Number.NEGATIVE_INFINITY
    );
    await expect(postedByCard.getByRole("heading", { name: "Posted by" })).toHaveClass(/sr-only/);
    await expect(postedByCard.getByText(/Hiring on behalf of Finance Channel/)).toBeVisible();
    await expect(postedByCard.getByText("Managed by Example Creator Agency")).toBeVisible();
    await expect(postedByCard.getByText("No reviews yet")).toHaveCount(0);
    await expect(postedByCard.getByRole("link", { name: /Open Example Creator Agency CreatorJobs profile/ })).toHaveAttribute(
      "href",
      "/u/example-agency?view=hiring"
    );
    await expect(postedByCard).not.toContainText("View CreatorJobs profile");
    const channelRating = page.getByTestId("job-channel-rating");
    await expect(channelRating).toBeVisible();
    await expect(channelRating).toContainText("4.6");
    await expect(channelRating).toContainText("(5)");
    await expect(channelRating).toHaveAttribute("href", "/u/finance-creator?view=hiring&tab=reviews");
    await expect(page.locator("body")).toContainText("Safety & expectations");
    const transparencyCard = page.getByTestId("job-transparency-card");
    await expect(transparencyCard).toContainText("not a safety or quality score");
    await expect(transparencyCard).not.toContainText(/trust score|safety score:\s*\d/i);
    await expect(page.locator("body")).toContainText(/Report this listing|Report listing/);
    const reportBounds = await page.getByRole("button", { name: /Report this listing|Report listing/ }).boundingBox();
    expect(reportBounds?.y ?? Number.POSITIVE_INFINITY).toBeGreaterThan(
      safetyBounds?.y ?? Number.NEGATIVE_INFINITY
    );
    await expect(page.locator("body")).not.toContainText(/USD|\$[0-9]|Proof/i);
    await expect(postedByCard).not.toContainText(/★★★★★|[1-9][0-9]* reviews as recruiter/);
  });

  test("direct posted job opens the creator profile from the Posted by card", async ({ page }) => {
    await page.goto("/jobs/3");

    const postedByCard = page.getByTestId("posted-by-card");
    await expect(postedByCard.getByRole("heading", { name: "Posted by" })).toHaveClass(/sr-only/);
    await expect(postedByCard.getByRole("link", { name: /Open Edu Hindi CreatorJobs profile/ })).toHaveAttribute(
      "href",
      "/u/edu-hindi?view=hiring"
    );
    await expect(postedByCard.getByText("Hiring directly · Creator", { exact: true })).toBeVisible();
    await expect(postedByCard.getByText("No reviews yet")).toHaveCount(0);
    await expect(postedByCard).not.toContainText("Posted by agency");
    await expect(page.locator("body")).not.toContainText(/USD|\$[0-9]|Proof/i);
    const channelRating = page.getByTestId("job-channel-rating");
    await expect(channelRating).toBeVisible();
    await expect(channelRating).toHaveAttribute("href", "/u/edu-hindi?view=hiring&tab=reviews");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await postedByCard.getByRole("link", { name: /Open Edu Hindi CreatorJobs profile/ }).click();
    await expect(page).toHaveURL(/\/u\/edu-hindi\?view=hiring$/);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("job cards remove start timing while keeping activity stats", async ({ page }) => {
    await page.goto("/jobs");

    await expect(page.getByText("Video editor for YouTube", { exact: false }).first()).toBeVisible();
    await expect(page.locator("body")).toContainText("Response rate");
    await expect(page.locator("body")).not.toContainText(/Start:/i);
    await expect(page.locator("body")).not.toContainText("Posted by agency");
    await expect(page.locator('[role="link"]').filter({ hasText: /^Verified$/i })).toHaveCount(0);
    await expect(page.locator('[role="link"]').filter({ hasText: /Representation verified|Verified via|Authorization verified/i })).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText(/USD|\$[0-9]|Proof/i);
  });

  test("zero job stats remain visible on both cards and detail panels", async ({ page }) => {
    await page.goto("/jobs");

    const zeroJobCard = page.getByRole("link").filter({ hasText: "Designer for explainer diagrams + simple motion overlays" }).first();
    await expect(zeroJobCard).toBeVisible();
    await expect(zeroJobCard).toContainText("Views");
    await expect(zeroJobCard).toContainText("0%");

    await page.goto("/jobs/15");
    await expect(page.getByRole("heading", { name: /Designer for explainer diagrams/i })).toBeVisible();
    await expect(page.locator("body")).toContainText("Views");
    await expect(page.locator("body")).toContainText("0");
    await expect(page.locator("body")).toContainText("Response rate");
    await expect(page.locator("body")).toContainText("0%");
  });

  test("talent detail keeps work-sample-first recruiter context", async ({ page }) => {
    await page.goto("/talent/mock-talent-retention-editor");

    await expect(page.getByRole("heading", { name: /RETENTION EDITOR/i })).toBeVisible();
    const contactButton = page.getByRole("button", { name: "Hire Me" }).first();
    // The redundant pre-popup message textarea was removed: details are now
    // collected in the first-message requirements modal, so the action panel no
    // longer renders the textarea or its helper line.
    await expect(page.getByTestId("talent-message-textarea-frame")).toHaveCount(0);
    await expect(page.getByPlaceholder("Add a short message for the candidate.")).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText("A few quick details are required");
    await expect(contactButton).toBeVisible();
    const saveButton = page.getByRole("button", { name: /Save/ }).first();
    const shareButton = page.getByRole("button", { name: /Share/ }).first();
    await expect(saveButton).toBeVisible();
    await expect(shareButton).toBeVisible();
    const actionCard = page.getByTestId("talent-action-card");
    const metadataCard = page.getByTestId("talent-metadata-card");
    const safetyCard = page.getByTestId("talent-safety-card");
    await expect(actionCard).toBeVisible();
    await expect(metadataCard).toBeVisible();
    await expect(metadataCard).toContainText("Content niches");
    await expect(metadataCard).toContainText("Education");
    await expect(metadataCard).toContainText("Genres");
    await expect(metadataCard).toContainText("Explainers");
    await expect(metadataCard).toContainText("Formats offered");
    await expect(metadataCard).toContainText("Shorts");
    await expect(metadataCard).toContainText("Tools");
    await expect(metadataCard.getByTestId("tool-chip").filter({ hasText: "Adobe Premiere Pro" })).toHaveAttribute(
      "data-tool-logo-key",
      "premiere-pro"
    );
    await expect(metadataCard.getByTestId("tool-chip").filter({ hasText: "Adobe After Effects" })).toHaveAttribute(
      "data-tool-logo-key",
      "after-effects"
    );
    await expect(page.getByRole("heading", { name: "Creator context" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Tools" })).toHaveCount(0);
    const contactBounds = await contactButton.boundingBox();
    const saveBounds = await saveButton.boundingBox();
    const shareBounds = await shareButton.boundingBox();
    const actionBounds = await actionCard.boundingBox();
    const metadataBounds = await metadataCard.boundingBox();
    const safetyBounds = await safetyCard.boundingBox();
    // Save/Share remain a secondary row beneath the primary Hire action,
    // Save on the left and Share on the right (unchanged position).
    expect(saveBounds?.y ?? Number.NEGATIVE_INFINITY).toBeGreaterThan(
      contactBounds?.y ?? Number.POSITIVE_INFINITY
    );
    expect(saveBounds?.x ?? Number.POSITIVE_INFINITY).toBeLessThan(
      shareBounds?.x ?? Number.NEGATIVE_INFINITY
    );
    expect(actionBounds?.y ?? Number.POSITIVE_INFINITY).toBeLessThan(
      metadataBounds?.y ?? Number.NEGATIVE_INFINITY
    );
    expect(metadataBounds?.y ?? Number.POSITIVE_INFINITY).toBeLessThan(
      safetyBounds?.y ?? Number.NEGATIVE_INFINITY
    );
    await expect(page.locator("body")).toContainText("Relevant portfolio");
    await expect(page.locator("body")).toContainText("Interested recruiters");
    await expect(page.locator("body")).toContainText(/Posted \d+ (day|week|month)s? ago|Posted just now/);
    await expect(page.locator("body")).not.toContainText("Featured");
    await expect(page.locator("body")).toContainText("Safety & expectations");
    await expect(page.locator("body")).toContainText("Report this listing");
    await expect(page.locator("body")).not.toContainText(
      /CONTACT|Use this panel to invite talent|Contact without a job|Proof|Selective|1 slot open|USD|\$[0-9]/
    );
  });

  test("post flows keep creatorjobs-native language", async ({ page }) => {
    await page.goto("/post-job");
    await expect(page.getByRole("heading", { name: "Who are you hiring for?" })).toBeVisible();
    await expect(page.locator("body")).toContainText("Hiring for");
    await expect(page.locator("body")).toContainText(/Save draft|Safety & expectations/);
    await expect(page.locator("body")).not.toContainText(/\$[0-9]|Coming soon/);
    await expect(page.locator("body")).not.toContainText(/Creator-led media|Monthly/);
    await expect(page.locator("body")).not.toContainText(/^Editing$/);

    await page.goto("/post-talent");
    await expect(page.locator("body")).toContainText(/Create talent listing|Welcome back/);
    await expect(page.locator("body")).not.toContainText(/Proof|Post availability|Enlist as talent|USD|\$[0-9]/);
  });

  test("checkout remains a protected free-beta flow", async ({ page }) => {
    await page.goto("/pricing/checkout?kind=talent_listing");
    await expect(page).toHaveURL(/\/auth\?mode=login/);
  });
});
