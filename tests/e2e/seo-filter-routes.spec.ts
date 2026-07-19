import { expect, test } from "@playwright/test";

const expectNoHorizontalOverflow = async (page: import("@playwright/test").Page) => {
  await page.waitForTimeout(150);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(2);
};

test.describe("SEO filtered browsing routes", () => {
  test("jobs filter chips route to curated URLs, select the chip, and show no visible SEO title", async ({ page }) => {
    await page.goto("/jobs", { waitUntil: "domcontentloaded" });

    await page.locator('main a[href="/jobs/video-editor-jobs"]').first().click();
    await expect(page).toHaveURL(/\/jobs\/video-editor-jobs$/);
    // The selected chip conveys the filter; there is no visible SEO heading.
    await expect(page.locator('main a[href="/jobs/video-editor-jobs"]').first()).toHaveClass(/vt-chip-active/);
    await expect(page.getByRole("heading", { name: "Video Editor Jobs" })).toHaveCount(0);
    await expect(page.locator('div[role="link"]').first()).toBeVisible();

    await page.goto("/jobs", { waitUntil: "domcontentloaded" });
    await page.locator('main a[href="/jobs/thumbnail-designer-jobs"]').first().click();
    await expect(page).toHaveURL(/\/jobs\/thumbnail-designer-jobs$/);
    await expect(page.locator('main a[href="/jobs/thumbnail-designer-jobs"]').first()).toHaveClass(/vt-chip-active/);
    await expect(page.getByRole("heading", { name: "Thumbnail Designer Jobs" })).toHaveCount(0);

    await page.goto("/jobs", { waitUntil: "domcontentloaded" });
    await page.locator('main a[href="/jobs/shorts-editor-jobs"]').first().click();
    await expect(page).toHaveURL(/\/jobs\/shorts-editor-jobs$/);
    await expect(page.locator('main a[href="/jobs/shorts-editor-jobs"]').first()).toHaveClass(/vt-chip-active/);
    await expect(page.getByRole("heading", { name: "Shorts Editor Jobs" })).toHaveCount(0);
  });

  test("talent filter chips route to curated URLs, select the chip, and show no visible SEO title", async ({ page }) => {
    await page.goto("/talent", { waitUntil: "domcontentloaded" });

    await page.locator('main a[href="/talent/video-editors"]').first().click();
    await expect(page).toHaveURL(/\/talent\/video-editors$/);
    await expect(page.getByRole("heading", { name: "Video Editors" })).toHaveCount(0);
    await expect(page.locator('main a[href="/talent/video-editors"]').first()).toHaveClass(/bg-white/);
    await expect(page.locator('[aria-label^="Open talent listing"]').first()).toBeVisible();

    await page.goto("/talent", { waitUntil: "domcontentloaded" });
    await page.locator('main a[href="/talent/thumbnail-designers"]').first().click();
    await expect(page).toHaveURL(/\/talent\/thumbnail-designers$/);
    await expect(page.getByRole("heading", { name: "Thumbnail Designers" })).toHaveCount(0);
    await expect(page.locator('main a[href="/talent/thumbnail-designers"]').first()).toHaveClass(/bg-white/);
  });

  test("curated routes filter results to the selected intent, not just rank them", async ({ page }) => {
    // Scriptwriter route: cards are writing-relevant; non-writing roles that merely
    // share the YouTube context (thumbnail/motion/channel) are filtered out.
    await page.goto("/talent/youtube-scriptwriters", { waitUntil: "domcontentloaded" });
    const talentCards = page.locator('[aria-label^="Open talent listing"]');
    await expect(talentCards.first()).toBeVisible();
    await expect(talentCards.filter({ hasText: /script|writer/i }).first()).toBeVisible();
    await expect(talentCards.filter({ hasText: /thumbnail/i })).toHaveCount(0);
    await expect(talentCards.filter({ hasText: /motion designer/i })).toHaveCount(0);
    await expect(talentCards.filter({ hasText: /channel manager/i })).toHaveCount(0);

    // Scriptwriter jobs route: only writing jobs, no generic editing jobs.
    await page.goto("/jobs/youtube-scriptwriter-jobs", { waitUntil: "domcontentloaded" });
    const jobCards = page.locator('main div[role="link"]');
    await expect(jobCards.first()).toBeVisible();
    await expect(jobCards.filter({ hasText: /script|writer/i }).first()).toBeVisible();
    await expect(jobCards.filter({ hasText: /thumbnail designer/i })).toHaveCount(0);

    // Video editor jobs route: editing jobs present; unrelated roles filtered out.
    await page.goto("/jobs/video-editor-jobs", { waitUntil: "domcontentloaded" });
    await expect(page.locator('main div[role="link"]').first()).toBeVisible();
    await expect(page.locator('main div[role="link"]').filter({ hasText: /channel manager/i })).toHaveCount(0);
  });

  test("local filters replace an SEO selection instead of silently narrowing it", async ({ page }) => {
    // The active chip is marked by `text-black` on the talent side and by the
    // theme-token active classes (`vt-chip-active-*`) on the jobs side; inactive
    // chips carry neither marker.
    const active = /text-black|vt-chip-active/;

    // Land on a curated SEO route: its chip is active, results are the narrowed set.
    await page.goto("/talent/channel-managers", { waitUntil: "domcontentloaded" });
    await expect(page.locator('main a[href="/talent/channel-managers"]').first()).toHaveClass(active);
    const seoCount = await page.locator('[aria-label^="Open talent listing"]').count();

    // Clicking the local "Remote" chip replaces the SEO selection: it navigates to
    // the base list with the filter applied, not a narrowed channel-manager subset.
    await page.locator('main a[href="/talent?filter=Remote"]').first().click();
    await expect(page).toHaveURL(/\/talent\?filter=Remote$/);
    // The SEO chip is no longer active; the local Remote chip is, and it works.
    await expect(page.locator('main a[href="/talent/channel-managers"]').first()).not.toHaveClass(active);
    await expect(page.getByRole("button", { name: "Remote", exact: true })).toHaveClass(active);
    const remoteCount = await page.locator('[aria-label^="Open talent listing"]').count();
    // Remote-across-all-talent is a broader set than remote-channel-managers-only.
    expect(remoteCount).toBeGreaterThan(seoCount);

    // The same single-select replacement works on the jobs side.
    await page.goto("/jobs/video-editor-jobs", { waitUntil: "domcontentloaded" });
    await page.locator('main a[href="/jobs?filter=Design"]').first().click();
    await expect(page).toHaveURL(/\/jobs\?filter=Design$/);
    await expect(page.locator('main a[href="/jobs/video-editor-jobs"]').first()).not.toHaveClass(active);
    await expect(page.getByRole("button", { name: "Design", exact: true })).toHaveClass(active);
  });

  test("existing detail routes still render detail pages, while unknown slugs are safe not-found pages", async ({ page }) => {
    await page.goto("/jobs/1", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/jobs\/1$/);
    await expect(page.getByRole("heading", { name: /Video editor for YouTube/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Video Editor Jobs" })).toHaveCount(0);

    await page.goto("/jobs/15", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/jobs\/15$/);
    await expect(page.getByRole("heading", { name: /Designer for explainer diagrams/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Jobs$/ })).toHaveCount(0);

    await page.goto("/talent/mock-talent-retention-editor", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/talent\/mock-talent-retention-editor$/);
    await expect(page.getByRole("heading", { name: /RETENTION EDITOR/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Video Editors" })).toHaveCount(0);

    await page.goto("/talent/mock-talent-scriptwriter", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/talent\/mock-talent-scriptwriter$/);
    await expect(page.locator("main")).toContainText(/script/i);
    await expect(page.getByRole("heading", { name: "YouTube Scriptwriters" })).toHaveCount(0);

    await page.goto("/jobs/unknown-random-slug", { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).not.toBeEmpty();
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Jobs$/ })).toHaveCount(0);

    await page.goto("/talent/unknown-random-slug", { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).not.toBeEmpty();
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Editors$/ })).toHaveCount(0);
  });

  test("header search routes strong known intents to SEO URLs and arbitrary searches to ranked query pages", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const jobsInput = page.getByRole("textbox", { name: "Search jobs" });
    await jobsInput.fill("video editor");
    await jobsInput.press("Enter");
    await expect(page).toHaveURL(/\/jobs\/video-editor-jobs$/);

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.getByRole("textbox", { name: "Search jobs" }).fill("video editor jobs");
    await page.getByRole("textbox", { name: "Search jobs" }).press("Enter");
    await expect(page).toHaveURL(/\/jobs\/video-editor-jobs$/);

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.getByRole("textbox", { name: "Search jobs" }).fill("thumbnail designer");
    await page.getByRole("textbox", { name: "Search jobs" }).press("Enter");
    await expect(page).toHaveURL(/\/jobs\/thumbnail-designer-jobs$/);

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.getByRole("textbox", { name: "Search jobs" }).fill("finance youtube editor");
    await page.getByRole("textbox", { name: "Search jobs" }).press("Enter");
    await expect(page).toHaveURL(/\/jobs\/finance-youtube-editor-jobs$/);

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.getByRole("textbox", { name: "Search jobs" }).fill("video editor delhi 10k");
    await page.getByRole("textbox", { name: "Search jobs" }).press("Enter");
    await expect(page).toHaveURL(/\/jobs\?q=video(%20|\+)editor(%20|\+)delhi(%20|\+)10k$/);

    await page.goto("/", { waitUntil: "domcontentloaded" });
    const group = page.getByRole("group", { name: "Search type" });
    await group.getByRole("button", { name: "talent" }).click();
    await page.getByRole("textbox", { name: "Search talent" }).fill("video editor");
    await page.getByRole("textbox", { name: "Search talent" }).press("Enter");
    await expect(page).toHaveURL(/\/talent\/video-editors$/);

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.getByRole("group", { name: "Search type" }).getByRole("button", { name: "talent" }).click();
    await page.getByRole("textbox", { name: "Search talent" }).fill("hire video editor");
    await page.getByRole("textbox", { name: "Search talent" }).press("Enter");
    await expect(page).toHaveURL(/\/talent\/video-editors$/);

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.getByRole("group", { name: "Search type" }).getByRole("button", { name: "talent" }).click();
    await page.getByRole("textbox", { name: "Search talent" }).fill("thumbnail designer");
    await page.getByRole("textbox", { name: "Search talent" }).press("Enter");
    await expect(page).toHaveURL(/\/talent\/thumbnail-designers$/);

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.getByRole("group", { name: "Search type" }).getByRole("button", { name: "talent" }).click();
    await page.getByRole("textbox", { name: "Search talent" }).fill("thumbnail designer chennai finance 5000");
    await page.getByRole("textbox", { name: "Search talent" }).press("Enter");
    await expect(page).toHaveURL(
      /\/talent\?q=thumbnail(%20|\+)designer(%20|\+)chennai(%20|\+)finance(%20|\+)5000$/
    );
  });

  test("curated SEO metadata, query noindex, and sitemap entries are correct", async ({ page, request }) => {
    await page.goto("/jobs/video-editor-jobs", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveTitle("Video Editor Jobs | CreatorJobs");
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      "content",
      "Browse video editor jobs from YouTube creators, creator agencies, and creator-led teams on CreatorJobs."
    );
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/jobs\/video-editor-jobs$/);
    expect((await page.locator('meta[name="robots"]').count()) === 0).toBe(true);

    await page.goto("/jobs/finance-youtube-editor-jobs", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveTitle("Finance YouTube Editor Jobs | CreatorJobs");
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/jobs\/finance-youtube-editor-jobs$/);

    await page.goto("/talent/video-editors", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveTitle("Video Editors | CreatorJobs");
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/talent\/video-editors$/);
    expect((await page.locator('meta[name="robots"]').count()) === 0).toBe(true);

    await page.goto("/jobs?q=video%20editor%20delhi", { waitUntil: "domcontentloaded" });
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/jobs$/);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/i);

    const sitemap = await request.get("/sitemap.xml");
    expect(sitemap.ok()).toBe(true);
    const xml = await sitemap.text();
    expect(xml).toContain("/jobs/video-editor-jobs");
    expect(xml).toContain("/jobs/finance-youtube-editor-jobs");
    expect(xml).toContain("/talent/video-editors");
    expect(xml).toContain("/talent/thumbnail-designers");
    expect(xml).not.toContain("?q=");
    expect(xml).not.toContain("unknown-random-slug");
  });

  test("filtered browse pages stay visually consistent and do not overflow on desktop or mobile", async ({ page }) => {
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);

      await page.goto("/jobs/video-editor-jobs", { waitUntil: "domcontentloaded" });
      // No visible SEO title/intro — the page reads as normal /jobs with a chip selected.
      await expect(page.getByRole("heading", { name: "Video Editor Jobs" })).toHaveCount(0);
      await expect(page.getByText(/Browse video editor jobs from/i)).toHaveCount(0);
      await expect(page.locator('main a[href="/jobs/video-editor-jobs"]').first()).toHaveClass(/vt-chip-active/);
      await expect(page.locator('div[role="link"]').first()).toBeVisible();
      await expectNoHorizontalOverflow(page);

      await page.goto("/talent/video-editors", { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { name: "Video Editors" })).toHaveCount(0);
      await expect(page.getByText(/Browse video editors for/i)).toHaveCount(0);
      await expect(page.locator('main a[href="/talent/video-editors"]').first()).toHaveClass(/bg-white/);
      await expect(page.locator('[aria-label^="Open talent listing"]').first()).toBeVisible();
      await expectNoHorizontalOverflow(page);
    }
  });

  test("Row-2 subfilters appear only after a role is selected, never on the base list", async ({ page }) => {
    // Base browse: no contextual subfilter row.
    await page.goto("/talent", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("subfilter-row")).toHaveCount(0);

    // On a curated role route, the contextual Row-2 appears with role-relevant chips.
    await page.goto("/talent/video-editors", { waitUntil: "domcontentloaded" });
    const row2 = page.getByTestId("subfilter-row");
    await expect(row2).toBeVisible();
    await expect(row2.getByTestId("subfilter-chip").filter({ hasText: "Long-form" })).toBeVisible();
    // Talent offers tool chips; jobs never do.
    await expect(row2.getByTestId("subfilter-chip").filter({ hasText: "Premiere Pro" })).toBeVisible();

    await page.goto("/jobs/video-editor-jobs", { waitUntil: "domcontentloaded" });
    const jobRow2 = page.getByTestId("subfilter-row");
    await expect(jobRow2).toBeVisible();
    await expect(jobRow2.getByTestId("subfilter-chip").filter({ hasText: "Premiere Pro" })).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
  });

  test("ad-hoc subfilter param filters strictly and is noindex; curated combo chip navigates", async ({ page }) => {
    await page.goto("/talent/video-editors", { waitUntil: "domcontentloaded" });
    const allEditors = await page.locator('[aria-label^="Open talent listing"]').count();

    // An ad-hoc refinement (a param chip) narrows results and the page goes noindex.
    await page.getByTestId("subfilter-row").getByTestId("subfilter-chip").filter({ hasText: "Long-form" }).first().click();
    await expect(page).toHaveURL(/\/talent\/video-editors\?format=long-form$/);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/i);
    // Canonical still points at the clean curated route (not the param URL).
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/talent\/video-editors$/);
    // No visible SEO heading even with a refinement applied.
    await expect(page.getByRole("heading", { name: "Video Editors" })).toHaveCount(0);
    // Re-load the refined URL for a clean card count: a soft client-side nav
    // briefly keeps the pre-nav cards in the DOM alongside the streaming-SSR
    // copy, so counting right after the click double-counts.
    await page.goto("/talent/video-editors?format=long-form", { waitUntil: "domcontentloaded" });
    const narrowed = await page.locator('[aria-label^="Open talent listing"]').count();
    expect(narrowed).toBeLessThanOrEqual(allEditors);

    // A curated-combo subfilter chip navigates to its own self-canonical route.
    await page.goto("/talent/video-editors", { waitUntil: "domcontentloaded" });
    await page.getByTestId("subfilter-row").getByTestId("subfilter-chip").filter({ hasText: "Finance" }).first().click();
    await expect(page).toHaveURL(/\/talent\/finance-video-editors$/);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/talent\/finance-video-editors$/);
  });

  test("an active curated-combo chip can be deselected back to the base role route (regression: was stuck)", async ({ page }) => {
    // Reported bug: on /jobs/thumbnail-designer-jobs, selecting the "Finance"
    // niche chip navigates to the finance combo, but clicking the now-active
    // "Finance" chip again just re-linked to the same page — no way back.
    await page.goto("/jobs/thumbnail-designer-jobs", { waitUntil: "domcontentloaded" });
    const financeChip = page.getByTestId("subfilter-row").getByTestId("subfilter-chip").filter({ hasText: "Finance" }).first();
    await financeChip.click();
    await expect(page).toHaveURL(/\/jobs\/finance-thumbnail-designer-jobs$/);
    await expect(financeChip).toHaveAttribute("aria-pressed", "true");

    await financeChip.click();
    await expect(page).toHaveURL(/\/jobs\/thumbnail-designer-jobs$/);
    await expect(financeChip).toHaveAttribute("aria-pressed", "false");

    // Same flow on talent, for a different role/combo, confirms it's not
    // one-off-fixed for a single route.
    await page.goto("/talent/video-editors", { waitUntil: "domcontentloaded" });
    const gamingChip = page.getByTestId("subfilter-row").getByTestId("subfilter-chip").filter({ hasText: "Gaming" }).first();
    await gamingChip.click();
    await expect(page).toHaveURL(/\/talent\/gaming-video-editors$/);
    await gamingChip.click();
    await expect(page).toHaveURL(/\/talent\/video-editors$/);
  });

  test("unvouched curated combos are noindex and excluded from the sitemap", async ({ page, request }) => {
    // A new curated combo works for users (renders the browse grid + its chip)
    // but is held out of the index until vouched.
    await page.goto("/talent/gaming-video-editors", { waitUntil: "domcontentloaded" });
    // The Row-2 "Gaming" chip renders and reads as active (it isn't a self-link:
    // an active curated-combo chip's href points back to the base role route so
    // it can be deselected — see the dedicated deselect regression test above).
    const gamingChip = page.getByTestId("subfilter-row").getByTestId("subfilter-chip").filter({ hasText: "Gaming" }).first();
    await expect(gamingChip).toBeVisible();
    await expect(gamingChip).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/i);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/talent\/gaming-video-editors$/);

    const sitemap = await request.get("/sitemap.xml");
    const xml = await sitemap.text();
    // Vouched routes remain; unvouched combos are absent.
    expect(xml).toContain("/talent/video-editors");
    expect(xml).not.toContain("/talent/gaming-video-editors");
    expect(xml).not.toContain("/jobs/remote-video-editor-jobs");
  });
});
