import { expect, test, type Page } from "@playwright/test";

type PrefetchRequest = {
  pathname: string;
  search: string;
};

async function observedAutomaticPrefetches(page: Page, path: string): Promise<PrefetchRequest[]> {
  const observed: PrefetchRequest[] = [];
  page.on("request", (request) => {
    if (request.headers()["next-router-prefetch"] !== "1") return;
    const url = new URL(request.url());
    url.searchParams.delete("_rsc");
    observed.push({ pathname: url.pathname, search: url.search });
  });

  await page.goto(path, { waitUntil: "domcontentloaded" });
  // Link prefetch is scheduled after intersection observation and idle work.
  // Waiting for the network to become idle observes that work without using a
  // timing threshold as a proxy for correctness.
  await page.waitForLoadState("networkidle");
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
      })
  );
  await page.waitForLoadState("networkidle");
  return observed;
}

test("the dynamic global shell does not render its destinations in the background", async ({ page }) => {
  expect(await observedAutomaticPrefetches(page, "/")).toEqual([]);
});

test("high-fan-out job discovery chips do not render every filter route in the background", async ({ page }) => {
  expect(await observedAutomaticPrefetches(page, "/jobs")).toEqual([]);
});

test("high-fan-out talent discovery chips do not render every filter route in the background", async ({ page }) => {
  expect(await observedAutomaticPrefetches(page, "/talent")).toEqual([]);
});
