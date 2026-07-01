import test from "node:test";
import assert from "node:assert/strict";

import {
  applyDraftTitle,
  getJobDraftCompletion,
  getTalentDraftCompletion,
  validateDraftTitle,
} from "../lib/draftCompletion.ts";

// Minimal draft fixtures (the fields applyDraftTitle reads); avoids importing
// ownerDrafts.ts, whose runtime deps aren't resolvable by the bare node runner.
const jobDraft = (sourceJob) => ({
  id: "j1",
  kind: "job",
  title: "Untitled job draft",
  untitled: true,
  resumeHref: "/post-job?draftId=j1",
  sourceJob,
  completion: getJobDraftCompletion(sourceJob),
});

const talentDraft = (sourceTalent) => ({
  id: "t1",
  kind: "talent",
  title: "Untitled talent draft",
  untitled: true,
  resumeHref: "/post-talent?draftId=t1",
  sourceTalent,
  completion: getTalentDraftCompletion(sourceTalent),
});

test("validateDraftTitle rejects empty and too-short titles, trims valid ones", () => {
  assert.equal(validateDraftTitle("").ok, false);
  assert.equal(validateDraftTitle("   ").ok, false);
  assert.equal(validateDraftTitle("ab").ok, false);

  const ok = validateDraftTitle("  Edit pro  ");
  assert.equal(ok.ok, true);
  assert.equal(ok.title, "Edit pro");
});

test("applyDraftTitle on an untitled job draft completes the title task and persists status", () => {
  const draft = jobDraft({ title: "", status: "draft" });
  const titleBefore = draft.completion.requiredItems.find((i) => i.key === "title");
  assert.equal(titleBefore.done, false);
  const beforePercent = draft.completion.requiredPercent;

  const next = applyDraftTitle(draft, "  Video editor for finance explainers  ");

  assert.equal(next.title, "Video editor for finance explainers");
  assert.equal(next.untitled, false);
  const titleAfter = next.completion.requiredItems.find((i) => i.key === "title");
  assert.equal(titleAfter.done, true);
  assert.ok(next.completion.requiredPercent > beforePercent);
  // No duplicate / status preserved / resume target unchanged.
  assert.equal(next.id, draft.id);
  assert.equal(next.resumeHref, draft.resumeHref);
  assert.equal(next.sourceJob.status, "draft");
  assert.equal(next.sourceJob.title, "Video editor for finance explainers");
});

test("applyDraftTitle on an untitled talent draft completes the title task and persists status", () => {
  const draft = talentDraft({ title: "", status: "draft" });
  const beforePercent = draft.completion.requiredPercent;

  const next = applyDraftTitle(draft, "Retention editor for YouTube channels");

  assert.equal(next.title, "Retention editor for YouTube channels");
  assert.equal(next.untitled, false);
  const titleAfter = next.completion.requiredItems.find((i) => i.key === "title");
  assert.equal(titleAfter.done, true);
  assert.ok(next.completion.requiredPercent > beforePercent);
  assert.equal(next.id, draft.id);
  assert.equal(next.resumeHref, draft.resumeHref);
  assert.equal(next.sourceTalent.status, "draft");
});

test("applyDraftTitle treats fallback wording as not a real title", () => {
  const draft = talentDraft({ title: "", status: "draft" });
  const next = applyDraftTitle(draft, "Untitled talent draft");
  assert.equal(next.untitled, true);
  const titleItem = next.completion.requiredItems.find((i) => i.key === "title");
  assert.equal(titleItem.done, false);
});

test("applyDraftTitle keeps other completed fields when renaming", () => {
  const draft = jobDraft({
    title: "Old title",
    status: "draft",
    budget: "₹3,000 per video",
    about: "Explainer videos for a creator-led education channel.",
    tools: ["After Effects"],
  });
  const toolsBefore = draft.completion.recommendedItems.find((i) => i.key === "tools");
  assert.equal(toolsBefore.done, true);

  const next = applyDraftTitle(draft, "New clearer title");
  const toolsAfter = next.completion.recommendedItems.find((i) => i.key === "tools");
  assert.equal(toolsAfter.done, true);
  assert.equal(next.sourceJob.tools.length, 1);
});
