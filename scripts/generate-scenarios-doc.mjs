#!/usr/bin/env node
/**
 * Assemble SCENARIOS.md from the manifests' own machine-readable index.
 *
 * Written rather than hand-maintained on purpose. A human-written record map
 * over a corpus of several hundred generated records is stale the first time
 * anyone regenerates, and a stale map is worse than none — it sends people to
 * check states that are no longer there. The index is the source of truth; this
 * turns it into prose.
 *
 * Usage:
 *   node scripts/generate-scenarios-doc.mjs           writes SCENARIOS.md
 *   node scripts/generate-scenarios-doc.mjs --check   fails if it is out of date
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const MANIFEST_DIR = path.join(ROOT, "fixtures", "creator_scenarios", "generated");
const OUTPUT = path.join(ROOT, "SCENARIOS.md");

const NAMES = ["empty", "default", "busy", "edge", "talent", "recruiter"];

const manifests = Object.fromEntries(
  NAMES.map((name) => [
    name,
    JSON.parse(fs.readFileSync(path.join(MANIFEST_DIR, `${name}.json`), "utf8")),
  ])
);

/** Escape a table cell: a pipe in generated copy would break the row. */
const cell = (value) => String(value ?? "—").replace(/\|/g, "\\|").replace(/\n+/g, " ");

const shortId = (id) => (id ? `\`${id.slice(0, 8)}\`` : "—");

function personaLabel(entry) {
  return entry.persona === "recruiter" ? "Recruiter" : "Talent";
}

/** The route a reader should actually open, with the scenario named. */
function routeFor(entry, scenario) {
  const [pathname, query = ""] = entry.route.split("?");
  const params = new URLSearchParams(query);
  params.set("demo", "1");
  if (scenario !== "default") params.set("seed", scenario);
  return `${pathname}?${params.toString()}`;
}

const BEST_FOR = {
  empty: "First-run and empty states",
  default: "Ordinary design and workflow QA",
  busy: "Volume, pagination and performance",
  edge: "Identity, portfolio and conflict cases",
  talent: "The Talent side end to end",
  recruiter: "The Recruiter side end to end",
};

function overviewTable() {
  const rows = NAMES.map((name) => {
    const data = manifests[name];
    const stats = data.stats ?? {};
    const personas = new Set((data.index ?? []).map(personaLabel));
    const coverage = [];
    if (stats.interviews) coverage.push(`${stats.interviews} interviews`);
    if (stats.engagements) coverage.push(`${stats.engagements} engagements`);
    const payments = Object.keys(stats.payment_states ?? {}).length;
    if (payments) coverage.push(`${payments} payment states`);
    if (stats.portfolio_items) coverage.push(`${stats.portfolio_items} portfolio items`);
    return `| \`${name}\` | ${cell(BEST_FOR[name])} | ${stats.relationships ?? 0} records / ${
      stats.jobs ?? 0
    } jobs | ${cell([...personas].sort().join(", ") || "—")} | ${cell(coverage.join(", ") || "—")} |`;
  });
  return [
    "| Seed | Best for | Volume | Personas | Important coverage |",
    "| --- | --- | --- | --- | --- |",
    ...rows,
  ].join("\n");
}

function recordsTable() {
  const rows = [];
  for (const name of NAMES) {
    for (const entry of manifests[name].index ?? []) {
      rows.push(
        `| \`${name}\` | \`${routeFor(entry, name)}\` | Mock | ${personaLabel(entry)} | ${shortId(
          entry.job_id
        )} | ${shortId(entry.relationship_id)} | ${cell(entry.expected_condition)} | ${cell(
          entry.action_to_test
        )} |`
      );
    }
  }
  return [
    "| Seed | Route | Mode | Persona | Job | Record | Expected visible state | Action to test |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...rows,
  ].join("\n");
}

/**
 * The workflow index.
 *
 * Each required workflow is matched to a real indexed record by looking for the
 * condition wording the generator used. A workflow with no example says so,
 * rather than silently disappearing from the document.
 */
const WORKFLOWS = [
  ["New application", /new application|needs your reply|first application/i],
  ["Question and reply", /question|replied|back-and-forth|conversation/i],
  ["Interview proposal", /interview proposed/i],
  ["Interview confirmation", /interview confirmed|confirmed/i],
  ["Interview reschedule", /reschedul/i],
  ["Decision needed", /decision|awaiting|needs a decision/i],
  ["Hire", /hired/i],
  ["Start confirmation", /start (pending|confirm)/i],
  ["Active engagement", /engagement active|work in progress/i],
  ["Completion confirmation", /completed/i],
  ["Payment funded", /payment funded|funded/i],
  ["Release requested", /release requested/i],
  ["Released", /released/i],
  ["Disputed", /disputed/i],
  ["Private “Not proceeding”", /not proceeding.*(privat|counterparty still)/i],
  ["Communicated “Not proceeding”", /not proceeding.*shared/i],
  ["Withdrawal", /withdraw/i],
  ["Archived", /archiv/i],
  ["Star", /star/i],
  ["Snooze", /snooz/i],
  ["No reply needed", /no reply|dismiss/i],
  ["Private legacy Shortlisted", /shortlisted.*(privat|never told)/i],
  ["Communicated legacy Shortlisted", /shortlisted.*(shown|communicated|under consideration)/i],
  ["Retired job", /retired job|job_2[56]/i],
  ["Missing portfolio", /no portfolio|zero portfolio/i],
  ["Broken thumbnail", /thumbnail/i],
  ["Long identity", /long name|very long/i],
  ["RTL identity", /rtl|right-to-left/i],
  ["Emoji identity", /emoji/i],
  ["Send failure", /send fail|failed to send/i],
  ["Empty state", /empty/i],
  ["200+ pagination", /214|applicant volume|many applicants/i],
];

function workflowIndex() {
  const all = [];
  for (const name of NAMES) {
    for (const entry of manifests[name].index ?? []) all.push([name, entry]);
  }
  const rows = WORKFLOWS.map(([label, pattern]) => {
    const hit = all.find(([, entry]) => pattern.test(entry.expected_condition));
    if (!hit) {
      // `empty` is the only workflow with no record by definition.
      if (label === "Empty state") {
        return `| ${label} | \`empty\` | \`/applications?demo=1&seed=empty\` | — | Nothing to show, and it says so |`;
      }
      return `| ${label} | — | — | — | *No indexed example — see Known limitations* |`;
    }
    const [scenario, entry] = hit;
    return `| ${label} | \`${scenario}\` | \`${routeFor(entry, scenario)}\` | ${shortId(
      entry.relationship_id
    )} | ${cell(entry.expected_condition)} |`;
  });
  return [
    "| Workflow | Seed | Route | Record | Condition |",
    "| --- | --- | --- | --- | --- |",
    ...rows,
  ].join("\n");
}

function coverageMatrix() {
  const totals = { stages: {}, payments: {}, kinds: {}, personas: {} };
  let portfolioZero = 0;
  let portfolioLarge = 0;
  for (const name of NAMES) {
    const data = manifests[name];
    for (const rel of data.relationships ?? []) {
      totals.stages[rel.stage] = (totals.stages[rel.stage] ?? 0) + 1;
      totals.kinds[rel.kind] = (totals.kinds[rel.kind] ?? 0) + 1;
      const state = rel.engagement?.payment_state;
      if (state) totals.payments[state] = (totals.payments[state] ?? 0) + 1;
      const count = (rel.portfolio_ids ?? []).length;
      if (count === 0) portfolioZero += 1;
      if (count >= 20) portfolioLarge += 1;
    }
    for (const entry of data.index ?? []) {
      const key = personaLabel(entry);
      totals.personas[key] = (totals.personas[key] ?? 0) + 1;
    }
  }
  const line = (title, map) =>
    `| ${title} | ${Object.entries(map)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key} ${value}`)
      .join(" · ")} |`;
  return [
    "| Dimension | Coverage across all six manifests |",
    "| --- | --- |",
    line("Lifecycle stage", totals.stages),
    line("Payment state", totals.payments),
    line("Relationship kind", totals.kinds),
    line("Indexed persona", totals.personas),
    `| Portfolio volume | ${portfolioZero} records with none · ${portfolioLarge} with 20+ |`,
  ].join("\n");
}

const DOC = `<!--
  Generated by scripts/generate-scenarios-doc.mjs from the manifests' own index.
  Do not edit by hand: run \`node scripts/generate-scenarios-doc.mjs\` instead.
  \`tests/scenarioDoc.test.mjs\` fails if this file drifts from the manifests.
-->

# Sample data scenarios

Six canonical datasets, all produced by one generator
(\`backend/app/db/creator_scenarios/\`) and consumed by both the frontend Mock
mode and the backend QA restore. There is no second corpus: this is the only
sample data in the repository.

## Selecting sample data

**Mock mode** renders sample records in the browser with no backend running.
Turn it on with the sample-data control in the workspace, or with \`?demo=1\`.
With no seed it loads **\`default\`**.

| What you want | How |
| --- | --- |
| Ordinary sample data | \`/applications?demo=1\` |
| A specific dataset | \`/applications?demo=1&seed=<name>\` |
| Back to ordinary data | Turn the sample-data control off, or drop \`demo=1\` |

Valid seeds are \`${NAMES.join("`, `")}\`. An unknown name shows a development
error naming the known list; it never silently loads \`default\`, because
spending an afternoon testing a dataset you did not ask for is worse than being
told you mistyped.

**Backend mode** is different on purpose. A seed in the URL never restores
anything — a link that rewrote the database would make every shared link
destructive. Restoring a scenario into a local database stays behind the
existing confirmation-gated QA mechanism, which asks for
\`RESTORE <SCENARIO>\` before it writes. Manifests are read from disk by a
server-only route that is disabled outside development, so none of this data
can reach a production bundle.

Use disposable local databases only.

## Scenario overview

${overviewTable()}

## Exact records

Every row is a real record. Ids are shortened for reading; the full identifier
is in the manifest's \`index\`.

${recordsTable()}

## Workflow index

${workflowIndex()}

## Coverage matrix

${coverageMatrix()}

## Known limitations

- **Star, Snooze and “No reply needed” are client-only in this phase.** They are
  personal organisation, held per viewer in the browser rather than in a table,
  so they are not restored by the backend consumer and not compared by the
  parity suite. The manifest records the intent; the durable per-user model is
  Phase B.
- **Permitted parity exceptions.** Backend/Mock parity excludes only values with
  no user-facing meaning (row insertion timestamps, optimistic-concurrency
  versions, environment-specific URLs) and values this endpoint structurally
  does not carry (conversation messages, engagement and payment state, both of
  which load per conversation rather than in the activity summary). Each
  exclusion is listed with its reason in \`tests/scenarioParity.test.mjs\`.
- **No real payment processing.** The payment plane is a separate, additive,
  read-only record of state. There is no checkout, wallet, escrow, payout or
  invoice anywhere in the product, and no scenario claims funds are held or
  secured.
- **No oEmbed.** Portfolio posters are generated deterministically from the
  item's identifier, so a portfolio strip costs no network requests and cannot
  break on a third-party failure.
- **Upload cadence is optional** and absent for most generated channels; it is
  carried only where a hero journey needs it.
- **Vocabulary normalisation is bounded.** Platform, format and niche values
  come from fixed pools. Free-text values a real user could type are not
  normalised beyond what the product itself does.
- **External test flakes.** A load-sensitive import-parser benchmark, an
  import-job publish QA failure, a duplicate \`job-apply-button\` test id, and
  several Playwright specs that pass in isolation but not under parallel load
  are known and classified; they are unrelated to this data.
`;

const existing = fs.existsSync(OUTPUT) ? fs.readFileSync(OUTPUT, "utf8") : null;

if (process.argv.includes("--check")) {
  if (existing !== DOC) {
    console.error("SCENARIOS.md is out of date — run: node scripts/generate-scenarios-doc.mjs");
    process.exit(1);
  }
  console.log("SCENARIOS.md is current");
} else {
  fs.writeFileSync(OUTPUT, DOC, "utf8");
  console.log(`wrote ${path.relative(ROOT, OUTPUT)}`);
}
