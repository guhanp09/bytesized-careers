import { expect, test } from "@playwright/test";

test("the live optimizer refuses every URL outside the owned media prefixes", async ({
  request,
}) => {
  for (const url of [
    "https://example.com/avatar.png",
    "https://media.creatorjobs.example/media/projects/a.png",
    "https://media.creatorjobs.example/media/avatars/a.svg",
    "http://127.0.0.1:8000/media/avatars/a.png",
  ]) {
    const response = await request.get("/_next/image", {
      params: { url, w: "640", q: "75" },
    });
    expect(response.status(), url).toBe(400);
    await expect(response.text()).resolves.toContain('"url" parameter is not allowed');
  }
});

test("external profile media stays a direct browser request", async ({ page }) => {
  const remoteOptimizerInputs: string[] = [];
  page.on("request", (request) => {
    const requestUrl = new URL(request.url());
    if (requestUrl.pathname !== "/_next/image") return;
    const source = requestUrl.searchParams.get("url");
    if (source?.startsWith("http")) remoteOptimizerInputs.push(source);
  });

  // The fixture uses external creator/channel media. Abort the third-party
  // bytes after observing the request; this test is about who fetches them,
  // and must not depend on picsum or another public host being available.
  await page.route("https://**", (route) => route.abort("blockedbyclient"));
  await page.goto("/u/aarav-mehta", { waitUntil: "domcontentloaded" });

  const externalImages = page.locator('img[src^="https://"]');
  expect(await externalImages.count()).toBeGreaterThan(0);
  expect(remoteOptimizerInputs).toEqual([]);
});
