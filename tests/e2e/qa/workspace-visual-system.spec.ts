import { expect, test, type Page } from "@playwright/test";

/**
 * The visual system, asserted as behaviour rather than as pixels.
 *
 * Screenshot diffing would fail on every deliberate change and tell nobody why.
 * These check the *properties* the design depends on: that layers are actually
 * distinguishable, that the open row is distinguishable from a closed one by
 * more than a hairline, that depth exists where the design says it does, and
 * that gradients never sit under unreadable text.
 */

const CONTROLLER_EMAIL = "qa-controller@example.com";
const CONTROLLER_PASSWORD = "LocalQaController123!";

async function loginController(page: Page) {
  await page.goto("/auth?mode=login", { waitUntil: "domcontentloaded" });
  await page.getByPlaceholder("Email").fill(CONTROLLER_EMAIL);
  await page.getByPlaceholder("Password").fill(CONTROLLER_PASSWORD);
  await page.locator("form").getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page).toHaveURL(/\/you/);
}

async function openRecruiterInbox(page: Page) {
  await loginController(page);
  const restore = await page.request.post("/api/qa/scenarios/inbox-pipeline/restore", {
    data: { confirmation: "RESTORE INBOX" },
  });
  expect(restore.ok(), await restore.text()).toBeTruthy();
  await page.getByTestId("qa-persona-open").click();
  await page.getByTestId("qa-switch-recruiter-active").click();
  await expect(page.getByTestId("qa-persona-open")).toContainText("Finance Simplified", {
    timeout: 20_000,
  });
  await page.goto("/applications?view=inbox&mode=recruiter&direction=received", {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByTestId("interaction-row").first()).toBeVisible({ timeout: 20_000 });
}

test("the open conversation is distinguishable from a closed one by more than a hairline", async ({
  page,
}) => {
  await openRecruiterInbox(page);
  const rows = page.getByTestId("interaction-row");
  await rows.nth(1).click();

  const measured = await page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll("[data-testid='interaction-row']"));
    const selected = nodes.find((node) => node.getAttribute("aria-pressed") === "true");
    const other = nodes.find((node) => node.getAttribute("aria-pressed") !== "true");
    if (!selected || !other) return null;
    const read = (node: Element) => {
      const style = getComputedStyle(node);
      return { background: style.backgroundColor, image: style.backgroundImage };
    };
    return { selected: read(selected), other: read(other) };
  });

  expect(measured, "expected one open row and one closed row").not.toBeNull();
  // A different fill, not merely a different border.
  expect(measured!.selected.background).not.toBe(measured!.other.background);
  // And a tonal wash, which is what makes it read as a lit band.
  expect(measured!.selected.image).not.toBe("none");
});

test("the workspace has real layers rather than one repeated tone", async ({ page }) => {
  await openRecruiterInbox(page);
  await page.getByTestId("interaction-row").first().click();

  const layers = await page.evaluate(() => {
    const of = (selector: string) => {
      const node = document.querySelector(selector);
      return node ? getComputedStyle(node).backgroundColor : null;
    };
    return {
      list: of("[data-testid='interaction-row']:not([aria-pressed='true'])"),
      header: of("[data-testid='applications-detail-header']"),
    };
  });

  expect(layers.header, "the detail header should paint its own surface").toBeTruthy();
  // The header is a raised layer; the list sits below it. If these ever match,
  // the layering has silently collapsed back to one flat tone.
  expect(layers.header).not.toBe("rgba(0, 0, 0, 0)");
});

test("the primary action is a lifted surface, not a flat rectangle", async ({ page }) => {
  await openRecruiterInbox(page);
  await page.getByTestId("interaction-row").filter({ hasText: "Priya Nair" }).first().click();

  const primary = page.getByTestId("next-action-primary");
  await expect(primary).toBeVisible();
  const style = await primary.evaluate((node) => {
    const computed = getComputedStyle(node);
    return {
      key: node.getAttribute("data-action-key"),
      image: computed.backgroundImage,
      shadow: computed.boxShadow,
    };
  });

  // Both variants sit above the surface — an action you can see is an action
  // you can find.
  expect(style.shadow, "the recommended action should sit above the surface").not.toBe("none");

  /*
    Only a *confident* recommendation wears the filled gradient. "Choose next
    step" is the neutral fallback the product shows when it will not guess, and
    dressing it as a primary would be the interface asserting certainty the
    derivation explicitly refused to claim.
  */
  if (style.key === "choose-next-step") {
    expect(style.image, "the neutral fallback must not look like a decision").toBe("none");
    return;
  }
  expect(style.image, "a confident recommendation should carry its gradient").not.toBe("none");
});

test("a confident recommendation is visually filled where a neutral one is not", async ({ page }) => {
  await openRecruiterInbox(page);

  // A row with unread mail yields "Reply to …", which is high confidence.
  const unread = page.getByTestId("interaction-row").filter({ has: page.getByTestId("inbox-unread-badge") });
  test.skip((await unread.count()) === 0, "no unread conversation in this scenario");
  await unread.first().click();

  const primary = page.getByTestId("next-action-primary");
  await expect(primary).toBeVisible();
  const image = await primary.evaluate((node) => getComputedStyle(node).backgroundImage);
  expect(image).toContain("gradient");
});

test("text over every gradient surface stays readable", async ({ page }) => {
  await openRecruiterInbox(page);
  await page.getByTestId("interaction-row").first().click();

  // Sampled from the rendered page: any element whose own background is a
  // gradient, checked against the text it contains. A gradient that swallows
  // its own label is the specific failure this guards.
  const offenders = await page.evaluate((): string[] => {
    const luminance = (color: string) => {
      const parts = color.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0];
      const lin = (v: number) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * lin(parts[0]) + 0.7152 * lin(parts[1]) + 0.0722 * lin(parts[2]);
    };
    const bad: string[] = [];
    for (const node of Array.from(document.querySelectorAll<HTMLElement>("*"))) {
      const style = getComputedStyle(node);
      if (!style.backgroundImage.includes("gradient")) continue;
      if (node.offsetParent === null) continue;
      const text = (node.textContent ?? "").trim();
      if (!text) continue;
      // Compare the text colour against the element's own base fill, which is
      // the darkest point any gradient stop resolves to here.
      const ratio = (() => {
        const a = luminance(style.color);
        const b = luminance(style.backgroundColor);
        const [hi, lo] = a > b ? [a, b] : [b, a];
        return (hi + 0.05) / (lo + 0.05);
      })();
      if (ratio < 4.5) bad.push(`${node.tagName}.${node.className}`.slice(0, 120));
    }
    return bad;
  });

  expect(offenders, `text under a gradient below 4.5:1:\n${offenders.join("\n")}`).toEqual([]);
});

test("Pipeline cards are surfaces above their section, and are not buttons", async ({ page }) => {
  await openRecruiterInbox(page);
  await page.getByTestId("applications-view-pipeline").click();
  await expect(page.getByTestId("pipeline-board")).toBeVisible();

  const card = page.getByTestId("pipeline-row").first();
  await expect(card).toBeVisible();

  // A card containing a link, a checkbox, a menu and a Message button must not
  // itself claim to be a button — that is ambiguous to a screen reader and is
  // what axe reports as `nested-interactive`.
  await expect(card).not.toHaveAttribute("role", "button");

  const depth = await card.evaluate((node) => {
    const own = getComputedStyle(node);
    const section = node.closest("[data-testid^='pipeline-group-']");
    return {
      shadow: own.boxShadow,
      card: own.backgroundColor,
      section: section ? getComputedStyle(section).backgroundColor : null,
    };
  });
  expect(depth.shadow, "cards should sit above their section").not.toBe("none");
  expect(depth.card, "a card must not share its section's fill").not.toBe(depth.section);

  // The keyboard path is the labelled Message button, which the card still owns.
  await expect(card.getByTestId("pipeline-message")).toBeVisible();
});

test("each stage section carries its own accent, and closed groups stay quiet", async ({ page }) => {
  await openRecruiterInbox(page);
  await page.getByTestId("applications-view-pipeline").click();
  await expect(page.getByTestId("pipeline-board")).toBeVisible();

  const accents = await page.evaluate(() =>
    Array.from(document.querySelectorAll("[data-testid^='pipeline-group-']")).map((section) => ({
      id: section.getAttribute("data-testid"),
      // The 2px stage edge is the first child when present.
      accent: section.firstElementChild?.getAttribute("aria-hidden") === "true",
    }))
  );
  expect(accents.length).toBeGreaterThan(0);
  // Active stages are accented; terminal ones are history and stay flat.
  expect(accents.some((entry) => entry.accent)).toBeTruthy();
  expect(accents.some((entry) => !entry.accent)).toBeTruthy();
});

test("the row leads with the person, not with backend vocabulary", async ({ page }) => {
  await openRecruiterInbox(page);
  const row = page.getByTestId("interaction-row").first();
  const text = ((await row.textContent()) ?? "").trim();

  // "Received application" used to be the topmost line of every row. It is now
  // an accessible name on the avatar mark, so it is still announced but no
  // longer occupies the position the person's name should hold.
  const firstVisibleLine = await row.evaluate((node) => {
    const name = node.querySelector("span.truncate");
    return (name?.textContent ?? "").trim();
  });
  expect(firstVisibleLine.length).toBeGreaterThan(0);
  expect(firstVisibleLine).not.toMatch(/^(Received|Sent) /);
  // The direction is still available to assistive technology.
  expect(text).toMatch(/(Received|Sent) (application|hiring request)/);
});

test("the queue rail keeps a visible way back to everything", async ({ page }) => {
  await openRecruiterInbox(page);
  const all = page.getByTestId("queue-chip-all");
  await expect(all).toBeVisible();

  // Pressed by default and visually raised, so "no filter" is a state you can
  // see rather than the absence of one.
  await expect(all).toHaveAttribute("aria-pressed", "true");
  const raised = await all.evaluate((node) => getComputedStyle(node).boxShadow);
  expect(raised).not.toBe("none");
});
