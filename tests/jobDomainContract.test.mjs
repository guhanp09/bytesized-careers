import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const DOMAIN_API_FIELDS = [
  "deliverables",
  "required_skill_keys",
  "preferred_skill_keys",
  "other_required_skills",
  "other_preferred_skills",
  "required_skills_note",
  "preferred_skills_note",
  "revision_policy",
  "revision_rounds",
  "revision_notes",
  "source_inputs",
  "source_inputs_notes",
  "creative_autonomy",
  "creative_autonomy_notes",
  "language_requirements",
  "trial_status",
  "trial_scope",
  "trial_effort_value",
  "trial_effort_unit",
  "trial_compensation_amount",
  "trial_compensation_currency",
  "trial_compensation_basis",
  "trial_work_usage",
  "trial_portfolio_permission",
  "trial_attribution",
  "unpaid_trial_confirmed",
  "trial_notes",
  "start_timing",
  "start_date",
  "duration_type",
  "duration_value",
  "duration_unit",
  "engagement_end_date",
  "hiring_process",
  "hiring_process_notes",
  "screening_questions",
  "employer_context_type",
  "application_mode",
  "external_apply_url",
  "deadline_at",
  "timezone_overlap",
  "how_to_apply",
];

test("creator domain taxonomies expose stable creator-economy values", () => {
  const contract = read("lib/jobContract.ts");
  for (const value of [
    "long_form_video",
    "podcast_episode",
    "community_post",
    "research_brief",
    "every_two_weeks",
    "video_editing",
    "scriptwriting",
    "account_access",
    "collaborative_direction",
    "native_or_fluent",
    "may_publish",
    "within_two_weeks",
    "production_house",
  ]) {
    assert.match(contract, new RegExp(`"${value}"`));
  }
  assert.match(contract, /sensitive_access_confirmed\?: boolean \| null/);
});

test("backend read and write boundaries include every V3 domain API field", () => {
  const client = read("lib/backendClient.ts");
  for (const field of DOMAIN_API_FIELDS) {
    const matches = client.match(new RegExp(`\\b${field}\\??:`, "g")) || [];
    assert.ok(matches.length >= 2, `${field} should exist on backend read and write types`);
  }
});

test("backend mapping preserves nullable structured collections and scalar fields", () => {
  const client = read("lib/backendClient.ts");
  for (const mapping of [
    /deliverables:\s*asNullableObjectArray\(job\.deliverables\)/,
    /requiredSkillKeys:\s*asNullableStringArray\(job\.required_skill_keys\)/,
    /preferredSkillKeys:\s*asNullableStringArray\(job\.preferred_skill_keys\)/,
    /sourceInputs:\s*asNullableObjectArray\(job\.source_inputs\)/,
    /languageRequirements:\s*asNullableObjectArray\(job\.language_requirements\)/,
    /hiringProcess:\s*asNullableObjectArray\(job\.hiring_process\)/,
    /screeningQuestions:\s*asNullableObjectArray\(job\.screening_questions\)/,
    /trialStatus:\s*asString\(job\.trial_status\)/,
    /startTiming:\s*asString\(job\.start_timing\)/,
    /employerContextType:\s*asString\(job\.employer_context_type\)/,
    /applicationMode:\s*asString\(job\.application_mode\)/,
    /externalApplyUrl:\s*asString\(job\.external_apply_url\)/,
    /deadlineAt:\s*asString\(job\.deadline_at\)/,
    /timezoneOverlap:\s*asString\(job\.timezone_overlap\)/,
    /howToApply:\s*asString\(job\.how_to_apply\)/,
  ]) {
    assert.match(client, mapping);
  }
  assert.match(client, /value == null\s*\? null/);
});

test("frontend Job model keeps legacy and canonical qualifications, languages, and application data separate", () => {
  const types = read("lib/types.ts");
  assert.match(types, /requirements\?: string/);
  assert.match(types, /requiredSkillKeys\?: string\[\] \| null/);
  assert.match(types, /preferredSkillKeys\?: string\[\] \| null/);
  assert.match(types, /languages\?: string\[\]/);
  assert.match(types, /languageRequirements\?: JobLanguageRequirement\[\] \| null/);
  assert.match(types, /applicationRequirements\?: string\[\]/);
  assert.match(types, /screeningQuestions\?: JobScreeningQuestion\[\] \| null/);
  assert.match(types, /applicationMode\?: string/);
  assert.match(types, /externalApplyUrl\?: string/);
  assert.match(types, /deadlineAt\?: string/);
  assert.match(types, /howToApply\?: string/);
});

test("the recruiter V3 fields use controlled taxonomies, accessible labels, and explicit sensitive access", () => {
  const fields = read("components/post-job/JobDomainFields.tsx");
  const posting = read("lib/jobPostingForm.ts");

  for (const registry of [
    "JOB_DELIVERABLE_TYPES",
    "JOB_DELIVERABLE_FREQUENCIES",
    "JOB_SKILL_KEYS",
    "JOB_SOURCE_INPUT_TYPES",
    "JOB_LANGUAGE_PURPOSES",
    "JOB_HIRING_STAGES",
  ]) {
    assert.match(fields, new RegExp(`\\b${registry}\\b`));
  }
  assert.match(fields, /<label htmlFor=\{id\}/);
  assert.match(fields, /<fieldset aria-describedby=/);
  assert.match(fields, /role="alert"/);
  assert.match(fields, /aria-pressed=\{active\}/);
  assert.match(fields, /sensitive_access_confirmed:\s*false/);
  assert.match(fields, /Explicit unpaid-trial confirmation/);
  assert.match(posting, /item\.sensitive_access_confirmed !== true/);
  assert.match(posting, /Explicitly confirm the sensitive access requirement/);
});

test("candidate preview displays structured and legacy information without conflating it", () => {
  const preview = read("components/post-job/RecruiterJobPreview.tsx");

  assert.match(preview, /const legacyRequirements = splitLines\(props\.legacyRequirements\)/);
  assert.match(preview, /const requiredSkills = unique\(\[[\s\S]*domain\.requiredSkillKeys/);
  assert.match(preview, /const structuredLanguages = domain\.languageRequirements \|\| \[\]/);
  assert.match(preview, /const legacyLanguages = unique\(props\.languages \|\| \[\]\)/);
  assert.match(preview, /const screeningQuestions = domain\.screeningQuestions \|\| \[\]/);
  assert.match(preview, /const howToApply = text\(domain\.howToApply\) \|\| text\(props\.howToApply\)/);
  assert.match(preview, /const applicationRequirements = unique\(props\.applicationRequirements \|\| \[\]\)/);

  for (const heading of [
    "Must-have skills",
    "Language requirements",
    "Trial terms",
    "Hiring process",
    "Screening questions",
    "What applicants should include",
    "How to apply",
  ]) {
    assert.match(preview, new RegExp(`title="${heading}"`));
  }
  assert.match(preview, /structuredLanguages\.length[\s\S]*legacyLanguages\.length/);
  assert.match(preview, /screeningQuestions\.map/);
});

test("V3 adds typed local boundaries without introducing AI execution into job posting", () => {
  const contract = read("lib/jobContract.ts");
  const posting = read("lib/jobPostingForm.ts");
  const client = read("lib/backendClient.ts");
  const fields = read("components/post-job/JobDomainFields.tsx");
  assert.doesNotMatch(`${contract}\n${posting}\n${client}\n${fields}`, /openai|anthropic|embedding|vector store/i);
  assert.match(posting, /hydrateJobPostingDomain/);
  assert.match(posting, /serializeJobPostingDomain/);
  assert.match(posting, /validateJobPostingDomainForPublication/);
  assert.match(fields, /const deliverables = state\.deliverables \?\? \[\]/);
  assert.match(fields, /deliverables: \[\.\.\.deliverables, next\]/);
  assert.match(fields, /const languages = state\.languageRequirements \?\? \[\]/);
  assert.match(fields, /languageRequirements: \[\.\.\.languages, next\]/);
  assert.match(fields, /const stages = state\.hiringProcess \?\? \[\]/);
  assert.match(fields, /hiringProcess: \[\.\.\.stages, next\]/);
  assert.match(fields, /const questions = state\.screeningQuestions \?\? \[\]/);
  assert.match(fields, /screeningQuestions: \[\.\.\.questions, next\]/);
});
