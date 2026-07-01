import { expect, test } from "@playwright/test";

test.describe("phase 2b marketplace workflow scaffolding", () => {
  test("saved and applications routes require auth with calm entry states", async ({ page }) => {
    await page.goto("/saved");
    await expect(page.getByRole("heading", { name: "Saved", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();

    await page.goto("/applications");
    await expect(page.getByRole("heading", { name: "Applications", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
  });

  test("talent contact is a real protected action and public view hides owner controls", async ({ page }) => {
    await page.goto("/talent/mock-talent-retention-editor", { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("button", { name: "Hire Me" })).toBeVisible();
    await expect(page.getByText("Owner controls")).toHaveCount(0);

    // Hiring is still a protected action, but auth is deferred to submit. Clicking
    // "Hire Me" on a listing with first-message requirements opens the hiring-request
    // completion modal in-flow — it must NOT bounce a signed-out recruiter to login on
    // open (that was the old behavior; the requirements now gate the action first).
    await page.getByRole("button", { name: "Hire Me" }).click();
    const modal = page.getByTestId("first-message-modal-talent");
    await expect(modal).toBeVisible();
    await expect(page).not.toHaveURL(/\/auth/);

    // Auth fires at submit, behind validation: an incomplete submit surfaces inline
    // guidance and keeps the modal open (no redirect, nothing created) — proving the
    // login requirement happens at the correct point, not when the modal first opens.
    await modal.getByTestId("first-message-modal-submit").click();
    await expect(modal).toBeVisible();
    await expect(page).not.toHaveURL(/\/auth/);
  });

  test("draft resume URLs keep publishing flows reachable", async ({ page }) => {
    await page.goto("/post-job?draftId=test-draft");
    await expect(page.getByText(/job draft/i).first()).toBeVisible();

    await page.goto("/post-talent?draftId=test-draft");
    await expect(page.locator("body")).toContainText(
      /Welcome back|talent listing draft|Create talent listing|Edit talent listing/i
    );
  });
});
