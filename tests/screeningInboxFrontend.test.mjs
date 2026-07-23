import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (
        (specifier.startsWith("./") || specifier.startsWith("../")) &&
        !/\.[a-z0-9]+$/i.test(specifier)
      ) {
        return nextResolve(`${specifier}.ts`, context);
      }
      throw error;
    }
  },
});

const { mapBackendMessage } = await import("../lib/messaging.ts");

test("the static 'Review the application details before sending' line is gone from every action-panel state", () => {
  const panel = read("components/job-details/JobActionsPanelClient.tsx");
  assert.doesNotMatch(panel, /Review the application details before sending/);
  // A genuine external-application notice remains.
  assert.match(panel, /This opens another site/);
});

test("public job detail no longer renders language or screening sections", () => {
  const sections = read("components/job-details/JobDescriptionSections.tsx");
  assert.doesNotMatch(sections, /Required languages/);
  assert.doesNotMatch(sections, /Preferred languages/);
  assert.doesNotMatch(sections, /title="Screening questions"/);
  assert.doesNotMatch(sections, /LanguageCards/);
  // Retained public application information is still present.
  assert.match(sections, /title="How to apply"/);
  assert.match(sections, /Required application materials/);
});

test("screening questions are not collected before applying (preflight is inert)", () => {
  const application = read("lib/jobApplication.ts");
  assert.match(application, /screeningQuestions: \[\] as NonNullable/);
  const panel = read("components/job-details/JobActionsPanelClient.tsx");
  // The public frontend does not send screening answers back to the backend.
  assert.doesNotMatch(panel, /normalizedAnswers\[SCREENING_ANSWERS_KEY\] = buildScreeningQuestionAnswers/);
});

test("language is not a discovery dimension", () => {
  const discovery = read("lib/jobDiscovery.ts");
  assert.doesNotMatch(discovery, /"language"/);
  const filters = read("components/jobs/JobFiltersDrawer.tsx");
  assert.doesNotMatch(filters, /Required language/);
});

test("mapBackendMessage renders the automated screening message from structured metadata", () => {
  const time = () => "Just now";
  const screeningMessage = mapBackendMessage(
    {
      id: "m1",
      from_me: false,
      sender_name: "Money & Mindset",
      body: "A few questions from the hiring team:\n1. Q one (Required)\n2. Q two",
      kind: "screening_questions",
      message_kind: "screening_questions",
      automated: true,
      screening: {
        questions: [
          { id: "0", position: 0, prompt: "Q one", required: true },
          { id: "1", position: 1, prompt: "Q two", required: false },
        ],
      },
      created_at: "2027-01-01T00:00:00Z",
      read_by_recipient: false,
    },
    "Money & Mindset",
    time,
  );
  assert.equal(screeningMessage.kind, "screening");
  assert.equal(screeningMessage.screening?.automated, true);
  assert.equal(screeningMessage.screening?.questions.length, 2);
  assert.equal(screeningMessage.screening?.questions[0].required, true);
  // Ordinary messages are unaffected.
  const ordinary = mapBackendMessage(
    { id: "m2", from_me: true, body: "hello", created_at: null },
    "Someone",
    time,
  );
  assert.equal(ordinary.kind, undefined);
  assert.equal(ordinary.screening, undefined);

  // The Inbox renders the screening message natively.
  const workspace = read("components/you/ApplicationsWorkspace.tsx");
  assert.match(workspace, /function ScreeningQuestionsCard/);
  assert.match(workspace, /message\.kind === "screening" \? \(\s*<ScreeningQuestionsCard/);
  assert.match(workspace, /Sent automatically after the application/);
});
