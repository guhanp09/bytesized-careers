import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  GLOBAL_LANGUAGE_OPTIONS,
  LANGUAGE_OPTIONS,
  canonicalizeLanguageValue,
  normalizeLanguageSelections,
  searchLanguageOptions,
} from "../lib/search/searchVocabulary.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("the shared picker keeps India-first quick languages and a global registry", () => {
  assert.deepEqual(LANGUAGE_OPTIONS, [
    "Hindi",
    "English",
    "Tamil",
    "Telugu",
    "Kannada",
    "Malayalam",
    "Marathi",
    "Bengali",
    "Punjabi",
    "Gujarati",
    "Urdu",
  ]);

  for (const language of [
    "Spanish",
    "French",
    "German",
    "Arabic",
    "Portuguese",
    "Russian",
    "Japanese",
    "Korean",
    "Mandarin Chinese",
    "Cantonese",
    "Vietnamese",
    "Thai",
    "Indonesian",
    "Turkish",
    "Italian",
    "Dutch",
    "Polish",
    "Swahili",
    "Afrikaans",
    "Hebrew",
    "Persian",
    "Greek",
    "Ukrainian",
    "Filipino / Tagalog",
    "Malay",
    "Burmese",
    "Nepali",
    "Sinhala",
  ]) {
    assert.ok(GLOBAL_LANGUAGE_OPTIONS.includes(language), `${language} should be available globally`);
  }
});

test("global language search supports aliases and canonical dedupe", () => {
  assert.equal(canonicalizeLanguageValue("Farsi"), "Persian");
  assert.equal(canonicalizeLanguageValue("Tagalog"), "Filipino / Tagalog");
  assert.equal(canonicalizeLanguageValue("Chinese"), "Mandarin Chinese");

  assert.equal(searchLanguageOptions("spanish")[0], "Spanish");
  assert.equal(searchLanguageOptions("farsi")[0], "Persian");
  assert.equal(searchLanguageOptions("tagalog")[0], "Filipino / Tagalog");
  assert.equal(searchLanguageOptions("mandarin")[0], "Mandarin Chinese");

  assert.deepEqual(normalizeLanguageSelections(["Hindi", "hindi", "Farsi", "Persian"]), [
    "Hindi",
    "Persian",
  ]);
});

test("the generic picker exposes an accessible global search and remains available to talent posting", () => {
  const picker = read("components/post-flow/LanguagePicker.tsx");
  const talentForm = read("components/PostTalentPage.tsx");

  assert.match(picker, /enableGlobalPicker/);
  assert.match(picker, />\s*Other\s*</);
  assert.match(picker, /aria-controls=\{`\$\{idPrefix\}-language-picker`\}/);
  assert.match(picker, /role="dialog"/);
  assert.match(picker, /role="listbox" aria-multiselectable="true"/);
  assert.match(picker, /Search languages/);
  assert.match(talentForm, /<LanguagePicker[\s\S]*idPrefix="post-talent"[\s\S]*enableGlobalPicker/);
});

test("recruiter V3 uses structured language requirements while preserving honest legacy tags", () => {
  const form = read("components/post-job/PostJobForm.tsx");
  const fields = read("components/post-job/JobDomainFields.tsx");
  const page = read("components/PostJobPage.tsx");
  const posting = read("lib/jobPostingForm.ts");
  const preview = read("components/post-job/RecruiterJobPreview.tsx");

  assert.doesNotMatch(form, /<LanguagePicker/);
  assert.match(form, /<SkillsQualificationsFields[\s\S]*legacyLanguages=\{languages\}/);
  assert.match(fields, /const languages = state\.languageRequirements \?\? \[\]/);
  assert.match(fields, /priority:\s*""/);
  assert.match(fields, />\s*Choose priority\s*</);
  assert.match(fields, /purposes:\s*\[\]/);
  assert.match(fields, /JOB_LANGUAGE_PURPOSES\.map/);
  assert.match(fields, /Existing language tags:/);
  assert.match(fields, /broad search tags from an earlier format, not confirmed proficiency requirements/);
  assert.match(fields, /They stay unchanged/);

  assert.match(posting, /language_requirements:\s*languageRequirements/);
  assert.match(page, /if \(languages\.length\) payload\.languages = languages/);
  assert.match(page, /markPayloadDirty\("languages"\)/);
  assert.match(fields, /\["language_requirements"\]/);
  assert.doesNotMatch(page, /languageRequirements:\s*languages/);
  assert.doesNotMatch(page, /setDomain\([^)]*languages/);

  // The structured-language component and serialization remain for backward
  // compatibility, but languages are no longer rendered in the candidate-facing preview.
  assert.doesNotMatch(preview, /title="Language requirements"/);
  assert.doesNotMatch(preview, /const structuredLanguages = domain\.languageRequirements/);
});
