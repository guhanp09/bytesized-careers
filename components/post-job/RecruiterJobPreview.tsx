"use client";

import type { ReactNode } from "react";
import Image from "next/image";

import type { BackendHiringIdentityVerificationStatus } from "../../lib/backendClient";
import {
  type CompensationMode,
  type CompensationUnit,
  type EmployerContextType,
  type EngagementType,
  type TurnaroundBasis,
  type TurnaroundUnit,
} from "../../lib/jobContract";
import {
  applicationRequirementLabel,
  autonomyForJob,
  cleanJobText,
  durationForJob,
  employerContextLabel,
  engagementForJob,
  formatJobCompensation,
  formatJobDate,
  formatJobMoney,
  formatTurnaround,
  formatWeeklyHours,
  hiringStageLabel,
  jobDeliverableFrequencyLabel,
  jobDeliverableTypeLabel,
  jobSkillLabel,
  revisionForJob,
  sentenceCaseJobValue,
  sourceInputLabel,
  splitJobLines,
  startForJob,
  uniqueJobText,
} from "../../lib/jobPresentation";
import type { JobPostingDomainState } from "../../lib/jobPostingForm";
import type { ReferenceVideo } from "../../lib/types";
import { Icon } from "../Icons";
import {
  BodySection,
  BulletList,
  LISTING_PANEL_CLASS,
  Pills,
  SectionLabel,
} from "../listing-details/ListingSections";
import TagPill from "../ui/TagPill";
import ToolChip from "../ui/ToolChip";

export type RecruiterJobPreviewTurnaround = {
  value: number | string;
  unit: TurnaroundUnit | "";
  basis: TurnaroundBasis | "";
};

export type RecruiterJobPreviewProps = {
  title: string;
  employerName: string;
  employerAvatarUrl?: string | null;
  employerVerificationStatus?: BackendHiringIdentityVerificationStatus | null;
  roleName?: string | null;
  roleSpecialization?: string | null;
  employerContext?: EmployerContextType | "" | null;
  platform?: string | null;
  compensationMode?: CompensationMode | "" | null;
  budgetMin?: string | number | null;
  budgetMax?: string | number | null;
  budgetCurrency?: string | null;
  budgetUnit?: CompensationUnit | null;
  legacyBudgetUnit?: string | null;
  budgetUnitCustom?: string | null;
  budgetNote?: string | null;
  engagementType?: EngagementType | "" | null;
  workMode?: string | null;
  location?: string | null;
  expectedWeeklyHoursMin?: string | number | null;
  expectedWeeklyHoursMax?: string | number | null;
  turnaround?: RecruiterJobPreviewTurnaround | null;
  about?: string | null;
  responsibilities?: string | null;
  legacyRequirements?: string | null;
  tools?: readonly string[];
  languages?: readonly string[];
  applicationRequirements?: readonly string[];
  howToApply?: string | null;
  tags?: readonly string[];
  contentNiches?: readonly string[];
  contentGenres?: readonly string[];
  formatsHiredFor?: readonly string[];
  referenceVideos?: readonly ReferenceVideo[];
  domain: JobPostingDomainState;
  previewMode?: "rail" | "full";
};

type PreviewFacts = {
  role: string;
  compensation: string;
  engagement: string;
  workSetup: string;
  weeklyHours: string;
  turnaround: string;
  start: string;
  duration: string;
  application: string;
};

const text = cleanJobText;
const sentenceCase = sentenceCaseJobValue;
const unique = (items: readonly string[]) => uniqueJobText(items);
const splitLines = splitJobLines;

const platformLabel = (value?: string | null) => {
  const normalized = text(value).toLowerCase();
  if (normalized === "youtube") return "YouTube";
  if (normalized === "instagram") return "Instagram";
  if (normalized === "tiktok") return "TikTok";
  if (normalized === "x" || normalized === "x/twitter") return "X / Twitter";
  return text(value);
};

const contextLabel = (value?: EmployerContextType | "" | null) => employerContextLabel(value);

const verificationMeta = (status?: BackendHiringIdentityVerificationStatus | null) => {
  if (status === "VERIFIED") {
    return {
      icon: "check" as const,
      label: "Access confirmed",
      className: "border-emerald-300/20 bg-emerald-300/[0.08] text-emerald-100/80",
    };
  }
  if (status === "REJECTED") {
    return {
      icon: "alert" as const,
      label: "Verification needed",
      className: "border-amber-200/20 bg-amber-200/[0.08] text-amber-100/80",
    };
  }
  if (status === "PENDING") {
    return {
      icon: "clock" as const,
      label: "Verification pending",
      className: "border-white/12 bg-white/[0.045] text-white/58",
    };
  }
  if (status === "UNVERIFIED") {
    return {
      icon: "shield" as const,
      label: "Not verified",
      className: "border-white/12 bg-white/[0.045] text-white/58",
    };
  }
  return null;
};

const initials = (value: string) =>
  value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "CJ";

const TRIAL_STATUS_LABELS: Record<Exclude<JobPostingDomainState["trialStatus"], "">, string> = {
  none: "No trial",
  undecided: "Trial is not decided yet",
  paid: "Paid trial",
  unpaid: "Unpaid trial",
};

const TRIAL_USAGE_LABELS: Record<Exclude<JobPostingDomainState["trialWorkUsage"], "">, string> = {
  evaluation_only: "Evaluation only",
  may_use_privately: "May be used privately",
  may_publish: "May be published",
};

const PORTFOLIO_PERMISSION_LABELS: Record<
  Exclude<JobPostingDomainState["trialPortfolioPermission"], "">,
  string
> = {
  allowed: "Candidate may show it in their portfolio",
  not_allowed: "Portfolio use is not allowed",
  with_permission: "Portfolio use requires permission",
};

const ATTRIBUTION_LABELS: Record<Exclude<JobPostingDomainState["trialAttribution"], "">, string> = {
  credited: "Candidate will be credited",
  not_credited: "No public credit",
  not_applicable: "Attribution does not apply",
  to_be_agreed: "Attribution will be agreed",
};

const TRIAL_BASIS_LABELS: Record<string, string> = {
  flat: "flat",
  per_hour: "per hour",
  per_deliverable: "per deliverable",
  custom: "custom basis",
};

function EmptyReview({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed border-white/[0.1] bg-white/[0.025] px-3.5 py-3 text-sm leading-relaxed text-subtle">
      {children}
    </p>
  );
}

function PreviewFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-2xl border border-white/[0.07] bg-white/[0.03] px-4 py-3.5">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.18em] text-subtle">{label}</dt>
      <dd className="mt-1.5 break-words text-sm font-medium leading-snug text-white/84">{value}</dd>
    </div>
  );
}

function CompactGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-white/[0.07] px-4 py-4 first:border-t-0" aria-label={title}>
      <h3 className="text-[10px] font-semibold uppercase tracking-[0.2em] text-subtle">{title}</h3>
      <div className="mt-2.5 space-y-2 text-xs leading-relaxed text-white/67">{children}</div>
    </section>
  );
}

function CompactLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[88px_minmax(0,1fr)] gap-2.5">
      <span className="text-subtle">{label}</span>
      <span className="min-w-0 break-words text-right font-medium text-white/76">{value}</span>
    </div>
  );
}

function EmployerHeader({
  title,
  employerName,
  employerAvatarUrl,
  verificationStatus,
  role,
  specialization,
  employerContext,
  platform,
  compact = false,
}: {
  title: string;
  employerName: string;
  employerAvatarUrl?: string | null;
  verificationStatus?: BackendHiringIdentityVerificationStatus | null;
  role: string;
  specialization: string;
  employerContext: string;
  platform: string;
  compact?: boolean;
}) {
  const verification = verificationMeta(verificationStatus);
  const displayEmployer = text(employerName) || "Employer identity not selected";
  const displayTitle = text(title) || "Job title not added yet";

  return (
    <header className={compact ? "p-4" : "p-5 sm:p-7"}>
      <div className="flex min-w-0 items-center gap-3">
        <div
          className={[
            "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/[0.12] bg-white/[0.07] font-semibold text-white/68",
            compact ? "h-10 w-10 text-xs" : "h-12 w-12 text-sm",
          ].join(" ")}
        >
          {employerAvatarUrl ? (
            <Image
              src={employerAvatarUrl}
              alt={`${displayEmployer} avatar`}
              width={48}
              height={48}
              unoptimized
              className="h-full w-full object-cover"
            />
          ) : (
            <span aria-hidden="true">{initials(displayEmployer)}</span>
          )}
        </div>
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <p className="truncate text-sm font-semibold text-white/88">{displayEmployer}</p>
            {verification ? (
              <span
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${verification.className}`}
              >
                <Icon name={verification.icon} className="h-3 w-3" />
                {verification.label}
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 text-xs text-subtle">
            {[employerContext, platform].filter(Boolean).join(" · ") || "Hiring context not added"}
          </p>
        </div>
      </div>

      <h2
        className={[
          "break-words font-semibold tracking-tight text-white",
          compact ? "mt-4 text-lg leading-snug" : "mt-6 text-2xl leading-tight sm:text-[28px]",
        ].join(" ")}
      >
        {displayTitle}
      </h2>
      <p className={`${compact ? "mt-1.5 text-xs" : "mt-2 text-sm"} text-white/55`}>
        {role || "Creator role not selected"}
        {specialization ? <span className="text-subtle"> · {specialization}</span> : null}
      </p>
    </header>
  );
}

function referenceHost(urlValue: string) {
  try {
    return new URL(urlValue).hostname.replace(/^www\./, "");
  } catch {
    return urlValue;
  }
}

function safeReferenceUrl(urlValue: string) {
  try {
    const url = new URL(urlValue);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function buildFacts(props: RecruiterJobPreviewProps): PreviewFacts {
  const domain = props.domain;
  const role = text(props.roleName) || "Creator role not selected";
  const location = text(props.location);
  const workMode = text(props.workMode);
  const workSetup = [workMode, location].filter(Boolean).join(" · ") || "Work setup not added";
  // Always CreatorJobs. A stored external mode describes someone else's hiring
  // process, so the preview must not promise the recruiter it will be honoured.
  const application = "Apply through CreatorJobs";
  const compensation = formatJobCompensation({
    mode: props.compensationMode,
    minimum: props.budgetMin,
    maximum: props.budgetMax,
    currency: props.budgetCurrency,
    unit: props.budgetUnit || props.legacyBudgetUnit,
    customUnit: props.budgetUnitCustom,
    note: props.budgetNote,
  });
  const start = domain.startTiming
    ? startForJob({
        startTiming: domain.startTiming,
        startDate: domain.startDate || undefined,
        startTimeframe: "Flexible",
      })
    : "Start not specified";
  const duration = durationForJob({
    durationType: domain.durationType || undefined,
    durationValue: domain.durationValue ? Number(domain.durationValue) : undefined,
    durationUnit: domain.durationUnit || undefined,
    engagementEndDate: domain.engagementEndDate || undefined,
  });
  return {
    role,
    compensation: [compensation.headline, compensation.note].filter(Boolean).join(" · "),
    engagement: props.engagementType
      ? engagementForJob({ engagementType: props.engagementType })
      : "Engagement not selected",
    workSetup,
    weeklyHours: formatWeeklyHours(props.expectedWeeklyHoursMin, props.expectedWeeklyHoursMax),
    turnaround: formatTurnaround(
      props.turnaround?.value,
      props.turnaround?.unit,
      props.turnaround?.basis,
    ),
    start,
    duration,
    application,
  };
}

function RecruiterJobRailPreview(props: RecruiterJobPreviewProps) {
  const { domain } = props;
  const facts = buildFacts(props);
  const role = text(props.roleName);
  const specialization = text(props.roleSpecialization);
  const employerContext = contextLabel(props.employerContext || domain.employerContextType);
  const platform = platformLabel(props.platform);
  const deliverables = domain.deliverables || [];
  const responsibilities = splitLines(props.responsibilities);
  const legacyRequirements = splitLines(props.legacyRequirements);
  const requiredSkills = unique([
    ...(domain.requiredSkillKeys || []).map(jobSkillLabel),
    ...(domain.otherRequiredSkills || []),
  ]);
  const preferredSkills = unique([
    ...(domain.preferredSkillKeys || []).map(jobSkillLabel),
    ...(domain.otherPreferredSkills || []),
  ]);
  const tools = unique(props.tools || []);
  const trial = domain.trialStatus ? TRIAL_STATUS_LABELS[domain.trialStatus] : "Trial terms not added";
  const processCount = domain.hiringProcess?.length || 0;
  const applicationCount = (props.applicationRequirements || []).length;
  const deliverableLines = deliverables.map((item) => {
    const type = item.type
      ? item.type === "other"
        ? text(item.customType) || "Custom deliverable"
        : jobDeliverableTypeLabel(item.type)
      : "Deliverable type not chosen";
    const frequency = item.frequency
      ? item.frequency === "other"
        ? text(item.customFrequency) || "Custom frequency"
        : jobDeliverableFrequencyLabel(item.frequency)
      : "Frequency not chosen";
    return `${text(item.quantity) || "Quantity not added"} ${type} · ${frequency}`;
  });
  const workItems = unique([...deliverableLines, ...responsibilities]);
  const mustHaves = unique([...requiredSkills, ...legacyRequirements]);

  return (
    <section
      aria-label="Candidate listing preview"
      className="max-h-[calc(100dvh-7.5rem)] min-w-0 overflow-y-auto rounded-3xl border border-[var(--vt-card-line,rgba(255,255,255,0.1))] bg-[var(--vt-card,rgba(255,255,255,0.06))] shadow-[var(--vt-card-shadow,0_10px_30px_-20px_rgba(0,0,0,0.9))]"
      data-preview-mode="rail"
    >
      <div className="border-b border-white/[0.07] px-4 py-3">
        <p className="inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-subtle">
          <Icon name="eye" className="h-3.5 w-3.5" />
          Candidate preview
        </p>
      </div>
      <EmployerHeader
        compact
        title={props.title}
        employerName={props.employerName}
        employerAvatarUrl={props.employerAvatarUrl}
        verificationStatus={props.employerVerificationStatus}
        role={role}
        specialization={specialization}
        employerContext={employerContext}
        platform={platform}
      />

      <div>
        <CompactGroup title="Opportunity">
          <CompactLine label="Pay" value={facts.compensation} />
          <CompactLine label="Engagement" value={facts.engagement} />
          <CompactLine label="Work setup" value={facts.workSetup} />
          <CompactLine label="Hours" value={facts.weeklyHours} />
          <CompactLine label="Turnaround" value={facts.turnaround} />
        </CompactGroup>

        <CompactGroup title="Work">
          {workItems.length ? (
            workItems.slice(0, 3).map((item) => (
              <p key={item} className="flex gap-2">
                <span aria-hidden="true" className="mt-[0.55em] h-1 w-1 shrink-0 rounded-full bg-white/30" />
                <span>{item}</span>
              </p>
            ))
          ) : (
            <p className="text-subtle">No work details added yet.</p>
          )}
          {workItems.length > 3 ? <p className="text-subtle">+{workItems.length - 3} more</p> : null}
        </CompactGroup>

        <CompactGroup title="Candidate fit">
          <CompactLine
            label="Must have"
            value={mustHaves.slice(0, 4).join(", ") || "Not added"}
          />
          <CompactLine
            label="Nice to have"
            value={preferredSkills.slice(0, 4).join(", ") || "Not added"}
          />
          <CompactLine label="Tools" value={tools.slice(0, 4).join(", ") || "Not added"} />
        </CompactGroup>

        <CompactGroup title="Application">
          <CompactLine label="Trial" value={trial} />
          <CompactLine
            label="Process"
            value={processCount ? `${processCount} stage${processCount === 1 ? "" : "s"}` : "Not added"}
          />
          <CompactLine
            label="Materials"
            value={applicationCount ? `${applicationCount} requested` : "None selected"}
          />
          <CompactLine label="Method" value={facts.application} />
        </CompactGroup>
      </div>
    </section>
  );
}

function RecruiterJobFullPreview(props: RecruiterJobPreviewProps) {
  const { domain } = props;
  const facts = buildFacts(props);
  const role = text(props.roleName);
  const specialization = text(props.roleSpecialization);
  const employerContext = contextLabel(props.employerContext || domain.employerContextType);
  const platform = platformLabel(props.platform);
  const deliverables = domain.deliverables || [];
  const responsibilities = splitLines(props.responsibilities);
  const legacyRequirements = splitLines(props.legacyRequirements);
  const requiredSkills = unique([
    ...(domain.requiredSkillKeys || []).map(jobSkillLabel),
    ...(domain.otherRequiredSkills || []),
  ]);
  const preferredSkills = unique([
    ...(domain.preferredSkillKeys || []).map(jobSkillLabel),
    ...(domain.otherPreferredSkills || []),
  ]);
  const tools = unique(props.tools || []);
  const sourceInputs = domain.sourceInputs || [];
  const applicationRequirements = unique(props.applicationRequirements || []).map(applicationRequirementLabel);
  const hiringProcess = domain.hiringProcess || [];
  const howToApply = text(domain.howToApply) || text(props.howToApply);
  const referenceVideos = props.referenceVideos || [];
  const contextGroups = [
    { label: "Niches", values: unique(props.contentNiches || []) },
    { label: "Genres", values: unique(props.contentGenres || []) },
    { label: "Formats", values: unique(props.formatsHiredFor || []) },
    { label: "Tags", values: unique(props.tags || []) },
  ].filter((group) => group.values.length);
  const deadline = formatJobDate(domain.deadlineAt, true);
  const applyNote = [
    howToApply,
    deadline && !/\b(?:applications?\s+close|apply\s+by|deadline)\b/i.test(howToApply || "")
      ? `Applications close on ${deadline}.`
      : null,
  ]
    .filter(Boolean)
    .join(" ")
    .trim();
  const trialActive = domain.trialStatus === "paid" || domain.trialStatus === "unpaid";
  const revisionSummary = revisionForJob({
    revisionPolicy: domain.revisionPolicy || undefined,
    revisionRounds: domain.revisionRounds ? Number(domain.revisionRounds) : undefined,
    revisionNotes: domain.revisionNotes,
  });
  const autonomySummary = autonomyForJob({
    creativeAutonomy: domain.creativeAutonomy || undefined,
    creativeAutonomyNotes: domain.creativeAutonomyNotes,
  });

  return (
    <section aria-label="Candidate listing preview" className="min-w-0 space-y-6" data-preview-mode="full">
      <div className="overflow-hidden rounded-3xl border border-[var(--vt-card-line,rgba(255,255,255,0.1))] bg-[var(--vt-card,rgba(255,255,255,0.06))] shadow-[var(--vt-card-shadow,0_10px_30px_-20px_rgba(0,0,0,0.9))]">
        <div className="border-b border-white/[0.07] px-5 py-3 sm:px-7">
          <p className="inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-subtle">
            <Icon name="eye" className="h-3.5 w-3.5" />
            Candidate preview
          </p>
        </div>
        <EmployerHeader
          title={props.title}
          employerName={props.employerName}
          employerAvatarUrl={props.employerAvatarUrl}
          verificationStatus={props.employerVerificationStatus}
          role={role}
          specialization={specialization}
          employerContext={employerContext}
          platform={platform}
        />
        <dl className="grid gap-3 border-t border-white/[0.07] p-4 sm:grid-cols-2 sm:p-6 lg:grid-cols-4">
          <PreviewFact label="Compensation" value={facts.compensation} />
          <PreviewFact label="Engagement" value={facts.engagement} />
          <PreviewFact label="Work setup" value={facts.workSetup} />
          <PreviewFact label="Turnaround" value={facts.turnaround} />
        </dl>
      </div>

      <section className={`${LISTING_PANEL_CLASS} min-w-0`} aria-label="Work details">
        <div className="min-w-0 divide-y divide-white/[0.08]">
          <BodySection title="About the opportunity" icon="notebook-text">
            {text(props.about) ? (
              <p className="whitespace-pre-line">{text(props.about)}</p>
            ) : (
              <EmptyReview>About this opportunity has not been added yet.</EmptyReview>
            )}
          </BodySection>

          <BodySection title="Deliverables" icon="layers">
            {deliverables.length ? (
              <ol className="space-y-3">
                {deliverables.map((item, index) => {
                  const type = item.type
                    ? item.type === "other"
                      ? text(item.customType) || "Custom deliverable"
                      : jobDeliverableTypeLabel(item.type)
                    : "Deliverable type not chosen";
                  const frequency = item.frequency
                    ? item.frequency === "other"
                      ? text(item.customFrequency) || "Custom frequency"
                      : jobDeliverableFrequencyLabel(item.frequency)
                    : "Frequency not chosen";
                  return (
                    <li
                      key={item.id || index}
                      className="rounded-2xl border border-white/[0.08] bg-white/[0.025] px-4 py-3.5"
                    >
                      <div className="flex items-start gap-3">
                        <span
                          aria-hidden="true"
                          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.05] text-[11px] font-semibold text-muted"
                        >
                          {index + 1}
                        </span>
                        <div className="min-w-0">
                          <p className="font-medium text-white/86">
                            {text(item.quantity) || "Quantity not added"} {type}
                          </p>
                          <p className="mt-1 text-xs text-muted">{frequency}</p>
                          {text(item.notes) ? <p className="mt-2 text-sm text-white/65">{text(item.notes)}</p> : null}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <EmptyReview>No structured deliverables have been added yet.</EmptyReview>
            )}
          </BodySection>

          <BodySection title="Responsibilities" icon="list-checks">
            {responsibilities.length ? (
              <BulletList items={responsibilities} />
            ) : (
              <EmptyReview>Responsibilities have not been added yet.</EmptyReview>
            )}
          </BodySection>
        </div>
      </section>

      <section className={`${LISTING_PANEL_CLASS} min-w-0`} aria-label="Qualifications and workflow">
        <div className="min-w-0 divide-y divide-white/[0.08]">
          <BodySection title="Must-have skills" icon="clipboard-check">
            {requiredSkills.length || legacyRequirements.length || text(domain.requiredSkillsNote) ? (
              <div className="space-y-4">
                {requiredSkills.length ? <Pills items={requiredSkills} /> : null}
                {legacyRequirements.length ? <BulletList items={legacyRequirements} /> : null}
                {text(domain.requiredSkillsNote) ? (
                  <p className="whitespace-pre-line text-white/65">{text(domain.requiredSkillsNote)}</p>
                ) : null}
              </div>
            ) : (
              <EmptyReview>Required skills have not been added yet.</EmptyReview>
            )}
          </BodySection>

          <BodySection title="Nice-to-have skills" icon="sparkles">
            {preferredSkills.length || text(domain.preferredSkillsNote) ? (
              <div className="space-y-4">
                {preferredSkills.length ? <Pills items={preferredSkills} /> : null}
                {text(domain.preferredSkillsNote) ? (
                  <p className="whitespace-pre-line text-white/65">{text(domain.preferredSkillsNote)}</p>
                ) : null}
              </div>
            ) : (
              <EmptyReview>No preferred skills have been added.</EmptyReview>
            )}
          </BodySection>

          <BodySection title="Required tools" icon="sliders-horizontal">
            {tools.length ? (
              <div className="flex flex-wrap gap-2.5">
                {tools.map((tool) => (
                  <ToolChip key={tool.toLowerCase()} toolName={tool} size="md" />
                ))}
              </div>
            ) : (
              <EmptyReview>No required tools have been added.</EmptyReview>
            )}
          </BodySection>
        </div>
      </section>

      <section className={`${LISTING_PANEL_CLASS} min-w-0`} aria-label="Working arrangement and compensation">
        <div className="min-w-0 divide-y divide-white/[0.08]">
          <BodySection title="Working arrangement" icon="calendar-clock">
            <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <PreviewFact label="Weekly hours" value={facts.weeklyHours} />
              <PreviewFact label="Start" value={facts.start} />
              <PreviewFact label="Duration" value={facts.duration} />
            </dl>
            {text(domain.timezoneOverlap) ? (
              <p className="mt-4 text-sm text-white/65">Timezone overlap: {text(domain.timezoneOverlap)}</p>
            ) : null}
          </BodySection>

          <BodySection title="Workflow and source materials" icon="settings">
            {sourceInputs.length || text(domain.sourceInputsNotes) || revisionSummary || autonomySummary ? (
              <div className="space-y-5">
                {sourceInputs.length ? (
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-subtle">Provided inputs</p>
                    <div className="flex flex-wrap gap-2">
                      {sourceInputs.map((item, index) => (
                        <TagPill key={`${item.type}-${item.custom_label || ""}-${index}`}>
                          {item.type === "other" && text(item.custom_label)
                            ? text(item.custom_label)
                            : sourceInputLabel(item)}
                          {item.sensitive_access_confirmed ? " · access need confirmed" : ""}
                        </TagPill>
                      ))}
                    </div>
                  </div>
                ) : null}
                {text(domain.sourceInputsNotes) ? <p className="whitespace-pre-line">{text(domain.sourceInputsNotes)}</p> : null}
                {revisionSummary ? <p><span className="text-subtle">Revisions:</span> {revisionSummary}</p> : null}
                {autonomySummary ? <p><span className="text-subtle">Creative direction:</span> {autonomySummary}</p> : null}
              </div>
            ) : (
              <EmptyReview>Source materials, revisions, and creative direction have not been described.</EmptyReview>
            )}
          </BodySection>

          <BodySection title="Compensation" icon="cash-stack">
            <p className="text-lg font-semibold text-white/90">{facts.compensation}</p>
            {props.budgetUnit?.startsWith("per ") && deliverables.length ? (
              <p className="mt-2 text-sm text-white/55">
                Expected volume is shown with the deliverables above.
              </p>
            ) : null}
          </BodySection>
        </div>
      </section>

      <section className={`${LISTING_PANEL_CLASS} min-w-0`} aria-label="Trial and hiring process">
        <div className="min-w-0 divide-y divide-white/[0.08]">
          <BodySection title="Trial terms" icon="badge-check">
            {domain.trialStatus ? (
              <div
                className={[
                  "rounded-2xl border px-4 py-4",
                  domain.trialStatus === "unpaid"
                    ? "border-amber-200/20 bg-amber-200/[0.07]"
                    : "border-white/[0.08] bg-white/[0.025]",
                ].join(" ")}
              >
                <p className="font-semibold text-white/88">{TRIAL_STATUS_LABELS[domain.trialStatus]}</p>
                {trialActive ? (
                  <div className="mt-3 space-y-2 text-sm leading-relaxed text-white/65">
                    {text(domain.trialScope) ? <p>{text(domain.trialScope)}</p> : null}
                    {text(domain.trialEffortValue) && domain.trialEffortUnit ? (
                      <p>Expected effort: {domain.trialEffortValue} {sentenceCase(domain.trialEffortUnit).toLowerCase()}</p>
                    ) : null}
                    {domain.trialStatus === "paid" && text(domain.trialCompensationAmount) ? (
                      <p>
                        Trial pay: {formatJobMoney(domain.trialCompensationAmount, domain.trialCompensationCurrency)}
                        {domain.trialCompensationBasis ? ` ${TRIAL_BASIS_LABELS[domain.trialCompensationBasis]}` : ""}
                      </p>
                    ) : null}
                    {domain.trialWorkUsage ? <p>Use of trial work: {TRIAL_USAGE_LABELS[domain.trialWorkUsage]}</p> : null}
                    {domain.trialPortfolioPermission ? <p>{PORTFOLIO_PERMISSION_LABELS[domain.trialPortfolioPermission]}</p> : null}
                    {domain.trialAttribution ? <p>{ATTRIBUTION_LABELS[domain.trialAttribution]}</p> : null}
                    {domain.trialStatus === "unpaid" ? (
                      <p className="font-medium text-amber-100/82">
                        {domain.unpaidTrialConfirmed
                          ? "The unpaid nature of this trial has been explicitly confirmed."
                          : "Unpaid-trial confirmation is still required before publication."}
                      </p>
                    ) : null}
                    {text(domain.trialNotes) ? <p>{text(domain.trialNotes)}</p> : null}
                  </div>
                ) : null}
              </div>
            ) : (
              <EmptyReview>Trial expectations have not been selected.</EmptyReview>
            )}
          </BodySection>

          <BodySection title="Hiring process" icon="clipboard-list">
            {hiringProcess.length ? (
              <ol className="space-y-3">
                {hiringProcess.map((item, index) => (
                  <li key={item.id || index} className="flex gap-3">
                    <span
                      aria-hidden="true"
                      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.05] text-[11px] font-semibold text-muted"
                    >
                      {index + 1}
                    </span>
                    <div className="min-w-0 pt-0.5">
                      <p className="font-medium text-white/82">
                        {item.stage
                          ? item.stage === "other"
                            ? text(item.customLabel) || "Custom stage"
                            : hiringStageLabel({ stage: item.stage, custom_label: item.customLabel || null })
                          : "Stage not selected"}
                      </p>
                      {text(item.notes) ? <p className="mt-1 text-sm text-white/55">{text(item.notes)}</p> : null}
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <EmptyReview>The hiring process has not been outlined.</EmptyReview>
            )}
            {text(domain.hiringProcessNotes) ? (
              <p className="mt-4 whitespace-pre-line text-sm text-white/62">{text(domain.hiringProcessNotes)}</p>
            ) : null}
          </BodySection>
        </div>
      </section>

      <section className={`${LISTING_PANEL_CLASS} min-w-0`} aria-label="Application details">
        <div className="min-w-0 divide-y divide-white/[0.08]">
          <BodySection title="What applicants should include" icon="inbox">
            {applicationRequirements.length ? (
              <Pills items={applicationRequirements} />
            ) : (
              <EmptyReview>No specific first-message materials are requested.</EmptyReview>
            )}
          </BodySection>

          <BodySection title="How to apply" icon="send">
            <div className="space-y-3">
              <p className="font-medium text-white/82">{facts.application}</p>
              {/* A closing date belongs in the instructions, not on a row of its
                  own — that is how a candidate reads it. */}
              {applyNote ? <p className="whitespace-pre-line">{applyNote}</p> : null}
              {!applyNote ? (
                <p className="text-sm text-muted">Candidates will apply through CreatorJobs.</p>
              ) : null}
            </div>
          </BodySection>
        </div>
      </section>

      {referenceVideos.length ? (
        <section className={`${LISTING_PANEL_CLASS} min-w-0 py-8`} aria-label="Reference videos">
          <SectionLabel icon="video">Reference videos</SectionLabel>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {referenceVideos.map((video, index) => {
              const url = safeReferenceUrl(video.url);
              const title = text(video.title) || `Reference ${index + 1}`;
              const note = text(video.whatToReference) || text(video.description);
              return (
                <article key={video.id || `${video.url}-${index}`} className="rounded-2xl border border-white/[0.08] bg-white/[0.025] px-4 py-4">
                  <h3 className="font-medium text-white/84">{title}</h3>
                  {url ? (
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1.5 inline-flex max-w-full items-center gap-1.5 text-xs text-muted underline decoration-white/20 underline-offset-4 hover:text-white/75"
                    >
                      <span className="truncate">{referenceHost(url)}</span>
                      <Icon name="external-link" className="h-3.5 w-3.5 shrink-0" />
                    </a>
                  ) : (
                    <p className="mt-1.5 text-xs text-subtle">Reference URL is incomplete.</p>
                  )}
                  {note ? <p className="mt-3 text-sm leading-relaxed text-white/62">{note}</p> : null}
                  {video.timestampNotes?.length ? (
                    <p className="mt-3 text-xs text-subtle">
                      {video.timestampNotes.length} timestamp note{video.timestampNotes.length === 1 ? "" : "s"}
                    </p>
                  ) : null}
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      {contextGroups.length ? (
        <section className={`${LISTING_PANEL_CLASS} min-w-0 py-8`} aria-label="Content context">
          <SectionLabel icon="tag">Content context</SectionLabel>
          <div className="mt-5 space-y-5">
            {contextGroups.map((group) => (
              <div key={group.label}>
                <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-subtle">{group.label}</h3>
                <div className="flex flex-wrap gap-2">
                  {group.values.map((value) => (
                    <TagPill key={`${group.label}-${value.toLowerCase()}`}>{value}</TagPill>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </section>
  );
}

export default function RecruiterJobPreview(props: RecruiterJobPreviewProps) {
  return props.previewMode === "rail" ? (
    <RecruiterJobRailPreview {...props} />
  ) : (
    <RecruiterJobFullPreview {...props} />
  );
}
