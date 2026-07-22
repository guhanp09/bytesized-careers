import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("job card stats use normalized persisted fields and show action feedback", () => {
  const source = read("components/JobCard.tsx");

  assert.match(source, /normalizeCount\(job\.views\)/);
  assert.match(source, /normalizeCount\(job\.applicants\)/);
  assert.match(source, /normalizePercent\(job\.responseRate\)/);
  assert.match(source, /formatCompactNumber\(applicantCount\)/);
  assert.match(source, /label="Views"/);
  assert.doesNotMatch(source, /label="Currently viewing"/);
  assert.match(source, /CardActionFeedback feedback=\{feedback\}/);
  assert.match(source, /showFeedback\("Job saved\.", "success", "check"/);
  assert.match(source, /actionHref: "\/you\?tab=saved"/);
  assert.match(source, /visual: "check"/);
  assert.match(source, /showFeedback\("Job link copied\.", "success", "share", \{ visual: "copy" \}/);
  assert.match(source, /copyTextToClipboard\(url\)/);
});

test("talent card stats use listing saves/interests instead of hardcoded zero", () => {
  const source = read("components/TalentCard.tsx");

  assert.match(source, /getTalentInterestedRecruiters\(item\)/);
  assert.match(source, /getTalentResponseRate\(item\)/);
  assert.match(source, /normalizeCount\(item\.views\)/);
  assert.doesNotMatch(source, /const interestedRecruitersCount = 0/);
  assert.match(source, /setInterestedRecruitersCount\(\(count\) => count \+ 1\)/);
  assert.match(source, /CardActionFeedback feedback=\{feedback\}/);
  assert.match(source, /showFeedback\("Talent listing saved\.", "success", "check"/);
  assert.match(source, /actionHref: "\/you\?tab=saved"/);
  assert.match(source, /visual: "check"/);
  assert.match(source, /showFeedback\("Talent link copied\.", "success", "share", \{ visual: "copy" \}/);
});

test("home preview cards use the same visible save/share feedback", () => {
  const source = read("components/marketplace/HomePreviewCards.tsx");

  assert.match(source, /CardActionFeedback feedback=\{feedback\}/);
  assert.match(source, /showFeedback\("Job saved\.", "success", "check"/);
  assert.match(source, /showFeedback\("Talent listing saved\.", "success", "check"/);
  assert.match(source, /showFeedback\("Job link copied\.", "success", "share", \{ visual: "copy" \}/);
  assert.match(source, /showFeedback\("Talent link copied\.", "success", "share", \{ visual: "copy" \}/);
  assert.match(source, /actionHref: "\/you\?tab=saved"/);
  assert.match(source, /copyTextToClipboard/);
});

test("card feedback supports save and copied success treatments", () => {
  const source = read("components/ui/CardActionFeedback.tsx");
  const css = read("app/globals.css");

  assert.match(source, /visual\?: "check" \| "copy"/);
  assert.match(source, /actionLabel\?: string/);
  assert.match(source, /actionHref\?: string/);
  assert.match(source, /card-feedback-check-path/);
  assert.match(source, /card-feedback-copy-front/);
  assert.match(css, /@keyframes card-feedback-check-draw/);
  assert.match(css, /@keyframes card-feedback-copy-shine/);
});

test("mock talent listings include varied public stats for UI testing", () => {
  const source = read("lib/mockTalentListings.ts");

  assert.match(source, /views:\s*129/);
  assert.match(source, /saves:\s*18/);
  assert.match(source, /response_rate:\s*76/);
  assert.match(source, /response_rate:\s*0/);
});
