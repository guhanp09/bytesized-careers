import { expect, test, type Page } from "@playwright/test";

/**
 * The content security policy, judged by the only authority that matters.
 *
 * A policy can be perfectly well-formed, pass every string assertion, and still
 * be wrong — either because it blocks something the product needs, or because it
 * blocks nothing at all. Both failures are invisible outside a browser, so this
 * spec asks a real one.
 *
 * Three things are proved here, and all three are needed:
 *
 * 1. No surface reports a violation. On its own this proves nothing: a page that
 *    never ran any script also reports nothing.
 * 2. The framework's own scripts *did* run. That is what makes (1) meaningful —
 *    it says the nonce reached the inline bootstrap Next emits, rather than the
 *    page having quietly failed to hydrate.
 * 3. An inline script that the server did not authorize is refused. That is what
 *    makes the policy more than decoration.
 *
 * Violations are read from the console because that is where Chromium reports
 * them, with the text the developer would see.
 */

const BACKEND = "http://127.0.0.1:8100/api/v1";
const CONTROLLER_EMAIL = "qa-controller@example.com";
const CONTROLLER_PASSWORD = "LocalQaController123!";

const VIOLATION = /content security policy|refused to (load|execute|apply|connect|frame|create)/i;

/** Collects every policy complaint the browser makes, for the life of the page. */
function watchForViolations(page: Page): string[] {
  const violations: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    if (VIOLATION.test(text)) violations.push(text);
  });
  page.on("pageerror", (error) => {
    if (VIOLATION.test(error.message)) violations.push(error.message);
  });
  return violations;
}

/**
 * Open a surface and confirm the client runtime executed there.
 *
 * `window.next` is installed by the App Router client entry, so its presence is
 * direct evidence that the browser accepted the framework's scripts under the
 * policy rather than silently dropping them.
 */
async function visit(page: Page, path: string): Promise<void> {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await expect
    .poll(() => page.evaluate(() => typeof (window as unknown as { next?: unknown }).next), {
      message: `the client runtime never started on ${path}`,
      timeout: 15_000,
    })
    .toBe("object");
}

async function login(page: Page): Promise<void> {
  await page.goto("/auth?mode=login", { waitUntil: "domcontentloaded" });
  await page.getByPlaceholder("Email").fill(CONTROLLER_EMAIL);
  await page.getByPlaceholder("Password").fill(CONTROLLER_PASSWORD);
  await page.locator("form").getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page).toHaveURL(/\/you/);
}

test("the policy is enforced, not merely observed", async ({ page }) => {
  const response = await page.goto("/faq", { waitUntil: "domcontentloaded" });
  const headers = response!.headers();

  // Report-only is a step during a policy change, never a destination. If this
  // fails, a debugging run was shipped.
  expect(headers["content-security-policy-report-only"]).toBeUndefined();

  const policy = headers["content-security-policy"];
  expect(policy, "no content security policy reached the browser").toBeTruthy();
  expect(policy).toMatch(/script-src [^;]*'nonce-/);
  expect(policy).toMatch(/object-src 'none'/);
  expect(policy).toMatch(/frame-ancestors 'none'/);
});

test("each response carries its own nonce", async ({ page }) => {
  const nonceOf = async () => {
    const response = await page.goto("/faq", { waitUntil: "domcontentloaded" });
    const policy = response!.headers()["content-security-policy"] ?? "";
    return /'nonce-([^']+)'/.exec(policy)?.[1];
  };

  const first = await nonceOf();
  const second = await nonceOf();

  expect(first).toBeTruthy();
  // A nonce reused across responses is a nonce an attacker can read from one
  // page and spend on the next.
  expect(second).not.toBe(first);
});

test("an inline script the server did not authorize is refused", async ({ page }) => {
  // Injected into the served HTML so the browser parses it exactly as it would
  // parse an injected script — the attack the nonce exists to stop. Evaluating
  // it through the automation channel instead would prove nothing, because that
  // channel is not subject to the page's policy.
  await page.route("**/faq", async (route) => {
    const response = await route.fetch();
    const body = (await response.text()).replace(
      "</head>",
      "<script>window.__unauthorizedInlineScriptRan = true;</script></head>"
    );
    await route.fulfill({ response, body });
  });

  const violations = watchForViolations(page);
  await visit(page, "/faq");

  expect(
    await page.evaluate(() => (window as unknown as { __unauthorizedInlineScriptRan?: boolean }).__unauthorizedInlineScriptRan)
  ).toBeUndefined();
  // And the browser said why, which is how we know it was the policy that
  // stopped it rather than the injection failing to land.
  expect(violations.join("\n")).toMatch(/script/i);
});

test("public surfaces run clean", async ({ page }) => {
  const violations = watchForViolations(page);

  for (const path of ["/", "/jobs", "/talent", "/faq", "/privacy", "/terms", "/support", "/auth?mode=login"]) {
    await visit(page, path);
  }

  expect(violations, violations.join("\n")).toEqual([]);
});

test("structured data does not trip the script policy", async ({ page }) => {
  // Job and talent detail pages carry inline `application/ld+json` blocks. Those
  // are data, not code, and no nonce is applied to them — this is where that
  // assumption gets checked against a browser instead of a specification.
  const violations = watchForViolations(page);

  const response = await page.request.get(`${BACKEND}/jobs?limit=5`);
  expect(response.ok(), await response.text()).toBeTruthy();
  const payload = (await response.json()) as { items?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>;
  const items = Array.isArray(payload) ? payload : (payload.items ?? []);
  const job = items.find((row) => typeof row.id === "string");
  expect(job, "the backend returned no published job to open").toBeTruthy();

  await visit(page, `/jobs/${String(job!.id)}`);
  await expect(page.locator('script[type="application/ld+json"]').first()).toHaveCount(1);

  expect(violations, violations.join("\n")).toEqual([]);
});

test("the signed-in workspace runs clean", async ({ page }) => {
  const violations = watchForViolations(page);

  await login(page);
  for (const path of ["/you", "/settings", "/post-job", "/post-job/import", "/applications?view=inbox&mode=recruiter"]) {
    await visit(page, path);
  }

  // Reaching these at all means the browser was allowed to talk to the backend
  // origin, which is the half of `connect-src` a header assertion cannot check.
  expect(violations, violations.join("\n")).toEqual([]);
});
