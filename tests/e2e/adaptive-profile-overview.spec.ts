import { expect, test } from "@playwright/test";

test.describe("adaptive profile overview", () => {
  test("public and owner profile routes render", async ({ page }) => {
    await page.goto("/u/aarav-mehta?view=talent");
    await expect(page.getByRole("heading", { name: "Aarav Mehta" })).toBeVisible();

    await page.goto("/you");
    await expect(page.locator("body")).toContainText(/Sign in to open your workspace|You/);
  });

  test("Talent view restores the old clean overview layout", async ({ page }) => {
    await page.goto("/u/aarav-mehta?view=talent");
    const main = page.getByRole("main");

    await expect(page.getByRole("heading", { name: "Aarav Mehta" })).toBeVisible();
    await expect(main.getByRole("button", { name: "Talent" })).toHaveAttribute("aria-pressed", "true");
    await expect(main.getByRole("button", { name: "Recruiter" })).toBeVisible();
    await expect(main.getByRole("button", { name: "Hiring" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Overview", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Portfolio", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Jobs", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Reviews" })).toHaveCount(0);
    await expect(page.locator("body")).toContainText("Experience");
    await expect(page.locator("body")).toContainText("Roles & content");
    await expect(page.locator("body")).toContainText("Profile details");
    await expect(page.locator("body")).toContainText("Collaboration");
    await expect(page.locator("body")).toContainText("Portfolio");
    await expect(page.locator("body")).toContainText("Talent listings");
    await expect(page.locator("body")).toContainText("Jobs");
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
    await expect(page.getByRole("link", { name: "Open YouTube" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Open website" })).toBeVisible();
    const experienceY = (await page.getByRole("heading", { name: "Experience" }).boundingBox())?.y ?? 0;
    const rolesY = (await page.getByRole("heading", { name: "Roles & content" }).boundingBox())?.y ?? 0;
    const presentY = (await page.getByText("Present").first().boundingBox())?.y ?? 0;
    const pastEntryY = (await page.getByText("Education Channel").first().boundingBox())?.y ?? 0;
    expect(experienceY).toBeLessThan(rolesY);
    expect(presentY).toBeLessThan(pastEntryY);
    await expect(page.locator("body")).not.toContainText(/Talent overview|Reviews as talent|Reviews as recruiter|Reviews as hirer|Reviews as hiring|Proof|★★★★★|4\.[5-9]|5\.0|USD|\$[0-9]/);
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

  test("Recruiter view uses the same restored overview layout", async ({ page }) => {
    await page.goto("/u/finance-creator?view=hiring");
    const main = page.getByRole("main");

    await expect(page.getByRole("heading", { name: "Finance Channel" })).toBeVisible();
    await expect(main.getByRole("button", { name: "Recruiter" })).toHaveAttribute("aria-pressed", "true");
    await expect(main.getByRole("button", { name: "Hiring" })).toHaveCount(0);
    await expect(page.locator("body")).toContainText("Hiring profile");
    await expect(page.locator("body")).toContainText("Recruiter details");
    await expect(page.locator("body")).toContainText("Collaboration");
    await expect(page.locator("body")).toContainText("Jobs");
    await expect(page.locator("body")).toContainText("Portfolio");
    await expect(page.locator("body")).toContainText("Talent listings");
    await expect(page.locator("body")).not.toContainText(/Recruiter overview|Talent overview|Reviews as talent|Reviews as recruiter|Reviews as hirer|Reviews as hiring|Candidate|Employee|Employer|Proof|★★★★★|4\.[5-9]|5\.0|USD|\$[0-9]/);
  });

  test("switch changes overview content between Talent and Recruiter", async ({ page }) => {
    await page.goto("/u/aarav-mehta?view=talent");

    await expect(page.locator("body")).toContainText("Roles & content");
    await page.getByRole("main").getByRole("button", { name: "Recruiter" }).click();
    await expect(page).toHaveURL(/\/u\/aarav-mehta\?view=hiring$/);
    await expect(page.locator("body")).toContainText("Hiring profile");
    await expect(page.locator("body")).toContainText("Recruiter details");

    await page.getByRole("main").getByRole("button", { name: "Talent" }).click();
    await expect(page).toHaveURL(/\/u\/aarav-mehta\?view=talent$/);
    await expect(page.locator("body")).toContainText("Roles & content");
    await expect(page.locator("body")).toContainText("Profile details");
  });

  test("talent and job entry points pass the intended profile view", async ({ page }) => {
    await page.goto("/talent/mock-talent-retention-editor");

    await page.getByRole("link", { name: "Aarav Mehta" }).click();
    await expect(page).toHaveURL(/\/u\/aarav-mehta\?view=talent$/);

    await page.goto("/jobs/1");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByRole("link", { name: /Finance Creator/ }).first().click();
    await expect(page).toHaveURL(/\/u\/finance-creator\?view=hiring$/);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});
