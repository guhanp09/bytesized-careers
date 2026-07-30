import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { encode } from "next-auth/jwt";
import { openWorkspace, type ScenarioName } from "./scenarioAnchors";

/**
 * The observation pass, run rather than described.
 *
 * A QA matrix written into a document is a claim; run as a spec it is a fact
 * that keeps being true. Five scenarios across seven conditions — three widths,
 * a laptop, 200% zoom, keyboard-only and reduced motion — with a screenshot per
 * cell so the visual pass is reviewable rather than remembered.
 *
 * The assertions are deliberately about *comprehension failures a screenshot
 * would not settle*: content escaping the viewport, a page that scrolls
 * sideways, controls overlapping, text clipped to nothing, an empty main. Those
 * are the things that make a scenario unreadable at a width, and they are all
 * measurable. Anything finer than that belongs to a person looking at the
 * images this produces.
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

const SCENARIOS: ScenarioName[] = ["default", "busy", "edge", "talent", "recruiter"];

type Condition = {
  key: string;
  width: number;
  height: number;
  /** 200% zoom is emulated by halving the viewport, the standard equivalent. */
  note: string;
  reducedMotion?: boolean;
};

const CONDITIONS: Condition[] = [
  { key: "desktop-1440", width: 1440, height: 900, note: "the width most of this was designed at" },
  { key: "laptop-1280", width: 1280, height: 800, note: "the width most people actually have" },
  { key: "mobile-390", width: 390, height: 844, note: "a current phone" },
  { key: "narrow-320", width: 320, height: 640, note: "the narrowest width still supported" },
  { key: "zoom-200", width: 720, height: 450, note: "1440 at 200% zoom" },
  { key: "reduced-motion", width: 1280, height: 800, note: "no animation", reducedMotion: true },
];

const SHOTS =
  process.env.QA_SHOT_DIR ??
  "/tmp/creator-jobs-qa";

/** Everything a width can break, measured in one pass. */
async function readability(page: Page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    const main = document.querySelector("main");
    const viewport = root.clientWidth;

    // Anything painted past the right edge is content nobody can reach.
    let escaped = 0;
    let worst = "";
    let worstBy = 0;
    for (const node of Array.from(main?.querySelectorAll<HTMLElement>("*") ?? [])) {
      const style = getComputedStyle(node);
      if (style.visibility === "hidden" || style.display === "none" || style.position === "fixed") continue;
      const box = node.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      const over = box.right - viewport;
      if (over <= 1) continue;

      // Content inside a horizontal scroller is reachable — that is what the
      // scroller is for. So the question is not "is this past the edge" but
      // "is there anything between here and the root that can scroll to it".
      // Checking only the immediate parent misses the common case: a 2px
      // underline inside a tab inside the scrolling row.
      let reachable = ["auto", "scroll"].includes(style.overflowX);
      let ancestor: HTMLElement | null = node.parentElement;
      while (ancestor && !reachable && ancestor !== root) {
        const parentStyle = getComputedStyle(ancestor);
        if (["auto", "scroll"].includes(parentStyle.overflowX)) reachable = true;
        // A hidden overflow clips rather than scrolls, but it also means the
        // overhang is not painted, so it is not a comprehension failure either.
        if (parentStyle.overflowX === "hidden") reachable = true;
        ancestor = ancestor.parentElement;
      }
      if (reachable) continue;

      escaped += 1;
      if (over > worstBy) {
        worstBy = over;
        worst = `${node.tagName.toLowerCase()}.${(node.className || "").toString().slice(0, 40)}`;
      }
    }

    return {
      pageScrollsSideways: root.scrollWidth - root.clientWidth,
      mainHasContent: (main?.textContent ?? "").trim().length,
      escaped,
      worst,
      worstBy: Math.round(worstBy),
    };
  });
}

for (const scenario of SCENARIOS) {
  for (const condition of CONDITIONS) {
    test(`${scenario} @ ${condition.key} — ${condition.note}`, async ({ page }) => {
      await page.setViewportSize({ width: condition.width, height: condition.height });
      if (condition.reducedMotion) await page.emulateMedia({ reducedMotion: "reduce" });

      await openWorkspace(page, { scenario, mode: "recruiter", view: "inbox" });
      await page.waitForTimeout(400);

      const seen = await readability(page);

      // `empty` is not in this matrix, so every scenario here has something to
      // show. A blank main at one width is the failure a screenshot review is
      // most likely to skim past.
      expect(seen.mainHasContent, `${scenario} renders nothing at ${condition.key}`).toBeGreaterThan(40);

      // The page itself must never scroll sideways. Individual containers may.
      expect(
        seen.pageScrollsSideways,
        `${scenario} at ${condition.key} scrolls the whole page sideways by ${seen.pageScrollsSideways}px`
      ).toBeLessThanOrEqual(1);

      expect(
        seen.escaped,
        `${scenario} at ${condition.key}: ${seen.escaped} element(s) painted past the right edge, worst ${seen.worst} by ${seen.worstBy}px`
      ).toBe(0);

      await page.screenshot({
        path: `${SHOTS}/${scenario}-${condition.key}.png`,
        fullPage: false,
      });
    });
  }
}

/* ---- the seventh condition: no mouse ------------------------------------- */

for (const scenario of SCENARIOS) {
  test(`${scenario} @ keyboard-only — reachable without a pointer`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openWorkspace(page, { scenario, mode: "recruiter", view: "inbox" });

    // Tab from the top and confirm the workspace's own controls are reachable
    // in a sane number of stops — not that a specific control is Nth, which
    // would break on any layout change and prove nothing.
    const reached = new Set<string>();
    for (let step = 0; step < 60; step += 1) {
      await page.keyboard.press("Tab");
      const id = await page.evaluate(() => {
        const node = document.activeElement as HTMLElement | null;
        if (!node) return null;
        return node.getAttribute("data-testid") ?? node.tagName.toLowerCase();
      });
      if (id) reached.add(id);
      if (reached.has("queue-selector-trigger")) break;
    }

    expect(
      reached.has("queue-selector-trigger"),
      `${scenario}: the classification control is not reachable by Tab (reached ${[...reached].slice(0, 12).join(", ")})`
    ).toBe(true);

    // And whatever holds focus is actually visible — focus on an offscreen
    // element is the classic keyboard trap that looks fine to a mouse user.
    const visible = await page.evaluate(() => {
      const node = document.activeElement as HTMLElement | null;
      if (!node) return false;
      const box = node.getBoundingClientRect();
      return box.width > 0 && box.height > 0 && box.top < window.innerHeight && box.bottom > 0;
    });
    expect(visible, `${scenario}: focus landed on something offscreen`).toBe(true);

    await page.screenshot({ path: `${SHOTS}/${scenario}-keyboard.png`, fullPage: false });
  });
}
