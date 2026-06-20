// Production-readiness UI simulation: exercises the workflows not yet covered by
// qa-workflow-sim.mjs — logged-out visitor + auth gating, save→/saved→unsave,
// /you Saved tab, talent hiring request via UI, search, notifications, public
// profile no-edit-leak, narrow viewport. Frontend-driven (Playwright).
import { chromium } from "@playwright/test";

const APP = "http://127.0.0.1:3100";
const API = "http://127.0.0.1:8000/api/v1";
const SHOT = "/tmp/cj-pr";
const results = [];
const log = (s) => { results.push(s); console.log(s); };

async function api(path, { method = "GET", token, body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await res.text(); let j = null; try { j = JSON.parse(t); } catch {}
  return { status: res.status, json: j, text: t };
}
async function makeUser(email, username, displayName) {
  const reg = await api("/auth/register", { method: "POST", body: { email, password: "Password123!", username, display_name: displayName } });
  const token = reg.json.verification_url.split("token=")[1];
  await api("/auth/verify-email", { method: "POST", body: { token } });
  return (await api("/auth/login", { method: "POST", body: { email, password: "Password123!" } })).json.access_token;
}
function stepper(page, tag) {
  return async (name, fn) => {
    try { await fn(); log(`PASS  ${tag} ${name}`); }
    catch (e) {
      const f = `${SHOT}-FAIL-${(tag+name).replace(/[^a-z0-9]+/gi,"_").slice(0,55)}.png`;
      try { await page.screenshot({ path: f }); } catch {}
      log(`FAIL  ${tag} ${name} :: ${String(e).replace(/\n/g," ").slice(0,200)} :: ${f}`);
    }
  };
}
async function uiLogin(page, email) {
  await page.goto(`${APP}/auth?mode=login`);
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill("Password123!");
  await page.locator('form').filter({ has: page.locator('input[type="password"]') }).locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith("/auth"), { timeout: 15000 });
}

const browser = await chromium.launch();
const ts = Date.now();

// ---------------- 1. Logged-out visitor ----------------
{
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
  const page = await ctx.newPage();
  const step = stepper(page, "[LoggedOut]");

  await step("home renders job + talent cards", async () => {
    await page.goto(`${APP}/`);
    await page.locator('[role="link"]').first().waitFor({ timeout: 12000 });
  });
  await step("/jobs renders cards", async () => {
    await page.goto(`${APP}/jobs`);
    if (await page.locator('[role="link"]').count() < 3) throw new Error("few/no job cards");
  });
  await step("/talent renders cards", async () => {
    await page.goto(`${APP}/talent`);
    if (await page.locator('[role="link"]').count() < 3) throw new Error("few/no talent cards");
  });
  await step("public profile loads with NO owner edit controls", async () => {
    // grab a real talent username from API
    const listings = (await api("/talent-listings?status=published&limit=5")).json.items;
    const withUser = listings.find((l) => l.owner_username);
    if (!withUser) throw new Error("no talent listing with owner_username");
    await page.goto(`${APP}/u/${withUser.owner_username}`);
    await page.waitForTimeout(1200);
    const editLeak = await page.getByRole("link", { name: /edit profile/i }).count()
      + await page.getByRole("button", { name: /edit profile|add banner|change banner/i }).count();
    if (editLeak > 0) throw new Error("owner edit controls leak on public profile");
  });
  await step("/you logged out shows sign-in state (no leak)", async () => {
    await page.goto(`${APP}/you`);
    await page.getByText(/sign in to open your workspace/i).waitFor({ timeout: 10000 });
  });
  await step("/saved logged out shows sign-in state", async () => {
    await page.goto(`${APP}/saved`);
    await page.getByText(/sign in/i).first().waitFor({ timeout: 10000 });
  });
  await step("Save on a job card while logged out -> auth redirect", async () => {
    await page.goto(`${APP}/jobs`);
    await page.locator('[role="link"]').first().waitFor({ timeout: 10000 });
    const saveBtn = page.getByRole("button", { name: "Save", exact: true }).first();
    await saveBtn.click();
    await page.waitForURL(/\/auth/, { timeout: 8000 });
  });
  await ctx.close();
}

// ---------------- 2. Saved flow (talent) ----------------
const talentEmail = `pr-talent-${ts}@example.com`;
const talentToken = await makeUser(talentEmail, `prt${String(ts).slice(-6)}`, "PR Talent");
{
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
  const page = await ctx.newPage();
  const step = stepper(page, "[Saved]");
  let savedJobTitle = "";

  await step("login + save a job from /jobs card", async () => {
    await uiLogin(page, talentEmail);
    await page.goto(`${APP}/jobs`);
    const firstCard = page.locator('[role="link"]').first();
    await firstCard.waitFor({ timeout: 10000 });
    savedJobTitle = (await firstCard.innerText()).split("\n").find((l) => l.trim().length > 8) || "";
    await page.getByRole("button", { name: "Save", exact: true }).first().click();
    // success: button flips to "Saved" (no redirect, no error)
    await page.getByRole("button", { name: "Saved", exact: true }).first().waitFor({ timeout: 10000 });
  });
  await step("saved job appears on /saved", async () => {
    await page.goto(`${APP}/saved`);
    await page.waitForTimeout(1200);
    const saved = await api("/me/saved/summary", { token: talentToken });
    if (!saved.json?.jobs?.length) throw new Error("no saved jobs via API after UI save");
    await page.screenshot({ path: `${SHOT}-saved-page.png` });
  });
  await step("/you?tab=saved reflects saved items (not a false-empty stub)", async () => {
    await page.goto(`${APP}/you?tab=saved`);
    await page.waitForTimeout(1500);
    const body = await page.locator("body").innerText();
    // We saved >=1 job; the tab must not claim 'No saved jobs yet'
    if (/no saved jobs yet/i.test(body)) throw new Error("/you Saved tab shows false-empty stub despite a saved job");
  });
  await step("unsave from /saved updates state", async () => {
    await page.goto(`${APP}/saved`);
    await page.waitForTimeout(1000);
    const unsave = page.getByRole("button", { name: /unsave|remove/i }).first();
    if (await unsave.count()) {
      await unsave.click();
      await page.waitForTimeout(1200);
    }
    const saved = await api("/me/saved/summary", { token: talentToken });
    if (saved.json?.jobs?.length) throw new Error("job still saved after UI unsave");
  });
  await ctx.close();
}

// ---------------- 3. Talent hiring request via UI (recruiter) ----------------
const recEmail = `pr-rec-${ts}@example.com`;
const recToken = await makeUser(recEmail, `prr${String(ts).slice(-6)}`, "PR Recruiter");
{
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
  const page = await ctx.newPage();
  const step = stepper(page, "[HireRequest]");
  await step("open a talent listing and send contact/invite via UI", async () => {
    await uiLogin(page, recEmail);
    const listing = (await api("/talent-listings?status=published&limit=1")).json.items[0];
    await page.goto(`${APP}/talent/${listing.id}`);
    await page.waitForTimeout(1500);
    const btn = page.getByRole("button", { name: /contact talent|invite to job/i }).first();
    await btn.waitFor({ timeout: 10000 });
    await btn.click();
    await page.getByText(/contacted|invite sent/i).first().waitFor({ timeout: 10000 });
  });
  await step("sent hiring request appears in recruiter Applications", async () => {
    await page.goto(`${APP}/you?tab=applications`);
    await page.getByRole("button", { name: "Recruiter", exact: true }).click();
    await page.getByTestId("applications-detail").waitFor({ timeout: 20000 });
    await page.getByTestId("applications-filter-sent").click();
    await page.getByTestId("interaction-row").filter({ hasText: /Sent hiring request/i }).first().waitFor({ timeout: 10000 });
  });
  await ctx.close();
}

// ---------------- 4. Search ----------------
{
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
  const page = await ctx.newPage();
  const step = stepper(page, "[Search]");
  await step("/search?q=editor returns results", async () => {
    await page.goto(`${APP}/search?q=editor`);
    await page.waitForTimeout(1500);
    const body = await page.locator("body").innerText();
    if (!/editor/i.test(body)) throw new Error("no editor results on /search");
  });
  await step("header search submits via keyboard", async () => {
    await page.goto(`${APP}/`);
    const search = page.getByPlaceholder(/search/i).first();
    await search.fill("thumbnail");
    await search.press("Enter");
    await page.waitForURL(/search|q=thumbnail/i, { timeout: 8000 });
  });
  await step("empty/odd query renders a clean state (no crash)", async () => {
    const r = await page.goto(`${APP}/search?q=zzzznotanything`);
    if (!r || r.status() >= 500) throw new Error(`/search crashed: ${r?.status()}`);
    const body = await page.locator("body").innerText();
    if (/application error|unhandled|500/i.test(body)) throw new Error("error text on empty search");
  });
  await ctx.close();
}

// ---------------- 5. Notifications ----------------
{
  // create an applicant + apply via API to a recruiter job to generate a notification,
  // then verify the recruiter's bell shows it in the UI.
  const recJob = await api("/jobs", { method: "POST", token: recToken, body: { title: `PR notif job ${ts}`, category: "Editing", location: "Remote", platforms: ["youtube"], status: "published" } });
  const appEmail = `pr-app-${ts}@example.com`;
  const appToken = await makeUser(appEmail, `pra${String(ts).slice(-6)}`, "PR Applicant");
  await api(`/jobs/${recJob.json.id}/applications`, { method: "POST", token: appToken, body: { cover_note: "notif test", portfolio_item_ids: [] } });

  const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
  const page = await ctx.newPage();
  const step = stepper(page, "[Notifications]");
  await step("recruiter bell shows the new-applicant notification", async () => {
    await uiLogin(page, recEmail);
    await page.goto(`${APP}/`);
    await page.getByRole("button", { name: /notification/i }).first().click();
    await page.getByText(/applied to/i).first().waitFor({ timeout: 10000 });
    await page.screenshot({ path: `${SHOT}-notifications.png` });
  });
  await ctx.close();
}

// ---------------- 6. Responsive (narrow) ----------------
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const step = stepper(page, "[Mobile]");
  for (const [label, path] of [["home","/"],["jobs","/jobs"],["talent","/talent"]]) {
    await step(`${label} has no horizontal overflow`, async () => {
      await page.goto(`${APP}${path}`);
      await page.waitForTimeout(1000);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (overflow > 4) throw new Error(`horizontal overflow ${overflow}px on ${path}`);
    });
  }
  await ctx.close();
}

await browser.close();
const fails = results.filter((l) => l.startsWith("FAIL"));
console.log(`\n===== ${results.filter(l=>l.startsWith("PASS")).length}/${results.filter(l=>l.startsWith("PASS")||l.startsWith("FAIL")).length} steps passed =====`);
if (fails.length) { console.log("FAILURES:"); fails.forEach((f) => console.log("  " + f)); }
