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

test("post-job keeps India-first quick language chips and adds a global registry", () => {
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

  assert.deepEqual(normalizeLanguageSelections(["Hindi", "hindi", "Farsi", "Persian"]), ["Hindi", "Persian"]);
});

test("language picker exposes Other search and post-job enables it only at the language field", () => {
  const picker = read("components/post-flow/LanguagePicker.tsx");
  const form = read("components/post-job/PostJobForm.tsx");

  assert.match(picker, /enableGlobalPicker/);
  assert.match(picker, />\s*Other\s*</);
  assert.match(picker, /Search languages/);
  assert.match(form, /<LanguagePicker[\s\S]*idPrefix="post-job"[\s\S]*enableGlobalPicker/);
});
