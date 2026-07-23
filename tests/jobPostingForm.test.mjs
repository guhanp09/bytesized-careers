import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

// The production modules use bundler-style extensionless imports. Keep the test
// on Node's native type stripper while resolving those imports to their .ts files.
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
  RECRUITER_JOB_STEPS,
  backendJobFieldStep,
  emptyJobPostingDomainState,
  getJobRoleRules,
  hydrateJobPostingDomain,
  serializeJobPostingDomain,
  validateJobPostingDomainForPublication,
  validateRepeatableDomainRows,
} = await import("../lib/jobPostingForm.ts");

const validDeliverable = (id = "deliverable-valid") => ({
  id,
  type: "short",
  customType: "",
  quantity: "4",
  frequency: "per_week",
  customFrequency: "",
  notes: "Vertical, captioned exports",
});

const validPublicationState = () => ({
  ...emptyJobPostingDomainState(),
  deliverables: [validDeliverable()],
  startTiming: "flexible",
  durationType: "fixed_period",
  durationValue: "3",
  durationUnit: "months",
  trialStatus: "none",
});

test("empty recruiter domain state is explicit and leaves structured collections unknown", () => {
  assert.deepEqual(emptyJobPostingDomainState(), {
    deliverables: null,
    requiredSkillKeys: null,
    preferredSkillKeys: null,
    otherRequiredSkills: null,
    otherPreferredSkills: null,
    requiredSkillsNote: "",
    preferredSkillsNote: "",
    revisionPolicy: "",
    revisionRounds: "",
    revisionNotes: "",
    sourceInputs: null,
    sourceInputsNotes: "",
    creativeAutonomy: "",
    creativeAutonomyNotes: "",
    languageRequirements: null,
    trialStatus: "",
    trialScope: "",
    trialEffortValue: "",
    trialEffortUnit: "",
    trialCompensationAmount: "",
    trialCompensationCurrency: "",
    trialCompensationBasis: "",
    trialWorkUsage: "",
    trialPortfolioPermission: "",
    trialAttribution: "",
    unpaidTrialConfirmed: false,
    trialNotes: "",
    startTiming: "",
    startDate: "",
    durationType: "",
    durationValue: "",
    durationUnit: "",
    engagementEndDate: "",
    hiringProcess: null,
    hiringProcessNotes: "",
    screeningQuestions: null,
    employerContextType: "",
    applicationMode: "internal",
    externalApplyUrl: "",
    deadlineAt: "",
    timezoneOverlap: "",
    howToApply: "",
  });

  assert.deepEqual(RECRUITER_JOB_STEPS.map(({ id }) => id), [
    "basics",
    "about",
    "creatorContext",
    "toolsTags",
    "details",
    "applicationRequirements",
    "referenceVideos",
  ]);
});

test("a complete backend domain hydrates and serializes without losing contract fields", () => {
  const deadline = "2032-06-15T12:30:00.000Z";
  const job = {
    deliverables: [
      {
        type: "other",
        custom_type: "Sponsor integration cut",
        quantity: 2,
        frequency: "other",
        custom_frequency: "per campaign launch",
        notes: "Two aspect ratios",
      },
    ],
    required_skill_keys: ["video_editing", "storytelling"],
    preferred_skill_keys: ["motion_graphics"],
    other_required_skills: ["Interview pacing"],
    other_preferred_skills: ["Basic sound design"],
    required_skills_note: "Show ownership of the final edit.",
    preferred_skills_note: "Motion polish is useful.",
    revision_policy: "fixed",
    revision_rounds: 2,
    revision_notes: "One consolidated feedback document per round.",
    source_inputs: [
      { type: "raw_footage", custom_label: null, sensitive_access_confirmed: null },
      { type: "account_access", custom_label: null, sensitive_access_confirmed: true },
      { type: "other", custom_label: "Previous project archive", sensitive_access_confirmed: null },
    ],
    source_inputs_notes: "Access is granted after onboarding.",
    creative_autonomy: "collaborative_direction",
    creative_autonomy_notes: "The hook is shaped together.",
    language_requirements: [
      {
        language: "Hindi",
        priority: "required",
        proficiency: "professional",
        purposes: ["content_understanding", "speaking"],
        notes: "Interviews are primarily in Hindi.",
      },
    ],
    trial_status: "paid",
    trial_scope: "One 45-second edit from supplied footage.",
    trial_effort_value: 2,
    trial_effort_unit: "hours",
    trial_compensation_amount: 2500,
    trial_compensation_currency: "INR",
    trial_compensation_basis: "flat",
    trial_work_usage: "evaluation_only",
    trial_portfolio_permission: "with_permission",
    trial_attribution: "to_be_agreed",
    unpaid_trial_confirmed: null,
    trial_notes: "Feedback is sent within two days.",
    start_timing: "specific_date",
    start_date: "2032-07-01",
    duration_type: "fixed_period",
    duration_value: 3,
    duration_unit: "months",
    engagement_end_date: null,
    hiring_process: [
      { stage: "portfolio_review", custom_label: null, notes: "Two relevant samples" },
      { stage: "other", custom_label: "Creator conversation", notes: "Twenty minutes" },
    ],
    hiring_process_notes: "Decision within one week.",
    screening_questions: [
      {
        prompt: "Which sample best shows retention-led pacing?",
        required: true,
        response_guidance: "Link one sample and explain your contribution.",
      },
    ],
    employer_context_type: "creator",
    application_mode: "external",
    external_apply_url: "https://example.test/apply",
    deadline_at: deadline,
    timezone_overlap: "Two hours with IST weekdays",
    how_to_apply: "Send two relevant samples and your availability.",
  };

  const hydrated = hydrateJobPostingDomain(job);
  assert.match(hydrated.deliverables[0].id, /^deliverable-0-/);
  assert.match(hydrated.languageRequirements[0].id, /^language-0-/);
  assert.match(hydrated.hiringProcess[0].id, /^stage-0-/);
  assert.match(hydrated.screeningQuestions[0].id, /^question-0-/);
  assert.equal(hydrated.trialCompensationAmount, "2500");
  assert.equal(hydrated.durationValue, "3");

  const serialized = serializeJobPostingDomain(hydrated);
  assert.deepEqual(serialized.deliverables, job.deliverables);
  assert.deepEqual(serialized.required_skill_keys, job.required_skill_keys);
  assert.deepEqual(serialized.preferred_skill_keys, job.preferred_skill_keys);
  assert.deepEqual(serialized.other_required_skills, job.other_required_skills);
  assert.deepEqual(serialized.other_preferred_skills, job.other_preferred_skills);
  assert.equal(serialized.required_skills_note, job.required_skills_note);
  assert.equal(serialized.preferred_skills_note, job.preferred_skills_note);
  assert.equal(serialized.revision_policy, job.revision_policy);
  assert.equal(serialized.revision_rounds, job.revision_rounds);
  assert.equal(serialized.revision_notes, job.revision_notes);
  assert.deepEqual(serialized.source_inputs, job.source_inputs);
  assert.equal(serialized.source_inputs_notes, job.source_inputs_notes);
  assert.equal(serialized.creative_autonomy, job.creative_autonomy);
  assert.equal(serialized.creative_autonomy_notes, job.creative_autonomy_notes);
  assert.deepEqual(serialized.language_requirements, job.language_requirements);
  assert.equal(serialized.trial_status, job.trial_status);
  assert.equal(serialized.trial_scope, job.trial_scope);
  assert.equal(serialized.trial_effort_value, job.trial_effort_value);
  assert.equal(serialized.trial_effort_unit, job.trial_effort_unit);
  assert.equal(serialized.trial_compensation_amount, job.trial_compensation_amount);
  assert.equal(serialized.trial_compensation_currency, job.trial_compensation_currency);
  assert.equal(serialized.trial_compensation_basis, job.trial_compensation_basis);
  assert.equal(serialized.trial_work_usage, job.trial_work_usage);
  assert.equal(serialized.trial_portfolio_permission, job.trial_portfolio_permission);
  assert.equal(serialized.trial_attribution, job.trial_attribution);
  assert.equal(serialized.unpaid_trial_confirmed, null);
  assert.equal(serialized.trial_notes, job.trial_notes);
  assert.equal(serialized.start_timing, job.start_timing);
  assert.equal(serialized.start_date, job.start_date);
  assert.equal(serialized.duration_type, job.duration_type);
  assert.equal(serialized.duration_value, job.duration_value);
  assert.equal(serialized.duration_unit, job.duration_unit);
  assert.equal(serialized.engagement_end_date, null);
  assert.deepEqual(serialized.hiring_process, job.hiring_process);
  assert.equal(serialized.hiring_process_notes, job.hiring_process_notes);
  assert.deepEqual(serialized.screening_questions, job.screening_questions);
  assert.equal(serialized.employer_context_type, job.employer_context_type);
  assert.equal(serialized.application_mode, job.application_mode);
  assert.equal(serialized.external_apply_url, job.external_apply_url);
  assert.equal(serialized.deadline_at, deadline);
  assert.equal(serialized.timezone_overlap, job.timezone_overlap);
  assert.equal(serialized.how_to_apply, job.how_to_apply);
});

test("nullable collections preserve unknown versus explicitly empty state", () => {
  const mappings = [
    ["deliverables", "deliverables"],
    ["requiredSkillKeys", "required_skill_keys"],
    ["preferredSkillKeys", "preferred_skill_keys"],
    ["otherRequiredSkills", "other_required_skills"],
    ["otherPreferredSkills", "other_preferred_skills"],
    ["sourceInputs", "source_inputs"],
    ["languageRequirements", "language_requirements"],
    ["hiringProcess", "hiring_process"],
    ["screeningQuestions", "screening_questions"],
  ];

  const unknown = emptyJobPostingDomainState();
  const explicitlyEmpty = emptyJobPostingDomainState();
  for (const [stateKey] of mappings) explicitlyEmpty[stateKey] = [];

  const unknownPayload = serializeJobPostingDomain(unknown);
  const emptyPayload = serializeJobPostingDomain(explicitlyEmpty);
  for (const [, payloadKey] of mappings) {
    assert.equal(unknownPayload[payloadKey], null, `${payloadKey} should preserve unknown as null`);
    assert.deepEqual(emptyPayload[payloadKey], [], `${payloadKey} should preserve an explicit empty list`);
  }

  const hydratedUnknown = hydrateJobPostingDomain({});
  const hydratedEmpty = hydrateJobPostingDomain(
    Object.fromEntries(mappings.map(([, payloadKey]) => [payloadKey, []])),
  );
  for (const [stateKey] of mappings) {
    assert.equal(hydratedUnknown[stateKey], null, `${stateKey} should hydrate missing data as null`);
    assert.deepEqual(hydratedEmpty[stateKey], [], `${stateKey} should hydrate [] as []`);
  }
});

test("legacy listing fields are preserved outside the domain model and never inferred into V3 fields", () => {
  const hydrated = hydrateJobPostingDomain({
    category: "Editing",
    weekly_hours: "3 day turnaround",
    budget_unit: "per month",
    requirements: ["English required", "Premiere Pro"],
    languages: ["English"],
    tools: ["Premiere Pro"],
    how_to_apply: "Legacy screening prompt",
  });

  assert.equal(hydrated.deliverables, null);
  assert.equal(hydrated.requiredSkillKeys, null);
  assert.equal(hydrated.requiredSkillsNote, "");
  assert.equal(hydrated.sourceInputs, null);
  assert.equal(hydrated.languageRequirements, null);
  assert.equal(hydrated.startTiming, "");
  assert.equal(hydrated.durationType, "");
  assert.equal(hydrated.trialStatus, "");
  assert.equal(hydrated.howToApply, "Legacy screening prompt");
});

test("repeatable validation targets incomplete rows and requires sensitive-access confirmation", () => {
  const state = {
    ...emptyJobPostingDomainState(),
    deliverables: [
      { id: "d1", type: "", customType: "", quantity: "0", frequency: "", customFrequency: "", notes: "" },
    ],
    languageRequirements: [
      { id: "l1", language: "H", priority: "", proficiency: "", purposes: [], notes: "" },
    ],
    sourceInputs: [
      { type: "other", custom_label: "" },
      { type: "account_access", sensitive_access_confirmed: false },
    ],
    hiringProcess: [{ id: "s1", stage: "other", customLabel: "", notes: "" }],
    screeningQuestions: [{ id: "q1", prompt: "?", required: true, responseGuidance: "" }],
  };

  const issues = validateRepeatableDomainRows(state);
  // Language requirements are no longer a recruiter-facing Post Job control, so an
  // incomplete stored language row is preserved rather than validated as editable.
  assert.equal(issues.length, 5);
  assert.deepEqual(
    issues.map(({ field, step, target }) => ({ field, step, target })),
    [
      { field: "deliverables", step: "about", target: "job-deliverable-d1" },
      { field: "source_inputs", step: "about", target: "job-source-inputs" },
      { field: "source_inputs", step: "about", target: "job-source-inputs" },
      { field: "hiring_process", step: "applicationRequirements", target: "job-stage-s1" },
      { field: "screening_questions", step: "applicationRequirements", target: "job-question-q1" },
    ],
  );
  assert.ok(issues.some((issue) => /sensitive access/i.test(issue.message)));

  const valid = {
    ...emptyJobPostingDomainState(),
    deliverables: [validDeliverable()],
    languageRequirements: [
      {
        id: "language-valid",
        language: "Hindi",
        priority: "required",
        proficiency: "professional",
        purposes: ["content_understanding"],
        notes: "",
      },
    ],
    sourceInputs: [
      { type: "other", custom_label: "Episode archive" },
      { type: "account_access", sensitive_access_confirmed: true },
    ],
    hiringProcess: [{ id: "stage-valid", stage: "portfolio_review", customLabel: "", notes: "" }],
    screeningQuestions: [
      { id: "question-valid", prompt: "Which sample is most relevant?", required: true, responseGuidance: "" },
    ],
  };
  assert.deepEqual(validateRepeatableDomainRows(valid), []);
});

test("role rules expose creator-specific progressive disclosure without assigning a role", () => {
  assert.deepEqual(getJobRoleRules("Short-form Video Editor").suggestedDeliverables, ["short"]);
  assert.equal(getJobRoleRules("Short-form Video Editor").family, "editing");
  assert.equal(getJobRoleRules("Voice Over Artist").showLanguages, true);
  assert.equal(getJobRoleRules("Thumbnail Designer").family, "design");
  assert.deepEqual(getJobRoleRules("Thumbnail Designer").suggestedDeliverables, ["thumbnail"]);
  assert.equal(getJobRoleRules("Scriptwriter").family, "writing");
  assert.equal(getJobRoleRules("Channel Manager").family, "management");
  assert.equal(getJobRoleRules("Channel Manager").showCreativeWorkflow, false);
  assert.equal(getJobRoleRules("Channel Manager").showSensitiveAccess, true);
  assert.equal(getJobRoleRules(undefined).family, "general");
  assert.deepEqual(getJobRoleRules(undefined).suggestedDeliverables, ["other"]);
});

test("publication rules require conditional scope, timing, trial, URL, and deadline details", () => {
  const missing = validateJobPostingDomainForPublication(emptyJobPostingDomainState(), {
    budgetUnit: "per video",
    engagementType: "fixed_term",
  });
  assert.deepEqual(
    new Set(missing.map((issue) => issue.field)),
    new Set(["deliverables", "start_timing", "duration_type", "trial_status"]),
  );

  const valid = validPublicationState();
  assert.deepEqual(
    validateJobPostingDomainForPublication(valid, {
      budgetUnit: "per video",
      engagementType: "fixed_term",
    }),
    [],
  );

  const paidTrial = {
    ...valid,
    trialStatus: "paid",
    trialScope: "",
    trialEffortValue: "",
    trialEffortUnit: "",
    trialCompensationAmount: "",
    trialCompensationCurrency: "",
    trialCompensationBasis: "",
    trialWorkUsage: "",
    trialPortfolioPermission: "",
    trialAttribution: "",
  };
  assert.deepEqual(
    new Set(
      validateJobPostingDomainForPublication(paidTrial, {
        budgetUnit: "per month",
        engagementType: "retainer",
      }).map((issue) => issue.field),
    ),
    new Set([
      "trial_scope",
      "trial_effort_value",
      "trial_work_usage",
      "trial_portfolio_permission",
      "trial_attribution",
      "trial_compensation_amount",
    ]),
  );

  const unsafeUnpaid = {
    ...valid,
    trialStatus: "unpaid",
    trialScope: "One supplied-footage sample",
    trialEffortValue: "1",
    trialEffortUnit: "hours",
    trialWorkUsage: "evaluation_only",
    trialPortfolioPermission: "allowed",
    trialAttribution: "not_applicable",
    unpaidTrialConfirmed: false,
  };
  assert.ok(
    validateJobPostingDomainForPublication(unsafeUnpaid, {
      budgetUnit: "per project",
      engagementType: "one_time_project",
    }).some((issue) => issue.field === "unpaid_trial_confirmed"),
  );

  const externalPastDeadline = {
    ...valid,
    applicationMode: "external",
    externalApplyUrl: "example.test/apply",
    deadlineAt: "2000-01-01T00:00",
  };
  const externalIssues = validateJobPostingDomainForPublication(externalPastDeadline, {
    budgetUnit: "per month",
    engagementType: "retainer",
  });
  assert.ok(externalIssues.some((issue) => issue.field === "external_apply_url"));
  assert.ok(externalIssues.some((issue) => issue.field === "deadline_at"));
});

test("backend validation fields route to the step that owns the candidate-facing control", () => {
  const routes = {
    title: "basics",
    primary_role_id: "basics",
    employer_context_type: "basics",
    deliverables: "about",
    source_inputs: "about",
    responsibilities: "about",
    content_niches: "creatorContext",
    content_genres: "creatorContext",
    formats_hired_for: "creatorContext",
    tags: "toolsTags",
    required_skill_keys: "toolsTags",
    required_tool_keys: "toolsTags",
    compensation_mode: "basics",
    engagement_type: "details",
    timezone_overlap: "details",
    trial_status: "applicationRequirements",
    screening_questions: "applicationRequirements",
    application_requirements: "applicationRequirements",
    how_to_apply: "applicationRequirements",
    reference_videos: "referenceVideos",
  };
  for (const [field, step] of Object.entries(routes)) {
    assert.equal(backendJobFieldStep(field), step, `${field} should route to ${step}`);
  }
  assert.equal(backendJobFieldStep("unknown_future_field"), "referenceVideos");
});

test("deadline hydration uses local datetime input semantics and serializes back to UTC", () => {
  const utc = "2035-11-20T18:45:00.000Z";
  const parsed = new Date(utc);
  const local = new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
  const hydrated = hydrateJobPostingDomain({ deadline_at: utc });
  assert.equal(hydrated.deadlineAt, local);
  assert.equal(serializeJobPostingDomain(hydrated).deadline_at, utc);

  const invalid = hydrateJobPostingDomain({ deadline_at: "not-a-date" });
  assert.equal(invalid.deadlineAt, "");
  assert.equal(serializeJobPostingDomain(invalid).deadline_at, null);
});

test("conditional serialization hides inactive values without mutating retained form state", () => {
  const state = {
    ...emptyJobPostingDomainState(),
    deliverables: [
      {
        id: "d-hidden",
        type: "short",
        customType: "Retained custom type",
        quantity: "2",
        frequency: "per_week",
        customFrequency: "Retained custom frequency",
        notes: "",
      },
    ],
    revisionPolicy: "negotiable",
    revisionRounds: "7",
    trialStatus: "none",
    trialScope: "Retained trial scope",
    trialEffortValue: "3",
    trialEffortUnit: "hours",
    trialCompensationAmount: "5000",
    trialCompensationCurrency: "usd",
    trialCompensationBasis: "flat",
    trialWorkUsage: "may_publish",
    trialPortfolioPermission: "allowed",
    trialAttribution: "credited",
    unpaidTrialConfirmed: true,
    trialNotes: "Retained trial note",
    startTiming: "flexible",
    startDate: "2030-02-03",
    durationType: "ongoing",
    durationValue: "8",
    durationUnit: "months",
    engagementEndDate: "2031-02-03",
    applicationMode: "internal",
    externalApplyUrl: "https://example.test/retained",
  };
  const before = structuredClone(state);
  const payload = serializeJobPostingDomain(state);

  assert.equal(payload.deliverables[0].custom_type, null);
  assert.equal(payload.deliverables[0].custom_frequency, null);
  assert.equal(payload.revision_rounds, null);
  assert.equal(payload.trial_scope, null);
  assert.equal(payload.trial_effort_value, null);
  assert.equal(payload.trial_compensation_amount, null);
  assert.equal(payload.trial_compensation_currency, null);
  assert.equal(payload.trial_work_usage, null);
  assert.equal(payload.unpaid_trial_confirmed, null);
  assert.equal(payload.start_date, null);
  assert.equal(payload.duration_value, null);
  assert.equal(payload.duration_unit, null);
  assert.equal(payload.engagement_end_date, null);
  assert.equal(payload.external_apply_url, null);
  assert.deepEqual(state, before, "serialization must not clear hidden form state");
});
