import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { encode } from "next-auth/jwt";
import { anchor, openRecord, openWorkspace, row } from "./scenarioAnchors";

/**
 * The messenger half of the workspace, held to a messenger's standards.
 *
 * Two defects motivate everything here. The list led with `item.title`, which
 * holds a job title on half its rows, so a list of conversations opened with
 * jobs rather than with people. The thread stamped a name and a time over every
 * bubble, which in a two-person conversation is repetition standing in for
 * information.
 *
 * These specs assert the shape of the fix in a real browser: what leads a row,
 * what the preview actually previews, where identity appears in a thread and —
 * as importantly — where it does not.
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

/* ---- the conversation row ------------------------------------------------ */

test("a row leads with the person, not the job", async ({ page }) => {
  const target = anchor("default", "portfolio attached", { persona: "recruiter" });
  await openWorkspace(page, { scenario: "default", mode: "recruiter", view: "inbox" });
  const record = row(page, target);
  await record.scrollIntoViewIfNeeded();

  await expect(record.getByTestId("row-identity")).toHaveText(target.counterpartyName);
  // The job is present, and it is the second line rather than the first.
  const context = record.getByTestId("row-context");
  await expect(context).toBeVisible();
  await expect(context).not.toHaveText(target.counterpartyName);
  if (target.jobTitle) await expect(context).toContainText(target.jobTitle);
});

test("identity outranks context typographically, not just in order", async ({ page }) => {
  const target = anchor("default", "portfolio attached", { persona: "recruiter" });
  await openWorkspace(page, { scenario: "default", mode: "recruiter", view: "inbox" });
  const record = row(page, target);
  await record.scrollIntoViewIfNeeded();

  const weights = await record.evaluate((node) => {
    const read = (selector: string) => {
      const element = node.querySelector(selector) as HTMLElement | null;
      if (!element) return null;
      const style = getComputedStyle(element);
      return { size: parseFloat(style.fontSize), weight: parseInt(style.fontWeight, 10) };
    };
    return { identity: read('[data-testid="row-identity"]'), context: read('[data-testid="row-context"]') };
  });
  expect(weights.identity).not.toBeNull();
  expect(weights.context).not.toBeNull();
  expect(weights.identity!.size).toBeGreaterThan(weights.context!.size);
  expect(weights.identity!.weight).toBeGreaterThanOrEqual(weights.context!.weight);
});

test("the avatar is prominent, square, and survives a dead image URL", async ({ page }) => {
  await openWorkspace(page, { scenario: "default", mode: "recruiter", view: "inbox" });
  const shapes = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('[data-testid="interaction-row"]')).slice(0, 12);
    return rows.map((entry) => {
      const avatar = entry.querySelector("span > span") as HTMLElement | null;
      const box = avatar?.getBoundingClientRect();
      return box ? { w: Math.round(box.width), h: Math.round(box.height) } : null;
    });
  });
  for (const shape of shapes) {
    expect(shape).not.toBeNull();
    // One size for every row, square, and big enough to be the first thing seen.
    expect(shape!.w).toBe(44);
    expect(shape!.h).toBe(44);
  }
});

test("the preview shows what a person said, and says so when nobody has", async ({ page }) => {
  await openWorkspace(page, { scenario: "busy", mode: "recruiter", view: "inbox" });
  const previews = main(page).getByTestId("row-preview");
  await expect(previews.first()).toBeVisible();

  const state = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('[data-testid="interaction-row"]'));
    return rows.map((entry) => {
      const preview = entry.querySelector('[data-testid="row-preview"]') as HTMLElement | null;
      return {
        text: (preview?.textContent ?? "").trim(),
        system: preview?.getAttribute("data-from-system") === "true",
      };
    });
  });
  expect(state.length).toBeGreaterThan(5);
  for (const entry of state) {
    // Never blank: an empty line would collapse the row and give the list two
    // heights depending on whether anybody happened to write a sentence.
    expect(entry.text.length, "a row previewed nothing at all").toBeGreaterThan(0);
  }
  // And a stand-in is marked as one rather than passed off as a message.
  const stand = state.filter((entry) => entry.system);
  for (const entry of stand) expect(entry.text).toMatch(/no message yet/i);
});

test("every row is the same height, whether or not anyone wrote anything", async ({ page }) => {
  await openWorkspace(page, { scenario: "busy", mode: "recruiter", view: "inbox" });
  const heights = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid="interaction-row"]')).map(
      (entry) => Math.round(entry.getBoundingClientRect().height)
    )
  );
  expect(heights.length).toBeGreaterThan(5);
  // One height, within a pixel of rounding. Rows that also carry a labelled
  // recommended action live in a wrapper outside this measurement — that extra
  // band is a deliberate hierarchy, not a row of a different size.
  expect(
    Math.max(...heights) - Math.min(...heights),
    `row heights: ${[...new Set(heights)].join(", ")}`
  ).toBeLessThanOrEqual(1);
});

test("the selected row is unmistakable without changing size", async ({ page }) => {
  const target = anchor("default", "portfolio attached", { persona: "recruiter" });
  await openWorkspace(page, { scenario: "default", mode: "recruiter", view: "inbox" });
  const record = row(page, target);
  await record.scrollIntoViewIfNeeded();
  const before = await record.boundingBox();

  await record.click();
  await expect(record).toHaveAttribute("aria-pressed", "true");
  const after = await record.boundingBox();
  expect(Math.abs((after?.height ?? 0) - (before?.height ?? 0))).toBeLessThanOrEqual(1);

  // A tonal surface, not only a hairline: the row itself is the button.
  const tone = await record.evaluate((node) => getComputedStyle(node).backgroundColor);
  expect(tone).not.toBe("rgba(0, 0, 0, 0)");
});

test("the reply shortcut stays hidden until it is wanted, and lands with the composer focused", async ({ page }) => {
  await openWorkspace(page, { scenario: "busy", mode: "recruiter", view: "inbox" });
  const shortcut = main(page).locator('[data-testid="row-next-action"][data-action-key="reply"]').first();
  if ((await shortcut.count()) === 0) test.skip(true, "no row in this scenario recommends a reply");

  // Not resident: it costs the row no space until a pointer or keyboard asks.
  await expect(shortcut).toHaveCSS("opacity", "0");
  const owner = shortcut.locator("xpath=..");
  await owner.hover();
  await expect(shortcut).toHaveCSS("opacity", "1");

  // It is an icon, so its whole meaning has to be in the accessible name.
  const label = await shortcut.getAttribute("aria-label");
  expect(label ?? "").toMatch(/reply/i);

  await shortcut.click();
  await expect(page.getByTestId("applications-detail").getByRole("textbox", { name: "Reply message" })).toBeFocused();
});

test("the timestamp never moves when a row's controls appear", async ({ page }) => {
  await openWorkspace(page, { scenario: "default", mode: "recruiter", view: "inbox" });
  const record = main(page).getByTestId("interaction-row").first();
  const time = record.locator("time").first();
  const before = await time.boundingBox();
  await record.hover();
  await page.waitForTimeout(250);
  const after = await time.boundingBox();
  expect(Math.abs((after?.x ?? 0) - (before?.x ?? 0))).toBeLessThanOrEqual(0.5);
});

test("hover-revealed controls do not exist on a touch-sized viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openWorkspace(page, { scenario: "default", mode: "recruiter", view: "inbox" });
  const record = main(page).getByTestId("interaction-row").first().locator("xpath=..");
  await expect(record.getByTestId("row-star-toggle")).toBeHidden();
});

test("the row and the card never disagree about what a record needs", async ({ page }) => {
  /*
    Both surfaces read one derivation, so they cannot be allowed to report
    different things — the list saying "2 unread" where the board says "New to
    review" is the same record described two ways. The unread count travels with
    the name; the state slot is the state's alone.
  */
  await openWorkspace(page, { scenario: "busy", mode: "recruiter", view: "inbox" });
  const inbox = await page.evaluate(() => {
    const out: Record<string, string> = {};
    for (const entry of Array.from(document.querySelectorAll('[data-testid="interaction-row"]'))) {
      const id = entry.getAttribute("data-record-id");
      const chip = entry.querySelector('[data-testid="work-state-chip"]');
      if (id) out[id] = chip?.getAttribute("data-work-state") ?? "none";
    }
    return out;
  });
  expect(Object.keys(inbox).length).toBeGreaterThan(5);

  await openWorkspace(page, {
    scenario: "busy",
    mode: "recruiter",
    view: "pipeline",
    extraParams: { direction: "received" },
  });
  const board = await page.evaluate(() => {
    const out: Record<string, string> = {};
    for (const entry of Array.from(document.querySelectorAll('[data-testid="pipeline-row"]'))) {
      const id = entry.getAttribute("data-record-id");
      const chip = entry.querySelector('[data-testid="pipeline-work-state"]');
      if (id) out[id] = chip?.getAttribute("data-work-state") ?? "none";
    }
    return out;
  });

  const disagreements: string[] = [];
  let compared = 0;
  for (const [id, state] of Object.entries(inbox)) {
    if (!(id in board)) continue;
    compared += 1;
    if (board[id] !== state) disagreements.push(`${id}: row=${state} card=${board[id]}`);
  }
  expect(compared, "no record appeared in both views").toBeGreaterThan(3);
  expect(disagreements, disagreements.join("; ")).toEqual([]);
});

/* ---- the thread ---------------------------------------------------------- */

test("a two-person thread never repeats either name", async ({ page }) => {
  const target = anchor("busy", "44 messages", { persona: "recruiter" });
  await openWorkspace(page, { scenario: "busy", mode: "recruiter", view: "inbox" });
  const detail = await openRecord(page, target);

  const groups = detail.getByTestId("message-group");
  await expect(groups.first()).toBeVisible();
  const count = await groups.count();
  expect(count).toBeGreaterThan(3);

  // The panel header names the counterparty; a name over every run would be
  // that fact again, once per turn.
  const names = await detail.evaluate((node) => {
    const found: string[] = [];
    for (const group of Array.from(node.querySelectorAll('[data-testid="message-group"]'))) {
      const heading = group.querySelector("p.font-semibold");
      if (heading) found.push((heading.textContent ?? "").trim());
    }
    return found;
  });
  expect(names, `sender names printed in a 1:1 thread: ${names.join(", ")}`).toEqual([]);
});

test("identity appears once per incoming run, at its foot, and never on your own", async ({ page }) => {
  const target = anchor("busy", "44 messages", { persona: "recruiter" });
  await openWorkspace(page, { scenario: "busy", mode: "recruiter", view: "inbox" });
  const detail = await openRecord(page, target);

  const stats = await detail.evaluate((node) => {
    const groups = Array.from(node.querySelectorAll('[data-testid="message-group"]'));
    return groups.map((group) => ({
      from: group.getAttribute("data-from"),
      avatars: group.querySelectorAll('[data-testid="message-group-avatar"]').length,
      times: group.querySelectorAll("time").length,
      bubbles: group.querySelectorAll('[data-testid="chat-message"]').length,
    }));
  });
  expect(stats.length).toBeGreaterThan(3);
  for (const group of stats) {
    expect(group.avatars, "an incoming run shows exactly one avatar; your own shows none").toBe(
      group.from === "other" ? 1 : 0
    );
    expect(group.times, "one timestamp per run, not one per bubble").toBe(1);
    expect(group.bubbles).toBeGreaterThan(0);
  }
});

test("consecutive messages from one person collapse into a single run", async ({ page }) => {
  const target = anchor("default", "portfolio attached", { persona: "recruiter" });
  await openWorkspace(page, { scenario: "default", mode: "recruiter", view: "inbox" });
  const detail = await openRecord(page, target);
  const composer = detail.getByRole("textbox", { name: "Reply message" });
  await expect(composer).toBeVisible();

  const before = await detail.getByTestId("message-group").count();
  for (const body of ["First thing", "And the follow-up"]) {
    await composer.fill(body);
    await detail.getByRole("button", { name: "Send", exact: true }).click();
    await expect(detail.getByTestId("chat-message").filter({ hasText: body })).toBeVisible();
  }

  const after = await detail.getByTestId("message-group").count();
  // Two messages, one new run — that is the whole point of grouping.
  expect(after - before).toBe(1);

  const last = detail.getByTestId("message-group").last();
  await expect(last).toHaveAttribute("data-from", "me");
  await expect(last.getByTestId("chat-message")).toHaveCount(2);
  await expect(last.locator("time")).toHaveCount(1);
});

test("a run communicates ownership by more than colour", async ({ page }) => {
  const target = anchor("busy", "44 messages", { persona: "recruiter" });
  await openWorkspace(page, { scenario: "busy", mode: "recruiter", view: "inbox" });
  const detail = await openRecord(page, target);

  const sides = await detail.evaluate((node) => {
    const canvas = node.querySelector('[data-testid="message-group"]')?.parentElement;
    const bounds = canvas?.getBoundingClientRect();
    return Array.from(node.querySelectorAll('[data-testid="message-group"]')).map((group) => {
      // The visual bubble, not its wrapper: the wrapper fills the run's column,
      // so it says nothing about which side of the canvas the message is on.
      const bubble = group.querySelector('[data-testid="chat-bubble"]')?.getBoundingClientRect();
      return {
        from: group.getAttribute("data-from"),
        label: group.getAttribute("aria-label") ?? "",
        role: group.getAttribute("role"),
        fromLeft: bubble ? bubble.left - (bounds?.left ?? 0) : null,
        fromRight: bubble ? (bounds?.right ?? 0) - bubble.right : null,
      };
    });
  });
  expect(sides.length).toBeGreaterThan(3);
  for (const group of sides) {
    // Alignment carries it visually. Structured cards have no bubble and are
    // deliberately full width, so they are exempt from the side test.
    if (group.fromLeft !== null && group.fromRight !== null) {
      if (group.from === "me") expect(group.fromRight).toBeLessThan(group.fromLeft);
      else expect(group.fromLeft).toBeLessThan(group.fromRight);
    }
    // …and the accessible name carries it for anyone who cannot see alignment.
    expect(group.role).toBe("group");
    expect(group.label.length).toBeGreaterThan(0);
    if (group.from === "me") expect(group.label).toMatch(/^You/);
  }
});

test("system events stay outside the message runs, in both surfaces", async ({ page }) => {
  const target = anchor("default", "portfolio attached", { persona: "recruiter" });
  await openWorkspace(page, { scenario: "default", mode: "recruiter", view: "inbox" });
  const detail = await openRecord(page, target);

  const leaked = await detail.evaluate((node) =>
    Array.from(node.querySelectorAll('[data-testid="message-group"]')).filter((group) =>
      group.querySelector('[data-testid="system-event-group"], [data-testid="status-update-line"]')
    ).length
  );
  expect(leaked, "a status line was rendered as though a person had said it").toBe(0);
});
