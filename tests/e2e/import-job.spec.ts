import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Playwright transpiles specs to CJS, so no import.meta here; tests run from the
// repo root.
const fixture = (name: string) =>
  readFileSync(join(process.cwd(), "tests", "fixtures", "import-posts", name), "utf8");

const TITLE_PLACEHOLDER = "e.g. Video editor for YouTube (retention-focused)";

async function importPost(page: Page, text: string) {
  await page.goto("/post-job/import", { waitUntil: "domcontentloaded" });
  await page.getByTestId("import-textarea").fill(text);
  await page.getByTestId("import-prepare").click();
  await expect(page.getByTestId("import-review")).toBeVisible();
}

test("the /post chooser offers the import entry point", async ({ page }) => {
  await page.goto("/post", { waitUntil: "domcontentloaded" });
  // .first(): the mock e2e server renders a soft-nav SSR duplicate of this page
  // (known environment behavior that doubles locator counts).
  const card = page.getByTestId("post-import-card").first();
  await expect(card).toBeVisible();
  await expect(card).toContainText("Already wrote a hiring post?");
  await card.click();
  await expect(page).toHaveURL(/\/post-job\/import$/);
  await expect(page.getByTestId("import-textarea")).toBeVisible();
});

test("paste → review → editor: fields, banner, jump pills, suppressed identity modal", async ({ page }) => {
  await importPost(page, fixture("video-editor-linkedin.txt"));

  // Review groups + evidence + confident category pre-selected.
  await expect(page.getByTestId("import-summary")).toContainText("Draft prepared");
  await expect(page.getByText("Imported", { exact: true })).toBeVisible();
  await expect(page.getByTestId("import-row-budget")).toContainText("₹25,000–₹35,000 per month");
  await expect(page.getByTestId("import-category-editing")).toHaveAttribute("aria-checked", "true");

  await page.getByTestId("import-continue").click();
  await expect(page).toHaveURL(/\/post-job$/);

  // Everything publish-relevant imported → fast path lands on the final step.
  await expect(page.getByText("Reference videos").first()).toBeVisible();

  // Banner with jump pills; the identity modal did NOT auto-open.
  const banner = page.getByTestId("import-review-banner");
  await expect(banner).toContainText("Imported from your post.");
  await expect(page.getByRole("button", { name: "Continue to job post" })).toHaveCount(0);

  await expect(page.getByTestId("import-banner-go-to-publish")).toBeVisible();
  await banner.getByTestId("import-banner-jump-experience").click();
  await expect(page.getByPlaceholder(TITLE_PLACEHOLDER)).toBeVisible();
  await expect(page.getByPlaceholder(TITLE_PLACEHOLDER)).toHaveValue(/video editor/i);

  // The wizard PreviewCard reflects the parsed values.
  await expect(page.getByText("₹25,000–₹35,000 per month").first()).toBeVisible();
});

test("remount-sensitivity: state-preserving URL cleanup keeps Next navigation working", async ({ page }) => {
  await importPost(page, fixture("video-editor-linkedin.txt"));
  await page.getByTestId("import-continue").click();
  await expect(page).toHaveURL(/\/post-job$/);
  await page.getByTestId("import-review-banner").getByTestId("import-banner-jump-experience").click();

  // In-page edits persist while staying on the wizard.
  const title = page.getByPlaceholder(TITLE_PLACEHOLDER);
  await title.fill("Edited after import");
  await expect(title).toHaveValue("Edited after import");

  // Back returns to the import page (no stale paste — the source was consumed).
  await page.goBack({ waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/post-job\/import$/);
  await expect(page.getByTestId("import-textarea")).toHaveValue("");

  // Forward lands on /post-job as a calm fresh visit: no false expiry, no crash.
  await page.goForward({ waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/post-job$/);
  await expect(page.getByText("Your import session expired")).toHaveCount(0);

  // Onward app navigation after history.replaceState still works.
  await page.goto("/drafts", { waitUntil: "domcontentloaded" });
  await page.goBack({ waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/post-job/);
});

test("non-job text can be overridden with Parse anyway", async ({ page }) => {
  await page.goto("/post-job/import", { waitUntil: "domcontentloaded" });
  await page.getByTestId("import-textarea").fill(fixture("not-a-job-lyrics.txt"));
  await page.getByTestId("import-prepare").click();
  await expect(page.getByTestId("import-not-job")).toBeVisible();
  await page.getByTestId("import-parse-anyway").click();
  await expect(page.getByTestId("import-review")).toBeVisible();
});

test("truncate-and-retain: >20k paste keeps the first 20k and stays analyzable", async ({ page }) => {
  await page.goto("/post-job/import", { waitUntil: "domcontentloaded" });
  const long = `Hiring a video editor. ₹20,000 per month. Remote.\n${"filler words ".repeat(2000)}`;
  expect(long.length).toBeGreaterThan(20_000);
  await page.getByTestId("import-textarea").fill(long);
  await expect(page.getByTestId("import-truncation-note")).toBeVisible();
  const value = await page.getByTestId("import-textarea").inputValue();
  expect(value.length).toBe(20_000);
  const prepare = page.getByTestId("import-prepare");
  await expect(prepare).toBeEnabled();
  await prepare.click();
  await expect(page.getByTestId("import-review")).toBeVisible();
});

test("refresh during review restores the paste for another run", async ({ page }) => {
  await importPost(page, fixture("thumbnail-designer-whatsapp.txt"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("import-textarea")).toHaveValue(/THUMBNAIL DESIGNER/);
  await expect(page.getByText("Restored your last paste.")).toBeVisible();
});

test("cold /post-job?import=1 shows the expired notice and normal modal behavior", async ({ page }) => {
  await page.goto("/post-job?import=1", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Your import session expired — paste the post again.")).toBeVisible();
});

test("a foreign-owner handoff is purged and reads as expired", async ({ page }) => {
  await page.goto("/post-job/import", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    window.sessionStorage.setItem(
      "creatorjobs:jobImport:handoff:v1",
      JSON.stringify({
        version: 1,
        createdAt: Date.now(),
        owner: "someone-else",
        initialStep: "basics",
        prefill: { title: "Leaked title" },
        meta: {},
      })
    );
  });
  await page.goto("/post-job?import=1", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Your import session expired — paste the post again.")).toBeVisible();
  await expect(page.getByPlaceholder(TITLE_PLACEHOLDER)).not.toHaveValue("Leaked title");
  const remaining = await page.evaluate(() =>
    window.sessionStorage.getItem("creatorjobs:jobImport:handoff:v1")
  );
  expect(remaining).toBeNull();
});

test("pasted script tags render as inert text", async ({ page }) => {
  let dialogFired = false;
  page.on("dialog", async (dialog) => {
    dialogFired = true;
    await dialog.dismiss();
  });
  await importPost(
    page,
    'Hiring a video editor. <script id="pwn">alert(1)</script> ₹20,000 per month. Remote.'
  );
  await expect(page.locator("#pwn")).toHaveCount(0);
  await expect(page.getByText(/<script id="pwn">/).first()).toBeVisible();
  expect(dialogFired).toBe(false);
});

test.describe("mobile viewport", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("paste and review stay usable with no horizontal scroll", async ({ page }) => {
    await importPost(page, fixture("channel-manager-remote.txt"));
    await expect(page.getByTestId("import-continue")).toBeVisible();
    const noHorizontalScroll = await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
    );
    expect(noHorizontalScroll).toBe(true);
  });
});
