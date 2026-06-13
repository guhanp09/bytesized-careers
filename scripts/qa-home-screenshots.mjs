// Visual QA for the home page polish pass. Run with the e2e server up:
// node scripts/qa-home-screenshots.mjs
import { chromium } from "@playwright/test";

const BASE = "http://127.0.0.1:3100";
const OUT = "/tmp/cj-home-qa";

const browser = await chromium.launch();

// Desktop
const desktop = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await desktop.goto(`${BASE}/`);
await desktop.waitForTimeout(1400);
await desktop.screenshot({ path: `${OUT}-hero-initial.png` });

// Let the stat carousel rotate once (5s) so count-up + progress are visible mid-flight.
await desktop.waitForTimeout(4400);
await desktop.screenshot({ path: `${OUT}-hero-rotated.png` });

// Hover the hero to engage the spotlight.
await desktop.mouse.move(700, 350);
await desktop.waitForTimeout(700);
await desktop.screenshot({ path: `${OUT}-hero-spotlight.png` });

// Scroll to the jobs grid (triggers reveals) and hover a card for the sheen.
await desktop.getByRole("heading", { name: "Recent Job Listings" }).scrollIntoViewIfNeeded();
await desktop.waitForTimeout(900);
const firstCard = desktop.locator('section.home-rise-delay-jobs article[role="link"]').first();
await firstCard.hover();
await desktop.waitForTimeout(400);
await desktop.screenshot({ path: `${OUT}-jobs-reveal.png` });

// Bottom: talent section + closing CTA band.
await desktop.mouse.wheel(0, 4000);
await desktop.waitForTimeout(1100);
await desktop.screenshot({ path: `${OUT}-closing-band.png` });

// Mobile
const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
await mobile.goto(`${BASE}/`);
await mobile.waitForTimeout(1400);
await mobile.screenshot({ path: `${OUT}-mobile-hero.png` });
await mobile.mouse.wheel(0, 5000);
await mobile.waitForTimeout(1100);
await mobile.screenshot({ path: `${OUT}-mobile-bottom.png` });

// Reduced motion sanity
const rmContext = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
  reducedMotion: "reduce",
});
const rmPage = await rmContext.newPage();
await rmPage.goto(`${BASE}/`);
await rmPage.waitForTimeout(1200);
await rmPage.screenshot({ path: `${OUT}-reduced-motion.png` });

await browser.close();
console.log("done");
