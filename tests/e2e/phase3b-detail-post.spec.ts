import { expect, test } from "@playwright/test";

test.describe("phase 3b detail and post surface polish", () => {
  test("job detail keeps a clear action panel without fake response metrics", async ({ page }) => {
    await page.goto("/jobs/1");

    await expect(page.getByRole("heading", { name: /Video editor for YouTube/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: "About the brand" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "About the channel" })).toHaveCount(0);
    const proposalBox = page.getByPlaceholder("Add a short proposal or context for the hiring team.");
    const applyButton = page.getByRole("button", { name: "Apply" });
    await expect(proposalBox).toBeVisible();
    await expect(proposalBox).toHaveAttribute("maxlength", "600");
    const proposalFrame = page.getByTestId("proposal-textarea-frame");
    const counter = proposalFrame.getByText("0/600");
    await expect(counter).toBeVisible();
    await expect(applyButton).toBeVisible();
    const proposalBoxBounds = await proposalBox.boundingBox();
    const proposalFrameBounds = await proposalFrame.boundingBox();
    const counterBounds = await counter.boundingBox();
    const applyButtonBounds = await applyButton.boundingBox();
    const applyPanel = page.getByTestId("job-apply-panel");
    const postedByCard = page.getByTestId("posted-by-card").first();
    const safetyCard = page.getByTestId("job-safety-card");
    const applyPanelBounds = await applyPanel.boundingBox();
    const postedByBounds = await postedByCard.boundingBox();
    const safetyBounds = await safetyCard.boundingBox();
    expect(counterBounds?.x ?? Number.NEGATIVE_INFINITY).toBeGreaterThanOrEqual(
      proposalFrameBounds?.x ?? Number.POSITIVE_INFINITY
    );
    expect(counterBounds?.y ?? Number.NEGATIVE_INFINITY).toBeGreaterThanOrEqual(
      proposalFrameBounds?.y ?? Number.POSITIVE_INFINITY
    );
    expect((counterBounds?.x ?? 0) + (counterBounds?.width ?? 0)).toBeLessThanOrEqual(
      (proposalFrameBounds?.x ?? 0) + (proposalFrameBounds?.width ?? 0)
    );
    expect((counterBounds?.y ?? 0) + (counterBounds?.height ?? 0)).toBeLessThanOrEqual(
      (proposalFrameBounds?.y ?? 0) + (proposalFrameBounds?.height ?? 0)
    );
    expect(proposalBoxBounds?.y ?? Number.POSITIVE_INFINITY).toBeLessThan(
      applyButtonBounds?.y ?? Number.NEGATIVE_INFINITY
    );
    expect(applyPanelBounds?.y ?? Number.POSITIVE_INFINITY).toBeLessThan(
      postedByBounds?.y ?? Number.NEGATIVE_INFINITY
    );
    expect(postedByBounds?.y ?? Number.POSITIVE_INFINITY).toBeLessThan(
      safetyBounds?.y ?? Number.NEGATIVE_INFINITY
    );
    await expect(page.getByRole("button", { name: /Save/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Share/ })).toBeVisible();
    await expect(postedByCard.getByRole("heading", { name: "Posted by" })).toHaveClass(/sr-only/);
    await expect(postedByCard.getByText("Example Creator Agency")).toBeVisible();
    await expect(postedByCard.getByText(/Agency · Hiring for Finance/)).toBeVisible();
    await expect(postedByCard.getByText("☆☆☆☆☆ 0 reviews as recruiter")).toBeVisible();
    await expect(postedByCard.getByRole("link", { name: "Example Creator Agency" })).toHaveAttribute(
      "href",
      "/u/example-agency?view=hiring"
    );
    await expect(postedByCard).not.toContainText("View CreatorJobs profile");
    await expect(page.locator("body")).toContainText("Safety & expectations");
    await expect(page.locator("body")).toContainText("82%");
    await expect(page.locator("body")).toContainText(/Report this listing|Report listing/);
    const reportBounds = await page.getByRole("button", { name: /Report this listing|Report listing/ }).boundingBox();
    expect(reportBounds?.y ?? Number.POSITIVE_INFINITY).toBeGreaterThan(
      safetyBounds?.y ?? Number.NEGATIVE_INFINITY
    );
    await expect(page.locator("body")).not.toContainText(/Start:|USD|\$[0-9]|Proof/i);
    await expect(page.locator("body")).not.toContainText(/★★★★★|4\.[5-9]|5\.0|[1-9][0-9]* reviews/);
  });

  test("direct posted job opens the creator profile from the Posted by card", async ({ page }) => {
    await page.goto("/jobs/3");

    const postedByCard = page.getByTestId("posted-by-card");
    await expect(postedByCard.getByRole("heading", { name: "Posted by" })).toHaveClass(/sr-only/);
    await expect(postedByCard.getByRole("link", { name: "Edu Hindi" })).toHaveAttribute(
      "href",
      "/u/edu-hindi?view=hiring"
    );
    await expect(postedByCard.getByText("Creator", { exact: true })).toBeVisible();
    await expect(postedByCard.getByText("☆☆☆☆☆ 0 reviews as recruiter")).toBeVisible();
    await expect(postedByCard).not.toContainText("Posted by agency");
    await expect(page.locator("body")).not.toContainText(/USD|\$[0-9]|Proof|★★★★★|4\.[5-9]|5\.0|[1-9][0-9]* reviews/i);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await postedByCard.getByRole("link", { name: "Edu Hindi" }).click();
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
    await expect(zeroJobCard).toContainText("Currently viewing");
    await expect(zeroJobCard).toContainText("0%");

    await page.goto("/jobs/15");
    await expect(page.getByRole("heading", { name: /Designer for explainer diagrams/i })).toBeVisible();
    await expect(page.locator("body")).toContainText("Currently viewing");
    await expect(page.locator("body")).toContainText("0");
    await expect(page.locator("body")).toContainText("Response rate");
    await expect(page.locator("body")).toContainText("0%");
  });

  test("talent detail keeps work-sample-first recruiter context", async ({ page }) => {
    await page.goto("/talent/mock-talent-retention-editor");

    await expect(page.getByRole("heading", { name: /RETENTION EDITOR/i })).toBeVisible();
    const messageFrame = page.getByTestId("talent-message-textarea-frame").first();
    const messageBox = messageFrame.getByPlaceholder("Add a short message for the candidate.");
    const contactButton = page.getByRole("button", { name: "Hire me" }).first();
    await expect(messageBox).toBeVisible();
    await expect(messageBox).toHaveAttribute("maxlength", "600");
    await expect(messageFrame.getByText("0/600")).toBeVisible();
    await expect(contactButton).toBeVisible();
    const messageBounds = await messageBox.boundingBox();
    const contactBounds = await contactButton.boundingBox();
    expect(messageBounds?.y ?? Number.POSITIVE_INFINITY).toBeLessThan(
      contactBounds?.y ?? Number.NEGATIVE_INFINITY
    );
    await expect(page.getByRole("button", { name: /Save/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Share/ })).toBeVisible();
    await expect(page.locator("body")).toContainText("Work samples");
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
    await expect(page.getByText("Who are you hiring for?")).toBeVisible();
    await expect(page.locator("body")).toContainText(/Save draft|Safety & expectations/);
    await expect(page.locator("body")).not.toContainText(/USD|\$[0-9]|Coming soon/);
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
