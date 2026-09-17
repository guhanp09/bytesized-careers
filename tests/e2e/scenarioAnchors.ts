import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";

/**
 * Addressing sample records by meaning.
 *
 * These specs used to name records the way the retired hand-written fixture
 * named them: "the row called Aarav Mehta", "the ninth row", "there are 9 rows".
 * All three break the moment the data changes, and none of them says *why* that
 * record was chosen — so a failure told you a name had moved, not which product
 * behaviour had stopped working.
 *
 * Every generated manifest carries an `index`: the records worth looking at,
 * each with the persona, the stage, the condition it exists to demonstrate and
 * the action to test. That index is the source of truth here. A spec asks for
 * "the record in `default` where a recruiter's decision is private", gets back a
 * stable UUID5, and addresses the row by `data-record-id`.
 *
 * When the condition is missing the helper throws with the conditions the
 * scenario *does* have, so a coverage gap reads as a coverage gap rather than as
 * a timeout.
 */

// Playwright transpiles specs to CommonJS, where `import.meta` is unavailable,
// and it always runs from the repository root.
const ROOT = process.cwd();

export const SCENARIOS = ["empty", "default", "busy", "edge", "talent", "recruiter"] as const;
export type ScenarioName = (typeof SCENARIOS)[number];

export type Persona = "recruiter" | "talent";

/** Observe the live endpoints a demo Star must never resolve or mutate. */
export function observeStarBackendRequests(page: Page): string[] {
  const requests: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (
      /\/me\/(applications|talent-interests)\/[^/]+\/conversation$/.test(path) ||
      /\/preferences\/star$/.test(path)
    ) {
      requests.push(`${request.method()} ${path}`);
    }
  });
  return requests;
}

type IndexEntry = {
  scenario: string;
  persona: Persona;
  route: string;
  job_id: string | null;
  relationship_id: string;
  conversation_id: string | null;
  expected_stage: string;
  expected_condition: string;
  action_to_test: string;
};

type Relationship = {
  id: string;
  kind: "application" | "hiring_request";
  stage: string;
  participant_stage?: string | null;
  archived?: boolean;
  starred?: boolean;
  snoozed_offset?: number | null;
  unread?: number;
  job_id?: string | null;
  recruiter_id: string;
  talent_id: string;
  portfolio_ids?: string[];
  messages?: Array<{ body: string; sender_id: string | null }>;
  engagement?: { state: string; payment_state?: string | null } | null;
  interview?: unknown;
};

type Manifest = {
  scenario: string;
  description: string;
  stats: Record<string, unknown>;
  actors: Array<{ id: string; display_name: string; username: string; deactivated?: boolean }>;
  jobs: Array<{ id: string; title: string; status?: string; legacy_key?: string | null }>;
  portfolio: Array<{ id: string; title: string; owner_id: string }>;
  relationships: Relationship[];
  index: IndexEntry[];
  client_state?: Array<{ relationship_id: string; kind: string; body?: string | null }>;
};

const cache = new Map<ScenarioName, Manifest>();

export function manifest(scenario: ScenarioName): Manifest {
  const hit = cache.get(scenario);
  if (hit) return hit;
  const parsed = JSON.parse(
    readFileSync(join(ROOT, "fixtures", "creator_scenarios", "generated", `${scenario}.json`), "utf8")
  ) as Manifest;
  cache.set(scenario, parsed);
  return parsed;
}

/** One indexed record, resolved into everything a spec needs to address it. */
export type Anchor = {
  scenario: ScenarioName;
  recordId: string;
  conversationId: string | null;
  jobId: string | null;
  jobTitle: string | null;
  /** Who the *viewer* sees on the other side, for this persona. */
  counterpartyName: string;
  /** Their handle, for asserting the profile link a card points at. */
  counterpartyUsername: string;
  persona: Persona;
  stage: string;
  participantStage: string | null;
  condition: string;
  action: string;
  route: string;
  kind: "application" | "hiring_request";
  archived: boolean;
  portfolioCount: number;
  /** The titles of the work attached, so a spec asserts on this record's own
   *  evidence rather than on a string that was true when it was written. */
  portfolioTitles: string[];
  messageCount: number;
};

function resolve(scenario: ScenarioName, entry: IndexEntry): Anchor {
  const data = manifest(scenario);
  const rel = data.relationships.find((item) => item.id === entry.relationship_id);
  if (!rel) {
    throw new Error(`${scenario}: index names relationship ${entry.relationship_id}, which does not exist`);
  }
  const otherId = entry.persona === "recruiter" ? rel.talent_id : rel.recruiter_id;
  const other = data.actors.find((actor) => actor.id === otherId);
  const job = rel.job_id ? data.jobs.find((item) => item.id === rel.job_id) : undefined;
  return {
    scenario,
    recordId: rel.id,
    conversationId: entry.conversation_id ?? null,
    jobId: rel.job_id ?? null,
    jobTitle: job?.title ?? null,
    counterpartyName: other?.display_name ?? "",
    counterpartyUsername: other?.username ?? "",
    persona: entry.persona,
    stage: rel.stage,
    participantStage: rel.participant_stage ?? null,
    condition: entry.expected_condition,
    action: entry.action_to_test,
    route: entry.route,
    kind: rel.kind,
    archived: Boolean(rel.archived),
    portfolioCount: (rel.portfolio_ids ?? []).length,
    portfolioTitles: (rel.portfolio_ids ?? [])
      .map((id) => data.portfolio.find((item) => item.id === id)?.title)
      .filter((title): title is string => Boolean(title)),
    messageCount: (rel.messages ?? []).length,
  };
}

/**
 * The indexed record matching a condition.
 *
 * `condition` is matched case-insensitively as a substring or a RegExp against
 * the generator's own wording, so a spec reads as the thing it is testing.
 */
export function anchor(
  scenario: ScenarioName,
  condition: string | RegExp,
  options: { persona?: Persona } = {}
): Anchor {
  const data = manifest(scenario);
  const pattern =
    typeof condition === "string"
      ? new RegExp(condition.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")
      : condition;
  const matches = (data.index ?? []).filter(
    (entry) =>
      pattern.test(entry.expected_condition) &&
      (!options.persona || entry.persona === options.persona)
  );
  if (matches.length === 0) {
    const available = (data.index ?? [])
      .map((entry) => `  [${entry.persona}] ${entry.expected_condition}`)
      .join("\n");
    throw new Error(
      `${scenario} has no indexed record matching ${pattern}` +
        `${options.persona ? ` for persona ${options.persona}` : ""}.\n` +
        `Indexed conditions are:\n${available}`
    );
  }
  return resolve(scenario, matches[0]);
}

/** Every indexed record matching a condition — for sweeps over a family of cases. */
export function anchors(
  scenario: ScenarioName,
  condition: string | RegExp,
  options: { persona?: Persona } = {}
): Anchor[] {
  const data = manifest(scenario);
  const pattern = typeof condition === "string" ? new RegExp(condition, "i") : condition;
  return (data.index ?? [])
    .filter(
      (entry) =>
        pattern.test(entry.expected_condition) &&
        (!options.persona || entry.persona === options.persona)
    )
    .map((entry) => resolve(scenario, entry));
}

/**
 * Counts a scenario genuinely contracts to provide.
 *
 * Deliberately narrow. Asserting a workspace's *total* row count against a
 * generated corpus tests the generator's arithmetic, not the product — so this
 * exposes the counts that are part of a named scenario's contract (how many
 * applicants a particular job carries, how long the long conversation is) and
 * nothing else.
 */
export function applicantCount(scenario: ScenarioName, jobId: string): number {
  return manifest(scenario).relationships.filter((rel) => rel.job_id === jobId).length;
}

/** The job in a scenario carrying exactly this many applicants, if one does. */
export function jobWithApplicants(scenario: ScenarioName, count: number): { id: string; title: string } {
  const data = manifest(scenario);
  const found = data.jobs.find((job) => applicantCount(scenario, job.id) === count);
  if (!found) {
    const actual = data.jobs
      .map((job) => `  ${job.title}: ${applicantCount(scenario, job.id)}`)
      .join("\n");
    throw new Error(`${scenario} has no job with exactly ${count} applicants.\nJobs carry:\n${actual}`);
  }
  return { id: found.id, title: found.title };
}

/** How many records a persona sees in a scenario — from the manifest, not the page. */
export function visibleRecordCount(scenario: ScenarioName): number {
  return manifest(scenario).relationships.length;
}

/* ---- navigation ---------------------------------------------------------- */

/**
 * Open the workspace on a named scenario.
 *
 * Always explicit. A spec that inherited whichever scenario ran before it would
 * pass or fail on test order, and the seed is the only thing that decides which
 * dataset Mock mode loads.
 */
export async function openWorkspace(
  page: Page,
  options: {
    scenario: ScenarioName;
    view?: "inbox" | "pipeline";
    mode?: "talent" | "recruiter";
    thread?: string;
    extraParams?: Record<string, string>;
  }
): Promise<void> {
  const params = new URLSearchParams({ demo: "1", seed: options.scenario });
  if (options.view) params.set("view", options.view);
  if (options.mode) params.set("mode", options.mode);
  if (options.thread) params.set("thread", options.thread);
  for (const [key, value] of Object.entries(options.extraParams ?? {})) params.set(key, value);
  await page.goto(`/applications?${params.toString()}`, { waitUntil: "domcontentloaded" });
  // Scoped to `main`: a navigation can briefly leave the server-rendered markup
  // beside the hydrated tree, so an unscoped match resolves twice and fails
  // strict mode on a page that is behaving correctly.
  await expect(page.getByRole("main").getByTestId("applications-workspace")).toBeVisible({
    timeout: 20_000,
  });
  // The manifest is fetched after mount, so the workspace can be visible while
  // still empty. Which content to wait for depends on the view the URL asked
  // for — the Pipeline renders cards, not list rows — and `empty` legitimately
  // stays empty either way.
  if (options.scenario !== "empty") {
    const content =
      options.view === "pipeline"
        ? page.getByRole("main").getByTestId("pipeline-row")
        : page.getByRole("main").getByTestId("interaction-row");
    await expect(content.first()).toBeVisible({ timeout: 30_000 });
  }
}

/** The list row for one record. */
export function row(page: Page, anchorOrId: Anchor | string) {
  const id = typeof anchorOrId === "string" ? anchorOrId : anchorOrId.recordId;
  return page.locator(`[data-testid="interaction-row"][data-record-id="${id}"]`);
}

/** The pipeline card for one record. */
export function card(page: Page, anchorOrId: Anchor | string) {
  const id = typeof anchorOrId === "string" ? anchorOrId : anchorOrId.recordId;
  return page.locator(`[data-testid="pipeline-row"][data-record-id="${id}"]`);
}

/**
 * Bring a record's row into the DOM.
 *
 * The inbox renders a bounded page, so a record can match every filter and still
 * not be on screen yet — exactly as it is for a person, who presses "Load more".
 * This does the same thing rather than reaching past the UI, so a spec that
 * passes here is a spec whose record a user could also have reached.
 */
export async function revealRecord(page: Page, target: Anchor | string): Promise<void> {
  const locator = row(page, target);
  const loadMore = page.getByRole("main").getByTestId("inbox-load-more");
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if ((await locator.count()) > 0) return;
    if ((await loadMore.count()) === 0) break;
    await loadMore.click();
  }
  await expect(locator, "the record never appeared, even after loading every page").toHaveCount(1);
}

/**
 * Open a record in the inbox.
 *
 * Loads far enough to reach it, then scrolls: `default` is a realistic corpus
 * rather than a nine-row fixture, so the record a spec wants is usually below
 * the fold and often past the first rendered page.
 */
export async function openRecord(page: Page, target: Anchor | string) {
  await revealRecord(page, target);
  const locator = row(page, target);
  await locator.scrollIntoViewIfNeeded();
  await locator.click();
  await expect(locator).toHaveAttribute("aria-pressed", "true");
  return page.getByTestId("applications-detail");
}
