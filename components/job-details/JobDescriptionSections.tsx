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
  formatJobLanguage,
  formatTurnaround,
  formatWeeklyHours,
  hiringStageLabel,
  preferredSkillsForJob,
  requiredSkillsForJob,
  requiredToolsForJob,
  revisionForJob,
  safeJobExternalUrl,
  sourceInputLabel,
  sourceInputNeedsSensitiveAccess,
  splitJobLines,
  startForJob,
  trialForJob,
  uniqueJobText,
  workSetupForJob,
} from "../../lib/jobPresentation";
import { CUSTOM_INSTRUCTION_REQUIREMENT_KEY } from "../../lib/firstMessageRequirements";
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
      <dt className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/38">{label}</dt>
      <dd className="mt-1.5 break-words text-sm font-medium leading-snug text-white/84">{value}</dd>
    </div>
  );
}

function EmptyImportant({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed border-white/[0.1] bg-white/[0.02] px-3.5 py-3 text-sm leading-relaxed text-white/48">
      {children}
    </p>
  );
}

function LanguageCards({ items }: { items: NonNullable<Job["languageRequirements"]> }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {items.map((item, index) => {
        const presentation = formatJobLanguage(item);
        return (
          <article
            key={`${item.language}-${item.priority}-${index}`}
            className="min-w-0 rounded-2xl border border-white/[0.08] bg-white/[0.025] px-4 py-3.5"
          >
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
              <h3 className="break-words font-medium text-white/86">{presentation.language}</h3>
              <TagPill>{presentation.priority}</TagPill>
            </div>
            <p className="mt-2 text-xs text-white/50">{presentation.proficiency}</p>
            {presentation.purposes ? (
              <p className="mt-1.5 text-xs leading-relaxed text-white/62">{presentation.purposes}</p>
            ) : null}
            {presentation.notes ? (
              <p className="mt-2 whitespace-pre-line text-sm text-white/62">{presentation.notes}</p>
            ) : null}
          </article>
        );
      })}
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
  const canonicalLanguagesCaptured = job.languageRequirements !== null && job.languageRequirements !== undefined;
  const languages = job.languageRequirements || [];
  const requiredLanguages = languages.filter((item) => item.priority === "required");
  const preferredLanguages = languages.filter((item) => item.priority === "preferred");
  const legacyLanguages = canonicalLanguagesCaptured ? [] : uniqueJobText(job.languages || []);
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
  const screeningQuestions = job.screeningQuestions || [];
  const applicationRequirements = uniqueJobText(job.applicationRequirements || []).map(applicationRequirementLabel);
  const customInstructionIsApplicantRequirement = Boolean(
    job.applicationRequirements?.includes(CUSTOM_INSTRUCTION_REQUIREMENT_KEY),
  );
  const howToApply = cleanJobText(job.howToApply);
  const legacyScreeningPrompt = customInstructionIsApplicantRequirement ? howToApply : "";
  const externalUrl = safeJobExternalUrl(job.externalApplyUrl);
  const referenceVideos = job.referenceVideos || [];
  const tags = uniqueJobText(job.tags || []);
  const sensitiveInputs = sourceInputs.filter(sourceInputNeedsSensitiveAccess);
  const hasCanonicalWork = Boolean(
    deliverables.length ||
      requiredSkills.length ||
      preferredSkills.length ||
      requiredTools.length ||
      languages.length ||
      legacyLanguages.length ||
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
      screeningQuestions.length ||
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
                          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.05] text-[11px] font-semibold text-white/50"
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

      {(requiredSkills.length || legacyRequirements.length || requiredTools.length || languages.length || legacyLanguages.length || preferredSkills.length || experience || cleanJobText(job.requiredSkillsNote) || cleanJobText(job.preferredSkillsNote)) ? (
        <section className={`${LISTING_PANEL_CLASS} min-w-0`} aria-label="Qualifications">
          <div className="min-w-0 divide-y divide-white/[0.08]">
            {(requiredSkills.length || requiredLanguages.length || experience || cleanJobText(job.requiredSkillsNote)) ? (
              <BodySection title="Must have" icon="clipboard-check">
                <div className="space-y-4">
                  {requiredSkills.length ? <Pills items={requiredSkills} /> : null}
                  {experience ? (
                    <p className="text-white/68"><span className="text-white/42">Experience:</span> {experience}</p>
                  ) : null}
                  {cleanJobText(job.requiredSkillsNote) ? (
                    <p className="whitespace-pre-line text-white/68">{cleanJobText(job.requiredSkillsNote)}</p>
                  ) : null}
                  {requiredLanguages.length ? (
                    <div>
                      <h3 className="mb-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/38">
                        Required languages
                      </h3>
                      <LanguageCards items={requiredLanguages} />
                    </div>
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

            {legacyLanguages.length && !languages.length ? (
              <BodySection title="Languages listed" icon="languages">
                <Pills items={legacyLanguages} />
              </BodySection>
            ) : null}

            {(preferredSkills.length || preferredLanguages.length || cleanJobText(job.preferredSkillsNote)) ? (
              <BodySection title="Nice to have" icon="sparkles">
                <div className="space-y-4">
                  {preferredSkills.length ? <Pills items={preferredSkills} /> : null}
                  {cleanJobText(job.preferredSkillsNote) ? (
                      <p className="whitespace-pre-line text-white/68">{cleanJobText(job.preferredSkillsNote)}</p>
                  ) : null}
                  {preferredLanguages.length ? (
                    <div>
                      <h3 className="mb-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/38">
                        Preferred languages
                      </h3>
                      <LanguageCards items={preferredLanguages} />
                    </div>
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
                  <span className="text-white/42">Timezone overlap:</span> {cleanJobText(job.timezoneOverlap)}
                </p>
              ) : null}
            </BodySection>

            <BodySection title="Compensation" icon="cash-stack">
              <p className="break-words text-xl font-semibold leading-snug text-white/92">{compensation.headline}</p>
              {compensation.note ? <p className="mt-2 whitespace-pre-line text-white/65">{compensation.note}</p> : null}
              {compensation.outputBased && deliverables.length ? (
                <div className="mt-4 rounded-2xl border border-white/[0.08] bg-white/[0.025] px-4 py-3.5">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/38">Expected volume</p>
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
                  <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/38">
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
              {revision ? <p><span className="text-white/42">Revisions:</span> {revision}</p> : null}
              {autonomy ? <p><span className="text-white/42">Creative direction:</span> {autonomy}</p> : null}
            </div>
          </BodySection>
        </section>
      ) : null}

      {(trialPresentation || hiringProcess.length || screeningQuestions.length || applicationRequirements.length || howToApply || job.applicationMode || deadline.valid) ? (
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

            {(screeningQuestions.length || legacyScreeningPrompt) ? (
              <BodySection title="Screening questions" icon="message-square-text">
                <p className="mb-4 text-sm text-white/55">You can review these before starting your application.</p>
                <ol className="space-y-3">
                  {legacyScreeningPrompt ? (
                    <li className="rounded-2xl border border-white/[0.08] bg-white/[0.025] px-4 py-3.5">
                      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                        <p className="min-w-0 flex-1 whitespace-pre-line break-words font-medium text-white/84">
                          1. {legacyScreeningPrompt}
                        </p>
                        <TagPill>Required</TagPill>
                      </div>
                    </li>
                  ) : null}
                  {screeningQuestions.map((question, index) => (
                    <li key={`${question.prompt}-${index}`} className="rounded-2xl border border-white/[0.08] bg-white/[0.025] px-4 py-3.5">
                      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                        <p className="min-w-0 flex-1 break-words font-medium text-white/84">
                          {legacyScreeningPrompt ? `${index + 2}. ` : `${index + 1}. `}
                          {cleanJobText(question.prompt)}
                        </p>
                        <TagPill>{question.required ? "Required" : "Optional"}</TagPill>
                      </div>
                      {cleanJobText(question.response_guidance) ? (
                        <p className="mt-2 text-sm text-white/52">{cleanJobText(question.response_guidance)}</p>
                      ) : null}
                    </li>
                  ))}
                </ol>
              </BodySection>
            ) : null}

            <BodySection title="How to apply" icon="send">
              <div className="space-y-4">
                <div>
                  <p className="font-medium text-white/84">
                    {job.applicationMode === "external" ? "Apply on an external site" : "Apply through CreatorJobs"}
                  </p>
                  {deadline.valid ? (
                    <p className={deadline.expired ? "mt-1.5 text-sm font-medium text-amber-100/82" : "mt-1.5 text-sm text-white/58"}>
                      {deadline.label}
                    </p>
                  ) : null}
                </div>
                {applicationRequirements.length ? (
                  <div>
                    <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/38">
                      Required application materials
                    </h3>
                    <Pills items={applicationRequirements} />
                  </div>
                ) : null}
                {howToApply && !customInstructionIsApplicantRequirement ? (
                  <p className="whitespace-pre-line text-white/68">{howToApply}</p>
                ) : null}
                {job.applicationMode === "external" ? (
                  externalUrl ? (
                    <p className="rounded-xl border border-white/[0.08] bg-white/[0.025] px-3.5 py-3 text-sm leading-relaxed text-white/58">
                      The application opens on another site. CreatorJobs does not receive or track that submission.
                    </p>
                  ) : (
                    <EmptyImportant>The external application link is unavailable.</EmptyImportant>
                  )
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
