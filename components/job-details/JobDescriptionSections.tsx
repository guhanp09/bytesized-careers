"use client";

import React from "react";
import { CUSTOM_INSTRUCTION_REQUIREMENT_KEY } from "../../lib/firstMessageRequirements";
import { Job } from "../../lib/types";
import {
  BodySection,
  BulletList,
  LISTING_PANEL_CLASS,
  Pills,
  SectionLabel,
} from "../listing-details/ListingSections";
import ReferenceVideos from "./ReferenceVideos";

export default function JobDescriptionSections({ job }: { job: Job }) {
  const aboutText = job.about?.trim();
  const responsibilities = (job.responsibilities || "")
    .split("\n")
    .map((line) => line.replace(/^\s*[-•]\s*/, "").trim())
    .filter(Boolean);
  const requirements = (job.requirements || "")
    .split("\n")
    .map((line) => line.replace(/^\s*[-•]\s*/, "").trim())
    .filter(Boolean);
  const customInstructionIsApplicantRequirement = Boolean(
    job.applicationRequirements?.includes(CUSTOM_INSTRUCTION_REQUIREMENT_KEY)
  );
  const howToApply = customInstructionIsApplicantRequirement ? "" : job.howToApply?.trim();
  const referenceVideos = job.referenceVideos ?? [];
  const tags = job.tags ?? [];

  const textSections: React.ReactNode[] = [];

  if (aboutText) {
    textSections.push(
      <BodySection key="about" title="About the brand">
        <p className="whitespace-pre-line">{aboutText}</p>
      </BodySection>
    );
  }

  if (responsibilities.length) {
    textSections.push(
      <BodySection key="responsibilities" title="Responsibilities">
        <BulletList items={responsibilities} />
      </BodySection>
    );
  }

  if (requirements.length) {
    textSections.push(
      <BodySection key="requirements" title="Requirements">
        <BulletList items={requirements} />
      </BodySection>
    );
  }

  if (howToApply) {
    textSections.push(
      <BodySection key="how-to-apply" title="How to apply">
        <p className="whitespace-pre-line">{howToApply}</p>
      </BodySection>
    );
  }

  const hasText = textSections.length > 0;
  const hasReference = referenceVideos.length > 0;
  const hasTags = tags.length > 0;

  if (!hasText && !hasReference && !hasTags) {
    return (
      <section className={`${LISTING_PANEL_CLASS} min-w-0 py-8`}>
        <SectionLabel>Listing details</SectionLabel>
        <p className="mt-4 text-sm leading-relaxed text-white/55">
          This job does not have additional details yet.
        </p>
      </section>
    );
  }

  return (
    <div className="min-w-0 space-y-6">
      {hasText ? (
        <section className={`${LISTING_PANEL_CLASS} min-w-0`}>
          <div className="min-w-0 divide-y divide-white/[0.08]">{textSections}</div>
        </section>
      ) : null}

      {hasReference ? (
        <section className={`${LISTING_PANEL_CLASS} min-w-0 py-8`}>
          <SectionLabel>Reference videos</SectionLabel>
          <div className="mt-5 min-w-0">
            <ReferenceVideos videos={referenceVideos} />
          </div>
        </section>
      ) : null}

      {hasTags ? (
        <div className="px-1">
          <Pills items={tags} />
        </div>
      ) : null}
    </div>
  );
}
