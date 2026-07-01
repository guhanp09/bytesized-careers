import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const extractSteps = (source) => {
  const match = source.match(/const STEPS: Step\[\] = \[([\s\S]*?)\];/);
  assert.ok(match, "PostJobPage should declare the Post Job step order");
  return Array.from(match[1].matchAll(/"([^"]+)"/g)).map((entry) => entry[1]);
};

test("post-job uses the seven-step structural flow", () => {
  const page = read("components/PostJobPage.tsx");
  const steps = extractSteps(page);
  assert.deepEqual(steps, [
    "basics",
    "details",
    "about",
    "creatorContext",
    "toolsTags",
    "applicationRequirements",
    "referenceVideos",
  ]);

  for (const oldStep of ["responsibilities", "requirements", "howToApply", "tags", "applyReferences"]) {
    assert.equal(steps.includes(oldStep), false);
  }
});

test("post-job completion and legacy draft targets route to the new steps", () => {
  const page = read("components/PostJobPage.tsx");

  assert.match(page, /identity:\s*\{\s*step:\s*"basics"/);
  assert.match(page, /budget:\s*\{\s*step:\s*"basics"/);
  assert.match(page, /experience:\s*\{\s*step:\s*"basics"/);
  assert.match(page, /creatorContext:\s*\{\s*step:\s*"creatorContext"/);
  assert.match(page, /contentNiches:\s*\{\s*step:\s*"creatorContext",\s*target:\s*"job-content-niches"/);
  assert.match(page, /contentGenres:\s*\{\s*step:\s*"creatorContext",\s*target:\s*"job-content-genres"/);
  assert.match(page, /formatsHiredFor:\s*\{\s*step:\s*"creatorContext",\s*target:\s*"job-formats-hired-for"/);
  assert.match(page, /tools:\s*\{\s*step:\s*"toolsTags"/);
  assert.match(page, /tags:\s*\{\s*step:\s*"toolsTags"/);
  assert.match(page, /responsibilities:\s*\{\s*step:\s*"about"/);
  assert.match(page, /requirements:\s*\{\s*step:\s*"about"/);
  assert.match(page, /about:\s*\{\s*step:\s*"about"/);
  assert.match(page, /media:\s*\{\s*step:\s*"referenceVideos"/);
  assert.match(page, /referenceVideos:\s*\{\s*step:\s*"referenceVideos"/);
  assert.match(page, /howToApply:\s*\{\s*step:\s*"applicationRequirements"/);
  assert.match(page, /"job-first-message":\s*\{\s*step:\s*"applicationRequirements"/);
  assert.match(page, /applyReferences:\s*\{\s*step:\s*"applicationRequirements"/);
});

test("post-job form renders the new structural branches and keeps field labels", () => {
  const form = read("components/post-job/PostJobForm.tsx");

  for (const step of ["basics", "details", "creatorContext", "toolsTags", "about", "applicationRequirements", "referenceVideos"]) {
    assert.match(form, new RegExp(`id === "${step}"|id="${step}"`));
  }

  for (const label of [
    "Job title",
    "Platform",
    "Work mode",
    "Budget",
    "Experience",
    "Turnaround",
    "Start",
    "Content niches",
    "Genres",
    "Formats hired for",
    "TOOLS & TAGS",
    "Tags",
    "Day-to-day responsibilities",
    "Requirements",
    "APPLICATION REQUIREMENTS",
    "What applicants must include",
    "Reference videos",
  ]) {
    assert.match(form, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  assert.equal((form.match(/Reference videos/g) || []).length, 1);
});

test("post-job final action says Post with its icon", () => {
  const form = read("components/post-job/PostJobForm.tsx");
  assert.match(form, /nextIcon=\{<Icon name="globe"/);
  assert.match(form, /nextLabel=\{isSubmitting \? "Posting\.\.\." : "Post"\}/);
  assert.match(form, /nextAriaLabel=\{isSubmitting \? "Posting job" : "Post job"\}/);
});

test("post-job clickable controls use explicit pointer cursors", () => {
  const form = read("components/post-job/PostJobForm.tsx");
  const selector = read("components/first-message/RequirementSelector.tsx");

  assert.match(form, /SAVE DRAFT/);
  assert.match(form, /cursor-pointer[\s\S]*SAVE DRAFT/);
  assert.match(form, /cursor-pointer[\s\S]*Add timestamp/);
  assert.match(form, /cursor-pointer[\s\S]*Add another video/);
  assert.match(selector, /flex cursor-pointer items-start/);
  assert.match(selector, /flex w-full cursor-pointer items-center/);
});

test("post-job application requirements and reference videos are separate steps", () => {
  const form = read("components/post-job/PostJobForm.tsx");
  const applicationRequirements = form.match(
    /if \(id === "applicationRequirements"\) \{([\s\S]*?)return \(\s*<StepCard\s*bodyClassName="mt-0"/
  );
  const referenceVideos = form.match(/const referenceVideoFields = \(([\s\S]*?)\);\n\n    if \(id === "basics"/);
  const referenceBranch = form.match(/<StepCard\s*bodyClassName="mt-0"([\s\S]*?)<\/StepCard>/);

  assert.ok(applicationRequirements, "Application requirements branch should exist");
  assert.ok(referenceVideos, "Reference videos branch should exist");
  assert.ok(referenceBranch, "Reference videos StepCard should exist");

  assert.doesNotMatch(applicationRequirements[1], /LabelWithIcon icon="send">How to apply/);
  assert.match(applicationRequirements[1], /LabelWithIcon icon="clipboard-list">What applicants must include/);
  assert.match(applicationRequirements[1], /RequirementSelector/);
  assert.match(applicationRequirements[1], /customInstructionValue=\{howToApply\}/);
  assert.doesNotMatch(applicationRequirements[1], /Reference videos/);
  assert.doesNotMatch(applicationRequirements[1], /referenceVideoFields/);

  assert.match(referenceVideos[1], /Icon name="video"[\s\S]*?Reference videos/);
  assert.match(referenceBranch[1], /referenceVideoFields/);
  assert.doesNotMatch(referenceBranch[1], /RequirementSelector/);
});

test("post-job creator context is focused and tools/tags are separated", () => {
  const form = read("components/post-job/PostJobForm.tsx");
  const creatorContext = form.match(/if \(id === "creatorContext"\) \{([\s\S]*?)if \(id === "toolsTags"\) \{/);
  const toolsTags = form.match(/if \(id === "toolsTags"\) \{([\s\S]*?)if \(id === "about"\) \{/);

  assert.ok(creatorContext, "Creator context branch should exist");
  assert.ok(toolsTags, "Tools & Tags branch should exist");

  assert.match(creatorContext[1], /targetId="job-content-niches"/);
  assert.match(creatorContext[1], /targetId="job-content-genres"/);
  assert.match(creatorContext[1], /targetId="job-formats-hired-for"/);
  assert.doesNotMatch(creatorContext[1], /StyleSmartInput|label="Style"|job-tools|tagsFields|Helps relevant talent find your job in search/);

  assert.match(toolsTags[1], /title="TOOLS & TAGS"/);
  assert.match(toolsTags[1], /data-quality-target="job-tools"/);
  assert.match(toolsTags[1], /tagsFields/);
  assert.match(form, /LabelWithIcon icon="tag">Tags/);
});

test("post-job basics uses the compact icon-led layout", () => {
  const form = read("components/post-job/PostJobForm.tsx");

  assert.match(form, /basics:\s*""/);
  assert.doesNotMatch(form, /basics:\s*"Just the essentials\."/);
  assert.match(form, /title="BASICS"/);
  assert.match(form, /LabelWithIcon icon="briefcase"/);
  assert.match(form, /LabelWithIcon icon="screen"/);
  assert.match(form, /LabelWithIcon icon="laptop"/);
  assert.match(form, /LabelWithIcon icon="wallet"/);
  assert.match(form, /PlatformMark platform=\{key\}/);
  assert.match(form, /₹/);
  assert.match(form, /Flexible/);
  assert.match(form, /saveDraftIcon=\{<Icon name="file"/);
});

test("post-job labels after basics use the shared icon treatment", () => {
  const form = read("components/post-job/PostJobForm.tsx");
  const languagePicker = read("components/post-flow/LanguagePicker.tsx");
  const toolPicker = read("components/you/ToolPicker.tsx");
  const postJobPage = read("components/PostJobPage.tsx");
  const portfolioBuilder = read("components/you/PortfolioProjectWorkspace.tsx");
  const youHub = read("components/you/YouHubClient.tsx");

  for (const pattern of [
    /LabelWithIcon icon="clock">Turnaround/,
    /LabelWithIcon icon="calendar">Start/,
    /label="Content niches"[\s\S]*?icon="sparkles"/,
    /label="Genres"[\s\S]*?icon="layers"/,
    /label="Formats hired for"[\s\S]*?icon="layout-grid"/,
    /LabelWithIcon icon="tag">Tags/,
    /LabelWithIcon icon="file">\{aboutTitle\}/,
    /LabelWithIcon icon="list-checks">Day-to-day responsibilities/,
    /LabelWithIcon icon="clipboard-check">Requirements/,
    /LabelWithIcon icon="clipboard-list">What applicants must include/,
    /customInstructionValue=\{howToApply\}/,
    /Icon name="video"[\s\S]*?Reference videos/,
    /LabelWithIcon icon="eye">What to reference/,
    /LabelWithIcon icon="clock">Timestamp notes/,
  ]) {
    assert.match(form, pattern);
  }

  assert.match(languagePicker, /Icon name="languages"[\s\S]*?Languages/);
  assert.match(toolPicker, /Icon name="sliders-horizontal"[\s\S]*?\{label\}/);
  assert.match(postJobPage, /Icon name="briefcase"[\s\S]*?Hiring for/);
  assert.match(portfolioBuilder, /icon: "sliders-horizontal"/);
  assert.match(portfolioBuilder, /BuilderSectionHeading icon="sliders-horizontal"/);
  assert.match(youHub, /Icon name="sliders-horizontal"[\s\S]*?Tools/);
  assert.match(youHub, /Icon name="sliders-horizontal"[\s\S]*?Tools used/);
});
