"use client";

import { useId, useState, type ReactNode } from "react";
import QuestionTooltip from "../ui/QuestionTooltip";
import type { BackendCreateJobPayload } from "../../lib/backendClient";
import {
  JOB_DELIVERABLE_FREQUENCIES,
  JOB_DELIVERABLE_TYPES,
  JOB_HIRING_STAGES,
  JOB_LANGUAGE_PURPOSES,
  JOB_SKILL_KEYS,
  JOB_SOURCE_INPUT_TYPES,
  deliverableFrequencyLabel,
  deliverableTypeLabel,
  getJobRoleRules,
  hiringStageLabel,
  languagePurposeLabel,
  skillLabel,
  sourceInputLabel,
  type EditableDeliverable,
  type EditableHiringStage,
  type EditableLanguageRequirement,
  type EditableScreeningQuestion,
  type JobPostingDomainState,
} from "../../lib/jobPostingForm";
import {
  engagementLabel,
  type CompensationUnit,
  type CreativeAutonomy,
  type EmployerContextType,
  type EngagementDurationType,
  type EngagementDurationUnit,
  type EngagementType,
  type HiringProcessStageType,
  type JobSourceInput,
  type LanguagePriority,
  type LanguageProficiency,
  type RevisionPolicy,
  type SourceInputType,
  type StartTiming,
  type TrialAttribution,
  type TrialCompensationBasis,
  type TrialEffortUnit,
  type TrialPortfolioPermission,
  type TrialStatus,
  type TrialWorkUsage,
} from "../../lib/jobContract";

export type JobDomainChangeHandler = (
  patch: Partial<JobPostingDomainState>,
  payloadKeys?: Array<keyof BackendCreateJobPayload>,
) => void;

export type JobDomainFieldErrors = Readonly<
  Record<string, string | readonly string[] | null | undefined>
>;

export type JobDomainBaseProps = {
  state: JobPostingDomainState;
  onChange: JobDomainChangeHandler;
  errors?: JobDomainFieldErrors;
  disabled?: boolean;
  className?: string;
};

export type JobDomainWorkMode = "" | "Remote" | "Hybrid" | "On-site";

const inputClass =
  "h-11 w-full rounded-xl border border-white/10 bg-white/[0.06] px-3 text-sm text-white outline-none transition placeholder:text-subtle focus:border-white/30 focus:bg-white/[0.08] focus-visible:ring-2 focus-visible:ring-white/20 disabled:cursor-not-allowed disabled:opacity-50";
const textareaClass =
  "min-h-24 w-full resize-y rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2.5 text-sm leading-6 text-white outline-none transition placeholder:text-subtle focus:border-white/30 focus:bg-white/[0.08] focus-visible:ring-2 focus-visible:ring-white/20 disabled:cursor-not-allowed disabled:opacity-50";
const selectClass = `${inputClass} cursor-pointer appearance-none pr-9`;
const secondaryButtonClass =
  "inline-flex min-h-10 cursor-pointer items-center justify-center rounded-xl border border-white/12 bg-white/[0.05] px-3 text-sm font-semibold text-white/75 transition hover:border-white/25 hover:bg-white/[0.09] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/25 disabled:cursor-not-allowed disabled:opacity-40";
const iconButtonClass =
  "inline-flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-base font-semibold text-white/55 transition hover:border-white/20 hover:bg-white/[0.08] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/25 disabled:cursor-not-allowed disabled:opacity-30";

const EMPLOYER_CONTEXT_LABELS: Record<EmployerContextType, string> = {
  creator: "Creator / channel",
  agency: "Agency",
  brand: "Brand",
  production_house: "Production house",
  other: "Other",
};

const REVISION_LABELS: Record<RevisionPolicy, string> = {
  fixed: "Fixed rounds",
  unlimited: "Unlimited",
  negotiable: "Agree together",
  not_applicable: "Not applicable",
};

const CREATIVE_AUTONOMY_LABELS: Record<CreativeAutonomy, string> = {
  follow_established_style: "Follow an established style",
  guided_by_references: "Work from references",
  collaborative_direction: "Shape it together",
  own_creative_approach: "Bring your own approach",
  varies_by_assignment: "Varies by assignment",
  not_applicable: "Not applicable",
};

const START_TIMING_LABELS: Record<StartTiming, string> = {
  immediate: "Immediately",
  within_two_weeks: "Within 2 weeks",
  specific_date: "On a specific date",
  flexible: "Flexible",
};

const DURATION_LABELS: Record<EngagementDurationType, string> = {
  ongoing: "Ongoing",
  fixed_period: "Fixed period",
  project_based: "For this project",
  until_date: "Until a date",
  flexible: "Flexible",
};

const LANGUAGE_PRIORITY_LABELS: Record<LanguagePriority, string> = {
  required: "Required",
  preferred: "Preferred",
};

const LANGUAGE_PROFICIENCY_LABELS: Record<LanguageProficiency, string> = {
  basic: "Basic",
  conversational: "Conversational",
  professional: "Professional",
  native_or_fluent: "Native or fluent",
};

const TRIAL_STATUS_LABELS: Record<TrialStatus, { label: string; description: string }> = {
  none: { label: "No trial", description: "Decide from the application and interviews." },
  undecided: { label: "Not decided", description: "Be transparent that the process may change." },
  paid: { label: "Paid trial", description: "Set scope, effort, pay, and usage before work begins." },
  unpaid: { label: "Unpaid trial", description: "Only for a small evaluation with explicit terms." },
};

const TRIAL_EFFORT_LABELS: Record<TrialEffortUnit, string> = {
  hours: "Hours",
  days: "Days",
  deliverables: "Deliverables",
};

const TRIAL_COMPENSATION_BASIS_LABELS: Record<TrialCompensationBasis, string> = {
  flat: "Flat amount",
  per_hour: "Per hour",
  per_deliverable: "Per deliverable",
  custom: "Custom basis",
};

const TRIAL_USAGE_LABELS: Record<TrialWorkUsage, string> = {
  evaluation_only: "Evaluation only",
  may_use_privately: "May be used privately",
  may_publish: "May be published",
};

const TRIAL_PORTFOLIO_LABELS: Record<TrialPortfolioPermission, string> = {
  allowed: "Candidate may show it",
  not_allowed: "Not for portfolios",
  with_permission: "With permission",
};

const TRIAL_ATTRIBUTION_LABELS: Record<TrialAttribution, string> = {
  credited: "Candidate will be credited",
  not_credited: "No public credit",
  not_applicable: "Not applicable",
  to_be_agreed: "Agree before the trial",
};

const makeRowId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const cleanId = (value: string) => value.replace(/:/g, "");

const getError = (errors: JobDomainFieldErrors | undefined, ...keys: string[]) => {
  for (const key of keys) {
    const value = errors?.[key];
    if (Array.isArray(value)) {
      const message = value.find((entry) => entry.trim());
      if (message) return message;
    } else if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return undefined;
};

const describedBy = (id: string, hasHint: boolean, error?: string) =>
  [hasHint ? `${id}-hint` : "", error ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined;

// Functional minimalism: a flat titled section — no nested card border/background,
// no eyebrow. The optional `description` becomes an on-demand question-mark tooltip
// so it no longer occupies permanent vertical space.
function DomainCard({
  id,
  title,
  description,
  action,
  children,
}: {
  id: string;
  /** Retained for call-site compatibility; no longer rendered. */
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={`${id}-title`} className="min-w-0 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <h3
          id={`${id}-title`}
          className="inline-flex min-w-0 items-center gap-1.5 text-sm font-semibold tracking-tight text-white/92"
        >
          <span className="min-w-0">{title}</span>
          {description ? <QuestionTooltip label={description} /> : null}
        </h3>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

// A single labelled control. Required state is conveyed by the asterisk in `label`;
// there is no "Optional" badge. Non-critical `hint` copy moves into a tooltip.
function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  /** Retained for call-site compatibility; optional state is shown by the absent asterisk. */
  optional?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="inline-flex items-center gap-1.5 text-xs font-semibold text-white/80">
        <span>{label}</span>
        {hint ? <QuestionTooltip label={hint} /> : null}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-[11px] leading-4 text-amber-200/90">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function Group({
  id,
  legend,
  hint,
  error,
  children,
}: {
  id: string;
  legend: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <fieldset aria-describedby={describedBy(id, false, error)} className="min-w-0 space-y-2">
      <legend className="inline-flex items-center gap-1.5 text-xs font-semibold text-white/80">
        <span>{legend}</span>
        {hint ? <QuestionTooltip label={hint} /> : null}
      </legend>
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-[11px] leading-4 text-amber-200/90">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

function ChoiceButton({
  active,
  children,
  onClick,
  disabled,
  tone = "white",
  ariaLabel,
}: {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone?: "white" | "amber";
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onClick}
      className={[
        "min-h-10 cursor-pointer rounded-xl border px-3 py-2 text-left text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-45",
        active && tone === "white"
          ? "border-white bg-white text-black focus-visible:ring-white/35"
          : active
            ? "border-amber-200/45 bg-amber-200/[0.13] text-amber-100 focus-visible:ring-amber-200/30"
            : "border-white/12 bg-white/[0.035] text-white/68 hover:border-white/25 hover:bg-white/[0.07] hover:text-white focus-visible:ring-white/25",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function RowControls({
  label,
  index,
  count,
  onMove,
  onRemove,
  disabled,
}: {
  label: string;
  index: number;
  count: number;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="ml-auto flex items-center gap-1.5">
      <button
        type="button"
        className={iconButtonClass}
        disabled={disabled || index === 0}
        onClick={() => onMove(-1)}
        aria-label={`Move ${label} up`}
        title="Move up"
      >
        ↑
      </button>
      <button
        type="button"
        className={iconButtonClass}
        disabled={disabled || index === count - 1}
        onClick={() => onMove(1)}
        aria-label={`Move ${label} down`}
        title="Move down"
      >
        ↓
      </button>
      <button
        type="button"
        className={`${iconButtonClass} hover:border-amber-200/30 hover:text-amber-100`}
        disabled={disabled}
        onClick={onRemove}
        aria-label={`Remove ${label}`}
        title="Remove"
      >
        ×
      </button>
    </div>
  );
}

function moveRow<T>(rows: readonly T[], index: number, direction: -1 | 1): T[] {
  const destination = index + direction;
  if (destination < 0 || destination >= rows.length) return [...rows];
  const next = [...rows];
  [next[index], next[destination]] = [next[destination], next[index]];
  return next;
}

function Notice({ tone = "neutral", children }: { tone?: "neutral" | "amber"; children: ReactNode }) {
  return (
    <div
      className={[
        "rounded-xl border px-3 py-2.5 text-xs leading-5",
        tone === "amber"
          ? "border-amber-200/20 bg-amber-200/[0.07] text-amber-100/85"
          : "border-white/10 bg-black/10 text-muted",
      ].join(" ")}
    >
      {children}
    </div>
  );
}

export type EmployerContextFieldsProps = JobDomainBaseProps & {
  recruiterIdentityLabel?: string | null;
  recruiterIdentityKind?: string | null;
};

export function EmployerContextFields({
  state,
  onChange,
  errors,
  disabled,
  className = "",
  recruiterIdentityLabel,
  recruiterIdentityKind,
}: EmployerContextFieldsProps) {
  const prefix = `job-employer-${cleanId(useId())}`;
  const contextError = getError(errors, "employer_context_type");

  return (
    <div className={className}>
      {recruiterIdentityLabel ? (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-black/10 px-3 py-2.5 text-xs text-white/55">
          <span className="text-subtle">Posting as</span>
          <span className="font-semibold text-white/85">{recruiterIdentityLabel}</span>
          {recruiterIdentityKind ? (
            <span className="rounded-full border border-white/10 bg-white/[0.05] px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-muted">
              {recruiterIdentityKind}
            </span>
          ) : null}
        </div>
      ) : null}
      <Group
        id={`${prefix}-type`}
        legend="Who is this work for?"
        hint="Choose the employer behind the brief so candidates know whether they'll work directly with a creator or through a team. Your verified posting identity stays separate."
        error={contextError}
      >
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {(Object.keys(EMPLOYER_CONTEXT_LABELS) as EmployerContextType[]).map((value) => (
            <ChoiceButton
              key={value}
              active={state.employerContextType === value}
              disabled={disabled}
              onClick={() =>
                onChange(
                  { employerContextType: state.employerContextType === value ? "" : value },
                  ["employer_context_type"],
                )
              }
            >
              {EMPLOYER_CONTEXT_LABELS[value]}
            </ChoiceButton>
          ))}
        </div>
      </Group>
    </div>
  );
}

export type WorkDeliverablesSection = "deliverables" | "workflow";

export type WorkDeliverablesFieldsProps = JobDomainBaseProps & {
  roleName?: string | null;
  engagementType?: EngagementType | "" | null;
  /** Which cards to render. Omit to render all (backward compatible). */
  sections?: WorkDeliverablesSection[];
};

export function WorkDeliverablesFields({
  state,
  onChange,
  errors,
  disabled,
  className = "",
  roleName,
  engagementType,
  sections,
}: WorkDeliverablesFieldsProps) {
  const prefix = `job-work-${cleanId(useId())}`;
  const show = (section: WorkDeliverablesSection) => !sections || sections.includes(section);
  const rules = getJobRoleRules(roleName);
  const deliverables = state.deliverables ?? [];
  const sourceInputs = state.sourceInputs ?? [];
  const selectedSourceTypes = new Set(sourceInputs.map((item) => item.type));
  const sensitiveInputs = sourceInputs.filter(
    (item) => item.type === "analytics_access" || item.type === "account_access",
  );

  const updateDeliverable = (id: string, patch: Partial<EditableDeliverable>) => {
    onChange(
      { deliverables: deliverables.map((item) => (item.id === id ? { ...item, ...patch } : item)) },
      ["deliverables"],
    );
  };

  const addDeliverable = () => {
    const next: EditableDeliverable = {
      id: makeRowId("deliverable"),
      type: "",
      customType: "",
      quantity: "",
      frequency: "",
      customFrequency: "",
      notes: "",
    };
    onChange({ deliverables: [...deliverables, next] }, ["deliverables"]);
  };

  const toggleSourceInput = (type: SourceInputType) => {
    if (selectedSourceTypes.has(type)) {
      onChange({ sourceInputs: sourceInputs.filter((item) => item.type !== type) }, ["source_inputs"]);
      return;
    }
    const next: JobSourceInput = {
      type,
      ...(type === "analytics_access" || type === "account_access"
        ? { sensitive_access_confirmed: false }
        : {}),
    };
    onChange({ sourceInputs: [...sourceInputs, next] }, ["source_inputs"]);
  };

  const updateSourceInput = (type: SourceInputType, patch: Partial<JobSourceInput>) => {
    onChange(
      { sourceInputs: sourceInputs.map((item) => (item.type === type ? { ...item, ...patch } : item)) },
      ["source_inputs"],
    );
  };

  const deliverablesError = getError(errors, "deliverables");
  const revisionError = getError(errors, "revision_policy", "revision_rounds");
  const sourceError = getError(errors, "source_inputs", "source_inputs.sensitive_access_confirmed");
  const autonomyError = getError(errors, "creative_autonomy");

  return (
    <div className={`space-y-4 ${className}`}>
      {show("deliverables") ? (
      <DomainCard
        id={`${prefix}-deliverables`}
        title="What will this person be expected to deliver?"
        description={`${rules.deliverableExample}. Use separate rows when outputs have different rhythms.`}
        action={
          <button type="button" className={secondaryButtonClass} disabled={disabled} onClick={addDeliverable}>
            + Add deliverable
          </button>
        }
      >
        {deliverables.length ? (
          <div className="space-y-3">
            {deliverables.map((item, index) => {
              const rowId = `job-deliverable-${item.id}`;
              const rowErrorId = `${rowId}-error`;
              const rowError = getError(
                errors,
                `deliverables.${index}`,
                `deliverables.${index}.type`,
                `deliverables.${index}.quantity`,
                `deliverables.${index}.frequency`,
              );
              return (
                <section
                  key={item.id}
                  id={rowId}
                  aria-labelledby={`${rowId}-title`}
                  className="rounded-xl border border-white/10 bg-black/10 p-3.5"
                >
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <h4 id={`${rowId}-title`} className="text-xs font-semibold text-white/76">
                      Deliverable {index + 1}
                    </h4>
                    <RowControls
                      label={`deliverable ${index + 1}`}
                      index={index}
                      count={deliverables.length}
                      disabled={disabled}
                      onMove={(direction) =>
                        onChange({ deliverables: moveRow(deliverables, index, direction) }, ["deliverables"])
                      }
                      onRemove={() =>
                        onChange({ deliverables: deliverables.filter((entry) => entry.id !== item.id) }, [
                          "deliverables",
                        ])
                      }
                    />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-[minmax(0,1.25fr)_100px_minmax(0,1fr)]">
                    <div className="space-y-1.5">
                      <label htmlFor={`${rowId}-type`} className="text-[11px] font-medium text-muted">
                        Output
                      </label>
                      <select
                        id={`${rowId}-type`}
                        className={selectClass}
                        value={item.type}
                        disabled={disabled}
                        aria-invalid={Boolean(rowError)}
                        aria-describedby={rowError ? rowErrorId : undefined}
                        onChange={(event) =>
                          updateDeliverable(item.id, {
                            type: event.target.value as EditableDeliverable["type"],
                          })
                        }
                      >
                        <option value="" className="bg-[#111116]">Choose output</option>
                        {JOB_DELIVERABLE_TYPES.map((value) => (
                          <option key={value} value={value} className="bg-[#111116]">
                            {deliverableTypeLabel(value)}
                            {rules.suggestedDeliverables.includes(value) ? " · common for this role" : ""}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <label htmlFor={`${rowId}-quantity`} className="text-[11px] font-medium text-muted">
                        Quantity
                      </label>
                      <input
                        id={`${rowId}-quantity`}
                        type="number"
                        min="1"
                        step="1"
                        inputMode="numeric"
                        className={inputClass}
                        value={item.quantity}
                        disabled={disabled}
                        aria-invalid={Boolean(rowError)}
                        aria-describedby={rowError ? rowErrorId : undefined}
                        placeholder="4"
                        onChange={(event) => updateDeliverable(item.id, { quantity: event.target.value })}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label htmlFor={`${rowId}-frequency`} className="text-[11px] font-medium text-muted">
                        Frequency
                      </label>
                      <select
                        id={`${rowId}-frequency`}
                        className={selectClass}
                        value={item.frequency}
                        disabled={disabled}
                        aria-invalid={Boolean(rowError)}
                        aria-describedby={rowError ? rowErrorId : undefined}
                        onChange={(event) =>
                          updateDeliverable(item.id, {
                            frequency: event.target.value as EditableDeliverable["frequency"],
                          })
                        }
                      >
                        <option value="" className="bg-[#111116]">Choose rhythm</option>
                        {JOB_DELIVERABLE_FREQUENCIES.map((value) => (
                          <option key={value} value={value} className="bg-[#111116]">
                            {deliverableFrequencyLabel(value)}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  {item.type === "other" || item.frequency === "other" ? (
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      {item.type === "other" ? (
                        <Field
                          id={`${rowId}-custom-type`}
                          label="Name the output"
                          error={getError(errors, `deliverables.${index}.custom_type`)}
                        >
                          <input
                            id={`${rowId}-custom-type`}
                            className={inputClass}
                            value={item.customType}
                            disabled={disabled}
                            maxLength={120}
                            placeholder="e.g. Sponsor integration cut"
                            onChange={(event) => updateDeliverable(item.id, { customType: event.target.value })}
                          />
                        </Field>
                      ) : null}
                      {item.frequency === "other" ? (
                        <Field
                          id={`${rowId}-custom-frequency`}
                          label="Describe the rhythm"
                          error={getError(errors, `deliverables.${index}.custom_frequency`)}
                        >
                          <input
                            id={`${rowId}-custom-frequency`}
                            className={inputClass}
                            value={item.customFrequency}
                            disabled={disabled}
                            maxLength={120}
                            placeholder="e.g. Around each product launch"
                            onChange={(event) => updateDeliverable(item.id, { customFrequency: event.target.value })}
                          />
                        </Field>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="mt-3">
                    <Field id={`${rowId}-notes`} label="Scope note" optional>
                      <input
                        id={`${rowId}-notes`}
                        className={inputClass}
                        value={item.notes}
                        disabled={disabled}
                        maxLength={300}
                        placeholder="Length, aspect ratio, handoff format, or what counts as complete"
                        onChange={(event) => updateDeliverable(item.id, { notes: event.target.value })}
                      />
                    </Field>
                  </div>
                  {rowError ? (
                    <p id={rowErrorId} role="alert" className="mt-2 text-[11px] text-amber-200/90">
                      {rowError}
                    </p>
                  ) : null}
                </section>
              );
            })}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-white/12 bg-black/10 px-4 py-6 text-center">
            <p className="text-sm font-medium text-white/64">No structured deliverables yet</p>
            <p className="mt-1 text-xs leading-5 text-subtle">
              Add them when quantity and frequency make the workload easier to judge.
            </p>
          </div>
        )}
        {deliverablesError ? <p role="alert" className="mt-2 text-[11px] text-amber-200/90">{deliverablesError}</p> : null}
        {engagementType ? (
          <p className="mt-3 text-[11px] text-subtle">
            Engagement: {engagementLabel(engagementType)}. Deliverables describe outputs; they do not replace hours or turnaround.
          </p>
        ) : null}
      </DomainCard>
      ) : null}

      {show("workflow") ? (
      <DomainCard
        id={`${prefix}-workflow`}
        eyebrow="Workflow"
        title="Review expectations and creative direction"
        description="Give candidates enough context to price the work without turning the brief into a contract."
      >
        <div className="space-y-5">
          <Group
            id={`${prefix}-revisions`}
            legend="Revision expectation"
            hint="Count review rounds, not every small comment within a round."
            error={revisionError}
          >
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {(Object.keys(REVISION_LABELS) as RevisionPolicy[]).map((value) => (
                <ChoiceButton
                  key={value}
                  active={state.revisionPolicy === value}
                  disabled={disabled}
                  onClick={() =>
                    onChange({ revisionPolicy: state.revisionPolicy === value ? "" : value }, ["revision_policy"])
                  }
                >
                  {REVISION_LABELS[value]}
                </ChoiceButton>
              ))}
            </div>
          </Group>
          {state.revisionPolicy === "fixed" ? (
            <Field
              id={`${prefix}-revision-rounds`}
              label="Included revision rounds"
              hint="A clear number prevents candidates from pricing for unlimited review cycles."
              error={getError(errors, "revision_rounds")}
            >
              <input
                id={`${prefix}-revision-rounds`}
                className={`${inputClass} max-w-40`}
                type="number"
                min="1"
                step="1"
                inputMode="numeric"
                value={state.revisionRounds}
                disabled={disabled}
                aria-invalid={Boolean(getError(errors, "revision_rounds"))}
                aria-describedby={describedBy(
                  `${prefix}-revision-rounds`,
                  true,
                  getError(errors, "revision_rounds"),
                )}
                onChange={(event) => onChange({ revisionRounds: event.target.value }, ["revision_rounds"])}
              />
            </Field>
          ) : null}
          <Field id={`${prefix}-revision-notes`} label="Revision note" optional>
            <textarea
              id={`${prefix}-revision-notes`}
              className={textareaClass}
              value={state.revisionNotes}
              disabled={disabled}
              maxLength={800}
              placeholder="Who gives feedback, typical review timing, or what is outside scope"
              onChange={(event) => onChange({ revisionNotes: event.target.value }, ["revision_notes"])}
            />
          </Field>

          <div className="border-t border-white/[0.07] pt-5">
            <Group
              id={`${prefix}-source-inputs`}
              legend="What you provide"
              hint={rules.sourceHelper}
              error={sourceError}
            >
              <div className="flex flex-wrap gap-2">
                {JOB_SOURCE_INPUT_TYPES.map((type) => (
                  <ChoiceButton
                    key={type}
                    active={selectedSourceTypes.has(type)}
                    disabled={disabled}
                    tone={type === "analytics_access" || type === "account_access" ? "amber" : "white"}
                    onClick={() => toggleSourceInput(type)}
                  >
                    {sourceInputLabel(type)}
                  </ChoiceButton>
                ))}
              </div>
            </Group>
            {sourceInputs.find((item) => item.type === "other") ? (
              <div className="mt-3">
                <Field id={`${prefix}-source-other`} label="Other source material">
                  <input
                    id={`${prefix}-source-other`}
                    className={inputClass}
                    value={sourceInputs.find((item) => item.type === "other")?.custom_label ?? ""}
                    disabled={disabled}
                    maxLength={120}
                    placeholder="e.g. Previous episode project files"
                    onChange={(event) => updateSourceInput("other", { custom_label: event.target.value })}
                  />
                </Field>
              </div>
            ) : null}
            {sensitiveInputs.length ? (
              <div className="mt-3 space-y-3 rounded-xl border border-amber-200/20 bg-amber-200/[0.06] p-3.5">
                <div>
                  <p className="text-xs font-semibold text-amber-100">Sensitive access</p>
                  <p className="mt-1 text-[11px] leading-5 text-amber-100/65">
                    Never request passwords in an application. Grant the least access needed after the candidate is selected.
                  </p>
                </div>
                {sensitiveInputs.map((item) => {
                  const inputId = `${prefix}-${item.type}-confirmed`;
                  return (
                    <label key={item.type} htmlFor={inputId} className="flex cursor-pointer items-start gap-3 text-xs text-amber-50/85">
                      <input
                        id={inputId}
                        type="checkbox"
                        className="mt-0.5 h-4 w-4 rounded border-white/20 bg-black/20 accent-white"
                        checked={item.sensitive_access_confirmed === true}
                        disabled={disabled}
                        onChange={(event) =>
                          updateSourceInput(item.type, { sensitive_access_confirmed: event.target.checked })
                        }
                      />
                      <span>
                        I confirm {sourceInputLabel(item.type).toLowerCase()} is genuinely needed and will be shared securely after selection.
                      </span>
                    </label>
                  );
                })}
              </div>
            ) : null}
            <div className="mt-3">
              <Field
                id={`${prefix}-source-notes`}
                label="Source-material context"
                hint="Say what is ready, what the creator must source, and when any access is granted."
                error={getError(errors, "source_inputs_notes")}
                optional={!sensitiveInputs.length}
              >
                <textarea
                  id={`${prefix}-source-notes`}
                  className={textareaClass}
                  value={state.sourceInputsNotes}
                  disabled={disabled}
                  maxLength={1000}
                  aria-invalid={Boolean(getError(errors, "source_inputs_notes"))}
                  aria-describedby={describedBy(
                    `${prefix}-source-notes`,
                    true,
                    getError(errors, "source_inputs_notes"),
                  )}
                  placeholder="Raw footage and the approved script arrive in Drive. Analytics access is granted after onboarding."
                  onChange={(event) => onChange({ sourceInputsNotes: event.target.value }, ["source_inputs_notes"])}
                />
              </Field>
            </div>
          </div>

          <div className="border-t border-white/[0.07] pt-5">
            <Group
              id={`${prefix}-autonomy`}
              legend="Creative autonomy"
              hint={
                rules.showCreativeWorkflow
                  ? "Set the creative lane without prescribing every edit or design choice."
                  : "Choose not applicable when this role does not own creative decisions."
              }
              error={autonomyError}
            >
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {(Object.keys(CREATIVE_AUTONOMY_LABELS) as CreativeAutonomy[]).map((value) => (
                  <ChoiceButton
                    key={value}
                    active={state.creativeAutonomy === value}
                    disabled={disabled}
                    onClick={() =>
                      onChange({ creativeAutonomy: state.creativeAutonomy === value ? "" : value }, ["creative_autonomy"])
                    }
                  >
                    {CREATIVE_AUTONOMY_LABELS[value]}
                  </ChoiceButton>
                ))}
              </div>
            </Group>
            <div className="mt-3">
              <Field id={`${prefix}-autonomy-notes`} label="Direction note" optional>
                <textarea
                  id={`${prefix}-autonomy-notes`}
                  className={textareaClass}
                  value={state.creativeAutonomyNotes}
                  disabled={disabled}
                  maxLength={800}
                  placeholder="What is fixed, where experimentation is welcome, and who approves the final"
                  onChange={(event) =>
                    onChange({ creativeAutonomyNotes: event.target.value }, ["creative_autonomy_notes"])
                  }
                />
              </Field>
            </div>
          </div>
        </div>
      </DomainCard>
      ) : null}
    </div>
  );
}

export type ArrangementDomainFieldsProps = JobDomainBaseProps & {
  engagementType?: EngagementType | "" | null;
  workMode?: JobDomainWorkMode | null;
  compensationUnit?: CompensationUnit | "" | null;
};

export function ArrangementDomainFields({
  state,
  onChange,
  errors,
  disabled,
  className = "",
  engagementType,
  workMode,
  compensationUnit,
}: ArrangementDomainFieldsProps) {
  const prefix = `job-arrangement-${cleanId(useId())}`;
  const [requiresLiveOverlap, setRequiresLiveOverlap] = useState(Boolean(state.timezoneOverlap.trim()));
  const startError = getError(errors, "start_timing", "start_date");
  const durationError = getError(
    errors,
    "duration_type",
    "duration_value",
    "duration_unit",
    "engagement_end_date",
  );
  const timezoneError = getError(errors, "timezone_overlap");
  const showTimezone = requiresLiveOverlap || Boolean(state.timezoneOverlap.trim());
  const engagementCopy = engagementType
    ? `${engagementLabel(engagementType)} describes the relationship; the dates below describe when it begins and how long it may run.`
    : "Start and duration are separate from the engagement type and compensation cadence.";

  return (
    <div className={className}>
      <DomainCard
        id={`${prefix}-timing`}
        eyebrow="Arrangement"
        title="When does the work happen?"
        description={engagementCopy}
      >
        <div className="space-y-5">
          <Group
            id={`${prefix}-start`}
            legend="Expected start"
            hint="Choose the closest honest window. A specific date should be realistic, not aspirational."
            error={startError}
          >
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {(Object.keys(START_TIMING_LABELS) as StartTiming[]).map((value) => (
                <ChoiceButton
                  key={value}
                  active={state.startTiming === value}
                  disabled={disabled}
                  onClick={() =>
                    onChange({ startTiming: state.startTiming === value ? "" : value }, ["start_timing"])
                  }
                >
                  {START_TIMING_LABELS[value]}
                </ChoiceButton>
              ))}
            </div>
          </Group>

          {state.startTiming === "specific_date" ? (
            <Field
              id={`${prefix}-start-date`}
              label="Start date"
              error={getError(errors, "start_date")}
            >
              <input
                id={`${prefix}-start-date`}
                type="date"
                className={`${inputClass} max-w-xs [color-scheme:dark]`}
                value={state.startDate}
                disabled={disabled}
                aria-invalid={Boolean(getError(errors, "start_date"))}
                aria-describedby={describedBy(
                  `${prefix}-start-date`,
                  false,
                  getError(errors, "start_date"),
                )}
                onChange={(event) => onChange({ startDate: event.target.value }, ["start_date"])}
              />
            </Field>
          ) : null}

          <div className="border-t border-white/[0.07] pt-5">
            <Group
              id={`${prefix}-duration`}
              legend="Expected duration"
              hint="This is the likely term, not a promise that replaces a later contract."
              error={durationError}
            >
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {(Object.keys(DURATION_LABELS) as EngagementDurationType[]).map((value) => (
                  <ChoiceButton
                    key={value}
                    active={state.durationType === value}
                    disabled={disabled}
                    onClick={() =>
                      onChange({ durationType: state.durationType === value ? "" : value }, ["duration_type"])
                    }
                  >
                    {DURATION_LABELS[value]}
                  </ChoiceButton>
                ))}
              </div>
            </Group>
            {state.durationType === "fixed_period" ? (
              <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <Field
                  id={`${prefix}-duration-value`}
                  label="Duration"
                  error={getError(errors, "duration_value")}
                >
                  <input
                    id={`${prefix}-duration-value`}
                    type="number"
                    min="1"
                    step="1"
                    inputMode="numeric"
                    className={inputClass}
                    value={state.durationValue}
                    disabled={disabled}
                    aria-invalid={Boolean(getError(errors, "duration_value"))}
                    aria-describedby={describedBy(
                      `${prefix}-duration-value`,
                      false,
                      getError(errors, "duration_value"),
                    )}
                    placeholder="3"
                    onChange={(event) => onChange({ durationValue: event.target.value }, ["duration_value"])}
                  />
                </Field>
                <Field
                  id={`${prefix}-duration-unit`}
                  label="Unit"
                  error={getError(errors, "duration_unit")}
                >
                  <select
                    id={`${prefix}-duration-unit`}
                    className={selectClass}
                    value={state.durationUnit}
                    disabled={disabled}
                    aria-invalid={Boolean(getError(errors, "duration_unit"))}
                    aria-describedby={describedBy(
                      `${prefix}-duration-unit`,
                      false,
                      getError(errors, "duration_unit"),
                    )}
                    onChange={(event) =>
                      onChange(
                        { durationUnit: event.target.value as EngagementDurationUnit | "" },
                        ["duration_unit"],
                      )
                    }
                  >
                    <option value="" className="bg-[#111116]">Choose unit</option>
                    <option value="weeks" className="bg-[#111116]">Weeks</option>
                    <option value="months" className="bg-[#111116]">Months</option>
                  </select>
                </Field>
              </div>
            ) : null}
            {state.durationType === "until_date" ? (
              <div className="mt-3">
                <Field
                  id={`${prefix}-end-date`}
                  label="Expected end date"
                  error={getError(errors, "engagement_end_date")}
                >
                  <input
                    id={`${prefix}-end-date`}
                    type="date"
                    className={`${inputClass} max-w-xs [color-scheme:dark]`}
                    value={state.engagementEndDate}
                    disabled={disabled}
                    aria-invalid={Boolean(getError(errors, "engagement_end_date"))}
                    aria-describedby={describedBy(
                      `${prefix}-end-date`,
                      false,
                      getError(errors, "engagement_end_date"),
                    )}
                    onChange={(event) =>
                      onChange({ engagementEndDate: event.target.value }, ["engagement_end_date"])
                    }
                  />
                </Field>
              </div>
            ) : null}
          </div>

          <div className="border-t border-white/[0.07] pt-5">
            {workMode !== "On-site" ? (
              <Group
                id={`${prefix}-overlap-choice`}
                legend="Does the work need fixed live overlap?"
                hint="Async roles do not need a timezone requirement. Choose yes only for calls, reviews, or collaboration windows."
              >
                <div className="grid gap-2 sm:grid-cols-2">
                  <ChoiceButton
                    active={!requiresLiveOverlap && !state.timezoneOverlap.trim()}
                    disabled={disabled}
                    onClick={() => {
                      setRequiresLiveOverlap(false);
                      onChange({ timezoneOverlap: "" }, ["timezone_overlap"]);
                    }}
                  >
                    No, the work is asynchronous
                  </ChoiceButton>
                  <ChoiceButton
                    active={showTimezone}
                    disabled={disabled}
                    onClick={() => setRequiresLiveOverlap(true)}
                  >
                    Yes, some live overlap is needed
                  </ChoiceButton>
                </div>
              </Group>
            ) : null}
            {workMode !== "On-site" && showTimezone ? (
              <div className="mt-4">
                <Field
                  id={`${prefix}-timezone`}
                  label="Timezone overlap"
                  hint={
                    workMode === "Hybrid"
                      ? "Only state the live collaboration window; on-site expectations belong in the location field."
                      : "Describe live overlap, not the candidate's home timezone. Leave blank if the work is asynchronous."
                  }
                  error={timezoneError}
                  optional
                >
                  <input
                    id={`${prefix}-timezone`}
                    className={inputClass}
                    value={state.timezoneOverlap}
                    disabled={disabled}
                    maxLength={160}
                    aria-invalid={Boolean(timezoneError)}
                    aria-describedby={describedBy(`${prefix}-timezone`, false, timezoneError)}
                    placeholder="e.g. 2 hours between 10:00–18:00 IST on weekdays"
                    onChange={(event) => onChange({ timezoneOverlap: event.target.value }, ["timezone_overlap"])}
                  />
                </Field>
              </div>
            ) : (
              workMode === "On-site" ? (
                <Notice>
                  This is an on-site role, so candidates will use the job location rather than a separate timezone requirement.
                </Notice>
              ) : null
            )}
          </div>

          {compensationUnit ? (
            <Notice>
              Main compensation is set as <span className="font-semibold text-white/72">{compensationUnit}</span>. That cadence stays separate from the engagement duration above.
            </Notice>
          ) : null}
        </div>
      </DomainCard>
    </div>
  );
}

function CustomSkillEditor({
  id,
  label,
  value,
  onChange,
  disabled,
  tone,
}: {
  id: string;
  label: string;
  value: string[] | null;
  onChange: (next: string[]) => void;
  disabled?: boolean;
  tone: "white" | "amber";
}) {
  const [draft, setDraft] = useState("");
  const values = value ?? [];

  const add = () => {
    const nextValue = draft.trim().replace(/\s+/g, " ");
    if (!nextValue) return;
    if (values.some((item) => item.toLocaleLowerCase() === nextValue.toLocaleLowerCase())) {
      setDraft("");
      return;
    }
    onChange([...values, nextValue]);
    setDraft("");
  };

  return (
    <div className="space-y-2">
      <label htmlFor={id} className="text-[11px] font-medium text-muted">
        {label}
      </label>
      {values.length ? (
        <div className="flex flex-wrap gap-2" aria-label={`${label} already added`}>
          {values.map((item) => (
            <span
              key={item.toLocaleLowerCase()}
              className={[
                "inline-flex min-h-9 items-center gap-2 rounded-xl border px-2.5 py-1 text-xs font-medium",
                tone === "amber"
                  ? "border-amber-200/25 bg-amber-200/[0.08] text-amber-100"
                  : "border-white/16 bg-white/[0.07] text-white/82",
              ].join(" ")}
            >
              {item}
              <button
                type="button"
                disabled={disabled}
                className="inline-flex h-6 w-6 items-center justify-center rounded-lg text-white/55 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/25 disabled:opacity-40"
                aria-label={`Remove ${item}`}
                onClick={() => onChange(values.filter((entry) => entry !== item))}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          id={id}
          className={inputClass}
          value={draft}
          disabled={disabled}
          maxLength={80}
          placeholder="Add a creator-specific skill"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              add();
            }
          }}
        />
        <button
          type="button"
          className={`${secondaryButtonClass} sm:min-w-24`}
          disabled={disabled || !draft.trim()}
          onClick={add}
        >
          Add
        </button>
      </div>
    </div>
  );
}

export type SkillsQualificationsSection = "skills" | "languages";

export type SkillsQualificationsFieldsProps = JobDomainBaseProps & {
  /** Which cards to render. Omit to render all (backward compatible). */
  sections?: SkillsQualificationsSection[];
  roleName?: string | null;
  /** Existing broad `languages` tags. They are shown honestly and never auto-converted. */
  legacyLanguages?: readonly string[] | null;
};

export function SkillsQualificationsFields({
  state,
  onChange,
  errors,
  disabled,
  className = "",
  roleName,
  legacyLanguages,
  sections,
}: SkillsQualificationsFieldsProps) {
  const prefix = `job-qualifications-${cleanId(useId())}`;
  const show = (section: SkillsQualificationsSection) => !sections || sections.includes(section);
  const rules = getJobRoleRules(roleName);
  const requiredSkills = state.requiredSkillKeys ?? [];
  const preferredSkills = state.preferredSkillKeys ?? [];
  const languages = state.languageRequirements ?? [];
  const requiredError = getError(errors, "required_skill_keys", "other_required_skills");
  const preferredError = getError(errors, "preferred_skill_keys", "other_preferred_skills");
  const languageError = getError(errors, "language_requirements");

  const toggleRequiredSkill = (key: (typeof JOB_SKILL_KEYS)[number]) => {
    const removing = requiredSkills.includes(key);
    const next = removing ? requiredSkills.filter((entry) => entry !== key) : [...requiredSkills, key];
    onChange(
      {
        requiredSkillKeys: next,
        ...(removing ? {} : { preferredSkillKeys: preferredSkills.filter((entry) => entry !== key) }),
      },
      removing ? ["required_skill_keys"] : ["required_skill_keys", "preferred_skill_keys"],
    );
  };

  const togglePreferredSkill = (key: (typeof JOB_SKILL_KEYS)[number]) => {
    const removing = preferredSkills.includes(key);
    const next = removing ? preferredSkills.filter((entry) => entry !== key) : [...preferredSkills, key];
    onChange(
      {
        preferredSkillKeys: next,
        ...(removing ? {} : { requiredSkillKeys: requiredSkills.filter((entry) => entry !== key) }),
      },
      removing ? ["preferred_skill_keys"] : ["preferred_skill_keys", "required_skill_keys"],
    );
  };

  const addLanguage = () => {
    const next: EditableLanguageRequirement = {
      id: makeRowId("language"),
      language: "",
      priority: "",
      proficiency: "",
      purposes: [],
      notes: "",
    };
    onChange({ languageRequirements: [...languages, next] }, ["language_requirements"]);
  };

  const updateLanguage = (id: string, patch: Partial<EditableLanguageRequirement>) => {
    onChange(
      { languageRequirements: languages.map((item) => (item.id === id ? { ...item, ...patch } : item)) },
      ["language_requirements"],
    );
  };

  return (
    <div className={`space-y-4 ${className}`}>
      {show("skills") ? (
      <DomainCard
        id={`${prefix}-skills`}
        eyebrow="Qualifications"
        title="Skills that matter for the work"
        description="Keep must-haves short. Use preferred skills for genuine advantages, not a second required list."
      >
        <div className="space-y-5">
          <Group
            id={`${prefix}-required-skills`}
            legend="Must-have skills"
            hint="A candidate should need these on day one."
            error={requiredError}
          >
            <div className="flex flex-wrap gap-2">
              {JOB_SKILL_KEYS.map((key) => (
                <ChoiceButton
                  key={key}
                  active={requiredSkills.includes(key)}
                  disabled={disabled}
                  onClick={() => toggleRequiredSkill(key)}
                >
                  {skillLabel(key)}
                </ChoiceButton>
              ))}
            </div>
          </Group>
          <CustomSkillEditor
            id={`${prefix}-other-required`}
            label="Other must-have skill"
            value={state.otherRequiredSkills}
            disabled={disabled}
            tone="white"
            onChange={(next) => {
              const selected = new Set(next.map((value) => value.trim().toLocaleLowerCase()));
              onChange(
                {
                  otherRequiredSkills: next,
                  otherPreferredSkills: (state.otherPreferredSkills || []).filter(
                    (value) => !selected.has(value.trim().toLocaleLowerCase()),
                  ),
                },
                ["other_required_skills", "other_preferred_skills"],
              );
            }}
          />
          <Field
            id={`${prefix}-required-note`}
            label="Must-have context"
            hint="Explain the expected level or evidence, without repeating the job description."
            error={getError(errors, "required_skills_note")}
            optional
          >
            <textarea
              id={`${prefix}-required-note`}
              className={textareaClass}
              value={state.requiredSkillsNote}
              disabled={disabled}
              maxLength={1000}
              aria-invalid={Boolean(getError(errors, "required_skills_note"))}
              aria-describedby={describedBy(
                `${prefix}-required-note`,
                true,
                getError(errors, "required_skills_note"),
              )}
              placeholder="For example: portfolios should show retention-led pacing across 8–12 minute videos."
              onChange={(event) => onChange({ requiredSkillsNote: event.target.value }, ["required_skills_note"])}
            />
          </Field>

          <div className="border-t border-white/[0.07] pt-5">
            <Group
              id={`${prefix}-preferred-skills`}
              legend="Nice-to-have skills"
              hint="These can strengthen an application but should not block it."
              error={preferredError}
            >
              <div className="flex flex-wrap gap-2">
                {JOB_SKILL_KEYS.map((key) => (
                  <ChoiceButton
                    key={key}
                    active={preferredSkills.includes(key)}
                    disabled={disabled}
                    tone="amber"
                    onClick={() => togglePreferredSkill(key)}
                  >
                    {skillLabel(key)}
                  </ChoiceButton>
                ))}
              </div>
            </Group>
            <div className="mt-3">
              <CustomSkillEditor
                id={`${prefix}-other-preferred`}
                label="Other nice-to-have skill"
                value={state.otherPreferredSkills}
                disabled={disabled}
                tone="amber"
                onChange={(next) => {
                  const selected = new Set(next.map((value) => value.trim().toLocaleLowerCase()));
                  onChange(
                    {
                      otherPreferredSkills: next,
                      otherRequiredSkills: (state.otherRequiredSkills || []).filter(
                        (value) => !selected.has(value.trim().toLocaleLowerCase()),
                      ),
                    },
                    ["other_preferred_skills", "other_required_skills"],
                  );
                }}
              />
            </div>
            <div className="mt-3">
              <Field
                id={`${prefix}-preferred-note`}
                label="Nice-to-have context"
                error={getError(errors, "preferred_skills_note")}
                optional
              >
                <textarea
                  id={`${prefix}-preferred-note`}
                  className={textareaClass}
                  value={state.preferredSkillsNote}
                  disabled={disabled}
                  maxLength={1000}
                  aria-invalid={Boolean(getError(errors, "preferred_skills_note"))}
                  aria-describedby={describedBy(
                    `${prefix}-preferred-note`,
                    false,
                    getError(errors, "preferred_skills_note"),
                  )}
                  placeholder="For example: experience adapting long-form stories into Shorts is useful."
                  onChange={(event) =>
                    onChange({ preferredSkillsNote: event.target.value }, ["preferred_skills_note"])
                  }
                />
              </Field>
            </div>
          </div>
        </div>
      </DomainCard>
      ) : null}

      {show("languages") ? (
      <DomainCard
        id={`${prefix}-languages`}
        eyebrow="Communication"
        title="Language requirements"
        description={
          rules.showLanguages
            ? "Add a language only when the work genuinely depends on it, then say how it will be used."
            : "This role does not usually need a language requirement. Add one only when the actual work does."
        }
        action={
          <button type="button" className={secondaryButtonClass} disabled={disabled} onClick={addLanguage}>
            + Add language
          </button>
        }
      >
        {legacyLanguages?.length ? (
          <div className="mb-4">
            <Notice tone="amber">
              Existing language tags: <span className="font-semibold">{legacyLanguages.join(", ")}</span>. These are broad search tags from an earlier format, not confirmed proficiency requirements. They stay unchanged; add structured rows only when the language is truly required or preferred for this work.
            </Notice>
          </div>
        ) : null}
        {languages.length ? (
          <div className="space-y-3">
            {languages.map((item, index) => {
              const rowId = `job-language-${item.id}`;
              const rowErrorId = `${rowId}-purposes-error`;
              const rowError = getError(
                errors,
                `language_requirements.${index}`,
                `language_requirements.${index}.language`,
                `language_requirements.${index}.purposes`,
              );
              return (
                <section
                  key={item.id}
                  id={rowId}
                  aria-labelledby={`${rowId}-title`}
                  className="rounded-xl border border-white/10 bg-black/10 p-3.5"
                >
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <h4 id={`${rowId}-title`} className="text-xs font-semibold text-white/76">
                      Language {index + 1}
                    </h4>
                    <RowControls
                      label={`language ${index + 1}`}
                      index={index}
                      count={languages.length}
                      disabled={disabled}
                      onMove={(direction) =>
                        onChange(
                          { languageRequirements: moveRow(languages, index, direction) },
                          ["language_requirements"],
                        )
                      }
                      onRemove={() =>
                        onChange(
                          { languageRequirements: languages.filter((entry) => entry.id !== item.id) },
                          ["language_requirements"],
                        )
                      }
                    />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field id={`${rowId}-name`} label="Language">
                      <input
                        id={`${rowId}-name`}
                        className={inputClass}
                        value={item.language}
                        disabled={disabled}
                        maxLength={80}
                        aria-invalid={Boolean(rowError)}
                        aria-describedby={rowError ? rowErrorId : undefined}
                        placeholder="e.g. Hindi"
                        onChange={(event) => updateLanguage(item.id, { language: event.target.value })}
                      />
                    </Field>
                    <Field id={`${rowId}-priority`} label="Priority">
                      <select
                        id={`${rowId}-priority`}
                        className={selectClass}
                        value={item.priority}
                        disabled={disabled}
                        aria-invalid={Boolean(rowError)}
                        aria-describedby={rowError ? rowErrorId : undefined}
                        onChange={(event) =>
                          updateLanguage(item.id, {
                            priority: event.target.value as LanguagePriority | "",
                          })
                        }
                      >
                        <option value="" className="bg-[#111116]">Choose priority</option>
                        {(Object.keys(LANGUAGE_PRIORITY_LABELS) as LanguagePriority[]).map((value) => (
                          <option key={value} value={value} className="bg-[#111116]">
                            {LANGUAGE_PRIORITY_LABELS[value]}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field id={`${rowId}-proficiency`} label="Proficiency" optional>
                      <select
                        id={`${rowId}-proficiency`}
                        className={selectClass}
                        value={item.proficiency}
                        disabled={disabled}
                        onChange={(event) =>
                          updateLanguage(item.id, {
                            proficiency: event.target.value as LanguageProficiency | "",
                          })
                        }
                      >
                        <option value="" className="bg-[#111116]">Not specified</option>
                        {(Object.keys(LANGUAGE_PROFICIENCY_LABELS) as LanguageProficiency[]).map((value) => (
                          <option key={value} value={value} className="bg-[#111116]">
                            {LANGUAGE_PROFICIENCY_LABELS[value]}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <div className="mt-3">
                    <Group id={`${rowId}-purposes`} legend="Used for" error={rowError}>
                      <div className="flex flex-wrap gap-2">
                        {JOB_LANGUAGE_PURPOSES.map((purpose) => (
                          <ChoiceButton
                            key={purpose}
                            active={item.purposes.includes(purpose)}
                            disabled={disabled}
                            onClick={() =>
                              updateLanguage(item.id, {
                                purposes: item.purposes.includes(purpose)
                                  ? item.purposes.filter((entry) => entry !== purpose)
                                  : [...item.purposes, purpose],
                              })
                            }
                          >
                            {languagePurposeLabel(purpose)}
                          </ChoiceButton>
                        ))}
                      </div>
                    </Group>
                  </div>
                  <div className="mt-3">
                    <Field id={`${rowId}-notes`} label="Language context" optional>
                      <input
                        id={`${rowId}-notes`}
                        className={inputClass}
                        value={item.notes}
                        disabled={disabled}
                        maxLength={300}
                        placeholder="e.g. Understand spoken interviews; candidate does not need to write scripts"
                        onChange={(event) => updateLanguage(item.id, { notes: event.target.value })}
                      />
                    </Field>
                  </div>
                </section>
              );
            })}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-white/12 bg-black/10 px-4 py-5 text-center text-xs leading-5 text-subtle">
            No structured language requirement. Candidates will not be excluded by an implied proficiency level.
          </div>
        )}
        {languageError ? <p role="alert" className="mt-2 text-[11px] text-amber-200/90">{languageError}</p> : null}
      </DomainCard>
      ) : null}
    </div>
  );
}

export type TrialApplicationSection = "trial" | "process" | "apply";

export type TrialApplicationFieldsProps = JobDomainBaseProps & {
  /** Which cards to render. Omit to render all (backward compatible). */
  sections?: TrialApplicationSection[];
  engagementType?: EngagementType | "" | null;
  compensationCurrency?: string | null;
  compensationUnit?: CompensationUnit | "" | null;
  /** Existing candidate-facing requirement chips rendered elsewhere in the posting flow. */
  legacyApplicationRequirements?: readonly string[] | null;
  publicInstructionsLockedReason?: string | null;
};

export function TrialApplicationFields({
  state,
  onChange,
  errors,
  disabled,
  className = "",
  engagementType,
  compensationCurrency,
  compensationUnit,
  legacyApplicationRequirements,
  publicInstructionsLockedReason,
  sections,
}: TrialApplicationFieldsProps) {
  const prefix = `job-application-${cleanId(useId())}`;
  const show = (section: TrialApplicationSection) => !sections || sections.includes(section);
  const stages = state.hiringProcess ?? [];
  const questions = state.screeningQuestions ?? [];
  const hasTrialTerms = state.trialStatus === "paid" || state.trialStatus === "unpaid";
  const hasRetainedTrialTerms = Boolean(
    state.trialScope.trim() ||
      state.trialEffortValue.trim() ||
      state.trialEffortUnit ||
      state.trialCompensationAmount.trim() ||
      state.trialCompensationCurrency.trim() ||
      state.trialCompensationBasis ||
      state.trialWorkUsage ||
      state.trialPortfolioPermission ||
      state.trialAttribution ||
      state.unpaidTrialConfirmed ||
      state.trialNotes.trim(),
  );
  const trialError = getError(
    errors,
    "trial_status",
    "trial_scope",
    "trial_effort_value",
    "trial_effort_unit",
    "trial_compensation_amount",
    "trial_compensation_currency",
    "trial_compensation_basis",
    "trial_work_usage",
    "trial_portfolio_permission",
    "trial_attribution",
    "unpaid_trial_confirmed",
  );
  const processError = getError(errors, "hiring_process");
  const questionsError = getError(errors, "screening_questions");
  const applicationError = getError(
    errors,
    "application_mode",
    "external_apply_url",
    "deadline_at",
    "how_to_apply",
  );

  const addStage = () => {
    const next: EditableHiringStage = {
      id: makeRowId("stage"),
      stage: "",
      customLabel: "",
      notes: "",
    };
    onChange({ hiringProcess: [...stages, next] }, ["hiring_process"]);
  };

  const updateStage = (id: string, patch: Partial<EditableHiringStage>) => {
    onChange(
      { hiringProcess: stages.map((item) => (item.id === id ? { ...item, ...patch } : item)) },
      ["hiring_process"],
    );
  };

  const addQuestion = () => {
    const next: EditableScreeningQuestion = {
      id: makeRowId("question"),
      prompt: "",
      required: false,
      responseGuidance: "",
    };
    onChange({ screeningQuestions: [...questions, next] }, ["screening_questions"]);
  };

  const updateQuestion = (id: string, patch: Partial<EditableScreeningQuestion>) => {
    onChange(
      { screeningQuestions: questions.map((item) => (item.id === id ? { ...item, ...patch } : item)) },
      ["screening_questions"],
    );
  };

  const engagementContext = engagementType
    ? `Keep any trial proportionate to a ${engagementLabel(engagementType).toLowerCase()} opportunity.`
    : "Keep any trial small and proportionate to the opportunity.";

  return (
    <div className={`space-y-4 ${className}`}>
      {show("trial") ? (
      <DomainCard
        id={`${prefix}-trial`}
        eyebrow="Fair trials"
        title="Will the process include trial work?"
        description={`${engagementContext} Candidates should see the scope, effort, usage, and pay before agreeing.`}
      >
        <div className="space-y-5">
          <Group
            id={`${prefix}-trial-status`}
            legend="Trial plan"
            error={getError(errors, "trial_status")}
          >
            <div className="grid gap-2 sm:grid-cols-2">
              {(Object.keys(TRIAL_STATUS_LABELS) as TrialStatus[]).map((value) => {
                const option = TRIAL_STATUS_LABELS[value];
                return (
                  <ChoiceButton
                    key={value}
                    active={state.trialStatus === value}
                    disabled={disabled}
                    tone={value === "unpaid" ? "amber" : "white"}
                    onClick={() =>
                      onChange({ trialStatus: state.trialStatus === value ? "" : value }, ["trial_status"])
                    }
                  >
                    <span className="block">{option.label}</span>
                    <span className="mt-1 block text-[11px] font-normal leading-4 opacity-65">
                      {option.description}
                    </span>
                  </ChoiceButton>
                );
              })}
            </div>
          </Group>

          {hasTrialTerms ? (
            <div className="space-y-4 rounded-2xl border border-white/10 bg-black/10 p-3.5 sm:p-4">
              <Field
                id={`${prefix}-trial-scope`}
                label="Trial scope"
                hint="Describe a bounded evaluation, not free production work."
                error={getError(errors, "trial_scope")}
              >
                <textarea
                  id={`${prefix}-trial-scope`}
                  className={textareaClass}
                  value={state.trialScope}
                  disabled={disabled}
                  maxLength={1200}
                  aria-invalid={Boolean(getError(errors, "trial_scope"))}
                  aria-describedby={describedBy(
                    `${prefix}-trial-scope`,
                    true,
                    getError(errors, "trial_scope"),
                  )}
                  placeholder="For example: edit one 45-second sample from supplied footage using an existing style guide."
                  onChange={(event) => onChange({ trialScope: event.target.value }, ["trial_scope"])}
                />
              </Field>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  id={`${prefix}-trial-effort`}
                  label="Expected effort"
                  error={getError(errors, "trial_effort_value")}
                >
                  <input
                    id={`${prefix}-trial-effort`}
                    type="number"
                    min="0.25"
                    step="0.25"
                    inputMode="decimal"
                    className={inputClass}
                    value={state.trialEffortValue}
                    disabled={disabled}
                    aria-invalid={Boolean(getError(errors, "trial_effort_value"))}
                    aria-describedby={describedBy(
                      `${prefix}-trial-effort`,
                      false,
                      getError(errors, "trial_effort_value"),
                    )}
                    placeholder="2"
                    onChange={(event) =>
                      onChange({ trialEffortValue: event.target.value }, ["trial_effort_value"])
                    }
                  />
                </Field>
                <Field
                  id={`${prefix}-trial-effort-unit`}
                  label="Effort unit"
                  error={getError(errors, "trial_effort_unit")}
                >
                  <select
                    id={`${prefix}-trial-effort-unit`}
                    className={selectClass}
                    value={state.trialEffortUnit}
                    disabled={disabled}
                    aria-invalid={Boolean(getError(errors, "trial_effort_unit"))}
                    aria-describedby={describedBy(
                      `${prefix}-trial-effort-unit`,
                      false,
                      getError(errors, "trial_effort_unit"),
                    )}
                    onChange={(event) =>
                      onChange(
                        { trialEffortUnit: event.target.value as TrialEffortUnit | "" },
                        ["trial_effort_unit"],
                      )
                    }
                  >
                    <option value="" className="bg-[#111116]">Choose unit</option>
                    {(Object.keys(TRIAL_EFFORT_LABELS) as TrialEffortUnit[]).map((value) => (
                      <option key={value} value={value} className="bg-[#111116]">
                        {TRIAL_EFFORT_LABELS[value]}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              {state.trialStatus === "paid" ? (
                <div className="rounded-xl border border-white/10 bg-white/[0.035] p-3.5">
                  <div className="mb-3">
                    <p className="text-xs font-semibold text-white/80">Trial compensation</p>
                    <p className="mt-1 text-[11px] leading-4 text-subtle">
                      Trial pay is explicit and separate from the main job rate
                      {compensationUnit ? ` (${compensationUnit})` : ""}.
                    </p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field
                      id={`${prefix}-trial-amount`}
                      label="Amount"
                      error={getError(errors, "trial_compensation_amount")}
                    >
                      <input
                        id={`${prefix}-trial-amount`}
                        type="number"
                        min="0.01"
                        step="0.01"
                        inputMode="decimal"
                        className={inputClass}
                        value={state.trialCompensationAmount}
                        disabled={disabled}
                        aria-invalid={Boolean(getError(errors, "trial_compensation_amount"))}
                        aria-describedby={describedBy(
                          `${prefix}-trial-amount`,
                          false,
                          getError(errors, "trial_compensation_amount"),
                        )}
                        placeholder="1500"
                        onChange={(event) =>
                          onChange(
                            { trialCompensationAmount: event.target.value },
                            ["trial_compensation_amount"],
                          )
                        }
                      />
                    </Field>
                    <Field
                      id={`${prefix}-trial-currency`}
                      label="Currency"
                      error={getError(errors, "trial_compensation_currency")}
                    >
                      <input
                        id={`${prefix}-trial-currency`}
                        className={inputClass}
                        value={state.trialCompensationCurrency}
                        disabled={disabled}
                        maxLength={3}
                        autoCapitalize="characters"
                        aria-invalid={Boolean(getError(errors, "trial_compensation_currency"))}
                        aria-describedby={describedBy(
                          `${prefix}-trial-currency`,
                          false,
                          getError(errors, "trial_compensation_currency"),
                        )}
                        placeholder={compensationCurrency?.toUpperCase() || "INR"}
                        onChange={(event) =>
                          onChange(
                            {
                              trialCompensationCurrency: event.target.value
                                .replace(/[^a-z]/gi, "")
                                .toUpperCase(),
                            },
                            ["trial_compensation_currency"],
                          )
                        }
                      />
                    </Field>
                    <Field
                      id={`${prefix}-trial-basis`}
                      label="Pay basis"
                      error={getError(errors, "trial_compensation_basis")}
                    >
                      <select
                        id={`${prefix}-trial-basis`}
                        className={selectClass}
                        value={state.trialCompensationBasis}
                        disabled={disabled}
                        aria-invalid={Boolean(getError(errors, "trial_compensation_basis"))}
                        aria-describedby={describedBy(
                          `${prefix}-trial-basis`,
                          false,
                          getError(errors, "trial_compensation_basis"),
                        )}
                        onChange={(event) =>
                          onChange(
                            {
                              trialCompensationBasis: event.target.value as TrialCompensationBasis | "",
                            },
                            ["trial_compensation_basis"],
                          )
                        }
                      >
                        <option value="" className="bg-[#111116]">Choose basis</option>
                        {(Object.keys(TRIAL_COMPENSATION_BASIS_LABELS) as TrialCompensationBasis[]).map(
                          (value) => (
                            <option key={value} value={value} className="bg-[#111116]">
                              {TRIAL_COMPENSATION_BASIS_LABELS[value]}
                            </option>
                          ),
                        )}
                      </select>
                    </Field>
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-amber-200/22 bg-amber-200/[0.07] p-3.5">
                  <p className="text-xs font-semibold text-amber-100">Explicit unpaid-trial confirmation</p>
                  <p className="mt-1 text-[11px] leading-5 text-amber-100/68">
                    The task should be brief, evaluation-only where possible, and never replace paid production work.
                  </p>
                  <label
                    htmlFor={`${prefix}-unpaid-confirmed`}
                    className="mt-3 flex cursor-pointer items-start gap-3 text-xs leading-5 text-amber-50/88"
                  >
                    <input
                      id={`${prefix}-unpaid-confirmed`}
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 rounded border-white/20 bg-black/20 accent-white"
                      checked={state.unpaidTrialConfirmed}
                      disabled={disabled}
                      aria-invalid={Boolean(getError(errors, "unpaid_trial_confirmed"))}
                      aria-describedby={
                        getError(errors, "unpaid_trial_confirmed")
                          ? `${prefix}-unpaid-confirmed-error`
                          : undefined
                      }
                      onChange={(event) =>
                        onChange({ unpaidTrialConfirmed: event.target.checked }, ["unpaid_trial_confirmed"])
                      }
                    />
                    <span>
                      I confirm this unpaid task is necessary for evaluation, tightly scoped, and disclosed before the candidate opts in.
                    </span>
                  </label>
                  {getError(errors, "unpaid_trial_confirmed") ? (
                    <p
                      id={`${prefix}-unpaid-confirmed-error`}
                      role="alert"
                      className="mt-2 text-[11px] text-amber-100"
                    >
                      {getError(errors, "unpaid_trial_confirmed")}
                    </p>
                  ) : null}
                </div>
              )}

              <div className="grid gap-3 sm:grid-cols-3">
                <Field
                  id={`${prefix}-trial-usage`}
                  label="How trial work may be used"
                  error={getError(errors, "trial_work_usage")}
                >
                  <select
                    id={`${prefix}-trial-usage`}
                    className={selectClass}
                    value={state.trialWorkUsage}
                    disabled={disabled}
                    aria-invalid={Boolean(getError(errors, "trial_work_usage"))}
                    aria-describedby={describedBy(
                      `${prefix}-trial-usage`,
                      false,
                      getError(errors, "trial_work_usage"),
                    )}
                    onChange={(event) =>
                      onChange(
                        { trialWorkUsage: event.target.value as TrialWorkUsage | "" },
                        ["trial_work_usage"],
                      )
                    }
                  >
                    <option value="" className="bg-[#111116]">Choose usage</option>
                    {(Object.keys(TRIAL_USAGE_LABELS) as TrialWorkUsage[]).map((value) => (
                      <option key={value} value={value} className="bg-[#111116]">
                        {TRIAL_USAGE_LABELS[value]}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field
                  id={`${prefix}-trial-portfolio`}
                  label="Portfolio permission"
                  error={getError(errors, "trial_portfolio_permission")}
                >
                  <select
                    id={`${prefix}-trial-portfolio`}
                    className={selectClass}
                    value={state.trialPortfolioPermission}
                    disabled={disabled}
                    aria-invalid={Boolean(getError(errors, "trial_portfolio_permission"))}
                    aria-describedby={describedBy(
                      `${prefix}-trial-portfolio`,
                      false,
                      getError(errors, "trial_portfolio_permission"),
                    )}
                    onChange={(event) =>
                      onChange(
                        {
                          trialPortfolioPermission: event.target.value as TrialPortfolioPermission | "",
                        },
                        ["trial_portfolio_permission"],
                      )
                    }
                  >
                    <option value="" className="bg-[#111116]">Choose permission</option>
                    {(Object.keys(TRIAL_PORTFOLIO_LABELS) as TrialPortfolioPermission[]).map((value) => (
                      <option key={value} value={value} className="bg-[#111116]">
                        {TRIAL_PORTFOLIO_LABELS[value]}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field
                  id={`${prefix}-trial-attribution`}
                  label="Attribution"
                  error={getError(errors, "trial_attribution")}
                >
                  <select
                    id={`${prefix}-trial-attribution`}
                    className={selectClass}
                    value={state.trialAttribution}
                    disabled={disabled}
                    aria-invalid={Boolean(getError(errors, "trial_attribution"))}
                    aria-describedby={describedBy(
                      `${prefix}-trial-attribution`,
                      false,
                      getError(errors, "trial_attribution"),
                    )}
                    onChange={(event) =>
                      onChange(
                        { trialAttribution: event.target.value as TrialAttribution | "" },
                        ["trial_attribution"],
                      )
                    }
                  >
                    <option value="" className="bg-[#111116]">Choose attribution</option>
                    {(Object.keys(TRIAL_ATTRIBUTION_LABELS) as TrialAttribution[]).map((value) => (
                      <option key={value} value={value} className="bg-[#111116]">
                        {TRIAL_ATTRIBUTION_LABELS[value]}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <Field id={`${prefix}-trial-notes`} label="Other trial terms" optional>
                <textarea
                  id={`${prefix}-trial-notes`}
                  className={textareaClass}
                  value={state.trialNotes}
                  disabled={disabled}
                  maxLength={1000}
                  placeholder="Delivery timing, files returned, feedback promised, or anything candidates should know before opting in"
                  onChange={(event) => onChange({ trialNotes: event.target.value }, ["trial_notes"])}
                />
              </Field>
            </div>
          ) : hasRetainedTrialTerms ? (
            <Notice tone="amber">
              Previously entered trial terms remain available in this editing session if you switch back. Saving after explicitly changing the trial plan to “{state.trialStatus === "none" ? "No trial" : "Not decided"}” clears those saved detail terms; unrelated edits preserve existing trial details.
            </Notice>
          ) : null}
          {trialError ? <p role="alert" className="text-[11px] text-amber-200/90">{trialError}</p> : null}
        </div>
      </DomainCard>
      ) : null}

      {show("process") ? (
      <DomainCard
        id={`${prefix}-process`}
        eyebrow="Hiring process"
        title="Show candidates what happens next"
        description="Keep the sequence realistic. Add a stage only when candidates will actually encounter it."
        action={
          <button type="button" className={secondaryButtonClass} disabled={disabled} onClick={addStage}>
            + Add stage
          </button>
        }
      >
        {stages.length ? (
          <ol className="space-y-3">
            {stages.map((item, index) => {
              const rowId = `job-stage-${item.id}`;
              const rowErrorId = `${rowId}-error`;
              const rowError = getError(
                errors,
                `hiring_process.${index}`,
                `hiring_process.${index}.stage`,
                `hiring_process.${index}.custom_label`,
              );
              return (
                <li
                  key={item.id}
                  id={rowId}
                  className="rounded-xl border border-white/10 bg-black/10 p-3.5"
                >
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span
                        aria-hidden="true"
                        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/12 bg-white/[0.06] text-xs font-semibold text-white/72"
                      >
                        {index + 1}
                      </span>
                      <span className="truncate text-xs font-semibold text-white/72">Stage {index + 1}</span>
                    </div>
                    <RowControls
                      label={`hiring stage ${index + 1}`}
                      index={index}
                      count={stages.length}
                      disabled={disabled}
                      onMove={(direction) =>
                        onChange({ hiringProcess: moveRow(stages, index, direction) }, ["hiring_process"])
                      }
                      onRemove={() =>
                        onChange({ hiringProcess: stages.filter((entry) => entry.id !== item.id) }, [
                          "hiring_process",
                        ])
                      }
                    />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field id={`${rowId}-type`} label="Stage">
                      <select
                        id={`${rowId}-type`}
                        className={selectClass}
                        value={item.stage}
                        disabled={disabled}
                        aria-invalid={Boolean(rowError)}
                        aria-describedby={rowError ? rowErrorId : undefined}
                        onChange={(event) =>
                          updateStage(item.id, {
                            stage: event.target.value as HiringProcessStageType | "",
                          })
                        }
                      >
                        <option value="" className="bg-[#111116]">Choose stage</option>
                        {JOB_HIRING_STAGES.map((value) => (
                          <option key={value} value={value} className="bg-[#111116]">
                            {hiringStageLabel(value)}
                          </option>
                        ))}
                      </select>
                    </Field>
                    {item.stage === "other" ? (
                      <Field id={`${rowId}-custom`} label="Stage name">
                        <input
                          id={`${rowId}-custom`}
                          className={inputClass}
                          value={item.customLabel}
                          disabled={disabled}
                          maxLength={120}
                          aria-invalid={Boolean(rowError)}
                          aria-describedby={rowError ? rowErrorId : undefined}
                          placeholder="e.g. Meet the channel lead"
                          onChange={(event) => updateStage(item.id, { customLabel: event.target.value })}
                        />
                      </Field>
                    ) : (
                      <Field id={`${rowId}-notes`} label="What candidates can expect" optional>
                        <input
                          id={`${rowId}-notes`}
                          className={inputClass}
                          value={item.notes}
                          disabled={disabled}
                          maxLength={300}
                          placeholder="e.g. 20-minute call with the creator"
                          onChange={(event) => updateStage(item.id, { notes: event.target.value })}
                        />
                      </Field>
                    )}
                  </div>
                  {item.stage === "other" ? (
                    <div className="mt-3">
                      <Field id={`${rowId}-notes`} label="What candidates can expect" optional>
                        <input
                          id={`${rowId}-notes`}
                          className={inputClass}
                          value={item.notes}
                          disabled={disabled}
                          maxLength={300}
                          placeholder="Timing, people involved, or preparation needed"
                          onChange={(event) => updateStage(item.id, { notes: event.target.value })}
                        />
                      </Field>
                    </div>
                  ) : null}
                  {rowError ? (
                    <p id={rowErrorId} role="alert" className="mt-2 text-[11px] text-amber-200/90">
                      {rowError}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ol>
        ) : (
          <div className="rounded-xl border border-dashed border-white/12 bg-black/10 px-4 py-5 text-center text-xs leading-5 text-subtle">
            No stages listed yet. A short, honest process usually gets better-completed applications.
          </div>
        )}
        {processError ? <p role="alert" className="mt-2 text-[11px] text-amber-200/90">{processError}</p> : null}
        <div className="mt-4">
          <Field id={`${prefix}-process-notes`} label="Process note" optional>
            <textarea
              id={`${prefix}-process-notes`}
              className={textareaClass}
              value={state.hiringProcessNotes}
              disabled={disabled}
              maxLength={1000}
              placeholder="Expected decision timing, who candidates meet, or when feedback is shared"
              onChange={(event) => onChange({ hiringProcessNotes: event.target.value }, ["hiring_process_notes"])}
            />
          </Field>
        </div>

        <div className="mt-5 border-t border-white/[0.07] pt-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h4 className="text-xs font-semibold text-white/80">Screening questions</h4>
              <p className="mt-1 text-[11px] leading-4 text-subtle">
                Ask only what helps you shortlist. Portfolio requests can stay in the existing application requirements.
              </p>
            </div>
            <button type="button" className={secondaryButtonClass} disabled={disabled} onClick={addQuestion}>
              + Add question
            </button>
          </div>
          {questions.length ? (
            <div className="mt-3 space-y-3">
              {questions.map((item, index) => {
                const rowId = `job-question-${item.id}`;
                const rowErrorId = `${rowId}-error`;
                const rowError = getError(
                  errors,
                  `screening_questions.${index}`,
                  `screening_questions.${index}.prompt`,
                );
                return (
                  <section key={item.id} id={rowId} className="rounded-xl border border-white/10 bg-black/10 p-3.5">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                      <h5 className="text-xs font-semibold text-white/72">Question {index + 1}</h5>
                      <RowControls
                        label={`screening question ${index + 1}`}
                        index={index}
                        count={questions.length}
                        disabled={disabled}
                        onMove={(direction) =>
                          onChange(
                            { screeningQuestions: moveRow(questions, index, direction) },
                            ["screening_questions"],
                          )
                        }
                        onRemove={() =>
                          onChange(
                            { screeningQuestions: questions.filter((entry) => entry.id !== item.id) },
                            ["screening_questions"],
                          )
                        }
                      />
                    </div>
                    <Field id={`${rowId}-prompt`} label="Question">
                      <textarea
                        id={`${rowId}-prompt`}
                        className={textareaClass}
                        value={item.prompt}
                        disabled={disabled}
                        maxLength={500}
                        aria-invalid={Boolean(rowError)}
                        aria-describedby={rowError ? rowErrorId : undefined}
                        placeholder="What would you change in the first 30 seconds of one recent video, and why?"
                        onChange={(event) => updateQuestion(item.id, { prompt: event.target.value })}
                      />
                    </Field>
                    <div className="mt-3 grid gap-3 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-end">
                      <label
                        htmlFor={`${rowId}-required`}
                        className="flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-xs font-medium text-white/70"
                      >
                        <input
                          id={`${rowId}-required`}
                          type="checkbox"
                          className="h-4 w-4 rounded border-white/20 bg-black/20 accent-white"
                          checked={item.required}
                          disabled={disabled}
                          onChange={(event) => updateQuestion(item.id, { required: event.target.checked })}
                        />
                        Response required
                      </label>
                      <Field id={`${rowId}-guidance`} label="Answer guidance" optional>
                        <input
                          id={`${rowId}-guidance`}
                          className={inputClass}
                          value={item.responseGuidance}
                          disabled={disabled}
                          maxLength={300}
                          placeholder="e.g. 3–5 sentences; no unpaid sample work"
                          onChange={(event) =>
                            updateQuestion(item.id, { responseGuidance: event.target.value })
                          }
                        />
                      </Field>
                    </div>
                    {rowError ? (
                      <p id={rowErrorId} role="alert" className="mt-2 text-[11px] text-amber-200/90">
                        {rowError}
                      </p>
                    ) : null}
                  </section>
                );
              })}
            </div>
          ) : null}
          {questionsError ? <p role="alert" className="mt-2 text-[11px] text-amber-200/90">{questionsError}</p> : null}
        </div>
      </DomainCard>
      ) : null}

      {show("apply") ? (
      <DomainCard
        id={`${prefix}-apply`}
        eyebrow="Applications"
        title="Where and how should candidates apply?"
        description="Everything here is candidate-visible. Do not include internal notes or private contact details."
      >
        <div className="space-y-5">
          <Group
            id={`${prefix}-application-mode`}
            legend="Application route"
            hint="CreatorJobs applications keep the candidate's response and portfolio with the listing."
            error={getError(errors, "application_mode", "external_apply_url")}
          >
            <div className="grid gap-2 sm:grid-cols-2">
              <ChoiceButton
                active={state.applicationMode === "internal"}
                disabled={disabled}
                onClick={() => onChange({ applicationMode: "internal" }, ["application_mode"])}
              >
                <span className="block">Apply on CreatorJobs</span>
                <span className="mt-1 block text-[11px] font-normal leading-4 opacity-65">
                  Review applications in your recruiter workspace.
                </span>
              </ChoiceButton>
              <ChoiceButton
                active={state.applicationMode === "external"}
                disabled={disabled}
                onClick={() => onChange({ applicationMode: "external" }, ["application_mode"])}
              >
                <span className="block">Apply on another site</span>
                <span className="mt-1 block text-[11px] font-normal leading-4 opacity-65">
                  Send candidates to one secure application URL.
                </span>
              </ChoiceButton>
            </div>
          </Group>
          {state.applicationMode === "external" ? (
            <Field
              id={`${prefix}-external-url`}
              label="External application URL"
              hint="Use the final application page, not a company homepage or tracking redirect."
              error={getError(errors, "external_apply_url")}
            >
              <input
                id={`${prefix}-external-url`}
                type="url"
                inputMode="url"
                autoCapitalize="none"
                autoCorrect="off"
                className={inputClass}
                value={state.externalApplyUrl}
                disabled={disabled}
                maxLength={2000}
                aria-invalid={Boolean(getError(errors, "external_apply_url"))}
                aria-describedby={describedBy(
                  `${prefix}-external-url`,
                  true,
                  getError(errors, "external_apply_url"),
                )}
                placeholder="https://…"
                onChange={(event) => onChange({ externalApplyUrl: event.target.value }, ["external_apply_url"])}
              />
            </Field>
          ) : state.externalApplyUrl.trim() ? (
            <Notice>
              The external URL entered earlier is retained in this draft, but it is not published while CreatorJobs applications are selected.
            </Notice>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              id={`${prefix}-deadline`}
              label="Application deadline"
              hint="Shown in the recruiter's local date and time while editing."
              error={getError(errors, "deadline_at")}
              optional
            >
              <input
                id={`${prefix}-deadline`}
                type="datetime-local"
                className={`${inputClass} [color-scheme:dark]`}
                value={state.deadlineAt}
                disabled={disabled}
                aria-invalid={Boolean(getError(errors, "deadline_at"))}
                aria-describedby={describedBy(
                  `${prefix}-deadline`,
                  true,
                  getError(errors, "deadline_at"),
                )}
                onChange={(event) => onChange({ deadlineAt: event.target.value }, ["deadline_at"])}
              />
            </Field>
            <div className="self-end">
              <Notice>
                Leave blank for a rolling search. Close the listing when the role is filled so candidates are not sent to a dead application.
              </Notice>
            </div>
          </div>

          {legacyApplicationRequirements?.length ? (
            <Notice tone="amber">
              Existing application requests remain active: <span className="font-semibold">{legacyApplicationRequirements.join(", ")}</span>. The public instructions below should clarify them, not silently replace them.
            </Notice>
          ) : null}

          <Field
            id={`${prefix}-how-to-apply`}
            label="Public how-to-apply note"
            hint={publicInstructionsLockedReason || "Tell candidates what to submit, what a strong response includes, and what not to send."}
            error={getError(errors, "how_to_apply")}
            optional
          >
            <textarea
              id={`${prefix}-how-to-apply`}
              className={`${textareaClass} min-h-28`}
              value={state.howToApply}
              disabled={disabled || Boolean(publicInstructionsLockedReason)}
              maxLength={2000}
              aria-invalid={Boolean(getError(errors, "how_to_apply"))}
              aria-describedby={describedBy(
                `${prefix}-how-to-apply`,
                true,
                getError(errors, "how_to_apply"),
              )}
              placeholder={
                state.applicationMode === "external"
                  ? "Use the link above. Include 2 relevant samples and briefly explain your role in each."
                  : "Apply on CreatorJobs with 2 relevant samples and a short note about your approach."
              }
              onChange={(event) => onChange({ howToApply: event.target.value }, ["how_to_apply"])}
            />
          </Field>
          {applicationError ? <p role="alert" className="text-[11px] text-amber-200/90">{applicationError}</p> : null}
        </div>
      </DomainCard>
      ) : null}
    </div>
  );
}
