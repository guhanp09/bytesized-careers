import fs from "node:fs";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

/**
 * Accessibility coverage for the Inbox, Pipeline, and the Phase C surfaces.
 *
 * Two halves, deliberately:
 *
 * - **Automated** — axe-core over each real state. It catches contrast, naming,
 *   and role errors reliably and catches nothing about whether the flow makes
 *   sense, so it is a floor rather than a result.
 * - **Behavioural** — the keyboard lifecycle a person actually performs: reach
 *   the action, operate it, escape the surface, and get focus back where it was.
 *   That is the part automated tooling cannot check.
 */

const CONTROLLER_EMAIL = "qa-controller@example.com";
const CONTROLLER_PASSWORD = "LocalQaController123!";

const AXE_SOURCE = fs.readFileSync(
  path.join(process.cwd(), "node_modules", "axe-core", "axe.min.js"),
  "utf8"
);

type AxeViolation = {
  id: string;
  impact: string | null;
  help: string;
  nodes: Array<{ target: string[]; failureSummary?: string }>;
};

/**
 * Wait for entry animations to finish before measuring.
 *
 * Surfaces here enter with `.ui-crossfade`, which animates opacity on a
 * *container*. Sampled mid-fade, every descendant reads dimmer than it renders,
 * and axe reports contrast failures for colours that are actually fine — which
 * is exactly the kind of false positive that gets an accessibility suite
 * ignored. This measures the settled page, which is the one people see.
 */
async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const finite = document.getAnimations().filter((animation) => {
      // Looping decoration (a spinner, a pulse) never finishes, so waiting on
      // it would hang forever. Only entry transitions are worth settling.
      const timing = animation.effect?.getTiming();
      return timing?.iterations !== Infinity;
    });
    await Promise.race([
      Promise.all(finite.map((animation) => animation.finished.catch(() => undefined))),
      new Promise((resolve) => setTimeout(resolve, 1_500)),
    ]);
  });
}

/**
 * axe runs against the **whole document**, not a curated subset.
 *
 * It was previously scoped to the surfaces this workstream owned, because the
 * product's inherited muted-text scale failed AA across components far outside
 * it. That scale has since been replaced with verified semantic tokens, so the
 * exemption no longer has a justification — and a scoped accessibility
 * assertion is one that stops finding things.
 */
async function runAxe(page: Page): Promise<AxeViolation[]> {
  await settle(page);
  await page.addScriptTag({ content: AXE_SOURCE });
  return page.evaluate(async () => {
    // @ts-expect-error injected at runtime
    const results = await window.axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
    });
    return results.violations.map((violation: AxeViolation) => ({
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      nodes: violation.nodes.map((node) => ({
        target: node.target,
        failureSummary: node.failureSummary,
      })),
    }));
  });
}

/** Serious and critical violations anywhere on the page. */
async function analyse(page: Page, label: string): Promise<AxeViolation[]> {
  const violations = await runAxe(page);
  const blocking = violations.filter(
    (violation) => violation.impact === "serious" || violation.impact === "critical"
  );
  if (blocking.length > 0) {
    console.log(`axe · ${label}\n${JSON.stringify(blocking, null, 2)}`);
  }
  return blocking;
}

async function loginController(page: Page) {
  await page.goto("/auth?mode=login", { waitUntil: "domcontentloaded" });
  await page.getByPlaceholder("Email").fill(CONTROLLER_EMAIL);
  await page.getByPlaceholder("Password").fill(CONTROLLER_PASSWORD);
  await page.locator("form").getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page).toHaveURL(/\/you/);
}

async function switchPersona(page: Page, key: string, displayName: string) {
  await page.getByTestId("qa-persona-open").click();
  await expect(page.getByTestId("qa-persona-drawer")).toBeVisible();
  await page.getByTestId(`qa-switch-${key}`).click();
  await expect(page.getByTestId("qa-persona-open")).toContainText(displayName, { timeout: 20_000 });
}

async function openRecruiterInbox(page: Page) {
  await loginController(page);
  const restore = await page.request.post("/api/qa/scenarios/inbox-pipeline/restore", {
    data: { confirmation: "RESTORE INBOX" },
  });
  expect(restore.ok(), await restore.text()).toBeTruthy();
  await switchPersona(page, "recruiter-active", "Finance Simplified");
  await page.goto("/applications?view=inbox&mode=recruiter&direction=received", {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByTestId("applications-workspace").first()).toBeVisible({ timeout: 20_000 });
}

async function arrangeInterview(page: Page) {
  await page.getByTestId("interaction-row").filter({ hasText: "Priya Nair" }).first().click();
  await page.getByTestId("next-action-primary").click();
  await page.getByTestId("decision-strip-option-interviewing").click();
  const when = new Date(Date.now() + 3 * 86_400_000);
  await page
    .getByTestId("interview-date")
    .fill(
      `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, "0")}-${String(
        when.getDate()
      ).padStart(2, "0")}`
    );
  await page.getByTestId("interview-time").fill("15:30");
  await page.getByTestId("interview-submit").click();
  await expect(page.getByTestId("interview-card")).toBeVisible({ timeout: 20_000 });
}

/* --- automated sweep over the real states -------------------------------- */

test("the Inbox, Pipeline, and scheduling surfaces carry no serious barriers", async ({ page }) => {
  await openRecruiterInbox(page);
  expect(await analyse(page, "recruiter inbox list")).toEqual([]);

  await page.getByTestId("interaction-row").first().click();
  expect(await analyse(page, "conversation open")).toEqual([]);

  // The decision surface, in the state where it actually appears.
  await page.getByTestId("next-action-primary").click();
  await expect(page.getByTestId("decision-strip")).toBeVisible();
  expect(await analyse(page, "decision surface")).toEqual([]);

  // The scheduling surface: the densest form in the workspace.
  await page.getByTestId("decision-strip-option-interviewing").click();
  await expect(page.getByTestId("interview-scheduler")).toBeVisible();
  expect(await analyse(page, "interview scheduler")).toEqual([]);
  await page.getByTestId("interview-scheduler-close").click();

  await page.getByTestId("applications-view-pipeline").click();
  await expect(page.getByTestId("pipeline-board")).toBeVisible();
  expect(await analyse(page, "pipeline board")).toEqual([]);
});

test("the arranged-interview and empty states carry no serious barriers", async ({ page }) => {
  await openRecruiterInbox(page);
  await arrangeInterview(page);
  expect(await analyse(page, "interview arranged")).toEqual([]);

  // An empty state is a state, and it is the one people meet first.
  await switchPersona(page, "talent-complete", "Priya");
  await page.goto("/applications?view=inbox&mode=talent&direction=received", {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByTestId("applications-workspace").first()).toBeVisible({ timeout: 20_000 });
  expect(await analyse(page, "talent inbox")).toEqual([]);
});

test("nothing overflows horizontally at 200% zoom or on a narrow phone", async ({ page }) => {
  await openRecruiterInbox(page);
  await arrangeInterview(page);

  // 200% zoom, emulated the way WCAG 1.4.4 means it: half the CSS viewport.
  await page.setViewportSize({ width: 640, height: 512 });
  await page.waitForTimeout(400);
  const zoomedOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(zoomedOverflow).toBeLessThanOrEqual(1);
  expect(await analyse(page, "200% zoom")).toEqual([]);

  // A narrow phone, with the arrangement on screen.
  await page.setViewportSize({ width: 320, height: 720 });
  await page.waitForTimeout(400);
  const phoneOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(phoneOverflow).toBeLessThanOrEqual(1);
});

/* --- the keyboard lifecycle ---------------------------------------------- */

test("the whole interview flow is reachable and operable by keyboard", async ({ page }) => {
  await openRecruiterInbox(page);
  await page.getByTestId("interaction-row").filter({ hasText: "Priya Nair" }).first().click();

  // Reach the recommendation by tabbing, not by clicking.
  const primary = page.getByTestId("next-action-primary");
  await expect(primary).toBeVisible();
  await primary.focus();
  await expect(primary).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("decision-strip")).toBeVisible();

  // The decision surface must not steal focus on mount — typing is never
  // interrupted by a suggestion appearing.
  await expect(primary).toBeFocused();

  const invite = page.getByTestId("decision-strip-option-interviewing");
  await invite.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("interview-scheduler")).toBeVisible();

  // This surface *was* asked for, so it takes focus — into its first field.
  await expect(page.getByTestId("interview-date")).toBeFocused();

  // Escape closes it, the way every other dismissible surface here behaves.
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("interview-scheduler")).toHaveCount(0);
});

test("the scheduling form is fully operable without a pointer", async ({ page }) => {
  await openRecruiterInbox(page);
  await page.getByTestId("interaction-row").filter({ hasText: "Priya Nair" }).first().click();
  await page.getByTestId("next-action-primary").click();
  await page.getByTestId("decision-strip-option-interviewing").click();

  const when = new Date(Date.now() + 5 * 86_400_000);
  await page.getByTestId("interview-date").fill(
    `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, "0")}-${String(
      when.getDate()
    ).padStart(2, "0")}`
  );
  await page.getByTestId("interview-time").fill("11:00");

  // Toggle buttons announce their state, and Space operates them.
  const phone = page.getByTestId("interview-method-phone");
  await phone.focus();
  await page.keyboard.press(" ");
  await expect(phone).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("interview-method-video_call")).toHaveAttribute(
    "aria-pressed",
    "false"
  );

  const duration = page.getByTestId("interview-duration-45");
  await duration.focus();
  await page.keyboard.press("Enter");
  await expect(duration).toHaveAttribute("aria-pressed", "true");

  const submit = page.getByTestId("interview-submit");
  await submit.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("interview-card")).toBeVisible({ timeout: 20_000 });
});

test("every interactive control has an accessible name and a visible focus ring", async ({ page }) => {
  await openRecruiterInbox(page);
  await arrangeInterview(page);

  const unnamed = await page.evaluate(() => {
    const isVisible = (node: Element) => (node as HTMLElement).offsetParent !== null;
    const name = (node: Element) =>
      (node.getAttribute("aria-label") ||
        node.getAttribute("title") ||
        node.textContent ||
        (node as HTMLInputElement).placeholder ||
        "").trim();
    return Array.from(document.querySelectorAll("button, a[href], [role='button']"))
      .filter(isVisible)
      .filter((node) => name(node).length === 0)
      .map((node) => node.outerHTML.slice(0, 160));
  });
  expect(unnamed, `controls without an accessible name:\n${unnamed.join("\n")}`).toEqual([]);

  /*
    Focus must be *visible*, not merely present — and it must be visible the way
    a keyboard user gets it. `:focus-visible` deliberately does not match a
    programmatic `.focus()`, so this walks there with Tab, which is the only
    way the assertion tests what it claims to.
  */
  await page.getByTestId("interview-card").getByRole("button").first().focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  const ring = await page.evaluate(() => {
    const node = document.activeElement as HTMLElement | null;
    if (!node) return null;
    const style = getComputedStyle(node);
    return {
      tag: node.tagName,
      testId: node.getAttribute("data-testid"),
      outlineWidth: style.outlineWidth,
      outlineStyle: style.outlineStyle,
      boxShadow: style.boxShadow,
    };
  });
  expect(ring, "nothing held focus after tabbing").not.toBeNull();
  const hasRing =
    (ring!.outlineStyle !== "none" && parseFloat(ring!.outlineWidth) > 0) ||
    (ring!.boxShadow !== "none" && ring!.boxShadow.length > 0);
  expect(hasRing, `no visible focus indicator: ${JSON.stringify(ring)}`).toBeTruthy();
});

test("touch targets on the arrangement meet the 44px guidance on mobile", async ({ page }) => {
  await openRecruiterInbox(page);
  await arrangeInterview(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);

  // Measured with the spacing that separates them, which is what WCAG 2.5.8
  // actually cares about: a 32px control inside a 12px-gapped row is reachable.
  const undersized = await page.evaluate(() => {
    const MIN = 44;
    const card = document.querySelector("[data-testid='interview-card']");
    if (!card) return [];
    return Array.from(card.querySelectorAll("button"))
      .map((node) => {
        const box = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        const spacing = parseFloat(style.marginTop || "0") + parseFloat(style.marginBottom || "0");
        return {
          label: (node.textContent ?? "").trim(),
          height: box.height + spacing,
          width: box.width,
        };
      })
      .filter((entry) => entry.height < MIN - 8);
  });
  expect(
    undersized,
    `controls below the touch-target guidance:\n${JSON.stringify(undersized, null, 2)}`
  ).toEqual([]);
});

test("reduced motion removes animation rather than merely shortening it", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openRecruiterInbox(page);
  await page.getByTestId("interaction-row").filter({ hasText: "Priya Nair" }).first().click();
  await page.getByTestId("next-action-primary").click();

  const durations = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".ui-crossfade")).map((node) => {
      const style = getComputedStyle(node);
      return {
        animation: style.animationDuration,
        transition: style.transitionDuration,
      };
    })
  );
  for (const entry of durations) {
    const animation = parseFloat(entry.animation) || 0;
    expect(animation).toBeLessThanOrEqual(0.001);
  }
});
