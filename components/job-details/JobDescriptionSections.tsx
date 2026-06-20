"use client";

import React from "react";
import { Job } from "../../lib/types";
import { Section, TagPill } from "../ui";
import ReferenceVideos from "./ReferenceVideos";

export default function JobDescriptionSections({ job }: { job: Job }) {
  const bodyClass = "mt-3 text-sm text-white/80 leading-relaxed";
  const aboutText = job.about?.trim();
  const responsibilities = (job.responsibilities || "")
    .split("\n")
    .map((line) => line.replace(/^\s*[-•]\s*/, "").trim())
    .filter(Boolean);
  const requirements = (job.requirements || "")
    .split("\n")
    .map((line) => line.replace(/^\s*[-•]\s*/, "").trim())
    .filter(Boolean);
  const howToApply = job.howToApply?.trim();

  return (
    <div className="space-y-6">
      {aboutText ? (
        <Section title="About the brand" bodyClassName={bodyClass}>
          <p className="whitespace-pre-line">{aboutText}</p>
        </Section>
      ) : null}

      {responsibilities.length ? (
        <Section title="Responsibilities" bodyClassName={bodyClass}>
          <ul className="list-disc pl-5 space-y-2">
            {responsibilities.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </Section>
      ) : null}

      {requirements.length ? (
        <Section title="Requirements" bodyClassName={bodyClass}>
          <ul className="list-disc pl-5 space-y-2">
            {requirements.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </Section>
      ) : null}

      {howToApply ? (
        <Section title="How to apply" bodyClassName={bodyClass}>
          <p className="whitespace-pre-line">{howToApply}</p>
        </Section>
      ) : null}

      {job.referenceVideos?.length ? (
        <Section title="Reference videos" bodyClassName={bodyClass}>
          <ReferenceVideos videos={job.referenceVideos} />
        </Section>
      ) : null}

      {job.tags?.length ? (
        <Section title="Tags" bodyClassName={bodyClass}>
          <div className="flex flex-wrap gap-2">
            {job.tags.map((t) => (
              <TagPill key={t}>{t}</TagPill>
            ))}
          </div>
        </Section>
      ) : null}

      {!aboutText && !responsibilities.length && !requirements.length && !howToApply && !job.referenceVideos?.length && !job.tags?.length ? (
        <Section title="Listing details" bodyClassName={bodyClass}>
          <p className="text-white/58">This job does not have additional details yet.</p>
        </Section>
      ) : null}
    </div>
  );
}
