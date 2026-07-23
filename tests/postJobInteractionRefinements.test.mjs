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

const {
  JOB_FIELD_REGISTRY,
  FIELD_SCREENS,
  screenForField,
} = await import("../lib/jobFieldRegistry.ts");

const {
  serializeJobPostingDomain,
  emptyJobPostingDomainState,
  hydrateJobPostingDomain,
  validateRepeatableDomainRows,
} = await import("../lib/jobPostingForm.ts");

const form = read("components/post-job/PostJobForm.tsx");
const fields = read("components/post-job/JobDomainFields.tsx");
const page = read("components/PostJobPage.tsx");
const preview = read("components/post-job/RecruiterJobPreview.tsx");

test("language requirements are removed from the Post Job flow but preserved as compatibility data", () => {
  // No recruiter-facing language control renders in the flow.
  assert.doesNotMatch(form, /sections=\{\["languages"\]\}/);
  assert.doesNotMatch(form, /TOOLS & LANGUAGES/);
  assert.match(form, /TOOLS & TAGS/);

  // Registry classifies language fields as preserved compatibility (no active screen).
  assert.equal(JOB_FIELD_REGISTRY.language_requirements.representation, "legacy-preserved");
  assert.equal(JOB_FIELD_REGISTRY.language_requirements.requirement, "system");
  assert.equal(JOB_FIELD_REGISTRY.language_requirements.step, undefined);
  assert.equal(screenForField("language_requirements"), undefined);
  assert.equal(FIELD_SCREENS.language_requirements, undefined);
  assert.equal(FIELD_SCREENS.languages, undefined);

  // Publication row validation no longer flags language requirements.
  const state = {
    ...emptyJobPostingDomainState(),
    languageRequirements: [{ id: "l1", language: "", priority: "", proficiency: "", purposes: [], notes: "" }],
  };
  assert.equal(
    validateRepeatableDomainRows(state).filter((issue) => issue.field === "language_requirements").length,
    0
  );

  // Stored languages still hydrate and serialize (untouched preservation), even though
  // they are no longer displayed anywhere in the job listing experience.
  const job = {
    language_requirements: [
      { language: "English", priority: "required", proficiency: "professional", purposes: ["scriptwriting"], notes: null },
    ],
  };
  const hydrated = hydrateJobPostingDomain(job);
  assert.equal(hydrated.languageRequirements?.length, 1);
  const serialized = serializeJobPostingDomain(hydrated);
  assert.deepEqual(serialized.language_requirements, job.language_requirements);
  // The candidate-facing preview no longer renders any language section.
  assert.doesNotMatch(preview, /title="Language requirements"/);
});

test("every audited Other option reveals a context-specific custom field", () => {
  // Each Other/custom choice reveals a dedicated custom input with contextual wording,
  // and stale custom values are dropped from the payload when the choice changes.
  const posting = read("lib/jobPostingForm.ts");

  // Deliverable type / frequency
  assert.match(fields, /item\.type === "other"/);
  assert.match(fields, /label="Name the output"/);
  assert.match(fields, /item\.frequency === "other"/);
  assert.match(fields, /label="Describe the rhythm"/);
  assert.match(posting, /custom_type: item\.type === "other" \? optionalText\(item\.customType\) : null/);
  assert.match(posting, /custom_frequency: item\.frequency === "other" \? optionalText\(item\.customFrequency\) : null/);

  // Source inputs
  assert.match(fields, /item\.type === "other"[\s\S]*custom_label/);

  // Hiring stage
  assert.match(fields, /item\.stage === "other"/);
  assert.match(fields, /label="Stage name"/);
  assert.match(posting, /custom_label: item\.stage === "other" \? optionalText\(item\.customLabel\) : null/);

  // Compensation unit (custom) lives in the pay screen with a dedicated input.
  assert.match(form, /budgetUnit === "custom"/);
  assert.match(form, /onBudgetUnitCustomChange/);
});

test("selectable single-choice controls deselect on re-selection where empty is allowed", () => {
  for (const pattern of [
    /employerContextType: state\.employerContextType === value \? "" : value/,
    /revisionPolicy: state\.revisionPolicy === value \? "" : value/,
    /creativeAutonomy: state\.creativeAutonomy === value \? "" : value/,
    /startTiming: state\.startTiming === value \? "" : value/,
    /durationType: state\.durationType === value \? "" : value/,
    /trialStatus: state\.trialStatus === value \? "" : value/,
  ]) {
    assert.match(fields, pattern);
  }
  // Platform (multi) toggles off; source inputs toggle off.
  assert.match(page, /prev\.includes\(next\)\s*\?\s*prev\.filter/);
  assert.match(fields, /selectedSourceTypes\.has\(type\)/);

  // Required binary confirmations must NOT become toggle-off choices.
  assert.match(fields, /unpaidTrialConfirmed/);
  assert.match(fields, /sensitive_access_confirmed/);
});

test("reference videos have their own dedicated step before review", () => {
  assert.match(form, /if \(id === "references"\)/);
  const refBranch = form.slice(form.indexOf('if (id === "references")'));
  assert.match(refBranch, /\{referenceVideoFields\}/);
  assert.match(refBranch, /You can publish without one/);
  // Reference routing points at the dedicated screen.
  assert.match(page, /media: \{ step: "references"/);
  assert.match(page, /referenceVideos: \{ step: "references"/);
  assert.match(page, /setStep\("references"\)/);
  assert.equal(screenForField("reference_videos"), "references");
});

test("missing-field attention scrolls, focuses, highlights, and shakes with reduced-motion support", () => {
  const emphasize = page.slice(page.indexOf("const emphasizeField"), page.indexOf("const focusQualityTarget"));
  assert.match(emphasize, /prefers-reduced-motion: reduce/);
  assert.match(emphasize, /scrollIntoView\(\{ behavior: reducedMotion \? "auto" : "smooth", block: "center" \}\)/);
  assert.match(emphasize, /focusable\?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(emphasize, /rgba\(251,191,36/); // amber highlight token
  assert.match(emphasize, /if \(reducedMotion\) return;/); // shake skipped under reduced motion
  assert.match(emphasize, /transform: "translateX\(-5px\)"/); // single restrained shake
  // Both the quality-target and first-invalid paths route through the shared emphasis.
  assert.match(page, /emphasizeField\(target\)/);
  assert.match(page, /emphasizeField\(el\)/);
});

test("label icons use one restrained, decorative treatment", () => {
  // The shared LabelWithIcon marks its icon decorative for assistive tech.
  const label = form.slice(form.indexOf("function LabelWithIcon"), form.indexOf("function PlatformMark"));
  assert.match(label, /aria-hidden="true"/);
  assert.match(label, /<Icon name=\{icon\}/);
});
