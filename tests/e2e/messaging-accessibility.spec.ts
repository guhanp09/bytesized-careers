import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { encode } from "next-auth/jwt";
import { anchor, observeStarBackendRequests, openRecord, openWorkspace, type ScenarioName } from "./scenarioAnchors";

/**
 * What the redesign has to be true of for everybody, not only for a pointer at
 * 1600px.
 *
 * Grouping removes information on purpose: a name that used to appear ten times
 * now appears none. That is a legibility win for a sighted reader and a
 * straightforward loss for a screen reader unless the attribution is restored
 * somewhere. Alignment carries ownership visually and carries nothing at all
 * otherwise. Reveal-on-hover controls are invisible to a keyboard unless focus
 * reveals them too.
 *
 * Each of those trades has a counterpart here.
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
const SCENARIOS: ScenarioName[] = ["default", "busy", "edge", "talent", "recruiter"];

/* ---- reading order and attribution --------------------------------------- */

test("grouping never costs a screen reader the sender it removes visually", async ({ page }) => {
  const target = anchor("busy", "44 messages", { persona: "recruiter" });
  await openWorkspace(page, { scenario: "busy", mode: "recruiter", view: "inbox" });
  const detail = await openRecord(page, target);

  const groups = await detail.evaluate((node) =>
    Array.from(node.querySelectorAll('[data-testid="message-group"]')).map((group) => ({
      role: group.getAttribute("role"),
      label: group.getAttribute("aria-label") ?? "",
      from: group.getAttribute("data-from"),
      // A time element inside carries the instant in its own accessible name.
      timeLabel: group.querySelector("time")?.getAttribute("aria-label") ?? "",
    }))
  );
  expect(groups.length).toBeGreaterThan(3);
  for (const group of groups) {
    expect(group.role).toBe("group");
    expect(group.label.trim().length, "a run with no accessible name").toBeGreaterThan(0);
    if (group.from === "me") expect(group.label).toMatch(/^You/);
    expect(group.timeLabel.length, "the run's time is not announced").toBeGreaterThan(0);
  }
});

test("the thread does not become forty tab stops", async ({ page }) => {
  const target = anchor("busy", "44 messages", { persona: "recruiter" });
  await openWorkspace(page, { scenario: "busy", mode: "recruiter", view: "inbox" });
  const detail = await openRecord(page, target);

  const stops = await detail.evaluate((node) => {
    const inside = Array.from(node.querySelectorAll('[data-testid="message-group"]'));
    let count = 0;
    for (const group of inside) {
      count += group.querySelectorAll(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"]), input, textarea'
      ).length;
    }
    return { groups: inside.length, focusable: count };
  });
  // A conversation of forty-four messages must not put forty-four stops between
  // the list and the composer. Links to the counterparty are legitimate; a stop
  // per bubble is not.
  expect(stops.focusable).toBeLessThanOrEqual(stops.groups);
});

/* ---- keyboard ------------------------------------------------------------ */

test("everything a pointer reveals, focus reveals too", async ({ page }) => {
  await openWorkspace(page, { scenario: "default", mode: "recruiter", view: "inbox" });
  const wrapper = main(page).getByTestId("interaction-row").first().locator("xpath=..");
  const star = wrapper.getByTestId("row-star-toggle");

  await expect(star).toHaveCSS("opacity", "0");
  await star.focus();
  await expect(star).toBeFocused();
  await expect(star, "a control only a mouse can see is a control a keyboard cannot use").toHaveCSS(
    "opacity",
    "1"
  );
});

test("a row is operable and toggles by keyboard alone", async ({ page }) => {
  const backendRequests = observeStarBackendRequests(page);
  await openWorkspace(page, { scenario: "default", mode: "recruiter", view: "inbox" });
  const record = main(page).getByTestId("interaction-row").nth(2);
  await record.focus();
  await expect(record).toBeFocused();
  await record.press("Enter");
  await expect(record).toHaveAttribute("aria-pressed", "true");

  const wrapper = record.locator("xpath=..");
  const star = wrapper.getByTestId("row-star-toggle");
  await star.focus();
  await star.press("Enter");
  await expect(star).toHaveAttribute("aria-pressed", "true");
  await star.press("Space");
  await expect(star).toHaveAttribute("aria-pressed", "false");
  expect(backendRequests, "authenticated demo keyboard actions must stay local").toEqual([]);
});

test("focus is visible wherever it lands", async ({ page }) => {
  await openWorkspace(page, { scenario: "default", mode: "recruiter", view: "inbox" });
  for (const testId of ["row-star-toggle", "queue-selector-trigger", "workspace-persona"]) {
    const control = page.getByTestId(testId).first();
    if ((await control.count()) === 0) continue;
    await control.focus();
    const ring = await control.evaluate((node) => {
      const style = getComputedStyle(node);
      return { outline: style.outlineWidth, shadow: style.boxShadow, opacity: style.opacity };
    });
    const visible = ring.outline !== "0px" || (ring.shadow !== "none" && ring.shadow.length > 0);
    expect(visible, `${testId} gives no visible focus`).toBeTruthy();
  }
});

/* ---- targets ------------------------------------------------------------- */

test("interactive targets meet the minimum size", async ({ page }) => {
  await openWorkspace(page, { scenario: "default", mode: "recruiter", view: "inbox" });
  const small = await page.evaluate(() => {
    const selectors = [
      '[data-testid="row-star-toggle"]',
      '[data-testid="row-next-action"]',
      '[data-testid="star-toggle"]',
      '[data-testid="queue-selector-trigger"]',
    ];
    const bad: string[] = [];
    for (const selector of selectors) {
      for (const node of Array.from(document.querySelectorAll(selector)).slice(0, 4)) {
        const box = node.getBoundingClientRect();
        if (box.width === 0 && box.height === 0) continue;
        // WCAG 2.5.8 (AA): 24×24 CSS px.
        if (box.width < 24 || box.height < 24) bad.push(`${selector} ${Math.round(box.width)}×${Math.round(box.height)}`);
      }
    }
    return bad;
  });
  expect(small, `targets below 24×24: ${small.join(", ")}`).toEqual([]);
});

/* ---- responsive ---------------------------------------------------------- */

for (const scenario of SCENARIOS) {
  for (const [label, width, height] of [
    ["mobile", 390, 844],
    ["narrow", 320, 720],
    ["zoom200", 800, 500],
  ] as const) {
    test(`${scenario} @${label}: nothing overflows sideways, in either view`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      const mode = scenario === "talent" ? "talent" : "recruiter";

      await openWorkspace(page, { scenario, mode, view: "inbox" });
      let overflow = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
      }));
      expect(overflow.scroll, `inbox scrolls sideways by ${overflow.scroll - overflow.client}px`).toBeLessThanOrEqual(
        overflow.client + 1
      );

      await openWorkspace(page, {
        scenario,
        mode,
        view: "pipeline",
        extraParams: { direction: mode === "recruiter" ? "received" : "sent" },
      });
      overflow = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
      }));
      expect(overflow.scroll, `pipeline scrolls sideways by ${overflow.scroll - overflow.client}px`).toBeLessThanOrEqual(
        overflow.client + 1
      );
    });
  }
}

test("a row keeps its identity and its message at 320px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await openWorkspace(page, { scenario: "default", mode: "recruiter", view: "inbox" });
  const record = main(page).getByTestId("interaction-row").first();
  await expect(record.getByTestId("row-identity")).toBeVisible();
  await expect(record.getByTestId("row-preview")).toBeVisible();
  await expect(record.getByTestId("row-context")).toBeVisible();

  // And the three of them fit inside the row rather than running past it.
  const clipped = await record.evaluate((node) => {
    const box = node.getBoundingClientRect();
    return ["row-identity", "row-context", "row-preview"].filter((id) => {
      const part = node.querySelector(`[data-testid="${id}"]`);
      if (!part) return true;
      return part.getBoundingClientRect().right > box.right + 1;
    });
  });
  expect(clipped, `parts running past the row: ${clipped.join(", ")}`).toEqual([]);
});

test("message bubbles never outgrow the thread at 390px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const target = anchor("edge", "very long message", { persona: "recruiter" });
  await openWorkspace(page, { scenario: "edge", mode: "recruiter", view: "inbox" });
  const detail = await openRecord(page, target);

  const escaped = await detail.evaluate((node) => {
    const canvas = node.querySelector('[data-testid="message-group"]')?.parentElement?.getBoundingClientRect();
    if (!canvas) return [];
    return Array.from(node.querySelectorAll('[data-testid="chat-bubble"]'))
      .map((bubble) => bubble.getBoundingClientRect())
      .filter((box) => box.right > canvas.right + 1 || box.left < canvas.left - 1).length;
  });
  expect(escaped, "a bubble ran past the thread canvas").toBe(0);
});

for (const width of [390, 320]) {
  test(`structured answers stay readable at ${width}px`, async ({ page }) => {
    /*
      The first-message card lays label against value in two columns. Inside a
      mobile thread the card gets about 180px, and an `auto` label column took
      all of it — "Mornings, overlapping with EU" rendered one letter per line.
      It stacks below its own width now, so this measures the answer's box
      rather than trusting the breakpoint.
    */
    await page.setViewportSize({ width, height: 844 });
    const target = anchor("default", "portfolio attached", { persona: "recruiter" });
    await openWorkspace(page, { scenario: "default", mode: "recruiter", view: "inbox" });
    const detail = await openRecord(page, target);
    await expect(detail.locator("dd").first()).toBeVisible();

    const narrow = await detail.evaluate((node) =>
      Array.from(node.querySelectorAll("dd"))
        .map((value) => ({
          text: (value.textContent ?? "").trim().slice(0, 24),
          width: Math.round(value.getBoundingClientRect().width),
        }))
        .filter((value) => value.text.length > 0 && value.width < 90)
    );
    expect(narrow, `answers crushed to: ${narrow.map((v) => `${v.text} @${v.width}px`).join(", ")}`).toEqual([]);
  });
}

/* ---- reduced motion ------------------------------------------------------ */

test("reduced motion removes transitions rather than shortening them", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openWorkspace(page, { scenario: "default", mode: "recruiter", view: "inbox" });
  const record = main(page).getByTestId("interaction-row").first();
  await record.click();
  await expect(record).toHaveAttribute("aria-pressed", "true");

  const durations = await page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll('[data-testid="interaction-row"], .ui-crossfade')).slice(0, 12);
    return nodes.map((node) => getComputedStyle(node).transitionDuration);
  });
  for (const duration of durations) {
    const seconds = duration
      .split(",")
      .map((value) => parseFloat(value))
      .filter((value) => !Number.isNaN(value));
    for (const value of seconds) expect(value).toBeLessThanOrEqual(0.01);
  }
  // And the workspace still works with motion off.
  await expect(page.getByTestId("applications-detail")).toBeVisible();
});
