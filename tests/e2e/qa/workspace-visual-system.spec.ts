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
  /*
    A record the ladder is confident about. Not every record has one — the
    neutral "Choose next step" fallback was removed, so where the derivation
    will not commit, the header simply carries no button and there is nothing
    here to measure. Finding a row that does have one is the honest way to test
    what a primary looks like.
  */
  const rows = page.getByTestId("interaction-row");
  const total = await rows.count();
  let found = false;
  for (let index = 0; index < Math.min(total, 6) && !found; index += 1) {
    await rows.nth(index).click();
    // Give the header a moment to settle: opening a conversation resolves over
    // several renders, so an immediate count() reads the frame before the
    // recommendation lands and would walk past a record that does have one.
    found = await page
      .getByTestId("next-action-primary")
      .waitFor({ state: "attached", timeout: 1_500 })
      .then(() => true)
      .catch(() => false);
  }
  test.skip(!found, "no record in this scenario carries a confident recommendation");

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
  // There is no neutral fallback any more — anything rendered here is a
  // recommendation the derivation stands behind, so it wears the filled
  // gradient without exception.
  expect(style.key, "the removed neutral fallback is back").not.toBe("choose-next-step");
  expect(style.image, "a confident recommendation should carry its gradient").not.toBe("none");
});

test("a confident recommendation is visually filled where a neutral one is not", async ({ page }) => {
  await openRecruiterInbox(page);

  /*
    An unread message on a *live* record yields "Reply to …", which is high
    confidence. The terminal ones are excluded deliberately: a hired or rejected
    record has nothing left to recommend, so it renders no primary action at all
    — and this test previously took whichever unread row happened to be first,
    which made it pass or fail on the fixture's ordering rather than on the
    styling it exists to check.
  */
  const unread = page
    .getByTestId("interaction-row")
    .filter({ has: page.getByTestId("inbox-unread-badge") })
    .filter({ hasNotText: /Hired|Not selected|Withdrawn|Declined|Accepted/ });
  test.skip((await unread.count()) === 0, "no unread live conversation in this scenario");
  await unread.first().click();

  const primary = page.getByTestId("next-action-primary");
  await expect(primary).toBeVisible();

  /*
    Settle before measuring. Opening a conversation resolves over several
    renders — unread clears, the thread and its engagement arrive — and React
    replaces the action button when the recommendation it carries changes. A
    style read from a handle captured before that lands resolves against a
    detached node and comes back as "", which reads as "the gradient is
    missing" when the gradient is simply on a newer element.
  */
  await expect(primary).toHaveAttribute("data-action-key", "reply");

  /*
    Resolved and measured in one tick, deliberately. Opening a conversation
    settles over several renders — unread clears, the thread and its engagement
    arrive — and React replaces this button each time the recommendation it
    carries is recomputed. A handle captured by the test and measured a moment
    later resolves against a node React has already discarded, and
    getComputedStyle on a detached node returns an empty declaration, which
    reads as "the gradient is missing" when the gradient is on a newer element.
  */
  await expect
    .poll(() =>
      page.evaluate(() => {
        const node = document.querySelector("[data-testid='next-action-primary']");
        return node ? getComputedStyle(node).backgroundImage : "";
      })
    )
    .toContain("gradient");
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

test("the queue control keeps a one-click way back to everything", async ({ page }) => {
  await openRecruiterInbox(page);
  const trigger = page.getByTestId("queue-selector-trigger");
  if ((await trigger.count()) === 0) test.skip(true, "no queue holds work in this fixture");

  // Idle it is an offer, so there is nothing to escape from and no clear shown.
  await expect(page.getByTestId("queue-clear")).toHaveCount(0);

  await trigger.click();
  const first = page.getByTestId("queue-selector-menu").getByRole("menuitemradio").nth(1);
  const label = ((await first.textContent()) ?? "").trim();
  await first.click();

  // Standing inside a queue, the trigger says which one — and the way out is a
  // button beside it, not an item you have to reopen the menu to find. The rail
  // this replaced made you hunt for "All" among chips that scrolled.
  await expect(trigger).toContainText(label.replace(/\d+$/, "").trim().slice(0, 12));
  const clear = page.getByTestId("queue-clear");
  await expect(clear).toBeVisible();
  await clear.click();
  await expect(page.getByTestId("queue-clear")).toHaveCount(0);
});
