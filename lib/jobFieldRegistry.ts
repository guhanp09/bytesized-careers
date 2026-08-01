import type { BackendCreateJobPayload } from "./backendClient";
import type { RecruiterJobScreen, RecruiterJobStep } from "./jobPostingForm";

/**
 * Field-completeness safeguard for the recruiter Post Job flow.
 *
 * Every writable version-3 job field on {@link BackendCreateJobPayload} must be
 * represented in the flow by at least one of the recognised representations
 * below. This registry is the single source of truth for *how* each field
 * reaches the recruiter, and `tests/jobFieldCompleteness.test.mjs` fails if a
 * future redesign drops a field, mis-routes a publication blocker, or lets the
 * registry drift from the backend payload contract.
 *
 * The registry is intentionally declarative and free of React so it can be
 * imported by both the wizard and the test without pulling in UI modules.
 */

export type FieldRepresentation =
  /** Always-visible recruiter input within its step. */
  | "control"
  /** Input revealed only when a prior choice makes it relevant (progressive disclosure). */
  | "conditional-control"
  /** Value deterministically derived from other confirmed recruiter inputs. */
  | "derived"
  /** Consequential value that always requires an explicit recruiter confirmation. */
  | "confirmation"
  /** Only surfaced/editable for legacy listings; untouched values are preserved verbatim. */
  | "legacy-preserved"
  /** Set by CreatorJobs from verified profile/identity data; recruiters never type it. */
  | "system-owned";

export type FieldRequirement =
  /** Blocks publication until satisfied. */
  | "publish"
  /** Blocks leaving its owning step until satisfied. */
  | "step"
  /** Improves listing quality; never blocks. */
  | "recommended"
  /** Purely optional. */
  | "optional"
  /** Owned by the system / listing lifecycle, not a recruiter decision. */
  | "system";

export type JobFieldEntry = {
  /** Recruiter-facing description of the decision (never a raw backend enum). */
  label: string;
  /** Owning wizard step. Omitted only for system-owned/meta fields with no step. */
  step?: RecruiterJobStep;
  representation: FieldRepresentation;
  requirement: FieldRequirement;
  /** True when the value can be prefilled from existing CreatorJobs data. */
  prefillable?: boolean;
  /** Focus/scroll target id used for quality jumps and backend-error routing. */
  target?: string;
  /** Short note on visibility, derivation, or confirmation semantics. */
  note?: string;
};

/**
 * Exhaustive by construction: `Record<keyof BackendCreateJobPayload, …>` makes
 * `tsc` fail the moment a writable field is added to the payload without being
 * classified here.
 */
export const JOB_FIELD_REGISTRY: Record<keyof BackendCreateJobPayload, JobFieldEntry> = {
  // ── Step 1 · Role, context & pay (basics) ─────────────────────────────────
  title: {
    label: "Job title",
    step: "basics",
    representation: "control",
    requirement: "step",
    target: "job-title",
  },
  primary_role_id: {
    label: "Creator role",
    step: "basics",
    representation: "control",
    requirement: "step",
    target: "job-primary-role",
  },
  role_specialization: {
    label: "Role specialization",
    step: "basics",
    representation: "conditional-control",
    requirement: "step",
    target: "job-role-specialization",
    note: "Shown only when the chosen role is 'Other Creator Role'.",
  },
  employer_context_type: {
    label: "Public hiring context",
    step: "basics",
    representation: "control",
    requirement: "recommended",
    note: "Who the candidate will be working for, from the recruiter's point of view.",
  },
  hiring_identity_id: {
    label: "Authorized hiring identity",
    step: "basics",
    representation: "confirmation",
    requirement: "publish",
    prefillable: true,
    note: "Recruiter selects a verified/represented identity; consequential authorization, never inferred.",
  },
  platforms: {
    label: "Platform(s) this hire is for",
    step: "basics",
    representation: "control",
    requirement: "step",
    prefillable: true,
    target: "job-platform",
    note: "Prefilled from the selected hiring identity's platform when available.",
  },
  work_mode: {
    label: "Work mode",
    step: "details",
    representation: "control",
    requirement: "step",
    target: "job-work-mode",
    note: "A working-arrangement decision — asked with collaboration, not with the role.",
  },
  location: {
    label: "Location / city",
    step: "details",
    representation: "conditional-control",
    requirement: "step",
    target: "job-location",
    note: "City input shown and required for Hybrid/On-site; 'Remote' is derived for remote work.",
  },
  compensation_mode: {
    label: "Compensation basis",
    step: "basics",
    representation: "control",
    requirement: "step",
    target: "job-budget",
  },
  budget_amount: {
    label: "Compensation amount",
    step: "basics",
    representation: "control",
    requirement: "step",
    target: "job-budget",
    note: "Consequential — never inferred; recruiter enters it explicitly.",
  },
  budget_max: {
    label: "Compensation maximum",
    step: "basics",
    representation: "conditional-control",
    requirement: "step",
    target: "job-budget",
    note: "Shown only for range compensation mode.",
  },
  budget_currency: {
    label: "Currency",
    step: "basics",
    representation: "control",
    requirement: "recommended",
  },
  budget_unit: {
    label: "Compensation unit",
    step: "basics",
    representation: "control",
    requirement: "recommended",
  },
  budget_unit_custom: {
    label: "Custom compensation unit",
    step: "basics",
    representation: "conditional-control",
    requirement: "step",
    note: "Shown only when the compensation unit is 'custom'.",
  },
  budget_note: {
    label: "Compensation note",
    step: "basics",
    representation: "control",
    requirement: "optional",
    note: "Free text; also derived from a 'Flexible' / 'Contact for pricing' intent when not typed.",
  },
  experience_level: {
    label: "Experience expectation",
    step: "basics",
    representation: "derived",
    requirement: "optional",
    target: "job-experience",
    note: "Derived from the selected experience range.",
  },

  // ── Step 2 · Work & deliverables (about) ──────────────────────────────────
  about_channel: {
    label: "About the brand / channel",
    step: "about",
    representation: "control",
    requirement: "step",
    target: "job-description",
  },
  responsibilities: {
    label: "Responsibilities",
    step: "about",
    representation: "control",
    requirement: "recommended",
    target: "job-responsibilities",
  },
  requirements: {
    label: "Requirements (free text)",
    step: "about",
    representation: "legacy-preserved",
    requirement: "optional",
    target: "job-requirements",
    note: "Legacy free-text requirements kept alongside structured skills; preserved verbatim.",
  },
  deliverables: {
    label: "What they will produce",
    step: "about",
    representation: "control",
    requirement: "publish",
    target: "job-deliverables",
    note: "Repeatable rows; required when compensation is output-based. Role-aware suggestions offered.",
  },
  revision_policy: {
    label: "Revision policy",
    step: "about",
    representation: "control",
    requirement: "publish",
    note: "'Fixed' gates the revision-round count.",
  },
  revision_rounds: {
    label: "Included revision rounds",
    step: "about",
    representation: "conditional-control",
    requirement: "publish",
    note: "Shown and required only for a fixed revision policy.",
  },
  revision_notes: {
    label: "Revision notes",
    step: "about",
    representation: "control",
    requirement: "optional",
  },
  source_inputs: {
    label: "What you will provide",
    step: "about",
    representation: "control",
    requirement: "publish",
    target: "job-source-inputs",
    note: "Repeatable; account/analytics access requires an explicit sensitive-access confirmation.",
  },
  source_inputs_notes: {
    label: "Source inputs / sensitive access notes",
    step: "about",
    representation: "conditional-control",
    requirement: "publish",
    note: "Required to explain sensitive access when account/analytics access is requested.",
  },
  creative_autonomy: {
    label: "Creative freedom",
    step: "about",
    representation: "control",
    requirement: "optional",
  },
  creative_autonomy_notes: {
    label: "Creative freedom notes",
    step: "about",
    representation: "control",
    requirement: "optional",
  },

  // ── Step 3 · Creator context (creatorContext) ─────────────────────────────
  content_niches: {
    label: "Content niches",
    step: "creatorContext",
    representation: "control",
    requirement: "recommended",
    target: "job-content-niches",
  },
  content_genres: {
    label: "Content genres",
    step: "creatorContext",
    representation: "control",
    requirement: "recommended",
    target: "job-content-genres",
  },
  formats_hired_for: {
    label: "Formats hired for",
    step: "creatorContext",
    representation: "control",
    requirement: "recommended",
    target: "job-formats-hired-for",
  },

  // ── Step 4 · Skills & workflow (toolsTags) ────────────────────────────────
  required_skill_keys: {
    label: "Must-have skills",
    step: "toolsTags",
    representation: "control",
    requirement: "recommended",
    note: "Role-aware suggestions offered; separated from preferred skills.",
  },
  preferred_skill_keys: {
    label: "Nice-to-have skills",
    step: "toolsTags",
    representation: "control",
    requirement: "optional",
  },
  other_required_skills: {
    label: "Other must-have skills",
    step: "toolsTags",
    representation: "control",
    requirement: "optional",
  },
  other_preferred_skills: {
    label: "Other nice-to-have skills",
    step: "toolsTags",
    representation: "control",
    requirement: "optional",
  },
  required_skills_note: {
    label: "Must-have skills note",
    step: "toolsTags",
    representation: "control",
    requirement: "optional",
  },
  preferred_skills_note: {
    label: "Nice-to-have skills note",
    step: "toolsTags",
    representation: "control",
    requirement: "optional",
  },
  required_tool_keys: {
    label: "Required tools",
    step: "toolsTags",
    representation: "control",
    requirement: "optional",
    target: "job-tools",
    note: "Confirmed structured tools; only written after the recruiter confirms the tool list.",
  },
  other_required_tools: {
    label: "Custom required tools",
    step: "toolsTags",
    representation: "control",
    requirement: "optional",
    target: "job-tools",
  },
  tools: {
    label: "Tools (free text)",
    step: "toolsTags",
    representation: "legacy-preserved",
    requirement: "optional",
    target: "job-tools",
    note: "Legacy free-text tool tags superseded by required_tool_keys; preserved verbatim.",
  },
  language_requirements: {
    label: "Language requirements (preserved)",
    representation: "legacy-preserved",
    requirement: "system",
    note: "No longer a recruiter control in Post Job. Stored values still hydrate, serialize on untouched update, and display in preview/candidate detail for existing jobs — they are never re-entered.",
  },
  languages: {
    label: "Languages (free text, preserved)",
    representation: "legacy-preserved",
    requirement: "system",
    note: "Legacy free-text languages; preserved verbatim, not a recruiter control in Post Job.",
  },
  tags: {
    label: "Search tags",
    step: "toolsTags",
    representation: "control",
    requirement: "recommended",
    target: "job-tags",
  },

  // ── Step 5 · Working arrangement (details) ────────────────────────────────
  engagement_type: {
    label: "Engagement type",
    step: "details",
    representation: "control",
    requirement: "publish",
    note: "'Fixed-term' requires a duration or end date.",
  },
  expected_weekly_hours_min: {
    label: "Expected weekly hours (min)",
    step: "details",
    representation: "conditional-control",
    requirement: "optional",
    note: "Surfaced for time-based engagements.",
  },
  expected_weekly_hours_max: {
    label: "Expected weekly hours (max)",
    step: "details",
    representation: "conditional-control",
    requirement: "optional",
    note: "Surfaced for time-based engagements.",
  },
  turnaround_value: {
    label: "Turnaround value",
    step: "details",
    representation: "conditional-control",
    requirement: "optional",
    note: "Emphasised for project/output/ongoing work.",
  },
  turnaround_unit: {
    label: "Turnaround unit",
    step: "details",
    representation: "conditional-control",
    requirement: "optional",
  },
  turnaround_basis: {
    label: "Turnaround basis",
    step: "details",
    representation: "conditional-control",
    requirement: "optional",
  },
  timezone_overlap: {
    label: "Timezone overlap",
    step: "details",
    representation: "control",
    requirement: "optional",
    note: "Relevant when live collaboration is expected.",
  },
  start_timing: {
    label: "Start timing",
    step: "details",
    representation: "control",
    requirement: "publish",
    target: "job-start-timing",
  },
  start_date: {
    label: "Specific start date",
    step: "details",
    representation: "conditional-control",
    requirement: "publish",
    note: "Shown and required only for a specific-date start.",
  },
  duration_type: {
    label: "Engagement duration type",
    step: "details",
    representation: "control",
    requirement: "publish",
    note: "Required for fixed-term engagements.",
  },
  duration_value: {
    label: "Fixed duration value",
    step: "details",
    representation: "conditional-control",
    requirement: "publish",
    note: "Shown and required only for a fixed-period duration.",
  },
  duration_unit: {
    label: "Fixed duration unit",
    step: "details",
    representation: "conditional-control",
    requirement: "publish",
    note: "Shown and required only for a fixed-period duration.",
  },
  engagement_end_date: {
    label: "Engagement end date",
    step: "details",
    representation: "conditional-control",
    requirement: "publish",
    note: "Shown and required only for an until-date duration.",
  },
  start_timeframe: {
    label: "Earlier start window",
    step: "details",
    representation: "legacy-preserved",
    requirement: "optional",
    note: "Legacy start window superseded by start_timing; surfaced read-only on old listings.",
  },
  weekly_hours: {
    label: "Earlier weekly-hours note",
    step: "details",
    representation: "legacy-preserved",
    requirement: "system",
    note: "Legacy free-text weekly hours superseded by expected_weekly_hours_min/max.",
  },
  contract_type: {
    label: "Earlier contract description",
    step: "details",
    representation: "legacy-preserved",
    requirement: "system",
    note: "Legacy engagement descriptor superseded by engagement_type.",
  },

  // ── Step 6 · Trial & application (applicationRequirements) ────────────────
  trial_status: {
    label: "Trial in the hiring process?",
    step: "applicationRequirements",
    representation: "control",
    requirement: "publish",
    target: "job-trial-status",
  },
  trial_scope: {
    label: "Trial scope",
    step: "applicationRequirements",
    representation: "conditional-control",
    requirement: "publish",
    note: "Shown and required only when a paid/unpaid trial is selected.",
  },
  trial_effort_value: {
    label: "Trial effort",
    step: "applicationRequirements",
    representation: "conditional-control",
    requirement: "publish",
    note: "Shown and required only when a paid/unpaid trial is selected.",
  },
  trial_effort_unit: {
    label: "Trial effort unit",
    step: "applicationRequirements",
    representation: "conditional-control",
    requirement: "publish",
    note: "Shown and required only when a paid/unpaid trial is selected.",
  },
  trial_compensation_amount: {
    label: "Trial compensation",
    step: "applicationRequirements",
    representation: "conditional-control",
    requirement: "publish",
    note: "Consequential — shown only for a paid trial and never inferred.",
  },
  trial_compensation_currency: {
    label: "Trial compensation currency",
    step: "applicationRequirements",
    representation: "conditional-control",
    requirement: "publish",
    note: "Shown only for a paid trial.",
  },
  trial_compensation_basis: {
    label: "Trial compensation basis",
    step: "applicationRequirements",
    representation: "conditional-control",
    requirement: "publish",
    note: "Shown only for a paid trial.",
  },
  trial_work_usage: {
    label: "Trial work usage rights",
    step: "applicationRequirements",
    representation: "conditional-control",
    requirement: "publish",
    note: "Consequential usage-rights choice; shown for paid/unpaid trials, never inferred.",
  },
  trial_portfolio_permission: {
    label: "Trial portfolio permission",
    step: "applicationRequirements",
    representation: "conditional-control",
    requirement: "publish",
    note: "Consequential permission; shown for paid/unpaid trials, never inferred.",
  },
  trial_attribution: {
    label: "Trial attribution terms",
    step: "applicationRequirements",
    representation: "conditional-control",
    requirement: "publish",
    note: "Consequential attribution terms; shown for paid/unpaid trials, never inferred.",
  },
  unpaid_trial_confirmed: {
    label: "Unpaid-trial confirmation",
    step: "applicationRequirements",
    representation: "confirmation",
    requirement: "publish",
    note: "Explicit confirmation required before an unpaid trial can be published.",
  },
  trial_notes: {
    label: "Trial notes",
    step: "applicationRequirements",
    representation: "conditional-control",
    requirement: "optional",
    note: "Shown for paid/unpaid trials.",
  },
  hiring_process: {
    label: "Hiring process stages",
    step: "applicationRequirements",
    representation: "control",
    requirement: "step",
    target: "job-stage",
    note: "Repeatable rows; role-aware stage suggestions offered.",
  },
  hiring_process_notes: {
    label: "Hiring process notes",
    step: "applicationRequirements",
    representation: "control",
    requirement: "optional",
  },
  screening_questions: {
    label: "Screening questions",
    step: "applicationRequirements",
    representation: "control",
    requirement: "step",
    target: "job-question",
    note: "Repeatable rows.",
  },
  application_mode: {
    label: "How candidates apply",
    step: "applicationRequirements",
    representation: "control",
    requirement: "step",
  },
  external_apply_url: {
    label: "External application URL",
    step: "applicationRequirements",
    representation: "conditional-control",
    requirement: "publish",
    note: "Shown and required only when applications are handled externally.",
  },
  deadline_at: {
    label: "Application deadline",
    step: "applicationRequirements",
    representation: "control",
    requirement: "optional",
    note: "Optional, but validated to be in the future when set.",
  },
  application_requirements: {
    label: "What applicants must include",
    step: "applicationRequirements",
    representation: "control",
    requirement: "recommended",
    target: "job-first-message",
  },
  how_to_apply: {
    label: "Public how-to-apply note",
    step: "applicationRequirements",
    representation: "conditional-control",
    requirement: "step",
    target: "job-first-message",
    note: "Legacy public prompt; shown when the custom-instruction requirement is chosen.",
  },

  // ── Step 7 · References & review (referenceVideos) ────────────────────────
  reference_videos: {
    label: "Reference videos",
    step: "referenceVideos",
    representation: "control",
    requirement: "optional",
    target: "job-reference-video",
  },

  // ── System-owned / derived from the verified hiring identity ──────────────
  category: {
    label: "Previous category",
    representation: "legacy-preserved",
    requirement: "system",
    note: "Legacy taxonomy superseded by primary_role_id; preserved for old listings.",
  },
  youtube_channel_id: {
    label: "YouTube channel id",
    representation: "system-owned",
    requirement: "system",
    note: "Derived from the verified YouTube hiring identity.",
  },
  channel_name: {
    label: "Channel name snapshot",
    representation: "system-owned",
    requirement: "system",
    note: "Derived from the selected hiring identity.",
  },
  channel_logo_url: {
    label: "Channel logo snapshot",
    representation: "system-owned",
    requirement: "system",
    note: "Derived from the selected hiring identity.",
  },
  channel_subscribers: {
    label: "Channel subscribers snapshot",
    representation: "system-owned",
    requirement: "system",
    note: "Derived from the verified identity's audience.",
  },
  channel_profile_slug: {
    label: "Channel profile slug",
    representation: "system-owned",
    requirement: "system",
    note: "Derived from the selected hiring identity.",
  },
  hiring_external_url_snapshot: {
    label: "Hiring identity URL snapshot",
    representation: "system-owned",
    requirement: "system",
    note: "Derived from the selected hiring identity.",
  },
  posted_by_agency: {
    label: "Posted-by-agency flag",
    representation: "system-owned",
    requirement: "system",
    note: "Derived from a represented-creator hiring identity.",
  },
  agency_profile_slug: {
    label: "Agency profile slug",
    representation: "system-owned",
    requirement: "system",
    note: "Derived from the represented-creator relationship.",
  },
  posted_platform: {
    label: "Posted platform snapshot",
    representation: "system-owned",
    requirement: "system",
    note: "Derived from the selected platform / hiring identity.",
  },
  posted_youtube_channel_id: {
    label: "Posted YouTube channel id",
    representation: "system-owned",
    requirement: "system",
    note: "Derived from the verified YouTube hiring identity.",
  },
  status: {
    label: "Listing lifecycle status",
    representation: "system-owned",
    requirement: "system",
    note: "Draft/published lifecycle; owned by the save/publish actions, not a form field.",
  },
};

/** Representations that put a field in front of the recruiter (i.e. not system-owned). */
export const RECRUITER_FACING_REPRESENTATIONS: readonly FieldRepresentation[] = [
  "control",
  "conditional-control",
  "derived",
  "confirmation",
  "legacy-preserved",
];

export const ALL_REPRESENTATIONS: readonly FieldRepresentation[] = [
  ...RECRUITER_FACING_REPRESENTATIONS,
  "system-owned",
];

export const ALL_REQUIREMENTS: readonly FieldRequirement[] = [
  "publish",
  "step",
  "recommended",
  "optional",
  "system",
];

export type JobFieldName = keyof typeof JOB_FIELD_REGISTRY;

/**
 * Authoritative field → **screen** map (finer than the domain `step`). This is
 * what the wizard uses to navigate and to route a backend/publication error to
 * the exact focused screen that owns the control. Every recruiter-facing field
 * that has an owning `step` also has a screen; `groupForScreen(screen)` must
 * equal that field's `step` (enforced by the completeness test).
 *
 * Purely-retained legacy/system fields (no live control) may be omitted.
 */
export const FIELD_SCREENS: Partial<Record<JobFieldName, RecruiterJobScreen>> = {
  // Chapter 1 · The opportunity
  title: "role",
  primary_role_id: "role",
  role_specialization: "role",
  employer_context_type: "role",
  hiring_identity_id: "role",
  platforms: "role",
  content_niches: "creatorContext",
  content_genres: "creatorContext",
  formats_hired_for: "creatorContext",
  // Chapter 2 · The work
  about_channel: "about",
  responsibilities: "about",
  requirements: "about",
  deliverables: "deliverables",
  revision_policy: "workflow",
  revision_rounds: "workflow",
  revision_notes: "workflow",
  source_inputs: "workflow",
  source_inputs_notes: "workflow",
  creative_autonomy: "workflow",
  creative_autonomy_notes: "workflow",
  // Chapter 3 · The person
  required_skill_keys: "skills",
  preferred_skill_keys: "skills",
  other_required_skills: "skills",
  other_preferred_skills: "skills",
  required_skills_note: "skills",
  preferred_skills_note: "skills",
  required_tool_keys: "toolsLanguages",
  other_required_tools: "toolsLanguages",
  tools: "toolsLanguages",
  tags: "toolsLanguages",
  // Chapter 4 · The arrangement (collaboration + timing merged into one screen)
  engagement_type: "arrangement",
  work_mode: "arrangement",
  location: "arrangement",
  expected_weekly_hours_min: "arrangement",
  expected_weekly_hours_max: "arrangement",
  turnaround_value: "arrangement",
  turnaround_unit: "arrangement",
  turnaround_basis: "arrangement",
  weekly_hours: "arrangement",
  contract_type: "arrangement",
  start_timing: "arrangement",
  start_date: "arrangement",
  duration_type: "arrangement",
  duration_value: "arrangement",
  duration_unit: "arrangement",
  engagement_end_date: "arrangement",
  timezone_overlap: "arrangement",
  start_timeframe: "arrangement",
  compensation_mode: "pay",
  budget_amount: "pay",
  budget_max: "pay",
  budget_currency: "pay",
  budget_unit: "pay",
  budget_unit_custom: "pay",
  budget_note: "pay",
  experience_level: "pay",
  // Chapter 5 · Hiring
  trial_status: "trial",
  trial_scope: "trial",
  trial_effort_value: "trial",
  trial_effort_unit: "trial",
  trial_compensation_amount: "trial",
  trial_compensation_currency: "trial",
  trial_compensation_basis: "trial",
  trial_work_usage: "trial",
  trial_portfolio_permission: "trial",
  trial_attribution: "trial",
  unpaid_trial_confirmed: "trial",
  trial_notes: "trial",
  hiring_process: "process",
  hiring_process_notes: "process",
  screening_questions: "process",
  application_mode: "apply",
  external_apply_url: "apply",
  deadline_at: "apply",
  application_requirements: "apply",
  how_to_apply: "apply",
  // Chapter 6 · Review
  reference_videos: "references",
};

export const screenForField = (field: JobFieldName): RecruiterJobScreen | undefined =>
  FIELD_SCREENS[field];

export const jobFieldEntry = (field: JobFieldName): JobFieldEntry => JOB_FIELD_REGISTRY[field];

/** Fields whose absence blocks either publication or leaving their step. */
export const requiredJobFields = (): JobFieldName[] =>
  (Object.keys(JOB_FIELD_REGISTRY) as JobFieldName[]).filter((field) => {
    const requirement = JOB_FIELD_REGISTRY[field].requirement;
    return requirement === "publish" || requirement === "step";
  });

/** Fields a recruiter can see/edit (everything except purely system-owned values). */
export const recruiterFacingJobFields = (): JobFieldName[] =>
  (Object.keys(JOB_FIELD_REGISTRY) as JobFieldName[]).filter((field) =>
    RECRUITER_FACING_REPRESENTATIONS.includes(JOB_FIELD_REGISTRY[field].representation)
  );

/** Consequential fields that must always be explicitly confirmed, never inferred. */
export const confirmationJobFields = (): JobFieldName[] =>
  (Object.keys(JOB_FIELD_REGISTRY) as JobFieldName[]).filter(
    (field) => JOB_FIELD_REGISTRY[field].representation === "confirmation"
  );
