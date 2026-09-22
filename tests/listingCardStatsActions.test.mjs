import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("job card preserves save/share feedback without unverified public activity claims", () => {
  const source = read("components/JobCard.tsx");

  assert.match(source, /CardActionFeedback feedback=\{feedback\}/);
  assert.match(source, /showFeedback\("Job saved\.", "success", "check"/);
  assert.match(source, /actionHref: "\/you\?tab=saved"/);
  assert.match(source, /visual: "check"/);
  assert.match(source, /showFeedback\("Job link copied\.", "success", "share", \{ visual: "copy" \}/);
  assert.match(source, /copyTextToClipboard\(url\)/);
});

test("talent card preserves save/share feedback without pretending saves are recruiter interest", () => {
  const source = read("components/TalentCard.tsx");

  assert.match(source, /CardActionFeedback feedback=\{feedback\}/);
  assert.match(source, /showFeedback\("Talent listing saved\.", "success", "check"/);
  assert.match(source, /actionHref: "\/you\?tab=saved"/);
  assert.match(source, /visual: "check"/);
  assert.match(source, /showFeedback\("Talent link copied\.", "success", "share", \{ visual: "copy" \}/);
});

// Persisted demo numbers and legacy counters have no verified public metric
// contract. Parse executable TSX, not comments, to keep these sinks closed until
// real semantics, deduplication and provenance have been separately validated.
for (const path of [
  "components/JobCard.tsx",
  "components/job-details/JobActionsPanel.tsx",
  "components/TalentCard.tsx",
  "components/TalentListingActionsClient.tsx",
  "components/PostTalentPage.tsx",
  "app/talent/[id]/page.tsx",
]) {
  test(`${path} does not consume unverified marketplace activity metrics`, () => {
    const source = ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    assert.equal(source.parseDiagnostics.length, 0);
    const forbiddenIdentifiers = new Set([
      "views", "applicants", "responseRate", "response_rate", "interestedRecruitersCount",
      "getTalentInterestedRecruiters", "getTalentResponseRate", "setInterestedRecruitersCount",
    ]);
    const violations = [];
    const visit = (node) => {
      // Backend/mock object shapes can still carry legacy fields. The public
      // sink must not read, bind or forward them; unrelated portfolio fixture
      // declarations are not marketplace activity measurements.
      const isObjectKey = node.parent && ts.isPropertyAssignment(node.parent) && node.parent.name === node;
      if (ts.isIdentifier(node) && !isObjectKey && forbiddenIdentifiers.has(node.text)) violations.push(node.text);
      if (ts.isStringLiteral(node) && /^(Views|Applicants|Response rate|Currently viewing|Interested recruiters)$/.test(node.text)) {
        violations.push(node.text);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    assert.deepEqual(violations, [], `${path} reintroduced unsupported public activity claims`);
  });
}

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

test("mock fixtures retain nonzero legacy metrics so hidden-state tests are non-vacuous", () => {
  const source = read("lib/mockTalentListings.ts");

  assert.match(source, /views:\s*129/);
  assert.match(source, /saves:\s*18/);
  assert.match(source, /response_rate:\s*76/);
  assert.match(source, /response_rate:\s*0/);
});
