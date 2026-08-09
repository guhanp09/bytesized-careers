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

const {
  RECRUITER_JOB_STEPS,
  RECRUITER_JOB_SCREENS,
  RECRUITER_JOB_CHAPTERS,
  chapterForScreen,
  groupForScreen,
  weightedJobProgress,
} = await import("../lib/jobPostingForm.ts");

const branch = (source, start, end) => {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `missing branch marker: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `missing next branch marker: ${end}`);
  return source.slice(startIndex, endIndex);
};

test("post-job navigates the merged screen sequence over seven domain groups", () => {
  assert.deepEqual(
    RECRUITER_JOB_STEPS.map((item) => item.id),
    ["basics", "about", "creatorContext", "toolsTags", "details", "applicationRequirements", "referenceVideos"]
  );

  // Collaboration + timing are merged into one "arrangement" screen → 13 screens.
  assert.deepEqual(
    RECRUITER_JOB_SCREENS.map((item) => item.id),
    [
      "role",
      "creatorContext",
      "about",
      "deliverables",
      "workflow",
      "skills",
      "toolsLanguages",
      "arrangement",
      "pay",
      "trial",
      "process",
      "apply",
      "references",
      "review",
    ]
  );
  assert.equal(RECRUITER_JOB_SCREENS.length, 14, "merged arrangement + dedicated references screen");

  const groups = new Set(RECRUITER_JOB_STEPS.map((item) => item.id));
  for (const screen of RECRUITER_JOB_SCREENS) {
    assert.ok(groups.has(screen.group), `${screen.id} maps to unknown group ${screen.group}`);
    assert.equal(groupForScreen(screen.id), screen.group);
  }

  const page = read("components/PostJobPage.tsx");
  const form = read("components/post-job/PostJobForm.tsx");
  assert.match(page, /const STEPS: Step\[\] = RECRUITER_JOB_SCREENS\.map\(\(item\) => item\.id\)/);
  assert.match(form, /type Step = RecruiterJobScreen/);
  assert.match(form, /const renderScreen = \(id: Step\) =>/);
});

test("chapters group every screen exactly once as short arcs", () => {
  const screenIds = RECRUITER_JOB_SCREENS.map((item) => item.id);
  const chaptered = RECRUITER_JOB_CHAPTERS.flatMap((chapter) => chapter.screens);
  assert.deepEqual([...chaptered].sort(), [...screenIds].sort(), "chapters must cover every screen once");
  assert.equal(chaptered.length, new Set(chaptered).size, "a screen cannot appear in two chapters");
  assert.equal(RECRUITER_JOB_CHAPTERS.length, 6, "six coherent chapters");
  const arrangement = RECRUITER_JOB_CHAPTERS.find((chapter) => chapter.id === "arrangement");
  assert.deepEqual(arrangement.screens, ["arrangement", "pay"]);
  const reviewChapter = RECRUITER_JOB_CHAPTERS.find((chapter) => chapter.id === "review");
  assert.deepEqual(reviewChapter.screens, ["references", "review"]);
  for (const id of screenIds) {
    assert.ok(chapterForScreen(id).screens.includes(id), `chapterForScreen(${id}) must contain ${id}`);
  }
});

test("the persistent header names the current decision and shows one continuous, weighted progress bar", () => {
  const form = read("components/post-job/PostJobForm.tsx");

  // Product context + the current conversational prompt + one truthful progress track.
  assert.match(form, />Post a job<\/p>/);
  assert.match(form, /\{activeScreen\.question\}/);
  assert.match(form, /\{activeScreen\.label\}/);
  assert.match(form, /role="progressbar"/);
  assert.match(form, /aria-label="Job posting progress"/);
  assert.match(form, /aria-valuemin=\{0\}/);
  assert.match(form, /aria-valuemax=\{100\}/);
  assert.match(form, /aria-valuenow=\{progressPercent\}/);
  assert.match(form, /aria-valuetext=\{`\$\{progressPercent\}% complete`\}/);
  assert.match(form, /const progressPercent = Math\.round\(weightedJobProgress\(step\) \* 100\)/);
  assert.match(form, /style=\{\{ width: `\$\{progressPercent\}%` \}\}/);
  assert.match(form, /motion-reduce:transition-none/);

  // No step count, no chapter/part labels, and no segmented markers in the header.
  assert.doesNotMatch(form, /Step \{currentStepNumber\} of \{totalSteps\}/);
  assert.doesNotMatch(form, /Part \{activeChapterIndex/);
  assert.doesNotMatch(form, /RECRUITER_JOB_CHAPTERS\.map\(\(chapter\) =>/);
  assert.doesNotMatch(form, /aria-current="step"/);
  assert.doesNotMatch(form, /chapterFill/);
  assert.doesNotMatch(form, /Continue to step \$\{/);

  // Layout guardrails still hold.
  assert.match(form, /<AnimatedStep key=\{step\} direction=\{direction\} flowLayout>/);
  assert.match(form, /className="relative min-h-\[420px\]"/);
});

test("progress is front-loaded and never shows completion before publish", () => {
  const order = RECRUITER_JOB_SCREENS.map((item) => item.id);

  // Monotonic non-decreasing across the whole flow.
  for (let i = 1; i < order.length; i += 1) {
    assert.ok(
      weightedJobProgress(order[i]) >= weightedJobProgress(order[i - 1]),
      `progress must not decrease from ${order[i - 1]} to ${order[i]}`
    );
  }

  // Front-loaded: by the 4th screen the bar is already ahead of a naive linear split.
  assert.ok(
    weightedJobProgress("deliverables") > 3 / order.length,
    "early screens should advance the bar faster than an equal split"
  );

  // The final Review screen sits just under 100% — publishing completes it.
  assert.ok(weightedJobProgress("review") < 1, "review must not display 100% before publish");
  assert.ok(weightedJobProgress("review") > 0.9, "review should be near the end");
  const max = Math.max(...order.map((id) => weightedJobProgress(id)));
  assert.equal(weightedJobProgress("review"), max, "review holds the highest in-flow progress");
});

test("dense domain groups are split into focused, flat screens", () => {
  const form = read("components/post-job/PostJobForm.tsx");
  const domainFields = read("components/post-job/JobDomainFields.tsx");

  // Role vs pay; work mode/city no longer on the role screen.
  const role = branch(form, 'if (id === "role")', 'if (id === "pay")');
  assert.match(role, /<EmployerContextFields[\s\S]*state=\{domain\}/);
  assert.doesNotMatch(role, /job-compensation-mode/);
  assert.doesNotMatch(role, /id="job-work-mode"/);
  const pay = branch(form, 'if (id === "pay")', 'if (id === "arrangement")');
  assert.match(pay, /job-compensation-mode/);

  // Work split: about / deliverables / workflow.
  const deliverables = branch(form, 'if (id === "deliverables")', 'if (id === "workflow")');
  assert.match(deliverables, /<WorkDeliverablesFields[\s\S]*sections=\{\["deliverables"\]\}/);
  const workflow = branch(form, 'if (id === "workflow")', 'if (id === "trial")');
  assert.match(workflow, /<WorkDeliverablesFields[\s\S]*sections=\{\["workflow"\]\}/);

  // Person split: skills / tools. Language requirements are removed from the flow.
  const skills = branch(form, 'if (id === "skills")', 'if (id === "toolsLanguages")');
  assert.match(skills, /<SkillsQualificationsFields[\s\S]*sections=\{\["skills"\]\}/);
  const toolsLanguages = branch(form, 'if (id === "toolsLanguages")', 'if (id === "about")');
  assert.match(toolsLanguages, /data-quality-target="job-tools"/);
  assert.doesNotMatch(toolsLanguages, /sections=\{\["languages"\]\}/);
  assert.doesNotMatch(toolsLanguages, /Language requirements/);

  // Merged arrangement: engagement first, then work mode, then the timing block, in one screen.
  const arrangement = branch(form, 'if (id === "arrangement")', 'if (id === "creatorContext")');
  assert.match(arrangement, /id="job-engagement-type"/);
  assert.match(arrangement, /id="job-work-mode"/);
  assert.match(arrangement, /<ArrangementDomainFields[\s\S]*workMode=\{workMode\}/);
  assert.ok(
    arrangement.indexOf("job-engagement-type") < arrangement.indexOf("job-work-mode"),
    "engagement type is asked before work mode"
  );
  assert.doesNotMatch(form, /if \(id === "collaboration"\)/);
  assert.doesNotMatch(form, /if \(id === "timing"\)/);

  // Hiring split into trial / evaluation / applications.
  const trial = branch(form, 'if (id === "trial")', 'if (id === "process")');
  assert.match(trial, /<TrialApplicationFields[\s\S]*sections=\{\["trial"\]\}/);
  const apply = branch(form, 'if (id === "apply")', 'if (id === "references")');
  assert.match(apply, /<TrialApplicationFields[\s\S]*sections=\{\["apply"\]\}/);
  assert.match(apply, /<RequirementSelector/);
  assert.doesNotMatch(apply, /referenceVideoFields/);

  // Reference videos have their own dedicated screen (not buried in review).
  const references = branch(form, 'if (id === "references")', "return (\n      <StepCard");
  assert.match(references, /\{referenceVideoFields\}/);
  const review = form.slice(form.indexOf("return (\n      <StepCard"));
  assert.doesNotMatch(review, /border-t border-white\/\[0\.08\] pt-6">\{referenceVideoFields\}/);

  assert.match(domainFields, /show\("deliverables"\)/);
  assert.match(domainFields, /show\("workflow"\)/);
  assert.match(domainFields, /show\("trial"\)/);
});

test("functional minimalism: flat sections, tooltips, no eyebrows, no optional badges", () => {
  const domainFields = read("components/post-job/JobDomainFields.tsx");
  const form = read("components/post-job/PostJobForm.tsx");

  // The shared DomainCard is a flat titled section, not a nested bordered card.
  const domainCard = branch(domainFields, "function DomainCard(", "function Field(");
  assert.doesNotMatch(domainCard, /rounded-2xl border border-white\/10 bg-white\/\[0\.055\]/);
  assert.match(domainCard, /className="min-w-0 space-y-4"/);
  assert.doesNotMatch(domainCard, /eyebrow \? \(/); // eyebrow is no longer rendered

  // Non-critical explanations move into the shared question-mark tooltip.
  assert.match(domainFields, /import QuestionTooltip from "\.\.\/ui\/QuestionTooltip"/);
  assert.match(domainFields, /<QuestionTooltip label=\{hint\}/);
  assert.match(domainFields, /<QuestionTooltip label=\{description\}/);
  assert.match(form, /import QuestionTooltip from "\.\.\/ui\/QuestionTooltip"/);
  assert.match(form, /<QuestionTooltip label=\{helper\}/);

  // "Optional" badges are gone (asterisks still mark required fields).
  assert.doesNotMatch(domainFields, />Optional<\/span>/);
  assert.doesNotMatch(form, />Optional<\/span>/);

  // The Role Context nested panel is gone — the employer question is direct.
  assert.doesNotMatch(domainFields, /eyebrow="Role context"/);
  assert.doesNotMatch(domainFields, /eyebrow="Scope"/);
  assert.match(domainFields, /legend="Who is this work for\?"/);
  assert.match(domainFields, /title="What will this person be expected to deliver\?"/);

  // Selectable choices are pointer-cursor and deselect on re-selection where empty is allowed.
  assert.match(domainFields, /min-h-11 cursor-pointer rounded-xl/); // ChoiceButton
  assert.match(domainFields, /employerContextType: state\.employerContextType === value \? "" : value/);
  assert.match(domainFields, /const show = \(section: WorkDeliverablesSection\)/);
});

test("completion links and backend validation return users to the field-owning screen", () => {
  const page = read("components/PostJobPage.tsx");
  for (const pattern of [
    /identity:\s*\{\s*step:\s*"role"/,
    /budget:\s*\{\s*step:\s*"pay"/,
    /creatorContext:\s*\{\s*step:\s*"creatorContext"/,
    /tools:\s*\{\s*step:\s*"toolsLanguages"/,
    /responsibilities:\s*\{\s*step:\s*"about"/,
    /timeline:\s*\{\s*step:\s*"arrangement"/,
    /turnaround:\s*\{\s*step:\s*"arrangement"/,
    /howToApply:\s*\{\s*step:\s*"apply"/,
    /referenceVideos:\s*\{\s*step:\s*"references"/,
  ]) {
    assert.match(page, pattern);
  }

  assert.match(page, /validateJobPostingDomainForPublication\(domain,\s*\{[\s\S]*budgetUnit,[\s\S]*engagementType/);
  assert.match(page, /screenForFieldError\(String\(firstIssue\.field\)\)/);
  assert.match(page, /const targetStep = screenForFieldError\(firstField\)/);
  assert.match(page, /focusQualityTarget\(`job-\$\{firstField\.replaceAll\("_", "-"\)\}`\)/);
});

test("step actions stay reachable on mobile without changing the desktop layout", () => {
  const form = read("components/post-job/PostJobForm.tsx");
  const actions = branch(form, "function StepActions(", "export default function PostJobForm(");

  assert.match(actions, /fixed inset-x-0 bottom-0 z-40/);
  assert.match(actions, /pb-\[max\(0\.75rem,env\(safe-area-inset-bottom\)\)\]/);
  assert.match(actions, /sm:hidden/);
  assert.match(actions, /mt-4 hidden items-center[\s\S]*sm:flex/);
  assert.match(actions, /min-h-11/);
  assert.match(actions, /aria-label=\{nextAccessibleLabel\}/);
  assert.match(actions, /saveDraftLabel = "Save draft"/);
  assert.match(form, /className="space-y-6 pb-28 sm:pb-0"/);
  assert.match(form, /variant="mobile-fixed"/);
});

test("candidate preview is available on mobile, desktop, and the final review screen", () => {
  const page = read("components/PostJobPage.tsx");
  const form = read("components/post-job/PostJobForm.tsx");
  const preview = read("components/post-job/RecruiterJobPreview.tsx");

  assert.match(page, /<details[^>]*className="[^"]*xl:hidden"/);
  assert.match(page, /Candidate preview/);
  assert.match(page, /<RecruiterJobPreview \{\.\.\.previewProps\} previewMode="full"/);
  assert.match(page, /sticky top-6 hidden[\s\S]*xl:block/);
  assert.match(page, /<RecruiterJobPreview \{\.\.\.previewProps\} previewMode="rail"/);
  assert.match(page, /reviewPreview=\{<RecruiterJobPreview \{\.\.\.previewProps\} previewMode="full" \/>\}/);
  assert.match(form, /aria-labelledby="job-review-preview-title"/);
  assert.match(form, /Review before publishing/);

  assert.match(preview, /aria-label="Candidate listing preview"/);
  for (const heading of ["Deliverables", "How to apply"]) {
    assert.match(preview, new RegExp(`title="${heading}"`));
  }
  // Languages and screening questions are no longer part of the candidate-facing preview.
  assert.doesNotMatch(preview, /title="Language requirements"/);
  assert.doesNotMatch(preview, /title="Screening questions"/);
});

test("step transitions respect reduced motion and hide outgoing content from interaction", () => {
  const transition = read("components/ui/StepTransition.tsx");
  const page = read("components/PostJobPage.tsx");

  assert.match(transition, /useReducedMotion/);
  assert.match(transition, /const prefersReducedMotion = useReducedMotion\(\)/);
  assert.match(transition, /prefersReducedMotion[\s\S]*transition:\s*\{ duration:\s*0 \}/);
  assert.match(transition, /aria-hidden=\{!isPresent\}/);
  assert.match(transition, /inert=\{!isPresent\}/);
  assert.match(page, /matchMedia\("\(prefers-reduced-motion: reduce\)"\)\.matches/);
  assert.match(page, /scrollIntoView\(\{ behavior: reducedMotion \? "auto" : "smooth"/);
});

test("application requests, structured screening, and public instructions remain separate", () => {
  const form = read("components/post-job/PostJobForm.tsx");
  const fields = read("components/post-job/JobDomainFields.tsx");

  const apply = branch(form, 'if (id === "apply")', 'if (id === "references")');
  assert.match(apply, /<TrialApplicationFields[\s\S]*sections=\{\["apply"\]\}/);
  assert.match(apply, /<RequirementSelector/);
  assert.match(apply, /hideCustomInstruction/);
  assert.match(apply, /Previously saved first-message prompt/);
  assert.match(fields, />\s*Screening questions\s*</);
  assert.match(fields, /label="Public how-to-apply note"/);
  assert.match(fields, /onChange\(\{ screeningQuestions:/);
  assert.match(fields, /onChange\(\{ howToApply: event\.target\.value \}, \["how_to_apply"\]\)/);
});

test("final action uses owner-aware publish copy and keeps explicit pointer affordances", () => {
  const form = read("components/post-job/PostJobForm.tsx");
  const selector = read("components/first-message/RequirementSelector.tsx");

  assert.match(form, /publishLabel = "Publish job"/);
  assert.match(form, /nextLabel=\{isSubmitting \? "Saving…" : publishLabel\}/);
  assert.match(form, /nextIcon=\{<Icon name="globe"/);
  assert.match(form, /cursor-pointer[\s\S]*Add another video/);
  assert.match(selector, /flex cursor-pointer items-start/);
});
