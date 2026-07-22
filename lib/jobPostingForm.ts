import type { BackendCreateJobPayload, BackendJob } from "./backendClient";
import {
  CREATOR_SKILL_KEYS,
  DELIVERABLE_FREQUENCIES,
  DELIVERABLE_TYPES,
  HIRING_PROCESS_STAGES,
  LANGUAGE_PURPOSES,
  SOURCE_INPUT_TYPES,
  type CreativeAutonomy,
  type CreatorSkillKey,
  type DeliverableFrequency,
  type DeliverableType,
  type EmployerContextType,
  type EngagementDurationType,
  type EngagementDurationUnit,
  type HiringProcessStageType,
  type JobHiringProcessStage,
  type JobLanguageRequirement,
  type JobScreeningQuestion,
  type JobSourceInput,
  type LanguagePriority,
  type LanguageProficiency,
  type LanguagePurpose,
  type RevisionPolicy,
  type StartTiming,
  type TrialAttribution,
  type TrialCompensationBasis,
  type TrialEffortUnit,
  type TrialPortfolioPermission,
  type TrialStatus,
  type TrialWorkUsage,
} from "./jobContract";

export type RecruiterJobStep =
  | "basics"
  | "about"
  | "creatorContext"
  | "toolsTags"
  | "details"
  | "applicationRequirements"
  | "referenceVideos";

export const RECRUITER_JOB_STEPS: Array<{
  id: RecruiterJobStep;
  label: string;
  shortLabel: string;
}> = [
  { id: "basics", label: "Role, context & pay", shortLabel: "Role" },
  { id: "about", label: "Work & deliverables", shortLabel: "Work" },
  { id: "creatorContext", label: "Creator context", shortLabel: "Context" },
  { id: "toolsTags", label: "Skills & workflow", shortLabel: "Fit" },
  { id: "details", label: "Working arrangement", shortLabel: "Timing" },
  { id: "applicationRequirements", label: "Trial & application", shortLabel: "Apply" },
  { id: "referenceVideos", label: "References & review", shortLabel: "Review" },
];

export type EditableDeliverable = {
  id: string;
  type: DeliverableType | "";
  customType: string;
  quantity: string;
  frequency: DeliverableFrequency | "";
  customFrequency: string;
  notes: string;
};

export type EditableLanguageRequirement = {
  id: string;
  language: string;
  priority: LanguagePriority | "";
  proficiency: LanguageProficiency | "";
  purposes: LanguagePurpose[];
  notes: string;
};

export type EditableHiringStage = {
  id: string;
  stage: HiringProcessStageType | "";
  customLabel: string;
  notes: string;
};

export type EditableScreeningQuestion = {
  id: string;
  prompt: string;
  required: boolean;
  responseGuidance: string;
};

export type JobPostingDomainState = {
  deliverables: EditableDeliverable[] | null;
  requiredSkillKeys: CreatorSkillKey[] | null;
  preferredSkillKeys: CreatorSkillKey[] | null;
  otherRequiredSkills: string[] | null;
  otherPreferredSkills: string[] | null;
  requiredSkillsNote: string;
  preferredSkillsNote: string;
  revisionPolicy: RevisionPolicy | "";
  revisionRounds: string;
  revisionNotes: string;
  sourceInputs: JobSourceInput[] | null;
  sourceInputsNotes: string;
  creativeAutonomy: CreativeAutonomy | "";
  creativeAutonomyNotes: string;
  languageRequirements: EditableLanguageRequirement[] | null;
  trialStatus: TrialStatus | "";
  trialScope: string;
  trialEffortValue: string;
  trialEffortUnit: TrialEffortUnit | "";
  trialCompensationAmount: string;
  trialCompensationCurrency: string;
  trialCompensationBasis: TrialCompensationBasis | "";
  trialWorkUsage: TrialWorkUsage | "";
  trialPortfolioPermission: TrialPortfolioPermission | "";
  trialAttribution: TrialAttribution | "";
  unpaidTrialConfirmed: boolean;
  trialNotes: string;
  startTiming: StartTiming | "";
  startDate: string;
  durationType: EngagementDurationType | "";
  durationValue: string;
  durationUnit: EngagementDurationUnit | "";
  engagementEndDate: string;
  hiringProcess: EditableHiringStage[] | null;
  hiringProcessNotes: string;
  screeningQuestions: EditableScreeningQuestion[] | null;
  employerContextType: EmployerContextType | "";
  applicationMode: "internal" | "external";
  externalApplyUrl: string;
  deadlineAt: string;
  timezoneOverlap: string;
  howToApply: string;
};

const rowId = (prefix: string, index = 0) => `${prefix}-${index}-${Math.random().toString(36).slice(2, 8)}`;

export const emptyJobPostingDomainState = (): JobPostingDomainState => ({
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

const numberText = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return value.trim();
  return "";
};

const localDateTime = (value: unknown) => {
  if (typeof value !== "string" || !value.trim()) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  const local = new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
};

export function hydrateJobPostingDomain(job: BackendJob): JobPostingDomainState {
  const base = emptyJobPostingDomainState();
  return {
    ...base,
    deliverables:
      job.deliverables == null
        ? null
        : job.deliverables.map((item, index) => ({
            id: rowId("deliverable", index),
            type: item.type,
            customType: item.custom_type || "",
            quantity: numberText(item.quantity),
            frequency: item.frequency,
            customFrequency: item.custom_frequency || "",
            notes: item.notes || "",
          })),
    requiredSkillKeys: job.required_skill_keys == null ? null : [...job.required_skill_keys] as CreatorSkillKey[],
    preferredSkillKeys: job.preferred_skill_keys == null ? null : [...job.preferred_skill_keys] as CreatorSkillKey[],
    otherRequiredSkills: job.other_required_skills == null ? null : [...job.other_required_skills],
    otherPreferredSkills: job.other_preferred_skills == null ? null : [...job.other_preferred_skills],
    requiredSkillsNote: job.required_skills_note || "",
    preferredSkillsNote: job.preferred_skills_note || "",
    revisionPolicy: job.revision_policy || "",
    revisionRounds: numberText(job.revision_rounds),
    revisionNotes: job.revision_notes || "",
    sourceInputs: job.source_inputs == null ? null : job.source_inputs.map((item) => ({ ...item })),
    sourceInputsNotes: job.source_inputs_notes || "",
    creativeAutonomy: job.creative_autonomy || "",
    creativeAutonomyNotes: job.creative_autonomy_notes || "",
    languageRequirements:
      job.language_requirements == null
        ? null
        : job.language_requirements.map((item, index) => ({
            id: rowId("language", index),
            language: item.language,
            priority: item.priority,
            proficiency: item.proficiency || "",
            purposes: [...item.purposes],
            notes: item.notes || "",
          })),
    trialStatus: job.trial_status || "",
    trialScope: job.trial_scope || "",
    trialEffortValue: numberText(job.trial_effort_value),
    trialEffortUnit: job.trial_effort_unit || "",
    trialCompensationAmount: numberText(job.trial_compensation_amount),
    trialCompensationCurrency: job.trial_compensation_currency || "",
    trialCompensationBasis: job.trial_compensation_basis || "",
    trialWorkUsage: job.trial_work_usage || "",
    trialPortfolioPermission: job.trial_portfolio_permission || "",
    trialAttribution: job.trial_attribution || "",
    unpaidTrialConfirmed: job.unpaid_trial_confirmed === true,
    trialNotes: job.trial_notes || "",
    startTiming: job.start_timing || "",
    startDate: typeof job.start_date === "string" ? job.start_date.slice(0, 10) : "",
    durationType: job.duration_type || "",
    durationValue: numberText(job.duration_value),
    durationUnit: job.duration_unit || "",
    engagementEndDate:
      typeof job.engagement_end_date === "string" ? job.engagement_end_date.slice(0, 10) : "",
    hiringProcess:
      job.hiring_process == null
        ? null
        : job.hiring_process.map((item, index) => ({
            id: rowId("stage", index),
            stage: item.stage,
            customLabel: item.custom_label || "",
            notes: item.notes || "",
          })),
    hiringProcessNotes: job.hiring_process_notes || "",
    screeningQuestions:
      job.screening_questions == null
        ? null
        : job.screening_questions.map((item, index) => ({
            id: rowId("question", index),
            prompt: item.prompt,
            required: item.required,
            responseGuidance: item.response_guidance || "",
          })),
    employerContextType: job.employer_context_type || "",
    applicationMode: job.application_mode === "external" ? "external" : "internal",
    externalApplyUrl: job.external_apply_url || "",
    deadlineAt: localDateTime(job.deadline_at),
    timezoneOverlap: job.timezone_overlap || "",
    howToApply: job.how_to_apply || "",
  };
}

const finitePositive = (value: string) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const optionalText = (value: string) => value.trim() || null;

const isoDeadline = (value: string) => {
  if (!value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

export function serializeJobPostingDomain(state: JobPostingDomainState): Partial<BackendCreateJobPayload> {
  const deliverables =
    state.deliverables == null
      ? null
      : state.deliverables.map((item) => ({
          type: item.type as DeliverableType,
          custom_type: item.type === "other" ? optionalText(item.customType) : null,
          quantity: finitePositive(item.quantity) || 0,
          frequency: item.frequency as DeliverableFrequency,
          custom_frequency: item.frequency === "other" ? optionalText(item.customFrequency) : null,
          notes: optionalText(item.notes),
        }));
  const languageRequirements: JobLanguageRequirement[] | null =
    state.languageRequirements == null
      ? null
      : state.languageRequirements.map((item) => ({
          language: item.language.trim(),
          priority: item.priority as LanguagePriority,
          proficiency: item.proficiency || null,
          purposes: [...item.purposes],
          notes: optionalText(item.notes),
        }));
  const hiringProcess: JobHiringProcessStage[] | null =
    state.hiringProcess == null
      ? null
      : state.hiringProcess.map((item) => ({
          stage: item.stage as HiringProcessStageType,
          custom_label: item.stage === "other" ? optionalText(item.customLabel) : null,
          notes: optionalText(item.notes),
        }));
  const screeningQuestions: JobScreeningQuestion[] | null =
    state.screeningQuestions == null
      ? null
      : state.screeningQuestions.map((item) => ({
          prompt: item.prompt.trim(),
          required: item.required,
          response_guidance: optionalText(item.responseGuidance),
        }));

  return {
    deliverables,
    required_skill_keys: state.requiredSkillKeys,
    preferred_skill_keys: state.preferredSkillKeys,
    other_required_skills: state.otherRequiredSkills,
    other_preferred_skills: state.otherPreferredSkills,
    required_skills_note: optionalText(state.requiredSkillsNote),
    preferred_skills_note: optionalText(state.preferredSkillsNote),
    revision_policy: state.revisionPolicy || null,
    revision_rounds: state.revisionPolicy === "fixed" ? finitePositive(state.revisionRounds) : null,
    revision_notes: optionalText(state.revisionNotes),
    source_inputs: state.sourceInputs,
    source_inputs_notes: optionalText(state.sourceInputsNotes),
    creative_autonomy: state.creativeAutonomy || null,
    creative_autonomy_notes: optionalText(state.creativeAutonomyNotes),
    language_requirements: languageRequirements,
    trial_status: state.trialStatus || null,
    trial_scope: state.trialStatus === "paid" || state.trialStatus === "unpaid" ? optionalText(state.trialScope) : null,
    trial_effort_value:
      state.trialStatus === "paid" || state.trialStatus === "unpaid"
        ? finitePositive(state.trialEffortValue)
        : null,
    trial_effort_unit:
      state.trialStatus === "paid" || state.trialStatus === "unpaid"
        ? state.trialEffortUnit || null
        : null,
    trial_compensation_amount:
      state.trialStatus === "paid" ? finitePositive(state.trialCompensationAmount) : null,
    trial_compensation_currency:
      state.trialStatus === "paid" ? optionalText(state.trialCompensationCurrency)?.toUpperCase() || null : null,
    trial_compensation_basis:
      state.trialStatus === "paid" ? state.trialCompensationBasis || null : null,
    trial_work_usage:
      state.trialStatus === "paid" || state.trialStatus === "unpaid"
        ? state.trialWorkUsage || null
        : null,
    trial_portfolio_permission:
      state.trialStatus === "paid" || state.trialStatus === "unpaid"
        ? state.trialPortfolioPermission || null
        : null,
    trial_attribution:
      state.trialStatus === "paid" || state.trialStatus === "unpaid"
        ? state.trialAttribution || null
        : null,
    unpaid_trial_confirmed: state.trialStatus === "unpaid" ? state.unpaidTrialConfirmed : null,
    trial_notes: state.trialStatus === "paid" || state.trialStatus === "unpaid" ? optionalText(state.trialNotes) : null,
    start_timing: state.startTiming || null,
    start_date: state.startTiming === "specific_date" ? optionalText(state.startDate) : null,
    duration_type: state.durationType || null,
    duration_value: state.durationType === "fixed_period" ? finitePositive(state.durationValue) : null,
    duration_unit: state.durationType === "fixed_period" ? state.durationUnit || null : null,
    engagement_end_date: state.durationType === "until_date" ? optionalText(state.engagementEndDate) : null,
    hiring_process: hiringProcess,
    hiring_process_notes: optionalText(state.hiringProcessNotes),
    screening_questions: screeningQuestions,
    employer_context_type: state.employerContextType || null,
    application_mode: state.applicationMode,
    external_apply_url: state.applicationMode === "external" ? optionalText(state.externalApplyUrl) : null,
    deadline_at: isoDeadline(state.deadlineAt),
    timezone_overlap: optionalText(state.timezoneOverlap),
    how_to_apply: optionalText(state.howToApply),
  };
}

export type JobPostingIssue = {
  field: keyof BackendCreateJobPayload | string;
  step: RecruiterJobStep;
  message: string;
  target?: string;
};

export function validateRepeatableDomainRows(state: JobPostingDomainState): JobPostingIssue[] {
  const issues: JobPostingIssue[] = [];
  state.deliverables?.forEach((item, index) => {
    if (!item.type || !finitePositive(item.quantity) || !item.frequency) {
      issues.push({
        field: "deliverables",
        step: "about",
        target: `job-deliverable-${item.id}`,
        message: `Finish deliverable ${index + 1} or remove it.`,
      });
    } else if (item.type === "other" && !item.customType.trim()) {
      issues.push({ field: "deliverables", step: "about", target: `job-deliverable-${item.id}`, message: "Name the custom deliverable." });
    } else if (item.frequency === "other" && !item.customFrequency.trim()) {
      issues.push({ field: "deliverables", step: "about", target: `job-deliverable-${item.id}`, message: "Describe the custom frequency." });
    }
  });
  state.languageRequirements?.forEach((item, index) => {
    if (item.language.trim().length < 2 || !item.priority || !item.purposes.length) {
      issues.push({
        field: "language_requirements",
        step: "toolsTags",
        target: `job-language-${item.id}`,
        message: `Finish language requirement ${index + 1} or remove it.`,
      });
    }
  });
  state.sourceInputs?.forEach((item) => {
    if (item.type === "other" && !item.custom_label?.trim()) {
      issues.push({
        field: "source_inputs",
        step: "about",
        target: "job-source-inputs",
        message: "Name the other source material or remove it.",
      });
    }
    if (
      (item.type === "analytics_access" || item.type === "account_access") &&
      item.sensitive_access_confirmed !== true
    ) {
      issues.push({
        field: "source_inputs",
        step: "about",
        target: "job-source-inputs",
        message: "Explicitly confirm the sensitive access requirement.",
      });
    }
  });
  state.hiringProcess?.forEach((item, index) => {
    if (!item.stage || (item.stage === "other" && !item.customLabel.trim())) {
      issues.push({
        field: "hiring_process",
        step: "applicationRequirements",
        target: `job-stage-${item.id}`,
        message: `Finish hiring stage ${index + 1} or remove it.`,
      });
    }
  });
  state.screeningQuestions?.forEach((item, index) => {
    if (item.prompt.trim().length < 3) {
      issues.push({
        field: "screening_questions",
        step: "applicationRequirements",
        target: `job-question-${item.id}`,
        message: `Finish screening question ${index + 1} or remove it.`,
      });
    }
  });
  return issues;
}

const OUTPUT_BASED_COMPENSATION_UNITS = new Set([
  "per deliverable",
  "per video",
  "per short",
  "per thumbnail",
  "per script",
  "per episode",
  "per post",
]);

export function validateJobPostingDomainForPublication(
  state: JobPostingDomainState,
  context: { budgetUnit: string; engagementType: string }
): JobPostingIssue[] {
  const issues = validateRepeatableDomainRows(state);
  const push = (field: keyof BackendCreateJobPayload, step: RecruiterJobStep, message: string) =>
    issues.push({ field, step, target: `job-${String(field).replaceAll("_", "-")}`, message });

  if (OUTPUT_BASED_COMPENSATION_UNITS.has(context.budgetUnit) && !state.deliverables?.length) {
    push("deliverables", "about", "Add the output volume that this compensation covers.");
  }
  if (
    state.sourceInputs?.some((item) => item.type === "analytics_access" || item.type === "account_access") &&
    state.sourceInputsNotes.trim().length < 10
  ) {
    push("source_inputs_notes", "about", "Explain why sensitive access is needed and when it will be granted.");
  }
  if (state.revisionPolicy === "fixed" && !finitePositive(state.revisionRounds)) {
    push("revision_rounds", "about", "Add the number of included revision rounds.");
  }
  if (!state.startTiming) {
    push("start_timing", "details", "Choose when you want the collaboration to start.");
  } else if (state.startTiming === "specific_date" && !state.startDate) {
    push("start_date", "details", "Add the specific start date.");
  } else if (state.startTiming === "specific_date" && state.startDate) {
    const today = new Date();
    const localToday = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    if (state.startDate < localToday) push("start_date", "details", "Choose today or a future start date.");
  }
  if (state.durationType === "fixed_period" && (!finitePositive(state.durationValue) || !state.durationUnit)) {
    push("duration_value", "details", "Complete the fixed engagement duration.");
  }
  if (state.durationType === "until_date" && !state.engagementEndDate) {
    push("engagement_end_date", "details", "Add the engagement end date.");
  } else if (
    state.durationType === "until_date" &&
    state.startDate &&
    state.engagementEndDate &&
    state.engagementEndDate <= state.startDate
  ) {
    push("engagement_end_date", "details", "The end date must be after the start date.");
  }
  if (context.engagementType === "fixed_term" && !["fixed_period", "until_date"].includes(state.durationType)) {
    push("duration_type", "details", "Fixed-term work needs a fixed period or end date.");
  }
  if (!state.trialStatus) {
    push("trial_status", "applicationRequirements", "Say whether the hiring process includes a trial.");
  }
  if (state.trialStatus === "paid" || state.trialStatus === "unpaid") {
    if (!state.trialScope.trim()) push("trial_scope", "applicationRequirements", "Describe the trial scope.");
    if (!finitePositive(state.trialEffortValue) || !state.trialEffortUnit) {
      push("trial_effort_value", "applicationRequirements", "Add the expected trial effort.");
    }
    if (!state.trialWorkUsage) push("trial_work_usage", "applicationRequirements", "State how the trial output may be used.");
    if (!state.trialPortfolioPermission) push("trial_portfolio_permission", "applicationRequirements", "State whether the candidate may show the trial in a portfolio.");
    if (!state.trialAttribution) push("trial_attribution", "applicationRequirements", "State the attribution terms.");
  }
  if (state.trialStatus === "paid") {
    if (!finitePositive(state.trialCompensationAmount) || !state.trialCompensationCurrency.trim() || !state.trialCompensationBasis) {
      push("trial_compensation_amount", "applicationRequirements", "Complete the paid-trial compensation.");
    }
  }
  if (state.trialStatus === "unpaid" && !state.unpaidTrialConfirmed) {
    push("unpaid_trial_confirmed", "applicationRequirements", "Explicitly confirm that this is an unpaid trial.");
  }
  const hiringStages = new Set((state.hiringProcess || []).map((item) => item.stage));
  if (hiringStages.has("paid_trial") && state.trialStatus !== "paid") {
    push("hiring_process", "applicationRequirements", "A paid-trial stage needs paid trial terms.");
  }
  if (hiringStages.has("unpaid_trial") && state.trialStatus !== "unpaid") {
    push("hiring_process", "applicationRequirements", "An unpaid-trial stage needs unpaid trial terms.");
  }
  if (state.applicationMode === "external" && !/^https?:\/\//i.test(state.externalApplyUrl.trim())) {
    push("external_apply_url", "applicationRequirements", "Add a complete external application URL.");
  }
  if (state.deadlineAt) {
    const deadline = new Date(state.deadlineAt);
    if (Number.isNaN(deadline.getTime()) || deadline.getTime() <= Date.now()) {
      push("deadline_at", "applicationRequirements", "Choose a future application deadline.");
    }
  }
  return issues;
}

export type JobRoleFamily = "editing" | "design" | "writing" | "management" | "general";

export type JobRoleRules = {
  family: JobRoleFamily;
  showDeliverables: boolean;
  showCreativeWorkflow: boolean;
  showLanguages: boolean;
  showSensitiveAccess: boolean;
  suggestedDeliverables: DeliverableType[];
  deliverableExample: string;
  sourceHelper: string;
};

export function getJobRoleRules(roleName?: string | null): JobRoleRules {
  const role = (roleName || "").toLowerCase();
  const editing = /editor|podcast|audio|videographer|animator|ugc|voice over/.test(role);
  const design = /thumbnail|designer|illustrator|motion/.test(role);
  const writing = /writer|researcher|copywriter|newsletter/.test(role);
  const management = /manager|strategist|specialist|paid ads/.test(role);
  if (editing) {
    return {
      family: "editing",
      showDeliverables: true,
      showCreativeWorkflow: true,
      showLanguages: /voice over/.test(role),
      showSensitiveAccess: /podcast/.test(role),
      suggestedDeliverables: /short/.test(role) ? ["short"] : /podcast/.test(role) ? ["podcast_episode", "short"] : ["long_form_video", "short"],
      deliverableExample: /short/.test(role) ? "For example: 15 Shorts per week" : "For example: 4 long-form videos per month",
      sourceHelper: "Clarify what footage, scripts, references, music, or project files you will provide.",
    };
  }
  if (design) {
    return {
      family: "design",
      showDeliverables: true,
      showCreativeWorkflow: true,
      showLanguages: false,
      showSensitiveAccess: false,
      suggestedDeliverables: /thumbnail/.test(role) ? ["thumbnail"] : ["design_asset"],
      deliverableExample: /thumbnail/.test(role) ? "For example: 3 thumbnail options per video" : "Describe the design assets and delivery rhythm",
      sourceHelper: "Clarify which brand guidelines, references, thumbnail assets, or project files you will provide.",
    };
  }
  if (writing) {
    return {
      family: "writing",
      showDeliverables: true,
      showCreativeWorkflow: true,
      showLanguages: true,
      showSensitiveAccess: false,
      suggestedDeliverables: /research/.test(role) ? ["research_brief"] : ["script", "newsletter"],
      deliverableExample: /research/.test(role) ? "For example: 2 research briefs per week" : "For example: 2 scripts per week",
      sourceHelper: "Clarify which briefs, sources, references, or existing scripts you will provide.",
    };
  }
  if (management) {
    return {
      family: "management",
      showDeliverables: true,
      showCreativeWorkflow: false,
      showLanguages: false,
      showSensitiveAccess: true,
      suggestedDeliverables: ["community_post", "research_brief"],
      deliverableExample: "Add recurring outputs only when they make the workload clearer",
      sourceHelper: "If account or analytics access is needed, explain why and when it is granted.",
    };
  }
  return {
    family: "general",
    showDeliverables: true,
    showCreativeWorkflow: true,
    showLanguages: true,
    showSensitiveAccess: true,
    suggestedDeliverables: ["other"],
    deliverableExample: "Add an output only when quantity and frequency help candidates scope the work",
    sourceHelper: "State what the candidate receives from you before work begins.",
  };
}

export const skillLabel = (key: CreatorSkillKey) =>
  ({
    video_editing: "Video editing",
    short_form_editing: "Short-form editing",
    storytelling: "Storytelling",
    motion_graphics: "Motion graphics",
    color_grading: "Color grading",
    audio_editing: "Audio editing",
    thumbnail_design: "Thumbnail design",
    graphic_design: "Graphic design",
    scriptwriting: "Scriptwriting",
    copywriting: "Copywriting",
    research: "Research",
    seo: "SEO",
    channel_strategy: "Channel strategy",
    community_management: "Community management",
    project_management: "Project management",
    ugc_creation: "UGC creation",
    voice_over: "Voice over",
  })[key];

export const deliverableTypeLabel = (value: DeliverableType) =>
  ({
    long_form_video: "Long-form video",
    short: "Short / Reel",
    thumbnail: "Thumbnail",
    script: "Script",
    podcast_episode: "Podcast episode",
    community_post: "Community post",
    social_post: "Social post",
    newsletter: "Newsletter",
    livestream: "Livestream",
    audio_asset: "Audio asset",
    design_asset: "Design asset",
    research_brief: "Research brief",
    voice_over: "Voice over",
    other: "Other",
  })[value];

export const deliverableFrequencyLabel = (value: DeliverableFrequency) =>
  ({
    one_time: "One time",
    per_day: "Per day",
    per_week: "Per week",
    per_month: "Per month",
    per_video: "Per video",
    per_episode: "Per episode",
    every_two_weeks: "Every fortnight",
    ongoing: "Ongoing",
    other: "Other",
  })[value];

export const sourceInputLabel = (value: (typeof SOURCE_INPUT_TYPES)[number]) =>
  value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

export const languagePurposeLabel = (value: (typeof LANGUAGE_PURPOSES)[number]) =>
  value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

export const hiringStageLabel = (value: (typeof HIRING_PROCESS_STAGES)[number]) =>
  value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

export const JOB_SKILL_KEYS = CREATOR_SKILL_KEYS;
export const JOB_DELIVERABLE_TYPES = DELIVERABLE_TYPES;
export const JOB_DELIVERABLE_FREQUENCIES = DELIVERABLE_FREQUENCIES;
export const JOB_SOURCE_INPUT_TYPES = SOURCE_INPUT_TYPES;
export const JOB_LANGUAGE_PURPOSES = LANGUAGE_PURPOSES;
export const JOB_HIRING_STAGES = HIRING_PROCESS_STAGES;

export const backendJobFieldStep = (field: string): RecruiterJobStep => {
  if (["title", "primary_role_id", "role_specialization", "platforms", "work_mode", "location", "employer_context_type", "hiring_identity_id", "experience_level", "compensation_mode", "budget_amount", "budget_max", "budget_currency", "budget_unit", "budget_unit_custom", "budget_note"].includes(field)) return "basics";
  if (["deliverables", "revision_policy", "revision_rounds", "revision_notes", "source_inputs", "source_inputs_notes", "creative_autonomy", "creative_autonomy_notes", "about_channel", "responsibilities", "requirements"].includes(field)) return "about";
  if (["content_niches", "content_genres", "formats_hired_for"].includes(field)) return "creatorContext";
  if (["engagement_type", "expected_weekly_hours_min", "expected_weekly_hours_max", "turnaround_value", "turnaround_unit", "turnaround_basis", "start_timing", "start_date", "duration_type", "duration_value", "duration_unit", "engagement_end_date", "timezone_overlap"].includes(field)) return "details";
  if (["required_skill_keys", "preferred_skill_keys", "other_required_skills", "other_preferred_skills", "required_skills_note", "preferred_skills_note", "required_tool_keys", "other_required_tools", "language_requirements", "tags"].includes(field)) return "toolsTags";
  if (["trial_status", "trial_scope", "trial_effort_value", "trial_effort_unit", "trial_compensation_amount", "trial_compensation_currency", "trial_compensation_basis", "trial_work_usage", "trial_portfolio_permission", "trial_attribution", "unpaid_trial_confirmed", "trial_notes", "hiring_process", "hiring_process_notes", "screening_questions", "deadline_at", "application_mode", "external_apply_url", "application_requirements", "how_to_apply"].includes(field)) return "applicationRequirements";
  return "referenceVideos";
};
