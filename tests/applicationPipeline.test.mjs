import test from "node:test";
import assert from "node:assert/strict";

import {
  HEADER_FILLED_ACTIONS,
  HEADER_SECONDARY_ACTIONS,
  headerActionWeight,
  backendStatusOf,
  bulkStageTargetsFor,
  directionLabelsFor,
  groupByStage,
  pipelineCardFacts,
  pipelineContextLabelOf,
  pipelineContextOptions,
  pipelineFirstMessageLines,
  pipelinePortfolioCountOf,
  pipelineProfileHrefOf,
  pipelineSearchMatch,
  pipelineSnippetOf,
  pipelineStagesFor,
  pipelineSummaryOf,
  stageNotifyPolicyOf,
  stageTargetsFor,
  validStageTargetsFor,
} from "../lib/applicationPipeline.ts";

test("received applications expose the full ATS funnel in order", () => {
  const keys = pipelineStagesFor("application", "received").map((stage) => stage.key);
  assert.deepEqual(keys, [
    "new",
    "reviewing",
    // "shortlisted" is retired: keeping someone in mind is a private Star now,
    // which layers on any stage instead of being one.
    "interviewing",
    "hired",
    "rejected",
    "withdrawn",
    "archived",
  ]);
});

test("sent applications relabel stages from the sender's point of view", () => {
  const stages = pipelineStagesFor("application", "sent");
  assert.equal(stages.find((stage) => stage.key === "new")?.label, "Pending");
  assert.equal(stages.find((stage) => stage.key === "reviewing")?.label, "Viewed");
  assert.equal(stages.find((stage) => stage.key === "rejected")?.label, "Not selected");
});

test("hiring-request stages use canonical Accepted vocabulary", () => {
  const stages = pipelineStagesFor("hiring_request", "received");
  assert.deepEqual(
    stages.map((stage) => stage.key),
    ["new", "reviewing", "accepted", "declined", "withdrawn", "archived"]
  );
  assert.equal(stages.find((stage) => stage.key === "accepted")?.label, "Accepted");
});

test("manager stage targets exclude arrival and sender-only statuses", () => {
  const applicationTargets = stageTargetsFor("application").map((stage) => stage.key);
  assert.deepEqual(applicationTargets, ["reviewing", "interviewing", "hired", "rejected", "archived"]);
  const interestTargets = stageTargetsFor("hiring_request").map((stage) => stage.key);
  assert.deepEqual(interestTargets, ["reviewing", "accepted", "declined", "archived"]);
  assert.deepEqual(
    bulkStageTargetsFor("application").map((stage) => stage.key),
    ["reviewing", "rejected", "archived"]
  );
  assert.deepEqual(
    bulkStageTargetsFor("hiring_request").map((stage) => stage.key),
    ["reviewing", "archived"]
  );
});

test("manager actions expose only legal next stages and never reopen terminal records", () => {
  assert.deepEqual(
    validStageTargetsFor("application", "new").map((stage) => stage.key),
    ["reviewing", "interviewing", "hired", "rejected"]
  );
  assert.deepEqual(
    validStageTargetsFor("application", "interviewing").map((stage) => stage.key),
    ["hired", "rejected"]
  );
  assert.deepEqual(
    validStageTargetsFor("application", "rejected").map((stage) => stage.key),
    ["reviewing", "interviewing", "hired"]
  );
  assert.deepEqual(
    validStageTargetsFor("application", "rejected", "rejected"),
    []
  );
  assert.deepEqual(validStageTargetsFor("application", "hired"), []);
  assert.deepEqual(
    validStageTargetsFor("hiring_request", "new").map((stage) => stage.key),
    ["reviewing", "accepted", "declined"]
  );
  assert.deepEqual(validStageTargetsFor("hiring_request", "accepted"), []);
});

test("legacy archives expose deliberate one-time resolution targets", () => {
  assert.deepEqual(
    validStageTargetsFor("application", "archived", "new", true).map((stage) => stage.key),
    ["new", "reviewing", "interviewing", "hired", "rejected"]
  );
  assert.deepEqual(
    validStageTargetsFor("hiring_request", "archived", "new", true).map((stage) => stage.key),
    ["new", "reviewing", "accepted", "declined"]
  );
  // A stale compatibility flag can be cleared by explicitly selecting the
  // current non-archived stage.
  assert.ok(
    validStageTargetsFor("application", "reviewing", "new", true).some(
      (stage) => stage.key === "reviewing"
    )
  );
  // A private compatibility flag never permits overwriting a shared outcome.
  assert.deepEqual(validStageTargetsFor("application", "archived", "hired", true), []);
  assert.deepEqual(validStageTargetsFor("hiring_request", "archived", "accepted", true), []);
});

test("backendStatusOf prefers the raw backend value and reverse-maps demo statuses", () => {
  // Live item: raw status wins.
  assert.equal(backendStatusOf({ kind: "application", status: "viewed", backendStatus: "reviewing" }), "reviewing");
  // Demo items: display status reverse-maps per kind.
  assert.equal(backendStatusOf({ kind: "application", status: "responded" }), "interviewing");
  assert.equal(backendStatusOf({ kind: "application", status: "declined" }), "rejected");
  assert.equal(backendStatusOf({ kind: "application", status: "closed" }), "archived");
  assert.equal(backendStatusOf({ kind: "application", status: "pending" }), "new");
  assert.equal(backendStatusOf({ kind: "hiring_request", status: "accepted" }), "accepted");
  assert.equal(backendStatusOf({ kind: "hiring_request", status: "responded" }), "accepted");
  assert.equal(backendStatusOf({ kind: "hiring_request", status: "declined" }), "declined");
});

test("groupByStage buckets items under stage keys and keeps unknown statuses visible", () => {
  const stages = pipelineStagesFor("application", "received");
  const items = [
    { id: "a", kind: "application", status: "new" },
    { id: "b", kind: "application", status: "shortlisted" },
    { id: "c", kind: "application", status: "declined" },
  ];
  const groups = groupByStage(items, stages);
  assert.equal(groups.get("new")?.length, 1);
  assert.equal(groups.get("shortlisted")?.length, 1);
  assert.equal(groups.get("rejected")?.length, 1);
  assert.equal(groups.get("hired")?.length, 0);
});

test("pipeline search matches names, titles, and job context, case-insensitively", () => {
  const item = {
    title: "Aarav Mehta",
    counterpartyName: "Aarav Mehta",
    contextLabel: null,
    job: { title: "Video editor for YouTube" },
    sourceListingTitle: null,
  };
  assert.equal(pipelineSearchMatch(item, "aarav"), true);
  assert.equal(pipelineSearchMatch(item, "video editor"), true);
  assert.equal(pipelineSearchMatch(item, ""), true);
  assert.equal(pipelineSearchMatch(item, "thumbnail"), false);
});

test("pipeline context options are distinct labels in first-seen order", () => {
  const items = [
    { job: { title: "Editor role" }, sourceListingTitle: null, contextLabel: null },
    { job: null, sourceListingTitle: "My listing", contextLabel: null },
    { job: { title: "Editor role" }, sourceListingTitle: null, contextLabel: null },
    { job: null, sourceListingTitle: null, contextLabel: null },
  ];
  assert.deepEqual(pipelineContextOptions(items), ["Editor role", "My listing"]);
  assert.equal(pipelineContextLabelOf(items[0]), "Editor role");
  assert.equal(pipelineContextLabelOf(items[3]), null);
});

test("profile href mirrors the inbox header logic for all four combos", () => {
  // Received application → the applicant's talent profile.
  assert.equal(
    pipelineProfileHrefOf({ kind: "application", talent: { profileSlug: "aarav-mehta" }, job: null, recruiter: null }),
    "/u/aarav-mehta?view=talent"
  );
  // Sent application → the hiring channel's profile.
  assert.equal(
    pipelineProfileHrefOf({ kind: "application", talent: null, job: { channelProfileSlug: "finance-creator" }, recruiter: null }),
    "/u/finance-creator?view=hiring"
  );
  // Received hiring request → the recruiter's profile.
  assert.equal(
    pipelineProfileHrefOf({ kind: "hiring_request", recruiter: { profileSlug: "edu-hindi" }, talent: null, job: null }),
    "/u/edu-hindi?view=hiring"
  );
  // Sent hiring request → the talent (listing owner).
  assert.equal(
    pipelineProfileHrefOf({ kind: "hiring_request", recruiter: null, talent: { profileSlug: "mira-shah" }, job: null }),
    "/u/mira-shah?view=talent"
  );
  assert.equal(pipelineProfileHrefOf({ kind: "application", talent: null, job: null, recruiter: null }), null);
});

test("card facts prefer proposed terms, else structured answers, capped at two, typed by icon", () => {
  assert.deepEqual(
    pipelineCardFacts({ proposedTerms: "₹2,500 per video · 4-day turnaround", firstMessageAnswers: null }),
    [{ icon: "cash", text: "₹2,500 per video · 4-day turnaround" }]
  );
  assert.deepEqual(
    pipelineCardFacts({
      proposedTerms: null,
      firstMessageAnswers: {
        expected_rate: { amount: "2,500", unit: "per video" },
        turnaround: { value: "4", unit: "days" },
        start_availability: "Within 1 week",
      },
    }),
    [
      { icon: "cash", text: "₹2,500 per video" },
      { icon: "clock", text: "4-day turnaround" },
    ]
  );
  assert.deepEqual(
    pipelineCardFacts({ proposedTerms: null, firstMessageAnswers: { start_availability: "Within 1 week" } }),
    [{ icon: "calendar", text: "Within 1 week" }]
  );
  assert.deepEqual(pipelineCardFacts({ proposedTerms: null, firstMessageAnswers: null }), []);
});

test("direction labels name the workflow instead of Sent/Received", () => {
  assert.deepEqual(directionLabelsFor("hiring"), { received: "Applicants", sent: "Outreach" });
  assert.deepEqual(directionLabelsFor("talent"), { received: "Hiring requests", sent: "Applications" });
});

test("pipeline summary reads total, new arrivals, and the furthest active stage", () => {
  const items = [
    { kind: "application", status: "new" },
    { kind: "application", status: "new" },
    { kind: "application", status: "shortlisted" },
    { kind: "application", status: "responded" }, // reverse-maps to interviewing
    { kind: "application", status: "declined" }, // terminal — never summarised
  ];
  assert.equal(
    pipelineSummaryOf(items, "application", "received", "hiring"),
    "5 applicants · 2 new · 1 interviewing"
  );
  // Talent mode names its own workflow; a single item reads in the singular.
  assert.equal(
    pipelineSummaryOf([{ kind: "hiring_request", status: "new" }], "hiring_request", "received", "talent"),
    "1 hiring request · 1 new"
  );
  // Sent boards use the sender-facing stage names ("pending", not "new").
  assert.equal(
    pipelineSummaryOf(
      [
        { kind: "application", status: "pending" },
        { kind: "application", status: "shortlisted" },
      ],
      "application",
      "sent",
      "talent"
    ),
    "2 applications · 1 pending · 1 under consideration"
  );
  assert.equal(pipelineSummaryOf([], "application", "received", "hiring"), null);
});

test("notify taxonomy: internal-only stages have no policy; outcomes do", () => {
  // Internal tracking must never message the other side.
  assert.equal(stageNotifyPolicyOf("application", "reviewing"), null);
  assert.equal(stageNotifyPolicyOf("application", "archived"), null);
  assert.equal(stageNotifyPolicyOf("hiring_request", "reviewing"), null);
  assert.equal(stageNotifyPolicyOf("hiring_request", "archived"), null);
  // Externally meaningful stages carry a platform notice.
  assert.equal(
    stageNotifyPolicyOf("application", "hired")?.notice({ contextLabel: null }),
    "Hired."
  );
  assert.equal(
    stageNotifyPolicyOf("application", "rejected")?.notice({ contextLabel: "Editor role" }),
    "Not moving forward for “Editor role”."
  );
  assert.equal(
    stageNotifyPolicyOf("hiring_request", "accepted")?.notice({ contextLabel: null }),
    "Hiring request accepted."
  );
  assert.equal(
    stageNotifyPolicyOf("hiring_request", "declined")?.notice({ contextLabel: null }),
    "Hiring request declined."
  );
  // Recommendation split: interviews and outcomes lead with send.
  // Retired stage: nothing can move into it, so it has no notify policy at all.
  assert.equal(stageNotifyPolicyOf("application", "shortlisted"), null);
  assert.equal(stageNotifyPolicyOf("application", "interviewing")?.recommended, true);
  assert.equal(stageNotifyPolicyOf("application", "rejected")?.recommended, true);
  assert.equal(stageNotifyPolicyOf("application", "rejected")?.automatic, undefined);
  assert.equal(stageNotifyPolicyOf("application", "interviewing")?.automatic, true);
  assert.equal(stageNotifyPolicyOf("application", "hired")?.automatic, true);
  assert.equal(stageNotifyPolicyOf("hiring_request", "accepted")?.automatic, true);
});

test("portfolio count reads structured portfolio answers, else attachments", () => {
  assert.equal(
    pipelinePortfolioCountOf({
      firstMessageAnswers: { relevant_portfolio: [{ id: "a", title: "A" }, { id: "b", title: "B" }] },
      attachments: [],
    }),
    2
  );
  assert.equal(
    pipelinePortfolioCountOf({ firstMessageAnswers: {}, attachments: [{ label: "Reel" }] }),
    1
  );
  assert.equal(pipelinePortfolioCountOf({ firstMessageAnswers: {}, attachments: [] }), 0);
});

test("card teaser is the fit note once requirements exist, else the legacy message", () => {
  // Legacy interaction (no structured answers): the written message is all there is.
  assert.equal(pipelineSnippetOf({ message: "  Hi there  ", firstMessageAnswers: null }), "Hi there");
  assert.equal(pipelineSnippetOf({ message: "", firstMessageAnswers: {} }), null);

  // Structured answers exist → the free-text message is ignored (newer model). The
  // teaser is the fit note (the applicant's own words on fit), never the message.
  assert.equal(
    pipelineSnippetOf({
      message: "Hi there — I'd love to be considered.",
      firstMessageAnswers: { expected_rate: { amount: "1", unit: "x" }, fit_note: "I edit in your niche." },
    }),
    "I edit in your niche."
  );
  // Requirements but no fit note → no single-line teaser (the card shows a "First
  // message" affordance for the requirements instead).
  assert.equal(
    pipelineSnippetOf({
      message: "Hi there",
      firstMessageAnswers: { expected_rate: { amount: "1", unit: "x" } },
    }),
    null
  );
});

test("first-message lines condense the listing owner's requirements as answered", () => {
  const lines = pipelineFirstMessageLines({
    kind: "application",
    firstMessageAnswers: {
      expected_rate: { amount: "2,500", unit: "per video" },
      relevant_portfolio: [
        { id: "p1", title: "A", url: "https://x/a" },
        { id: "p2", title: "B", url: "https://x/b" },
      ],
      turnaround: { value: "3", unit: "days" },
      fit_note: "I already edit in your niche.",
      custom_instruction: { prompt: "Share a similar edit.", response: "I handled the full cut." },
    },
  });
  const byLabel = Object.fromEntries(lines.map((l) => [l.label, l.value]));
  assert.match(byLabel["Expected rate"], /^₹2,500 per video/);
  assert.equal(byLabel["Portfolio"], "2 items");
  assert.equal(byLabel["Turnaround"], "3 days");
  assert.equal(byLabel["Fit note"], "I already edit in your niche.");
  // The custom instruction is relabelled "Screener" and shows the applicant's answer.
  assert.equal(byLabel["Screener"], "I handled the full cut.");

  // No structured answers → no lines (the card falls back to the "First message" label).
  assert.deepEqual(pipelineFirstMessageLines({ kind: "application", firstMessageAnswers: null }), []);
  assert.deepEqual(pipelineFirstMessageLines({ kind: "application", firstMessageAnswers: {} }), []);
});

/* ---- which recommendations reach the header, and how loudly ------------- */

test("reply never reaches the header, because the composer is already there", () => {
  // The pinned composer names the person in its placeholder. A filled button
  // whose whole effect is to focus it was the loudest control in the workspace
  // spending most of its life duplicating one already on screen.
  assert.equal(headerActionWeight("reply"), null);
});

test("the loud weight is reserved for actions somebody else is waiting on", () => {
  for (const key of ["confirm-interview", "confirm-start", "share-decision", "resolve-legacy-stage"]) {
    assert.equal(headerActionWeight(key), "filled", `${key} should be filled`);
  }
});

test("recording a decision is real work at your own pace, so it is secondary", () => {
  assert.equal(headerActionWeight("record-decision"), "secondary");
});

test("the retired neutral fallback has no weight at all", () => {
  assert.equal(headerActionWeight("choose-next-step"), null);
});

test("every action the ladder can return has an explicit verdict", () => {
  // A new rung must be classified deliberately rather than defaulting to
  // invisible, which is how a genuinely urgent action would go missing.
  const known = new Set([
    "resolve-legacy-stage",
    "confirm-interview",
    "confirm-start",
    "share-decision",
    "record-decision",
    "reply",
    "choose-next-step",
  ]);
  for (const key of [...HEADER_FILLED_ACTIONS, ...HEADER_SECONDARY_ACTIONS]) {
    assert.ok(known.has(key), `${key} is placed in the header but is not a ladder rung`);
  }
});
