"use client";

import React from "react";

import {
  applicationRequirementLabel,
  autonomyForJob,
  cleanJobText,
  compensationForJob,
  deadlineForJob,
  durationForJob,
  engagementForJob,
  formatJobDeliverable,
  formatTurnaround,
  formatWeeklyHours,
  hiringStageLabel,
  preferredSkillsForJob,
  requiredSkillsForJob,
  requiredToolsForJob,
  revisionForJob,
  sourceInputLabel,
  sourceInputNeedsSensitiveAccess,
  splitJobLines,
  startForJob,
  trialForJob,
  uniqueJobText,
  workSetupForJob,
} from "../../lib/jobPresentation";
import type { Job } from "../../lib/types";
import {
  BodySection,
  BulletList,
  LISTING_PANEL_CLASS,
  Pills,
  SectionLabel,
} from "../listing-details/ListingSections";
import TagPill from "../ui/TagPill";
import ToolChip from "../ui/ToolChip";
import ReferenceVideos from "./ReferenceVideos";

function DecisionFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-2xl border border-white/[0.07] bg-white/[0.025] px-4 py-3.5">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.18em] text-subtle">{label}</dt>
      <dd className="mt-1.5 break-words text-sm font-medium leading-snug text-white/84">{value}</dd>
    </div>
  );
}

export default function JobDescriptionSections({ job }: { job: Job }) {
  const about = cleanJobText(job.about);
  const responsibilities = splitJobLines(job.responsibilities);
  const legacyRequirements = splitJobLines(job.requirements);
  const deliverables = job.deliverables || [];
  const requiredSkills = requiredSkillsForJob(job);
  const preferredSkills = preferredSkillsForJob(job);
  const requiredTools = requiredToolsForJob(job);
  // Language requirements are no longer shown on public job listings (stored values
  // remain in the record for backward compatibility but are not presented here).
  const experience = cleanJobText(job.experience);
  const sourceInputs = job.sourceInputs || [];
  const revision = revisionForJob(job);
  const autonomy = autonomyForJob(job);
  const compensation = compensationForJob(job);
  const deadline = deadlineForJob(job.deadlineAt);
  // Legacy absence remains absence; only an explicitly stored status can say
  // that there is no trial.
  const trialPresentation = job.trialStatus ? trialForJob(job) : null;
  const hiringProcess = job.hiringProcess || [];
  const applicationRequirements = uniqueJobText(job.applicationRequirements || []).map(applicationRequirementLabel);
  const baseNote = cleanJobText(job.howToApply);
  // A closing date is part of the instructions. Older jobs stored it as its own
  // field and it was rendered as a separate row; folding it in keeps the fact
  // without giving it a label of its own, and only when the note is silent.
  const howToApply = [
    baseNote,
    deadline.valid && deadline.label && !/\b(?:applications?\s+close|apply\s+by|deadline)\b/i.test(baseNote || "")
      ? `Applications close on ${deadline.label}.`
      : null,
  ]
    .filter(Boolean)
    .join(" ")
    .trim();
  const referenceVideos = job.referenceVideos || [];
  const tags = uniqueJobText(job.tags || []);
  const sensitiveInputs = sourceInputs.filter(sourceInputNeedsSensitiveAccess);
  const hasCanonicalWork = Boolean(
    deliverables.length ||
      requiredSkills.length ||
      preferredSkills.length ||
      requiredTools.length ||
      experience ||
      sourceInputs.length ||
      cleanJobText(job.sourceInputsNotes) ||
      revision ||
      autonomy ||
      job.engagementType ||
      job.workMode ||
      job.expectedWeeklyHoursMin !== undefined ||
      job.expectedWeeklyHoursMax !== undefined ||
      job.turnaroundValue !== undefined ||
      job.startTiming ||
      cleanJobText(job.startTimeframe) ||
      job.durationType ||
      cleanJobText(job.timezoneOverlap) ||
      compensation.disclosed ||
      job.trialStatus ||
      hiringProcess.length ||
      applicationRequirements.length ||
      howToApply ||
      job.applicationMode ||
      deadline.valid,
  );

  if (
    !about &&
    !responsibilities.length &&
    !legacyRequirements.length &&
    !referenceVideos.length &&
    !tags.length &&
    !hasCanonicalWork
  ) {
    return (
      <section className={`${LISTING_PANEL_CLASS} min-w-0 py-8`}>
        <SectionLabel icon="file">Listing details</SectionLabel>
        <p className="mt-4 text-sm leading-relaxed text-white/55">
          This listing does not include additional details yet.
        </p>
      </section>
    );
  }

  return (
    <div className="min-w-0 space-y-6">
      {(about || responsibilities.length || deliverables.length) ? (
        <section className={`${LISTING_PANEL_CLASS} min-w-0`} aria-label="Role and work">
          <div className="min-w-0 divide-y divide-white/[0.08]">
            {about ? (
              <BodySection title="About the opportunity" icon="notebook-text">
                <p className="whitespace-pre-line">{about}</p>
              </BodySection>
            ) : null}

            {deliverables.length ? (
              <BodySection title="Deliverables and volume" icon="layers">
                <ol className="space-y-3">
                  {deliverables.map((item, index) => (
                    <li
                      key={`${item.type}-${item.frequency}-${index}`}
                      className="rounded-2xl border border-white/[0.08] bg-white/[0.025] px-4 py-3.5"
                    >
                      <div className="flex min-w-0 items-start gap-3">
                        <span
                          aria-hidden="true"
                          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.05] text-[11px] font-semibold text-muted"
                        >
                          {index + 1}
                        </span>
                        <div className="min-w-0">
                          <p className="break-words font-medium text-white/88">{formatJobDeliverable(item)}</p>
                          {cleanJobText(item.notes) ? (
                            <p className="mt-1.5 whitespace-pre-line text-sm text-white/58">{cleanJobText(item.notes)}</p>
                          ) : null}
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>
              </BodySection>
            ) : null}

            {responsibilities.length ? (
              <BodySection title="Responsibilities" icon="list-checks">
                <BulletList items={responsibilities} />
              </BodySection>
            ) : null}
          </div>
        </section>
      ) : null}

      {(requiredSkills.length || legacyRequirements.length || requiredTools.length || preferredSkills.length || experience || cleanJobText(job.requiredSkillsNote) || cleanJobText(job.preferredSkillsNote)) ? (
        <section className={`${LISTING_PANEL_CLASS} min-w-0`} aria-label="Qualifications">
          <div className="min-w-0 divide-y divide-white/[0.08]">
            {(requiredSkills.length || experience || cleanJobText(job.requiredSkillsNote)) ? (
              <BodySection title="Must have" icon="clipboard-check">
                <div className="space-y-4">
                  {requiredSkills.length ? <Pills items={requiredSkills} /> : null}
                  {experience ? (
                    <p className="text-white/68"><span className="text-subtle">Experience:</span> {experience}</p>
                  ) : null}
                  {cleanJobText(job.requiredSkillsNote) ? (
                    <p className="whitespace-pre-line text-white/68">{cleanJobText(job.requiredSkillsNote)}</p>
                  ) : null}
                </div>
              </BodySection>
            ) : null}

            {legacyRequirements.length ? (
              <BodySection title="Additional listing requirements" icon="list-checks">
                <BulletList items={legacyRequirements} />
              </BodySection>
            ) : null}

            {requiredTools.length ? (
              <BodySection title="Required tools" icon="sliders-horizontal">
                <div className="flex flex-wrap gap-2.5">
                  {requiredTools.map((tool) => (
                    <ToolChip key={tool.toLowerCase()} toolName={tool} size="md" />
                  ))}
                </div>
              </BodySection>
            ) : null}

            {(preferredSkills.length || cleanJobText(job.preferredSkillsNote)) ? (
              <BodySection title="Nice to have" icon="sparkles">
                <div className="space-y-4">
                  {preferredSkills.length ? <Pills items={preferredSkills} /> : null}
                  {cleanJobText(job.preferredSkillsNote) ? (
                      <p className="whitespace-pre-line text-white/68">{cleanJobText(job.preferredSkillsNote)}</p>
                  ) : null}
                </div>
              </BodySection>
            ) : null}
          </div>
        </section>
      ) : null}

      {(job.engagementType || job.workMode || job.expectedWeeklyHoursMin !== undefined || job.expectedWeeklyHoursMax !== undefined || job.turnaroundValue !== undefined || job.startTiming || cleanJobText(job.startTimeframe) || job.durationType || job.timezoneOverlap || compensation.disclosed) ? (
        <section className={`${LISTING_PANEL_CLASS} min-w-0`} aria-label="Work arrangement and compensation">
          <div className="min-w-0 divide-y divide-white/[0.08]">
            <BodySection title="Work arrangement" icon="calendar-clock">
              <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <DecisionFact label="Engagement" value={engagementForJob(job)} />
                <DecisionFact label="Work setup" value={workSetupForJob(job)} />
                {job.expectedWeeklyHoursMin !== undefined || job.expectedWeeklyHoursMax !== undefined ? (
                  <DecisionFact
                    label="Weekly hours"
                    value={formatWeeklyHours(job.expectedWeeklyHoursMin, job.expectedWeeklyHoursMax)}
                  />
                ) : null}
                {job.turnaroundValue !== undefined ? (
                  <DecisionFact
                    label="Turnaround"
                    value={formatTurnaround(job.turnaroundValue, job.turnaroundUnit, job.turnaroundBasis)}
                  />
                ) : null}
                {job.startTiming || cleanJobText(job.startTimeframe) ? (
                  <DecisionFact label="Start" value={startForJob(job)} />
                ) : null}
                {job.durationType ? <DecisionFact label="Duration" value={durationForJob(job)} /> : null}
              </dl>
              {cleanJobText(job.timezoneOverlap) ? (
                <p className="mt-4 text-sm text-white/65">
                  <span className="text-subtle">Timezone overlap:</span> {cleanJobText(job.timezoneOverlap)}
                </p>
              ) : null}
            </BodySection>

            <BodySection title="Compensation" icon="cash-stack">
              <p className="break-words text-xl font-semibold leading-snug text-white/92">{compensation.headline}</p>
              {compensation.note ? <p className="mt-2 whitespace-pre-line text-white/65">{compensation.note}</p> : null}
              {compensation.outputBased && deliverables.length ? (
                <div className="mt-4 rounded-2xl border border-white/[0.08] bg-white/[0.025] px-4 py-3.5">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-subtle">Expected volume</p>
                  <ul className="mt-2 space-y-1.5 text-sm text-white/70">
                    {deliverables.map((item, index) => (
                      <li key={`${item.type}-comp-${index}`}>{formatJobDeliverable(item)}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </BodySection>
          </div>
        </section>
      ) : null}

      {(sourceInputs.length || cleanJobText(job.sourceInputsNotes) || revision || autonomy) ? (
        <section className={`${LISTING_PANEL_CLASS} min-w-0`} aria-label="Creative workflow">
          <BodySection title="Creative workflow" icon="settings">
            <div className="space-y-5">
              {sourceInputs.length ? (
                <div>
                  <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-subtle">
                    Materials and access provided
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {sourceInputs.map((input, index) => (
                      <TagPill key={`${input.type}-${input.custom_label || ""}-${index}`}>
                        {sourceInputLabel(input)}
                      </TagPill>
                    ))}
                  </div>
                </div>
              ) : null}
              {sensitiveInputs.length ? (
                <div className="rounded-2xl border border-amber-200/20 bg-amber-200/[0.06] px-4 py-3.5 text-sm leading-relaxed text-amber-50/80">
                  <p className="font-semibold text-amber-50/90">Sensitive access required</p>
                  <p className="mt-1">
                    This work involves {uniqueJobText(sensitiveInputs.map(sourceInputLabel)).join(", ").toLowerCase()}.
                    Confirm access scope and timing before sharing credentials or account access.
                  </p>
                </div>
              ) : null}
              {cleanJobText(job.sourceInputsNotes) ? (
                <p className="whitespace-pre-line text-white/68">{cleanJobText(job.sourceInputsNotes)}</p>
              ) : null}
              {revision ? <p><span className="text-subtle">Revisions:</span> {revision}</p> : null}
              {autonomy ? <p><span className="text-subtle">Creative direction:</span> {autonomy}</p> : null}
            </div>
          </BodySection>
        </section>
      ) : null}

      {(trialPresentation || hiringProcess.length || applicationRequirements.length || howToApply || job.applicationMode || deadline.valid) ? (
        <section className={`${LISTING_PANEL_CLASS} min-w-0`} aria-label="Trial and application">
          <div className="min-w-0 divide-y divide-white/[0.08]">
            {trialPresentation ? (
              <BodySection title="Trial terms" icon="badge-check">
                <div
                  className={[
                    "rounded-2xl border px-4 py-4",
                    trialPresentation.status === "unpaid"
                      ? "border-amber-200/24 bg-amber-200/[0.07]"
                      : trialPresentation.status === "paid"
                        ? "border-emerald-200/18 bg-emerald-200/[0.045]"
                        : "border-white/[0.08] bg-white/[0.025]",
                  ].join(" ")}
                >
                  <p className="font-semibold text-white/90">{trialPresentation.title}</p>
                  {trialPresentation.details.length ? (
                    <ul className="mt-3 space-y-2 text-sm leading-relaxed text-white/68">
                      {trialPresentation.details.map((detail) => (
                        <li key={detail} className="flex gap-2.5">
                          <span aria-hidden="true" className="mt-[0.6em] h-1 w-1 shrink-0 rounded-full bg-white/35" />
                          <span>{detail}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </BodySection>
            ) : null}

            {hiringProcess.length ? (
              <BodySection title="Hiring process" icon="clipboard-list">
                <ol className="space-y-3">
                  {hiringProcess.map((stage, index) => (
                    <li key={`${stage.stage}-${index}`} className="flex min-w-0 gap-3">
                      <span
                        aria-hidden="true"
                        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.05] text-xs font-semibold text-white/55"
                      >
                        {index + 1}
                      </span>
                      <div className="min-w-0 pt-0.5">
                        <p className="break-words font-medium text-white/84">{hiringStageLabel(stage)}</p>
                        {cleanJobText(stage.notes) ? (
                          <p className="mt-1 whitespace-pre-line text-sm text-white/55">{cleanJobText(stage.notes)}</p>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ol>
                {cleanJobText(job.hiringProcessNotes) ? (
                  <p className="mt-4 whitespace-pre-line text-white/62">{cleanJobText(job.hiringProcessNotes)}</p>
                ) : null}
              </BodySection>
            ) : null}

            <BodySection title="How to apply" icon="send">
              <div className="space-y-4">
                <div>
                  {/* Always CreatorJobs. A stored external mode describes a
                      hiring process this platform never saw, so it is not a
                      choice to report. The closing date, when there is one, is
                      part of the instructions below rather than a row here. */}
                  <p className="font-medium text-white/84">Apply through CreatorJobs</p>
                </div>
                {applicationRequirements.length ? (
                  <div>
                    <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-subtle">
                      Required application materials
                    </h3>
                    <Pills items={applicationRequirements} />
                  </div>
                ) : null}
                {howToApply ? (
                  <p className="whitespace-pre-line text-white/68">{howToApply}</p>
                ) : null}
              </div>
            </BodySection>
          </div>
        </section>
      ) : null}

      {referenceVideos.length ? (
        <section className={`${LISTING_PANEL_CLASS} min-w-0 py-8`} aria-label="Reference videos">
          <SectionLabel icon="video">Reference videos</SectionLabel>
          <div className="mt-5 min-w-0">
            <ReferenceVideos videos={referenceVideos} />
          </div>
        </section>
      ) : null}

      {tags.length ? (
        <section className={`${LISTING_PANEL_CLASS} min-w-0 py-8`} aria-label="Content context">
          <SectionLabel icon="tag">Content context</SectionLabel>
          <div className="mt-5">
            <Pills items={tags} />
          </div>
        </section>
      ) : null}
    </div>
  );
}
