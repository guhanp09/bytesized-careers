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

const { RECRUITER_JOB_STEPS } = await import("../lib/jobPostingForm.ts");

const branch = (source, start, end) => {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `missing branch marker: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `missing next branch marker: ${end}`);
  return source.slice(startIndex, endIndex);
};

test("post-job has one shared seven-step recruiter sequence", () => {
  assert.deepEqual(RECRUITER_JOB_STEPS, [
    { id: "basics", label: "Role, context & pay", shortLabel: "Role" },
    { id: "about", label: "Work & deliverables", shortLabel: "Work" },
    { id: "creatorContext", label: "Creator context", shortLabel: "Context" },
    { id: "toolsTags", label: "Skills & workflow", shortLabel: "Fit" },
    { id: "details", label: "Working arrangement", shortLabel: "Timing" },
    { id: "applicationRequirements", label: "Trial & application", shortLabel: "Apply" },
    { id: "referenceVideos", label: "References & review", shortLabel: "Review" },
  ]);

  const page = read("components/PostJobPage.tsx");
  const form = read("components/post-job/PostJobForm.tsx");
  assert.match(page, /const STEPS: Step\[\] = RECRUITER_JOB_STEPS\.map\(\(item\) => item\.id\)/);
  assert.match(form, /type Step = RecruiterJobStep/);
  assert.match(form, /RECRUITER_JOB_STEPS\.find\(\(item\) => item\.id === step\)/);
  assert.doesNotMatch(page, /const STEPS: Step\[\] = \[[\s\S]*?\]/);
});

test("all five V3 domain components are wired to their owning steps", () => {
  const form = read("components/post-job/PostJobForm.tsx");
  const domainFields = read("components/post-job/JobDomainFields.tsx");
  const componentNames = [
    "EmployerContextFields",
    "WorkDeliverablesFields",
    "ArrangementDomainFields",
    "SkillsQualificationsFields",
    "TrialApplicationFields",
  ];

  for (const name of componentNames) {
    assert.match(domainFields, new RegExp(`export function ${name}\\(`));
    assert.equal((form.match(new RegExp(`<${name}\\b`, "g")) || []).length, 1, `${name} should be mounted once`);
  }

  const basics = branch(form, 'if (id === "basics")', 'if (id === "details")');
  const details = branch(form, 'if (id === "details")', 'if (id === "creatorContext")');
  const tools = branch(form, 'if (id === "toolsTags")', 'if (id === "about")');
  const about = branch(form, 'if (id === "about")', 'if (id === "applicationRequirements")');
  const application = branch(form, 'if (id === "applicationRequirements")', "return (\n      <StepCard");

  assert.match(basics, /<EmployerContextFields[\s\S]*state=\{domain\}[\s\S]*onChange=\{onDomainChange\}/);
  assert.match(details, /<ArrangementDomainFields[\s\S]*state=\{domain\}[\s\S]*engagementType=\{engagementType\}[\s\S]*workMode=\{workMode\}/);
  assert.match(tools, /<SkillsQualificationsFields[\s\S]*state=\{domain\}[\s\S]*legacyLanguages=\{languages\}/);
  assert.match(about, /<WorkDeliverablesFields[\s\S]*state=\{domain\}[\s\S]*roleName=\{selectedRoleName\}/);
  assert.match(application, /<TrialApplicationFields[\s\S]*state=\{domain\}[\s\S]*legacyApplicationRequirements=\{applicationRequirements\}/);

  assert.ok((form.match(/errors=\{domainErrors\}/g) || []).length >= 5);
  assert.match(form, /domain: JobPostingDomainState/);
  assert.match(form, /payloadKeys\?: Array<keyof BackendCreateJobPayload>/);
});

test("completion links and backend validation return users to the field-owning V3 step", () => {
  const page = read("components/PostJobPage.tsx");
  for (const pattern of [
    /identity:\s*\{\s*step:\s*"basics"/,
    /creatorContext:\s*\{\s*step:\s*"creatorContext"/,
    /tools:\s*\{\s*step:\s*"toolsTags"/,
    /responsibilities:\s*\{\s*step:\s*"about"/,
    /timeline:\s*\{\s*step:\s*"details"/,
    /howToApply:\s*\{\s*step:\s*"applicationRequirements"/,
    /referenceVideos:\s*\{\s*step:\s*"referenceVideos"/,
  ]) {
    assert.match(page, pattern);
  }

  assert.match(page, /validateJobPostingDomainForPublication\(domain,\s*\{[\s\S]*budgetUnit,[\s\S]*engagementType/);
  assert.match(page, /backendJobFieldStep\(firstField\)/);
  assert.match(page, /setStep\(targetStep\)/);
  assert.match(page, /focusQualityTarget\(`job-\$\{firstField\.replaceAll\("_", "-"\)\}`\)/);
});

test("the wizard exposes accessible progress and uses natural document scrolling", () => {
  const form = read("components/post-job/PostJobForm.tsx");

  assert.match(form, /aria-current="step"/);
  assert.match(form, /role="progressbar"/);
  assert.match(form, /aria-label="Job post progress"/);
  assert.match(form, /aria-valuemin=\{1\}/);
  assert.match(form, /aria-valuemax=\{totalSteps\}/);
  assert.match(form, /aria-valuenow=\{currentStepNumber\}/);
  assert.match(form, /aria-valuetext=\{`\$\{currentStepMeta\?\.label \|\| "Step"\}, step \$\{currentStepNumber\} of \$\{totalSteps\}`\}/);
  assert.match(form, /<AnimatedStep key=\{step\} direction=\{direction\} flowLayout>/);
  assert.match(form, /className="relative min-h-\[420px\]"/);

  assert.doesNotMatch(form, /h-\[calc\(100vh-/);
  assert.doesNotMatch(form, /max-h-\[75vh\]/);
  assert.doesNotMatch(form, /flex-1 overflow-y-auto pr-2 -mr-2/);
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

test("candidate preview is available on mobile, desktop, and the final review step", () => {
  const page = read("components/PostJobPage.tsx");
  const form = read("components/post-job/PostJobForm.tsx");
  const preview = read("components/post-job/RecruiterJobPreview.tsx");

  assert.match(page, /<details className="[^"]*lg:hidden"/);
  assert.match(page, /Preview candidate view/);
  assert.match(page, /<RecruiterJobPreview \{\.\.\.previewProps\} previewMode="full"/);
  assert.match(page, /sticky top-6 hidden[\s\S]*lg:block/);
  assert.match(page, /<RecruiterJobPreview \{\.\.\.previewProps\} previewMode="rail"/);
  assert.match(page, /reviewPreview=\{<RecruiterJobPreview \{\.\.\.previewProps\} previewMode="full" \/>\}/);
  assert.match(form, /aria-labelledby="job-review-preview-title"/);
  assert.match(form, /Review before publishing/);

  assert.match(preview, /aria-label="Candidate listing preview"/);
  for (const heading of ["Deliverables", "Language requirements", "Screening questions", "How to apply"]) {
    assert.match(preview, new RegExp(`title="${heading}"`));
  }
  assert.match(preview, /const structuredLanguages = domain\.languageRequirements \|\| \[\]/);
  assert.match(preview, /const screeningQuestions = domain\.screeningQuestions \|\| \[\]/);
});

test("step transitions respect reduced motion and hide outgoing content from interaction", () => {
  const transition = read("components/ui/StepTransition.tsx");
  const page = read("components/PostJobPage.tsx");

  assert.match(transition, /useReducedMotion/);
  assert.match(transition, /const prefersReducedMotion = useReducedMotion\(\)/);
  assert.match(transition, /prefersReducedMotion[\s\S]*transition:\s*\{ duration:\s*0 \}/);
  assert.match(transition, /aria-hidden=\{!isPresent\}/);
  assert.match(transition, /inert=\{!isPresent\}/);
  assert.match(transition, /flowLayout \? "relative" : "absolute inset-0"/);
  assert.match(page, /matchMedia\("\(prefers-reduced-motion: reduce\)"\)\.matches/);
  assert.match(page, /scrollIntoView\(\{ behavior: reducedMotion \? "auto" : "smooth"/);
});

test("application requests, structured screening, and public instructions remain separate", () => {
  const form = read("components/post-job/PostJobForm.tsx");
  const fields = read("components/post-job/JobDomainFields.tsx");

  const application = branch(form, 'if (id === "applicationRequirements")', "return (\n      <StepCard");
  assert.match(application, /<TrialApplicationFields/);
  assert.match(application, /<RequirementSelector/);
  assert.match(application, /hideCustomInstruction/);
  assert.match(application, /Legacy first-message prompt/);
  assert.match(application, /New screening questions are managed above/);
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
  assert.match(form, /nextAriaLabel=\{isSubmitting \? "Saving listing" : publishLabel\}/);
  assert.match(form, /nextIcon=\{<Icon name="globe"/);
  assert.match(form, /cursor-pointer[\s\S]*Add timestamp/);
  assert.match(form, /cursor-pointer[\s\S]*Add another video/);
  assert.match(selector, /flex cursor-pointer items-start/);
});
