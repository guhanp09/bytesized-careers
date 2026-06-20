import { test, expect } from "@playwright/test";

// Exercises the real channel/page resolver route used by the Post a Job
// authorization flow. Assertions for valid profiles rely only on URL-derived
// fields (never on the best-effort live Instagram enrichment fetch), so the
// test is deterministic with or without network access.
const RESOLVE = "/api/profile/organization-identity";

test.describe("Instagram channel/page resolver", () => {
  test("resolves a valid Instagram profile URL to a usable identity (no dead-end)", async ({ request }) => {
    const res = await request.post(RESOLVE, { data: { url: "https://www.instagram.com/guhanpurushothaman/" } });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.error).toBeNull();
    expect(body.platform).toBe("Instagram");
    expect(body.handle).toBe("@guhanpurushothaman");
    expect(body.canonicalUrl).toBe("https://www.instagram.com/guhanpurushothaman/");
  });

  test("normalizes a protocol-less, non-www Instagram URL", async ({ request }) => {
    const res = await request.post(RESOLVE, { data: { url: "instagram.com/guhanpurushothaman" } });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.error).toBeNull();
    expect(body.platform).toBe("Instagram");
    expect(body.canonicalUrl).toBe("https://www.instagram.com/guhanpurushothaman/");
  });

  test("rejects Instagram post/reel/story URLs with a clear message", async ({ request }) => {
    for (const url of [
      "https://www.instagram.com/p/Cabc123/",
      "https://www.instagram.com/reel/Cabc123/",
      "https://www.instagram.com/stories/guhan/123/",
    ]) {
      const res = await request.post(RESOLVE, { data: { url } });
      expect(res.status()).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("Use the Instagram profile URL, not a post, reel, or story link.");
    }
  });

  test("rejects reserved Instagram routes as invalid profiles", async ({ request }) => {
    const res = await request.post(RESOLVE, { data: { url: "https://www.instagram.com/explore/" } });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Enter a valid Instagram profile URL.");
  });
});
