import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { encode } from "next-auth/jwt";
import { openWorkspace } from "./scenarioAnchors";

/**
 * The classification control, without a mouse and without sight.
 *
 * This menu exists to say that three names answer three *different* questions.
 * Sighted readers get that from the headings and the stated denominators. None
 * of that reached assistive technology: nine `menuitemradio`s sat in one flat
 * menu, so the structure the control was built to convey was the one thing that
 * did not survive the translation.
 *
 * `role="menu"` is also a promise — that arrows move between items and focus
 * starts inside. Announcing the role and then not honouring it is worse than
 * not announcing it, because the user is told to expect a control that then
 * does not answer.
 */

const SESSION_SECRET = "e2e-secret";

async function signIn(context: BrowserContext) {
  const sessionToken = await encode({
    token: {
      name: "Demo Owner",
      email: "owner-e2e@example.com",
      sub: "e2e-owner",
      username: "demo-owner",
      displayName: "Demo Owner",
      backendAccessToken: "e2e-offline-token",
      backendTokenType: "bearer",
      backendUserId: "e2e-owner",
    },
    secret: SESSION_SECRET,
  });
  await context.addCookies([
    { name: "next-auth.session-token", value: sessionToken, domain: "127.0.0.1", path: "/", httpOnly: true, sameSite: "Lax" },
  ]);
}

test.beforeEach(async ({ context }) => {
  await signIn(context);
});

const main = (page: Page) => page.getByRole("main");
const trigger = (page: Page) => main(page).getByTestId("queue-selector-trigger");
const menu = (page: Page) => page.getByTestId("queue-selector-menu");

async function openMenu(page: Page) {
  await openWorkspace(page, { scenario: "busy", mode: "recruiter", view: "inbox" });
  await trigger(page).click();
  await expect(menu(page)).toBeVisible();
}

/* ---- structure ----------------------------------------------------------- */

test("each question is a group, not nine radios in a row", async ({ page }) => {
  await openMenu(page);

  const groups = menu(page).getByRole("group");
  const count = await groups.count();
  expect(count, "the planes are not exposed as groups").toBeGreaterThanOrEqual(3);

  // And each group says what its numbers reconcile against, because a count
  // heard without its denominator is a count taken on faith.
  const labels = await groups.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("aria-label") ?? "")
  );
  const planes = labels.filter((label) => /\bof \d+\b/.test(label));
  expect(planes.length, `no group states a denominator: ${labels.join(" | ")}`).toBeGreaterThanOrEqual(3);
});

test("every option is a radio that says whether it is on", async ({ page }) => {
  await openMenu(page);
  const options = menu(page).getByRole("menuitemradio");
  expect(await options.count()).toBeGreaterThan(3);
  for (const state of await options.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("aria-checked"))
  )) {
    expect(["true", "false"]).toContain(state);
  }
});

test("the trigger says what is on, so returning focus re-announces it", async ({ page }) => {
  await openMenu(page);
  const before = await trigger(page).getAttribute("aria-label");
  expect(before).toMatch(/filter what you are looking at/i);

  await menu(page).getByTestId("queue-chip-opened").click();
  await expect(menu(page)).toHaveCount(0);

  const after = await trigger(page).getAttribute("aria-label");
  expect(after).toMatch(/showing/i);
  expect(after).not.toBe(before);
});

/* ---- keyboard ------------------------------------------------------------ */

test("opening the menu puts focus inside it", async ({ page }) => {
  await openWorkspace(page, { scenario: "busy", mode: "recruiter", view: "inbox" });
  await trigger(page).focus();
  await page.keyboard.press("Enter");
  await expect(menu(page)).toBeVisible();

  const inside = await page.evaluate(() => {
    const node = document.querySelector('[data-testid="queue-selector-menu"]');
    return node?.contains(document.activeElement) ?? false;
  });
  expect(inside, "focus stayed on the trigger after opening a menu").toBe(true);
});

test("arrows move between options, and wrap", async ({ page }) => {
  await openMenu(page);

  const focusedKey = () =>
    page.evaluate(() => document.activeElement?.getAttribute("data-queue-key") ?? null);

  const first = await focusedKey();
  expect(first).not.toBeNull();

  await page.keyboard.press("ArrowDown");
  const second = await focusedKey();
  expect(second).not.toBe(first);

  await page.keyboard.press("ArrowUp");
  expect(await focusedKey()).toBe(first);

  // End reaches the last option without pressing Down through three groups.
  await page.keyboard.press("End");
  const last = await focusedKey();
  expect(last).not.toBe(first);
  await page.keyboard.press("ArrowDown");
  expect(await focusedKey(), "the menu does not wrap").toBe(first);
});

test("a filter can be applied entirely from the keyboard", async ({ page }) => {
  await openWorkspace(page, { scenario: "busy", mode: "recruiter", view: "inbox" });
  await trigger(page).focus();
  await page.keyboard.press("Enter");
  await expect(menu(page)).toBeVisible();

  await page.keyboard.press("ArrowDown");
  const chosen = await page.evaluate(
    () => document.activeElement?.getAttribute("data-queue-key") ?? null
  );
  await page.keyboard.press("Enter");

  await expect(menu(page)).toHaveCount(0);
  expect(chosen).not.toBeNull();
  // The choice took effect rather than merely closing the menu.
  await expect(trigger(page)).toHaveAttribute("aria-label", /showing/i);
});

test("Escape closes the menu and gives focus back", async ({ page }) => {
  await openMenu(page);
  await page.keyboard.press("Escape");
  await expect(menu(page)).toHaveCount(0);
  await expect(trigger(page)).toBeFocused();
});

test("choosing an option also returns focus to the trigger", async ({ page }) => {
  // Focus left somewhere inside a menu that no longer exists is focus on the
  // document body, which sends a keyboard user back to the top of the page.
  await openMenu(page);
  await menu(page).getByTestId("queue-chip-opened").click();
  await expect(menu(page)).toHaveCount(0);
  await expect(trigger(page)).toBeFocused();
});

/* ---- seeing it ----------------------------------------------------------- */

test("every interactive part of the control shows a focus ring", async ({ page }) => {
  await openMenu(page);
  const option = menu(page).getByTestId("queue-chip-opened");
  await option.focus();
  const ring = await option.evaluate((node) => {
    const style = getComputedStyle(node);
    return {
      shadow: style.boxShadow,
      outline: style.outlineWidth,
    };
  });
  // Tailwind's focus ring is a box-shadow; either mechanism is fine, absence
  // of both is not.
  expect(
    ring.shadow !== "none" || parseFloat(ring.outline || "0") > 0,
    "a focused option is indistinguishable from an unfocused one"
  ).toBe(true);
});

test("the menu stays reachable and readable at 200% zoom", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  // Emulating zoom by halving the viewport is the standard equivalent.
  await page.setViewportSize({ width: 640, height: 360 });
  await openMenu(page);

  await expect(menu(page)).toBeVisible();
  const box = await menu(page).boundingBox();
  expect(box, "the menu has no box at 200% zoom").not.toBeNull();
  const viewport = page.viewportSize()!;
  // It may scroll internally, but it must not sit off the side of the screen.
  expect(box!.x).toBeGreaterThanOrEqual(-1);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow, "the page scrolls sideways at 200% zoom").toBeLessThanOrEqual(1);
});

test("options are large enough to hit on a touch screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openMenu(page);

  const heights = await menu(page)
    .getByRole("menuitemradio")
    .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height));
  expect(heights.length).toBeGreaterThan(0);
  for (const height of heights) {
    // 44px is the floor a finger needs; these carry two lines of text and
    // comfortably clear it, but a future single-line variant would not.
    expect(Math.round(height), "an option is below the 44px touch floor").toBeGreaterThanOrEqual(44);
  }
});

test("the trigger is a 44px target even though it is drawn at 28", async ({ page }) => {
  // The toolbar is dense by design and the control matches it. A finger does
  // not care what the row looks like, so the hit area is extended vertically —
  // vertically only, because the neighbours here are horizontal and growing
  // sideways would steal their taps.
  await page.setViewportSize({ width: 390, height: 844 });
  await openWorkspace(page, { scenario: "busy", mode: "recruiter", view: "inbox" });

  const measured = await trigger(page).evaluate((node) => {
    const box = node.getBoundingClientRect();
    const before = getComputedStyle(node, "::before");
    const grow = Math.abs(parseFloat(before.top || "0"));
    return { painted: box.height, target: box.height + grow * 2, width: box.width };
  });

  expect(Math.round(measured.painted), "the control grew instead of its target").toBeLessThanOrEqual(30);
  expect(Math.round(measured.target), "the trigger is below the 44px touch floor").toBeGreaterThanOrEqual(44);
});

test("the extended target does not swallow the controls beside it", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openWorkspace(page, { scenario: "busy", mode: "recruiter", view: "inbox" });

  // Tapping just outside the trigger's own width must not open the menu.
  const box = (await trigger(page).boundingBox())!;
  await page.mouse.click(box.x - 6, box.y + box.height / 2);
  await expect(menu(page)).toHaveCount(0);
});
