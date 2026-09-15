import { expect, test, type Page } from "@playwright/test";

/**
 * The channel/page resolver, which asks the server to fetch a URL the caller
 * chose.
 *
 * It used to answer anyone on the internet. It now requires a signed-in
 * same-origin caller, which is why this spec lives here rather than in the mock
 * harness: the assertions about *what* it resolves are only meaningful from a
 * session, and the assertion that it refuses an anonymous caller is the point
 * of the slice.
 *
 * Every resolution asserted below is derived from the URL itself, never from a
 * live Instagram fetch, so the spec is deterministic with or without network
 * access.
 */

const RESOLVE = "/api/profile/organization-identity";
const CONTROLLER_EMAIL = "qa-controller@example.com";
const CONTROLLER_PASSWORD = "LocalQaController123!";

async function login(page: Page) {
  await page.goto("/auth?mode=login", { waitUntil: "domcontentloaded" });
  await page.getByPlaceholder("Email").fill(CONTROLLER_EMAIL);
  await page.getByPlaceholder("Password").fill(CONTROLLER_PASSWORD);
  await page.locator("form").getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page).toHaveURL(/\/you/);
}

test("an anonymous caller cannot make the server fetch a URL", async ({ request }) => {
  const response = await request.post(RESOLVE, {
    data: { url: "https://www.instagram.com/guhanpurushothaman/" },
  });

  expect(response.status()).toBe(401);
  expect((await response.json()).error).toBe("authentication_required");
});

test.describe("signed in", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("keeps a usable YouTube URL identity when provider configuration is absent", async ({ page }) => {
    // The local QA server explicitly has no provider key; this exercises the
    // signed-in Next -> backend -> URL fallback without a live provider request.
    const response = await page.request.post(RESOLVE, {
      data: { url: "https://www.youtube.com/@creatorjobsqa" },
    });

    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.error).toBeNull();
    expect(body.platform).toBe("YouTube");
    expect(body.handle).toBe("@creatorjobsqa");
    expect(body.canonicalUrl).toBe("https://www.youtube.com/@creatorjobsqa");
    expect(body.source).toBe("url_fallback");
    expect(body.logoUrl).toBeNull();
  });

  test("resolves a valid Instagram profile URL to a usable identity", async ({ page }) => {
    const response = await page.request.post(RESOLVE, {
      data: { url: "https://www.instagram.com/guhanpurushothaman/" },
    });

    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.error).toBeNull();
    expect(body.platform).toBe("Instagram");
    expect(body.handle).toBe("@guhanpurushothaman");
    expect(body.canonicalUrl).toBe("https://www.instagram.com/guhanpurushothaman/");
  });

  test("normalizes a protocol-less, non-www Instagram URL", async ({ page }) => {
    const response = await page.request.post(RESOLVE, {
      data: { url: "instagram.com/guhanpurushothaman" },
    });

    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.error).toBeNull();
    expect(body.platform).toBe("Instagram");
    expect(body.canonicalUrl).toBe("https://www.instagram.com/guhanpurushothaman/");
  });

  test("rejects Instagram post, reel and story URLs with a clear message", async ({ page }) => {
    for (const url of [
      "https://www.instagram.com/p/Cabc123/",
      "https://www.instagram.com/reel/Cabc123/",
      "https://www.instagram.com/stories/guhan/123/",
    ]) {
      const response = await page.request.post(RESOLVE, { data: { url } });
      expect(response.status()).toBe(400);
      expect((await response.json()).error).toBe(
        "Use the Instagram profile URL, not a post, reel, or story link."
      );
    }
  });

  test("rejects reserved Instagram routes as invalid profiles", async ({ page }) => {
    const response = await page.request.post(RESOLVE, {
      data: { url: "https://www.instagram.com/explore/" },
    });

    expect(response.status()).toBe(400);
    expect((await response.json()).error).toBe("Enter a valid Instagram profile URL.");
  });

  test("still refuses an obviously private target", async ({ page }) => {
    const response = await page.request.post(RESOLVE, {
      data: { url: "http://127.0.0.1:8000/admin" },
    });

    expect(response.status()).toBe(400);
    expect((await response.json()).error).toMatch(/valid URL/i);
  });
});
