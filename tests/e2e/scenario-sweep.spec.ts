import { test, expect, type Page } from "@playwright/test";
import { encode } from "next-auth/jwt";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { anchor, manifest, openWorkspace, row, SCENARIOS, type ScenarioName } from "./scenarioAnchors";

/**
 * The six-scenario sweep, kept.
 *
 * The one-off QA pass that produced these checks found no product defects, which
 * is only worth something if the checks stay. Each one is a property that would
 * be expensive to notice by hand and cheap to lose: a scenario quietly leaking
 * into the next, a raw enum reaching a screen, a documented route that stopped
 * resolving, a payment claim appearing in copy.
 */

const SESSION_SECRET = "e2e-secret";

async function signIn(context: Parameters<typeof test>[0] extends never ? never : any) {
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

/** Values the workspace stores but must never show a person. */
const RAW_ENUMS = [
  "under_consideration",
  "not_applicable",
  "release_requested",
  "work_in_progress",
  "funding_pending",
  "setup_pending",
  "start_pending",
  "hiring_request",
];

/** The product holds no money, so no screen may suggest otherwise. */
const PAYMENT_CLAIMS = ["escrow", "funds are held", "funds are secure", "guaranteed"];

const overflowOf = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test.beforeEach(async ({ context }) => {
  await signIn(context);
});

for (const scenario of SCENARIOS) {
  test(`${scenario}: renders on every viewport without overflow, raw enums or payment claims`, async ({ page }) => {
    test.setTimeout(120_000);
    for (const width of [1440, 1280, 390, 320]) {
      await page.setViewportSize({ width, height: width < 500 ? 800 : 900 });
      for (const mode of ["talent", "recruiter"] as const) {
        await openWorkspace(page, { scenario, mode, view: "inbox" });
        expect(await overflowOf(page), `${scenario}/${mode}/${width}px overflows`).toBeLessThanOrEqual(1);

        const main = page.getByRole("main");
        const rows = await main.getByTestId("interaction-row").count();
        if (scenario === "empty") {
          expect(rows, "the empty scenario must be empty").toBe(0);
          // Empty is a state the product says out loud; a blank pane reads as a
          // failure to load.
          await expect(main.getByTestId("applications-workspace")).toContainText(/no .*(yet|activity)/i);
        } else {
          expect(rows, `${scenario}/${mode} rendered nothing`).toBeGreaterThan(0);
        }

        if (width === 1440) {
          const text = (await main.getByTestId("applications-workspace").textContent()) ?? "";
          for (const raw of RAW_ENUMS) expect(text, `${scenario}/${mode} leaked "${raw}"`).not.toContain(raw);
          for (const claim of PAYMENT_CLAIMS)
            expect(text.toLowerCase(), `${scenario}/${mode} claims "${claim}"`).not.toContain(claim);
          // A shared generic word is the absence of a name rendered as one.
          const names = await main.getByTestId("interaction-row").evaluateAll((els) =>
            els.slice(0, 40).map((el) => (el.textContent ?? "").trim())
          );
          const generic = names.filter((n) => /(^|\s)(Recruiter|Talent|Applicant)(\s|$)/.test(n));
          expect(generic, `${scenario}/${mode} shows a generic counterparty name`).toEqual([]);
        }
      }
    }
  });
}

test("every indexed edge case renders a row and opens a detail that is not blank", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openWorkspace(page, { scenario: "edge", mode: "recruiter", view: "inbox" });
  const main = page.getByRole("main");

  const missing: string[] = [];
  for (const entry of manifest("edge").index) {
    const locator = row(page, entry.relationship_id);
    if ((await locator.count()) === 0) missing.push(entry.expected_condition);
  }
  expect(missing, `indexed edge cases with no row:\n${missing.join("\n")}`).toEqual([]);

  // The pathological ones, opened. Identity and content edge cases are exactly
  // where a detail pane goes blank or a layout escapes its column.
  for (const condition of [
    "very long name",
    "right-to-left",
    "emoji inside",
    "non-Latin",
    "zero portfolio",
    "22 portfolio",
    "thumbnail 404",
    "very long message",
    "record reversed after a hire",
    "withdrawal during an active engagement",
  ]) {
    const target = anchor("edge", condition, { persona: "recruiter" });
    const locator = row(page, target);
    await locator.scrollIntoViewIfNeeded();
    await locator.click();
    const detail = main.getByTestId("applications-detail");
    await expect(detail, `${condition} produced no detail`).toBeVisible();
    expect(((await detail.textContent()) ?? "").trim(), `${condition} detail is blank`).not.toBe("");
    expect(await overflowOf(page), `${condition} overflows`).toBeLessThanOrEqual(1);
  }
});

test("switching scenarios leaks nothing, refresh keeps the choice, unknown seeds fail loudly", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const main = page.getByRole("main");
  const idsOf = () =>
    main.getByTestId("interaction-row").evaluateAll((els) => els.map((el) => el.getAttribute("data-record-id")));

  await openWorkspace(page, { scenario: "edge", mode: "recruiter", view: "inbox" });
  const edgeIds = await idsOf();
  await openWorkspace(page, { scenario: "talent", mode: "recruiter", view: "inbox" });
  const talentIds = await idsOf();
  expect(talentIds.filter((id) => edgeIds.includes(id)), "records from the previous scenario are still on screen").toEqual([]);

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(main.getByTestId("interaction-row").first()).toBeVisible({ timeout: 20_000 });
  expect((await idsOf()).every((id) => talentIds.includes(id)), "a refresh changed the scenario").toBe(true);

  await page.goto("/applications?demo=1&seed=nope", { waitUntil: "domcontentloaded" });
  const error = page.getByTestId("scenario-error");
  await expect(error).toBeVisible();
  await expect(error).toContainText("nope");
  // And it must not have quietly loaded a dataset nobody asked for.
  await expect(main.getByTestId("interaction-row")).toHaveCount(0);
});

test("every route SCENARIOS.md documents actually resolves", async ({ page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const doc = readFileSync(join(process.cwd(), "SCENARIOS.md"), "utf8");
  const routes = [
    ...new Set(
      [...doc.matchAll(/`(\/applications\?[^`]+)`/g)].map((match) => match[1]).filter((route) => !route.includes("<"))
    ),
  ];
  expect(routes.length, "the document names no routes").toBeGreaterThan(0);

  const broken: string[] = [];
  for (const route of routes) {
    const response = await page.goto(route, { waitUntil: "domcontentloaded" });
    const main = page.getByRole("main");
    if (!response || response.status() >= 400) {
      broken.push(`${route} → HTTP ${response?.status()}`);
      continue;
    }
    await expect(main.getByTestId("applications-workspace")).toBeVisible({ timeout: 20_000 });
    if ((await page.getByTestId("scenario-error").count()) > 0) {
      broken.push(`${route} → scenario error`);
      continue;
    }
    const params = new URLSearchParams(route.split("?")[1]);
    const seed = (params.get("seed") ?? "default") as ScenarioName;
    if (seed === "empty") continue;
    /*
      Either shape counts as "showed something".

      A route that names no `view` gets whichever one the workspace remembers,
      which is correct behaviour and not something this check should second-
      guess. And the wait has to be an `expect`: `locator.isVisible()` answers
      immediately, so at `busy` volume it reported an empty board that was
      merely still rendering.
    */
    const target = params.get("view")
      ? main.getByTestId(params.get("view") === "pipeline" ? "pipeline-row" : "interaction-row").first()
      : main.locator('[data-testid="interaction-row"], [data-testid="pipeline-row"]').first();
    try {
      await expect(target).toBeVisible({ timeout: 30_000 });
    } catch {
      broken.push(`${route} → resolved but showed nothing`);
    }
  }
  expect(broken, `documented routes that do not work:\n${broken.join("\n")}`).toEqual([]);
});
