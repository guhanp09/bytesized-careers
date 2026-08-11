import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), "utf8");

test("job creation owns the full phone viewport without changing other app routes", () => {
  const content = read("components/AppContent.tsx");
  const sidebar = read("components/Sidebar.tsx");
  const layout = read("app/layout.tsx");

  assert.match(content, /pathname\.startsWith\("\/post-job"\)/);
  assert.match(content, /focusedJobCreation \? "pt-14 sm:pl-20" : "pl-20 pt-14"/);
  assert.match(sidebar, /focusedJobCreation \? "hidden sm:flex" : "flex"/);
  assert.match(layout, /<AppContent>\{children\}<\/AppContent>/);
});

test("Bea reads as one accessible conversation with a nearby manual exit", () => {
  const canvas = read("components/import-job/assistant/DraftAssistantCanvas.tsx");
  const turn = read("components/import-job/assistant/ConversationTurn.tsx");

  assert.match(canvas, /aria-label="Prepare this job draft with Bea"/);
  assert.match(canvas, />\s*Bea\s*<\/p>/);
  assert.match(canvas, /Needs attention/);
  assert.match(canvas, /progress\.nativeDraftReady[\s\S]*"Ready"/);
  assert.match(canvas, /conversation-scroll/);
  assert.match(canvas, /conversation-continue-manually/);
  assert.match(canvas, /min-h-11 w-full[\s\S]*sm:w-auto sm:self-center/);
  assert.match(turn, /<RecruiterReply>\{submittedReply\}<\/RecruiterReply>[\s\S]*conversation-thinking/);
  assert.match(turn, /w-\[30px\] shrink-0 sm:w-8/);
  assert.doesNotMatch(turn, /hidden w-8 shrink-0 sm:block/);
});

test("remote geography survives imported-draft hydration, editing, preview, and save", () => {
  const page = read("components/PostJobPage.tsx");
  const form = read("components/post-job/PostJobForm.tsx");

  assert.match(page, /setCity\(nextLocation\)/);
  assert.match(page, /setCity\(typeof values\.location === "string" \? values\.location : ""\)/);
  assert.match(page, /workMode === "Remote"\s*\? city\.trim\(\) \|\| "Remote"/);
  assert.match(page, /location: city\.trim\(\) \|\| \(workMode === "Remote" \? "Remote" : ""\)/);
  assert.match(form, /label="Candidate location"/);
  assert.match(form, /Leave blank for worldwide/);
  assert.doesNotMatch(form, /if \(next === "Remote"\) onCityChange\(""\)/);
});

test("Post Job keeps a calm decision hierarchy and an editable About the brand field", () => {
  const form = read("components/post-job/PostJobForm.tsx");

  assert.match(form, /\{activeScreen\.question\}/);
  assert.match(form, /\{activeScreen\.label\}/);
  assert.match(form, /aria-label="Job posting progress"/);
  // One visible label for one field; the dynamic brand heading belongs to the
  // candidate page, where naming the brand tells a reader something.
  assert.match(form, /<label htmlFor="job-about-brand">About the brand<\/label>/);
  assert.doesNotMatch(form, /Candidate-facing introduction/);
  assert.match(form, /stays fully editable/);
  assert.match(form, />Continue<\/span>[\s\S]*aria-hidden="true">→<\/span>/);
});

test("the recruiter preview prioritizes candidate content without exposing internal review concepts", () => {
  const preview = read("components/post-job/RecruiterJobPreview.tsx");

  assert.match(preview, /const hasCandidateFit = Boolean/);
  assert.match(preview, /\{hasCandidateFit \? \(/);
  assert.match(preview, /<CompactGroup title=\{aboutBrandLabel\(props\.employerName\)\}>/);
  assert.doesNotMatch(preview, /title="Screening questions"/);
  assert.doesNotMatch(preview, /title="Provenance"/);
  assert.doesNotMatch(preview, /external_application_url/);
});
