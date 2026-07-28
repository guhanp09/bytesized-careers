import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { encode } from "next-auth/jwt";
import { openWorkspace, type ScenarioName } from "./scenarioAnchors";

/**
 * Every Pipeline card is exactly the same height.
 *
 * Not "roughly", and not "at least". A card is a summary surface — the whole
 * message, the whole portfolio and every answer live one click away in the
 * conversation — so its content is clamped to fixed zones and its height is
 * decided by the layout rather than by how much a particular applicant wrote.
 *
 * The previous implementation used a height *floor* and produced cards ranging
 * 304–384px within a single column. These specs exist so that cannot come back:
 * they measure real rendered boxes across scenarios that contain records with
 * no portfolio, one portfolio and many, long names, long messages, private
 * notes and every stage.
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

type CardShape = {
  height: number;
  width: number;
  evidence: string | null;
  footerTop: number;
};

async function cardShapes(page: Page): Promise<CardShape[]> {
  return page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('[data-testid="pipeline-row"]'));
    return cards.map((card) => {
      const box = card.getBoundingClientRect();
      const evidence = card.querySelector('[data-testid="pipeline-evidence"]');
      // The footer is the last grid child; its top edge is what "footers line
      // up" actually means.
      const footer = card.lastElementChild as HTMLElement | null;
      return {
        height: Math.round(box.height * 100) / 100,
        width: Math.round(box.width * 100) / 100,
        evidence: evidence?.getAttribute("data-evidence") ?? null,
        footerTop: footer ? Math.round((footer.getBoundingClientRect().top - box.top) * 100) / 100 : -1,
      };
    });
  });
}

/** Rendering can differ by a sub-pixel; anything a person could see cannot. */
const TOLERANCE_PX = 0.5;

async function expectUniform(page: Page, label: string) {
  const shapes = await cardShapes(page);
  expect(shapes.length, `${label}: no cards rendered`).toBeGreaterThan(3);

  const byWidth = new Map<number, CardShape[]>();
  for (const shape of shapes) {
    // Cards of different widths are in different columns of a responsive grid;
    // uniform height is a claim about one layout, not across two.
    const group = byWidth.get(shape.width) ?? [];
    group.push(shape);
    byWidth.set(shape.width, group);
  }

  for (const [width, group] of byWidth) {
    if (group.length < 2) continue;
    const heights = group.map((shape) => shape.height);
    const min = Math.min(...heights);
    const max = Math.max(...heights);
    expect(
      max - min,
      `${label} @${width}px wide: heights span ${min}–${max}px across ${group.length} cards`
    ).toBeLessThanOrEqual(TOLERANCE_PX);

    const footers = group.map((shape) => shape.footerTop);
    expect(
      Math.max(...footers) - Math.min(...footers),
      `${label} @${width}px wide: footers start between ${Math.min(...footers)} and ${Math.max(...footers)}px`
    ).toBeLessThanOrEqual(TOLERANCE_PX);
  }
  return shapes;
}

/**
 * The three scenarios whose boards actually contain variety: `default` has
 * records with and without portfolios, `busy` has a 214-applicant stage, and
 * `edge` carries the awkward records — long names, missing data, archived.
 * Opened as the recruiter with the received direction, which is where cards
 * carry the most content and so are hardest to hold to one height.
 */
const SCENARIOS: ScenarioName[] = ["default", "busy", "edge"];

for (const scenario of SCENARIOS) {
  test(`${scenario}: every card is exactly the same height`, async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await openWorkspace(page, {
      scenario,
      view: "pipeline",
      mode: "recruiter",
      extraParams: { direction: "received" },
    });
    await expectUniform(page, `${scenario} desktop`);
  });
}

test("cards with no portfolio, one, and many are all the same height", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await openWorkspace(page, {
    scenario: "default",
    view: "pipeline",
    mode: "recruiter",
    extraParams: { direction: "received" },
  });
  const shapes = await expectUniform(page, "mixed evidence");

  // The claim is only interesting if the board actually contains the variety.
  const kinds = new Set(shapes.map((shape) => shape.evidence));
  expect(
    kinds.size,
    `expected cards with and without portfolio evidence; saw only ${[...kinds].join(", ")}`
  ).toBeGreaterThan(1);
});

test("the evidence zone never leaves a meaningless blank slab", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await openWorkspace(page, {
    scenario: "default",
    view: "pipeline",
    mode: "recruiter",
    extraParams: { direction: "received" },
  });
  const zones = page.getByTestId("pipeline-evidence");
  const count = await zones.count();
  expect(count).toBeGreaterThan(0);
  for (let index = 0; index < count; index += 1) {
    const zone = zones.nth(index);
    const text = ((await zone.innerText()) || "").trim();
    const hasArtwork = (await zone.locator('[data-testid="portfolio-poster"]').count()) > 0;
    expect(
      text.length > 0 || hasArtwork,
      `card ${index} reserves the evidence zone and puts nothing in it`
    ).toBeTruthy();
  }
});

test("card content and controls stay inside the card", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await openWorkspace(page, {
    scenario: "busy",
    view: "pipeline",
    mode: "recruiter",
    extraParams: { direction: "received" },
  });
  const overflowing = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('[data-testid="pipeline-row"]'));
    const bad: string[] = [];
    for (const card of cards) {
      const box = card.getBoundingClientRect();
      for (const selector of [
        '[data-testid="pipeline-message"]',
        '[data-testid="pipeline-stage-menu"]',
        '[data-testid="pipeline-star-toggle"]',
      ]) {
        const control = card.querySelector(selector);
        if (!control) continue;
        const rect = control.getBoundingClientRect();
        if (rect.bottom > box.bottom + 0.5 || rect.top < box.top - 0.5 || rect.right > box.right + 0.5) {
          bad.push(`${card.getAttribute("data-record-id")} ${selector}`);
        }
      }
    }
    return bad;
  });
  expect(overflowing, `controls escaped their card: ${overflowing.join(", ")}`).toEqual([]);
});

for (const width of [390, 320]) {
  test(`cards stay uniform at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openWorkspace(page, {
      scenario: "default",
      view: "pipeline",
      mode: "recruiter",
      extraParams: { direction: "received" },
    });
    await expectUniform(page, `default @${width}`);
  });
}

test("cards stay uniform at 200% zoom", async ({ page }) => {
  // Emulating zoom by halving the viewport is what a 200% zoom does to layout:
  // the CSS pixel count available drops by half in each direction.
  await page.setViewportSize({ width: 800, height: 500 });
  await openWorkspace(page, {
    scenario: "default",
    view: "pipeline",
    mode: "recruiter",
    extraParams: { direction: "received" },
  });
  await expectUniform(page, "default @200% zoom");
});
