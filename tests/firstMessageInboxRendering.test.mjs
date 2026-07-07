import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  CUSTOM_INSTRUCTION_REQUIREMENT_KEY,
  filterStructuredPortfolioDuplicateAttachments,
  normalizeFirstMessageAnswers,
  requirementsForContext,
  summarizeAnswers,
  validateAnswers,
} from "../lib/firstMessageRequirements.ts";

// These tests cover the post-success Apply / Hire behaviour:
//   • how the inbox opening message renders completed first-message requirements
//     natively (summarizeAnswers is the data layer FirstMessageSummary renders),
//   • that the renderer carries no wrapper/explanatory labels or raw field keys,
//   • the success state copy + "Open conversation" deep-link on both action panels,
//   • the deep-link thread selection wiring through to the inbox workspace.
//
// The renderer + panels are client components, so structural guards use source
// assertions (the repo's convention); the data shaping is exercised directly.

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (relPath) => readFileSync(join(repoRoot, relPath), "utf8");

// Registry keys must never leak into the rendered text — the inbox shows human copy.
const ALL_KEYS = [
  "expected_rate",
  "project_budget",
  "relevant_portfolio",
  "project_brief",
  "turnaround",
  "working_hours",
  "relevant_experience",
  "tools_workflow",
  "channel_or_brand_link",
  "reference_links",
  "start_availability",
  "fit_note",
];

const JOB_CONTEXT_KEYS = requirementsForContext("job").map((def) => def.key);
const TALENT_CONTEXT_KEYS = requirementsForContext("talent").map((def) => def.key);

// ── summarizeAnswers: native render data for the opening message ──────────────

test("job answers summarise into native label/value items in registry order", () => {
  const items = summarizeAnswers(
    ["expected_rate", "relevant_portfolio", "turnaround", "working_hours", "relevant_experience"],
    "job",
    {
      expected_rate: { amount: "2,500", unit: "per video" },
      relevant_portfolio: [
        { id: "p1", title: "Finance explainer reel", url: "https://example.com/reel" },
        { id: "p2", title: "Brand promo edit", url: "https://example.com/promo" },
      ],
      turnaround: { value: "4", unit: "days" },
      working_hours: "Evenings IST",
      relevant_experience: "Finance and education YouTube channels",
    }
  );

  assert.deepEqual(
    items.map((i) => i.key),
    ["expected_rate", "relevant_portfolio", "turnaround", "working_hours", "relevant_experience"]
  );

  const rate = items.find((i) => i.key === "expected_rate");
  assert.equal(rate.emphasis, true, "rate is the headline value (rendered without a label)");
  assert.match(rate.text, /^₹2,500/);

  const portfolio = items.find((i) => i.key === "relevant_portfolio");
  assert.equal(portfolio.label, "Portfolio");
  assert.equal(portfolio.text, undefined, "portfolio samples render as direct links, not a count label");
  assert.equal(portfolio.links.length, 2);
  assert.equal(portfolio.links[0].label, "Finance explainer reel");
  assert.equal(portfolio.links[0].url, "https://example.com/reel");

  assert.equal(items.find((i) => i.key === "turnaround").text, "4 days");
  assert.equal(items.find((i) => i.key === "working_hours").text, "Evenings IST");
  assert.equal(
    items.find((i) => i.key === "relevant_experience").text,
    "Finance and education YouTube channels"
  );
});

test("talent answers summarise with budget headline and clickable reference links", () => {
  const items = summarizeAnswers(
    ["project_budget", "project_brief", "reference_links", "turnaround", "working_hours"],
    "talent",
    {
      project_budget: { amount: "25,000", unit: "per month" },
      project_brief: "15 Shorts per month, retention-focused",
      reference_links: ["https://youtube.com/@one", "https://youtube.com/@two"],
      turnaround: { value: "1", unit: "weeks" },
      working_hours: "Flexible, IST preferred",
    }
  );

  const budget = items.find((i) => i.key === "project_budget");
  assert.equal(budget.emphasis, true);
  assert.match(budget.text, /^₹25,000/);

  assert.equal(items.find((i) => i.key === "project_brief").label, "Scope");

  const refs = items.find((i) => i.key === "reference_links");
  assert.equal(refs.links.length, 2);
  assert.ok(refs.links.every((l) => l.url), "reference links carry their url so they stay clickable");

  // Singular unit collapses ("1 weeks" → "1 week").
  assert.equal(items.find((i) => i.key === "turnaround").text, "1 week");
});

test("rendered values never expose raw requirement keys", () => {
  const items = summarizeAnswers(
    ["expected_rate", "relevant_portfolio", "working_hours"],
    "job",
    {
      expected_rate: { amount: "1,000", unit: "per project" },
      relevant_portfolio: [{ id: "p1", title: "Edit reel", url: "https://example.com/x" }],
      working_hours: "Mornings IST",
    }
  );
  for (const item of items) {
    assert.ok(!ALL_KEYS.includes(item.label), `label leaked a raw key: ${item.label}`);
    if (item.text) {
      for (const key of ALL_KEYS) {
        assert.ok(!item.text.includes(key), `value leaked a raw key: ${item.text}`);
      }
    }
  }
});

test("empty / missing answers summarise to nothing (legacy messages render unchanged)", () => {
  assert.deepEqual(summarizeAnswers([], "job", {}), []);
  assert.deepEqual(summarizeAnswers(["expected_rate", "working_hours"], "job", {}), []);
  // A currency answer with no amount is omitted rather than shown blank.
  assert.deepEqual(summarizeAnswers(["expected_rate"], "job", { expected_rate: { amount: "", unit: "per video" } }), []);
});

test("mock interactions keep structured requirements out of duplicate proposed terms", () => {
  const source = read("lib/ownerInteractions.ts");
  for (const id of ["t-req-recv-1", "r-app-recv-1"]) {
    const snippet = source.match(new RegExp(`id: "${id}"[\\s\\S]*?firstMessageAnswers:`));
    assert.ok(snippet, `expected ${id} to carry structured first-message answers`);
    assert.ok(
      !snippet[0].includes("proposedTerms:"),
      `${id} should rely on firstMessageAnswers, not duplicate proposedTerms`
    );
  }
});

test("mock inbox conversations include full structured-answer examples for both contexts", () => {
  const source = read("lib/ownerInteractions.ts");
  const jobSnippet = source.match(/id: "t-app-sent-1"[\s\S]*?job: \{/);
  const talentSnippet = source.match(/id: "t-req-recv-1"[\s\S]*?recruiter: \{/);
  assert.ok(jobSnippet, "expected a full job-application structured-answer mock thread");
  assert.ok(talentSnippet, "expected a full hiring-request structured-answer mock thread");

  for (const key of JOB_CONTEXT_KEYS) {
    assert.match(jobSnippet[0], new RegExp(`${key}:`), `missing job-context mock answer: ${key}`);
  }
  for (const key of TALENT_CONTEXT_KEYS) {
    assert.match(talentSnippet[0], new RegExp(`${key}:`), `missing talent-context mock answer: ${key}`);
  }
});

test("structured portfolio answers suppress duplicate legacy attachment chips", () => {
  const attachments = [
    { label: "Retention edit sample", url: "https://portfolio.example.com/sample/retention-edit" },
    { label: "Extra creative brief", url: "https://docs.example.com/brief" },
  ];

  const visible = filterStructuredPortfolioDuplicateAttachments(attachments, {
    relevant_portfolio: [
      {
        id: "p1",
        title: "Retention edit sample",
        url: "https://portfolio.example.com/sample/retention-edit/",
      },
    ],
  });

  assert.deepEqual(visible, [{ label: "Extra creative brief", url: "https://docs.example.com/brief" }]);
});

test("legacy attachments still render when there is no structured portfolio answer", () => {
  const attachments = [{ label: "Legacy work sample", url: "https://portfolio.example.com/legacy" }];

  assert.deepEqual(filterStructuredPortfolioDuplicateAttachments(attachments, {}), attachments);
  assert.deepEqual(filterStructuredPortfolioDuplicateAttachments(attachments, null), attachments);
});

test("job custom instruction captures prompt, candidate answer, and optional links", () => {
  const answers = normalizeFirstMessageAnswers(
    [CUSTOM_INSTRUCTION_REQUIREMENT_KEY],
    "job",
    {
      [CUSTOM_INSTRUCTION_REQUIREMENT_KEY]: {
        response: "I edited this video and handled pacing, captions, and final delivery.",
        links: [" https://youtube.com/watch?v=abc123 ", ""],
      },
    },
    {
      [CUSTOM_INSTRUCTION_REQUIREMENT_KEY]: "Share one similar video you edited and explain your role.",
    }
  );

  assert.deepEqual(validateAnswers([CUSTOM_INSTRUCTION_REQUIREMENT_KEY], "job", answers), {});

  const items = summarizeAnswers([CUSTOM_INSTRUCTION_REQUIREMENT_KEY], "job", answers);
  assert.equal(items.length, 1);
  assert.equal(items[0].label, "Share one similar video you edited and explain your role.");
  assert.equal(items[0].text, "I edited this video and handled pacing, captions, and final delivery.");
  assert.equal(items[0].links.length, 1);
  assert.equal(items[0].links[0].url, "https://youtube.com/watch?v=abc123");
});

test("job custom instruction requires an answer and validates non-empty links", () => {
  const missing = {
    [CUSTOM_INSTRUCTION_REQUIREMENT_KEY]: {
      prompt: "Share a similar edit.",
      response: " ",
      links: [],
    },
  };
  assert.match(
    validateAnswers([CUSTOM_INSTRUCTION_REQUIREMENT_KEY], "job", missing)[CUSTOM_INSTRUCTION_REQUIREMENT_KEY],
    /Answer this prompt|Custom instruction is required/
  );

  const invalidLink = {
    [CUSTOM_INSTRUCTION_REQUIREMENT_KEY]: {
      prompt: "Share a similar edit.",
      response: "I can share one.",
      links: ["not-a-url"],
    },
  };
  assert.equal(
    validateAnswers([CUSTOM_INSTRUCTION_REQUIREMENT_KEY], "job", invalidLink)[CUSTOM_INSTRUCTION_REQUIREMENT_KEY],
    "Use valid links, or remove them."
  );
});

// ── FirstMessageSummary: native rendering, no wrapper labels ──────────────────

test("FirstMessageSummary carries no wrapper or explanatory labels", () => {
  const source = read("components/first-message/FirstMessageSummary.tsx");
  for (const forbidden of [
    "Included details",
    "Requirement answers",
    "First-message requirements",
    "The applicant has submitted",
    "Application details",
    "Required information",
  ]) {
    assert.ok(!source.includes(forbidden), `renderer must not show "${forbidden}"`);
  }
});

test("FirstMessageSummary renders nothing without structured answers", () => {
  const source = read("components/first-message/FirstMessageSummary.tsx");
  assert.match(source, /if \(!items\.length\) return null;/);
  assert.match(source, /Array\.isArray\(answers\)\) return null;/);
});

test("FirstMessageSummary keeps links clickable and safe, and the rate label-less", () => {
  const source = read("components/first-message/FirstMessageSummary.tsx");
  assert.match(source, /target="_blank"/);
  assert.match(source, /rel="noopener noreferrer"/);
  assert.match(source, /<Icon name=\{item\.icon\}/);
  assert.match(source, /text-blue-300/);
  // The emphasis branch is the rate rendered on its own line, no label.
  assert.match(source, /item\.emphasis && item\.text/);
  assert.match(source, /item\.text[\s\S]*item\.links\.map/);
});

test("custom instruction requester UI is prompt-led with answer textarea and links", () => {
  const source = read("components/first-message/FirstMessageFields.tsx");
  assert.match(source, /function CustomInstructionField/);
  assert.match(source, /Listing prompt/);
  assert.match(source, /Write your answer/);
  assert.match(source, /CUSTOM_INSTRUCTION_MAX_LENGTH = 3000/);
  assert.match(source, /Add link/);
});

// ── Success state: copy + "Open conversation" deep-link ──────────────────────

test("job apply success shows the exact copy and deep-links to the talent inbox thread", () => {
  const source = read("components/job-details/JobActionsPanelClient.tsx");
  assert.match(source, /title="Application sent"/);
  assert.match(source, /body="Your application has been shared with the hiring team\."/);
  assert.match(source, /primaryLabel="Open conversation"/);
  assert.match(source, /secondaryLabel="Keep browsing jobs"/);
  // Captures the created application id (idempotent) and routes to its thread.
  assert.match(source, /const application = await applyToJob\(/);
  assert.match(source, /setConversationId\(application\.id\)/);
  assert.match(source, /\/applications\?view=talent/);
  assert.match(source, /thread=\$\{encodeURIComponent\(conversationId\)\}/);
  // "Keep browsing" closes without navigating.
  assert.match(source, /onSecondary=\{\(\) => setSuccessOpen\(false\)\}/);
});

test("talent hire success shows the exact copy and deep-links to the recruiter inbox thread", () => {
  const source = read("components/TalentListingActionsClient.tsx");
  assert.match(source, /title="Request sent"/);
  assert.match(source, /body="Your hiring request has been shared with the talent\."/);
  assert.match(source, /primaryLabel="Open conversation"/);
  assert.match(source, /secondaryLabel="Keep browsing talent"/);
  assert.match(source, /const interest = await sendTalentInterest\(/);
  assert.match(source, /setConversationId\(interest\.id\)/);
  assert.match(source, /\/applications\?view=hiring/);
  assert.match(source, /thread=\$\{encodeURIComponent\(conversationId\)\}/);
  assert.match(source, /onSecondary=\{\(\) => setSuccessOpen\(false\)\}/);
});

test("ActionSuccessModal is a dialog with distinct primary/secondary actions", () => {
  const source = read("components/first-message/ActionSuccessModal.tsx");
  assert.match(source, /role="dialog"/);
  assert.match(source, /aria-modal="true"/);
  assert.match(source, /data-testid="action-success-primary"/);
  assert.match(source, /data-testid="action-success-secondary"/);
  // Secondary is wired to onSecondary (dismiss), primary to onPrimary (navigate).
  assert.match(source, /onClick=\{onPrimary\}/);
  assert.match(source, /onClick=\{onSecondary\}/);
});

// ── "Open conversation" deep-link selects the thread in the inbox ────────────

test("Applications page reads ?thread and forwards it as the initial selection", () => {
  const source = read("components/applications/ApplicationsPageClient.tsx");
  assert.match(source, /searchParams\.get\("thread"\)/);
  assert.match(source, /initialSelectedId=\{threadParam\}/);
});

test("Applications workspace seeds its selection from the deep-link id", () => {
  const source = read("components/you/ApplicationsWorkspace.tsx");
  assert.match(source, /initialSelectedId(\?: string \| null)?/);
  assert.match(source, /useState<string \| null>\(initialSelectedId\)/);
  assert.match(source, /useState\(Boolean\(initialSelectedId\)\)/);
});
