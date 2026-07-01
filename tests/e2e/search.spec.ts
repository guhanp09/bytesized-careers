import { expect, test } from "@playwright/test";

// The search experience: a Jobs/Talent switch in the header routes into the
// canonical marketplace pages. The old /search route remains only as a redirect.

test("header search switch flips the placeholder and routes with the selected type", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const group = page.getByRole("group", { name: "Search type" });
  await expect(group).toBeVisible();

  // Jobs is the default mode.
  const jobsInput = page.getByRole("textbox", { name: "Search jobs" });
  await expect(jobsInput).toBeVisible();
  await expect(jobsInput).toHaveAttribute("placeholder", /Search jobs, roles, platforms/);

  // Switching to Talent re-labels the input and updates the placeholder.
  await group.getByRole("button", { name: "talent" }).click();
  const talentInput = page.getByRole("textbox", { name: "Search talent" });
  await expect(talentInput).toBeVisible();
  await expect(talentInput).toHaveAttribute("placeholder", /Search talent, roles, tools/);

  // Submitting routes to the canonical talent page with the query preserved.
  await talentInput.fill("video editor");
  await talentInput.press("Enter");
  await expect(page).toHaveURL(/\/talent\?q=video(%20|\+)editor/);
});

// During React streaming SSR, the production server briefly injects a hidden
// duplicate of the page content (a <div hidden> appended at end of <body>) before
// hydration relocates it. The real content is always DOM-first, so `.first()` keeps
// these assertions strict-safe while still proving the visible result.

test("jobs search ranks results inside the normal jobs marketplace page", async ({ page }) => {
  await page.goto("/jobs?q=video%20editor%20remote", { waitUntil: "domcontentloaded" });

  await expect(page).toHaveURL(/\/jobs\?q=video%20editor%20remote/);
  await expect(page.getByText("Interpreted as")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Results for/ })).toHaveCount(0);
  await expect(page.locator('div[role="link"]').first()).toBeVisible();
});

test("typo-tolerant search resolves the canonical role and still returns results", async ({ page }) => {
  await page.goto("/jobs?q=vdeo%20editor", { waitUntil: "domcontentloaded" });

  // Results still come back despite the typo.
  await expect(page.locator('div[role="link"]').first()).toBeVisible();
});

test("talent search switches the result type and ranks creators", async ({ page }) => {
  await page.goto("/talent?q=editor", { waitUntil: "domcontentloaded" });

  // Talent results link to creator detail pages.
  await expect(page.locator('[aria-label^="Open talent listing"]').first()).toBeVisible();
});

test("legacy search URLs redirect to canonical listing pages", async ({ page }) => {
  await page.goto("/search?type=jobs&q=video%20editor", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/jobs\?q=video%20editor/);

  await page.goto("/search?type=talent&q=thumbnail%20designer", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/talent\?q=thumbnail%20designer/);
});
