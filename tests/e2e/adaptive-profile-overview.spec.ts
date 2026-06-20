import { expect, test } from "@playwright/test";

test.describe("adaptive profile overview", () => {
  test("public and owner profile routes render", async ({ page }) => {
    await page.goto("/u/aarav-mehta?view=talent");
    await expect(page.getByRole("heading", { name: "Aarav Mehta" })).toBeVisible();

    await page.goto("/you");
    await expect(page.locator("body")).toContainText(/Sign in to open your workspace|You/);
  });

  test("Talent view uses the mode-specific overview layout", async ({ page }) => {
    await page.goto("/u/aarav-mehta?view=talent");
    const main = page.getByRole("main");

    await expect(page.getByRole("heading", { name: "Aarav Mehta" })).toBeVisible();
    await expect(main.getByRole("button", { name: "Talent" })).toHaveAttribute("aria-pressed", "true");
    await expect(main.getByRole("button", { name: "Recruiter" })).toBeVisible();
    await expect(main.getByRole("button", { name: "Hiring" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Overview", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Portfolio", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Jobs", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Reviews", exact: true })).toBeVisible();
    await expect(page.locator("body")).toContainText("Bio");
    await expect(page.locator("body")).toContainText("Experience");
    await expect(page.locator("body")).toContainText("Portfolio");
    await expect(page.locator("body")).toContainText("Reviews");
    await expect(page.locator("body")).not.toContainText("Profile metadata");
    await expect(page.locator("body")).not.toContainText("Roles & content");
    await expect(page.locator("body")).not.toContainText("Profile details");
    await expect(page.locator("body")).not.toContainText("Verified collaborations");
    await expect(page.getByRole("heading", { name: "Collaboration", exact: true })).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText("Work samples");
    await expect(page.locator("body")).toContainText(/\|\s+.*Creator/);
    await expect(page.locator("body")).toContainText("Present");
    await expect(page.locator("body")).toContainText("Premiere Pro");
    await expect(page.locator("body")).toContainText("Finance Creator Team");
    await expect(page.locator("body")).toContainText("SaaS Founder YouTube Channel");
    await expect(page.locator("body")).toContainText("Podcast Production House");
    await expect(page.locator("body")).not.toContainText("Logo URL");
    await expect(page.locator("body")).not.toContainText("Auto-detected platform");
    await expect(page.locator("body")).not.toContainText(/Name from URL|Resolved name/);
    await main.getByRole("button", { name: /Creator/ }).first().click();
    await expect(page.getByRole("dialog", { name: /Creator/ })).toBeVisible();
    await expect(page.getByRole("dialog")).toContainText("Choose where to open");
    await expect(page.getByRole("dialog")).toContainText("Website");
    await expect(page.getByRole("dialog")).toContainText("YouTube");
    await page.getByRole("button", { name: "Close organization links" }).click();
    await expect(page.locator("body")).not.toContainText("Add experience");
    await expect(page.getByRole("link", { name: /YouTube ·/ })).toBeVisible();
    await expect(page.getByRole("link", { name: "Open website" })).toBeVisible();
    const bioY = (await page.getByRole("heading", { name: "Bio" }).boundingBox())?.y ?? 0;
    const experienceY = (await page.getByRole("heading", { name: "Experience" }).boundingBox())?.y ?? 0;
    const portfolioY = (await page.getByRole("heading", { name: "Portfolio" }).last().boundingBox())?.y ?? 0;
    const reviewsY = (await page.getByRole("heading", { name: "Reviews" }).boundingBox())?.y ?? 0;
    const presentY = (await page.getByText("Present").first().boundingBox())?.y ?? 0;
    const pastEntryY = (await page.getByText("Education Channel").first().boundingBox())?.y ?? 0;
    expect(bioY).toBeLessThan(experienceY);
    expect(experienceY).toBeLessThan(portfolioY);
    expect(portfolioY).toBeLessThan(reviewsY);
    expect(presentY).toBeLessThan(pastEntryY);
    const reviewsPreview = page.getByLabel("Reviews preview");
    await expect(reviewsPreview).toBeVisible();
    expect(await reviewsPreview.locator(".snap-start").count()).toBeLessThanOrEqual(4);
    await page.getByRole("button", { name: "View Full Portfolio" }).click();
    await expect(page.getByRole("button", { name: "Portfolio", exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Overview", exact: true }).click();
    await page.getByRole("button", { name: "View All Reviews" }).click();
    await expect(page.getByRole("button", { name: "Reviews", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("body")).toContainText("out of 5");
    await expect(page.locator("body")).not.toContainText(/Talent overview|Reviews as talent|Reviews as recruiter|Reviews as hirer|Reviews as hiring|Proof|USD|\$[0-9]/);
  });

  test("mock talent profiles expose multiple experience rows for scroll and list coverage", async ({ page }) => {
    await page.goto("/u/anika-rao?view=talent");

    await expect(page.getByRole("heading", { name: "Anika Rao" })).toBeVisible();
    await expect(page.locator("body")).toContainText("Fitness Shorts Studio");
    await expect(page.locator("body")).toContainText("Beauty & Lifestyle Page");
    await expect(page.locator("body")).toContainText("Travel Vlog Channel");
    await expect(page.locator("body")).toContainText("Full-time");
    await expect(page.locator("body")).toContainText("Freelance");
    await expect(page.locator("body")).toContainText("Contract");
  });

  test("Recruiter view uses the recruiter overview layout", async ({ page }) => {
    await page.goto("/u/finance-creator?view=hiring");
    const main = page.getByRole("main");

    await expect(page.getByRole("heading", { name: "Finance Channel", exact: true })).toBeVisible();
    await expect(main.getByRole("button", { name: "Recruiter" })).toHaveAttribute("aria-pressed", "true");
    await expect(main.getByRole("button", { name: "Hiring" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Jobs", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Portfolio", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Reviews", exact: true })).toBeVisible();
    await expect(page.locator("body")).toContainText("Bio");
    await expect(page.locator("body")).toContainText("Recent Hires");
    await expect(page.locator("body")).not.toContainText("Hiring For");
    await expect(page.locator("body")).toContainText("Jobs");
    await expect(page.locator("body")).toContainText("Reviews");
    await expect(page.locator("body")).not.toContainText("Profile metadata");
    await expect(page.locator("body")).not.toContainText("Hiring profile");
    await expect(page.locator("body")).not.toContainText("Recruiter details");
    await expect(page.locator("body")).not.toContainText("Verified collaborations");
    await expect(page.getByRole("heading", { name: "Collaboration", exact: true })).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText("Portfolio");
    const bioY = (await page.getByRole("heading", { name: "Bio" }).boundingBox())?.y ?? 0;
    const hiringY = (await page.getByRole("heading", { name: "Recent Hires" }).boundingBox())?.y ?? 0;
    const jobsY = (await page.getByRole("heading", { name: "Jobs" }).last().boundingBox())?.y ?? 0;
    const reviewsY = (await page.getByRole("heading", { name: "Reviews" }).boundingBox())?.y ?? 0;
    expect(bioY).toBeLessThan(hiringY);
    expect(hiringY).toBeLessThan(jobsY);
    expect(jobsY).toBeLessThan(reviewsY);
    const recentHiresSection = page.locator("article").filter({
      has: page.getByRole("heading", { name: "Recent Hires" }),
    });
    await expect(recentHiresSection).not.toContainText(/Hired [a-z]/i);
    const jobsPreview = page.getByLabel("Jobs preview");
    await expect(jobsPreview).toBeVisible();
    expect(await jobsPreview.locator(".snap-start").count()).toBeLessThanOrEqual(3);
    await page.getByRole("button", { name: "View All Jobs" }).click();
    await expect(page.getByRole("button", { name: "Jobs", exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Overview", exact: true }).click();
    const recruiterReviewsPreview = page.getByLabel("Reviews preview");
    await expect(recruiterReviewsPreview).toBeVisible();
    expect(await recruiterReviewsPreview.locator(".snap-start").count()).toBeLessThanOrEqual(4);
    await expect(page.locator("body")).not.toContainText("Posted by agency");
    await page.getByRole("button", { name: "View All Reviews" }).click();
    await expect(page.getByRole("button", { name: "Reviews", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("body")).toContainText("out of 5");
    await expect(page.locator("body")).not.toContainText(/Recruiter overview|Talent overview|Reviews as talent|Reviews as recruiter|Reviews as hirer|Reviews as hiring|Candidate|Employee|Employer|Proof|USD|\$[0-9]/);
  });

  test("agency recruiter overview shows Hiring For identity rail", async ({ page }) => {
    await page.goto("/u/example-agency?view=hiring");

    await expect(page.getByRole("heading", { name: "Example Creator Agency", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Recent Hires" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Hiring For" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Jobs" }).last()).toBeVisible();
    await expect(page.getByRole("button", { name: "Portfolio", exact: true })).toHaveCount(0);

    const recentHiresY = (await page.getByRole("heading", { name: "Recent Hires" }).boundingBox())?.y ?? 0;
    const hiringForY = (await page.getByRole("heading", { name: "Hiring For" }).boundingBox())?.y ?? 0;
    const jobsY = (await page.getByRole("heading", { name: "Jobs" }).last().boundingBox())?.y ?? 0;
    expect(recentHiresY).toBeLessThan(hiringForY);
    expect(hiringForY).toBeLessThan(jobsY);

    const hiringForRail = page.getByLabel("Hiring For channels");
    await expect(hiringForRail).toBeVisible();
    expect(await hiringForRail.locator(".snap-start").count()).toBeGreaterThan(3);
    await expect(hiringForRail).toContainText("Finance Channel");
    await expect(hiringForRail).toContainText("Study Sprint");
    await expect(hiringForRail).not.toContainText("Pending Creator Page");
    await expect(hiringForRail).not.toContainText(/subscribers|followers|Verified/i);
  });

  test("switch changes overview content between Talent and Recruiter", async ({ page }) => {
    await page.goto("/u/aarav-mehta?view=talent");

    await expect(page.locator("body")).toContainText("Experience");
    await expect(page.locator("body")).not.toContainText("Hiring For");
    await expect(page.getByRole("button", { name: "Portfolio", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Jobs", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Reviews", exact: true })).toBeVisible();
    await page.getByRole("main").getByRole("button", { name: "Recruiter" }).click();
    await expect(page).toHaveURL(/\/u\/aarav-mehta\?view=hiring$/);
    await expect(page.locator("body")).toContainText("Bio");
    await expect(page.getByRole("button", { name: "Jobs", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Portfolio", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Reviews", exact: true })).toBeVisible();

    await page.getByRole("main").getByRole("button", { name: "Talent" }).click();
    await expect(page).toHaveURL(/\/u\/aarav-mehta\?view=talent$/);
    await expect(page.locator("body")).toContainText("Experience");
    await expect(page.locator("body")).not.toContainText("Roles & content");
    await expect(page.locator("body")).not.toContainText("Profile details");
  });

  test("talent and job entry points pass the intended profile view", async ({ page }) => {
    await page.goto("/talent/mock-talent-retention-editor");

    await page.getByRole("link", { name: "Aarav Mehta" }).click();
    await expect(page).toHaveURL(/\/u\/aarav-mehta\?view=talent$/);

    await page.goto("/jobs/1");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator('a[href="https://www.youtube.com/@financecreator"]').first()).toBeVisible();
    await expect(page.getByRole("link", { name: /Open Example Creator Agency CreatorJobs profile/ }).first()).toHaveAttribute(
      "href",
      "/u/example-agency?view=hiring"
    );
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});
