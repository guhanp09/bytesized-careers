import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The Portfolio Builder (PortfolioProjectWorkspace) lives behind auth on /you and
// needs a live backend, so it is not reachable from the mock Playwright harness.
// These source-contract tests lock in the requested builder refinements + the
// retraction of the speech-bubble popup shell (the builder must be a plain
// centered workflow modal), matching the repo's existing source-assertion tests.
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const BUILDER = "components/you/PortfolioProjectWorkspace.tsx";

test("builder uses a 3-step flow (project / contribution details / tools), no review", () => {
  const source = read(BUILDER);
  for (const key of ["project-details", "contribution-details", "tools"]) {
    assert.match(source, new RegExp(`key: "${key}"`), `missing step ${key}`);
  }
  assert.match(source, /WIZARD_STEP_ORDER = \[0, 1, 2\]/);
  // Old per-section steps are merged away; no review step.
  assert.doesNotMatch(source, /key: "contribution-highlights"/);
  assert.doesNotMatch(source, /key: "timestamp-notes"/);
  assert.doesNotMatch(source, /Ready to review/);
  assert.doesNotMatch(source, /key: "review"/);
});

test("builder is a centered workflow modal, not the speech-bubble popover shell", () => {
  const source = read(BUILDER);
  assert.doesNotMatch(source, /<AnchoredGlassPopover/);
  assert.doesNotMatch(source, /useAnchoredGlassPopover/);
  assert.doesNotMatch(source, /anchored-popover-caret/);
  assert.match(source, /fixed inset-0/);
  assert.match(source, /max-w-5xl/);
  assert.match(source, /bg-\[#1d1d1f\]/);
});

test("step 1 removes the preview label, source-metadata box, and timeline inputs", () => {
  const source = read(BUILDER);
  assert.doesNotMatch(source, /CARD PREVIEW/);
  assert.doesNotMatch(source, /Currently working/);
  assert.doesNotMatch(source, /Start month/i);
  assert.doesNotMatch(source, /Timeline not set/);
});

test("summary field is renamed and feeds the card + popup description", () => {
  const source = read(BUILDER);
  assert.match(source, /Brief summary of your contribution/);
  assert.doesNotMatch(source, /Shown on your portfolio card/);
  assert.doesNotMatch(source, />What I Did</);
  assert.match(source, /contribution_summary: shortSummary \|\| description/);
});

test("visibility sits under the preview without a visible label, preview only on step 1", () => {
  const source = read(BUILDER);
  assert.match(source, /aria-label="Project visibility"/);
  assert.doesNotMatch(source, />Visibility</);
  assert.match(source, /<aside className="hidden lg:block">\{previewWithVisibility\}<\/aside>/);
});

test("Step 2 'Contribution details' combines highlights + timestamp notes in one step", () => {
  const source = read(BUILDER);
  assert.match(source, /label: "Contribution details"/);
  // Both section headings render inside the same (editorStep === 1) block.
  const step2 = source.split("if (editorStep === 1)")[1].split("return (")[0] + source.split("if (editorStep === 1)")[1];
  assert.match(step2, /Contribution highlights/);
  assert.match(step2, /Timestamp notes/);
});

test("contribution highlights are numbered list rows, not tags/chips", () => {
  const source = read(BUILDER);
  assert.doesNotMatch(source, /TagPill/);
  // Multiple editable rows backed by scaffolded state + per-row delete.
  assert.match(source, /highlightRows\.map\(/);
  assert.match(source, /HIGHLIGHT_MIN_ROWS/);
  // Numbered rows (1. 2. 3.) and a text "Add highlight" control.
  assert.match(source, /\{index \+ 1\}\./);
  assert.match(source, /Add highlight/);
  assert.match(source, /aria-label="Add contribution highlight"/);
});

test("progress bar is the blue accent with a subtle 'Step X of Y' label", () => {
  const source = read(BUILDER);
  assert.match(source, /rounded-full bg-\[#4f6bf6\] transition-\[width\]/);
  assert.match(source, /Step \{currentWizardIndex \+ 1\} of \{WIZARD_STEPS\.length\}/);
});

test("sections use icon-badge headings; timestamps show TIME/LABEL/WHAT CHANGED columns", () => {
  const source = read(BUILDER);
  assert.match(source, /function BuilderSectionHeading/);
  assert.match(source, /<BuilderSectionHeading icon="bolt" iconClassName="text-\[#4f6bf6\]">Contribution highlights/);
  assert.match(source, /<BuilderSectionHeading icon="clock">Timestamp notes/);
  assert.match(source, />Time</);
  assert.match(source, />Label</);
  assert.match(source, />What changed</);
  assert.match(source, /Add timestamp/);
});

test("Enter and the plus control both commit a row and create/focus another", () => {
  const source = read(BUILDER);
  // Highlights: Enter commits the row, plus adds a row, both focus next.
  assert.match(source, /commitHighlightRow\(index\)/);
  assert.match(source, /onClick=\{addHighlightRow\}/);
  assert.match(source, /pendingHighlightFocus\.current =/);
  // Timestamps: Enter from description commits, plus adds, both focus next.
  assert.match(source, /commitTimestampRow\(index\)/);
  assert.match(source, /onClick=\{addTimestampRow\}/);
  assert.match(source, /pendingTimestampFocus\.current =/);
  // Timestamp validation remains on commit.
  assert.match(source, /parseReferenceTimestamp\(row\.time\)/);
});

test("empty rows are not persisted; filled rows auto-save into builder state", () => {
  const source = read(BUILDER);
  // Highlights filtered (listFromItem trims/dedupes/drops empties).
  assert.match(source, /listFromItem\(draft\.contributionHighlights\)/);
  // Timestamp rows are re-validated and dropped when invalid/empty at save.
  assert.match(source, /const seconds = parseReferenceTimestamp\(note\.time\)/);
  assert.match(source, /note\.title\.trim\(\) \|\| note\.description\.trim\(\)/);
  // Edits write straight into draft (auto-save), so navigating away keeps them.
  assert.match(source, /updateHighlightRow/);
  assert.match(source, /updateTimestampRow/);
});

test("a brief inline check confirms a committed row", () => {
  const source = read(BUILDER);
  assert.match(source, /function CommitCheck/);
  assert.match(source, /<CommitCheck show=\{highlightChecked\}/);
  assert.match(source, /<CommitCheck show=\{timestampChecked\}/);
  assert.match(source, /flashHighlightCheck/);
  assert.match(source, /flashTimestampCheck/);
});

test("tools step is labelled TOOLS with the sliders icon and the shared ToolPicker", () => {
  const source = read(BUILDER);
  assert.match(source, /import ToolPicker from "\.\/ToolPicker"/);
  assert.match(source, /<ToolPicker/);
  assert.match(source, /label: "TOOLS"/);
  assert.match(source, /icon: "sliders-horizontal"/);
  // The TOOLS heading uses the shared icon-badge heading with the sliders icon.
  assert.match(source, /<BuilderSectionHeading icon="sliders-horizontal">TOOLS/);
  assert.doesNotMatch(source, /label: "Tools used"/);
});

test("footer matches the reference: text Back + blue Next/Publish, accessible, no Cancel", () => {
  const source = read(BUILDER);
  assert.match(source, /aria-label="Previous step"/);
  assert.match(source, /aria-label="Next step"/);
  // Back is a labelled control; Next + Publish are the blue primary buttons.
  assert.match(source, /Back\s*\n\s*<\/button>/);
  assert.match(source, /bg-\[#4f6bf6\][^"]*text-white/);
  assert.match(source, /\{saving \? "Publishing\.\.\." : "Publish"\}/);
  assert.match(source, /\? "Refreshing\.\.\." : "Next"/);
  assert.doesNotMatch(source, />Cancel</);
});

test("save draft shows a check + toast and keeps builder state", () => {
  const source = read(BUILDER);
  assert.match(source, /setDraftSavedToast\(true\)/);
  assert.match(source, /Draft saved/);
  assert.match(source, /name="check"/);
  assert.match(source, /publishStatus === "draft" && !embedded/);
});

test("non-preview steps are centered in a right-sized modal; step 1 stays wide with preview", () => {
  const source = read(BUILDER);
  assert.match(source, /editorStep === 0 \?/);
  assert.match(source, /lg:grid-cols-\[minmax\(0,1fr\)_280px\]/);
  assert.match(source, /flex min-h-full items-center justify-center/);
  assert.match(source, /max-w-\[680px\]/);
  // Step 1 wide/tall; combined Contribution details a touch taller; Tools compact.
  assert.match(source, /max-w-5xl h-\[min\(760px,calc\(100vh-2rem\)\)\]/);
  assert.match(source, /max-w-\[760px\] h-\[min\(680px,calc\(100vh-2rem\)\)\]/);
  assert.match(source, /max-w-\[720px\] h-\[min\(560px,calc\(100vh-2rem\)\)\]/);
});

test("non-preview header is a quiet motivational line; no mechanical labels", () => {
  const source = read(BUILDER);
  assert.match(source, /\{activeWizardStep\.motivation\}/);
  assert.match(source, /Show the proof behind your work so recruiters can evaluate it fast\./);
  assert.match(source, /Add the tools that shaped the final output\./);
  // Mechanical "Project builder" / kicker / "N of M" labels are gated to step 0 only.
  assert.match(source, /editorStep === 0 \? \(\s*\n\s*\/\/ Step 1 keeps its fuller header/);
  // No duplicate step-label title node in the body (sections carry their own headings).
  assert.doesNotMatch(source, /<h3 className="text-lg font-semibold text-white\/92">\{activeWizardStep\.label\}<\/h3>/);
});

test("Back is disabled/greyed on step 1 and active from step 2 onward", () => {
  const source = read(BUILDER);
  assert.match(source, /aria-label="Previous step"/);
  assert.match(source, /currentWizardIndex === 0\s*\n?\s*\?\s*"cursor-not-allowed text-white\/25"/);
  assert.match(source, /:\s*"cursor-pointer text-white\/70 hover:text-white"/);
});

test("step transitions reuse the shared Post Job animation wrapper", () => {
  const builder = read(BUILDER);
  assert.match(builder, /import \{ AnimatedStep, type StepDirection \} from "\.\.\/ui\/StepTransition"/);
  assert.match(builder, /<AnimatePresence mode="sync" initial=\{false\} custom=\{stepDirection\}>/);
  assert.match(builder, /<AnimatedStep key=\{editorStep\} direction=\{stepDirection\}>/);
  assert.match(builder, /setStepDirection\("forward"\)/);
  assert.match(builder, /setStepDirection\("back"\)/);
  const postJob = read("components/post-job/PostJobForm.tsx");
  assert.match(postJob, /import \{ AnimatedStep \} from "\.\.\/ui\/StepTransition"/);
  assert.doesNotMatch(postJob, /const stepVariants =/);
  const shared = read("components/ui/StepTransition.tsx");
  assert.match(shared, /export function AnimatedStep/);
  assert.match(shared, /export const stepTransitionVariants/);
});
