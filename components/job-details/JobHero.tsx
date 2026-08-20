"use client";

import React from "react";
import { Job } from "../../lib/types";
import { formatListingTitle } from "../../lib/displayText";
import { formatSubs } from "../../lib/format";
import {
  cleanJobText,
  compensationForJob,
  employerContextLabel,
  engagementForJob,
  hiringVerificationForJob,
  roleForJob,
  sentenceCaseJobValue,
  uniqueJobText,
  workSetupForJob,
} from "../../lib/jobPresentation";
import type { ProfileRatingSummary } from "../../lib/profileRating";
import useFitTitle from "./useFitTitle";
import ChannelAttribution from "../jobs/ChannelAttribution";
import ProfileRatingLink from "../profile/ProfileRatingLink";
import { Icon } from "../Icons";

const TITLE_MAX_LINES = 2;
const TITLE_BASE_PX = 44;
const TITLE_MIN_PX = 20;
const TITLE_STEP_PX = 1;

type SummaryFactProps = {
  icon: React.ComponentProps<typeof Icon>["name"];
  label: string;
  value: string;
  prominent?: boolean;
};

function SummaryFact({ icon, label, value, prominent = false }: SummaryFactProps) {
  return (
    <div className="min-w-0 rounded-2xl border border-white/[0.07] bg-white/[0.03] px-4 py-3.5">
      <dt className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-subtle">
        <Icon name={icon} className="h-3.5 w-3.5 shrink-0" />
        <span>{label}</span>
      </dt>
      <dd
        className={[
          "mt-2 min-w-0 break-words font-medium leading-snug [overflow-wrap:anywhere]",
          prominent ? "text-base text-white/92" : "text-sm text-white/82",
        ].join(" ")}
      >
        {value}
      </dd>
    </div>
  );
}

const platformLabel = (value: string) => {
  const normalized = value.trim().toLowerCase();
  if (normalized === "youtube") return "YouTube";
  if (normalized === "instagram") return "Instagram";
  if (normalized === "tiktok") return "TikTok";
  if (normalized === "x" || normalized === "x/twitter") return "X / Twitter";
  return sentenceCaseJobValue(value);
};

export default function JobHero({
  job,
  postedText,
  titleScale,
  channelRating,
  ownerControls,
}: {
  job: Job;
  postedText: string;
  titleScale: number;
  channelRating?: ProfileRatingSummary | null;
  ownerControls?: React.ReactNode;
}) {
  const displayTitle = formatListingTitle(job.title);
  const { ref: titleRef, fontPx } = useFitTitle({
    text: displayTitle,
    maxLines: TITLE_MAX_LINES,
    basePx: TITLE_BASE_PX,
    minPx: TITLE_MIN_PX,
    stepPx: TITLE_STEP_PX,
    scale: titleScale,
  });
  const role = roleForJob(job);
  const compensation = compensationForJob(job);
  const identityName =
    cleanJobText(job.hiringDisplayName) ||
    cleanJobText(job.channel.name) ||
    "Hiring identity unavailable";
  const employerType = employerContextLabel(job.employerContextType);
  const agencyName = cleanJobText(job.managedByAgencyName);
  const hasCanonicalHiringContext = (job.listingSchemaVersion || 1) >= 3;
  const relationshipText = job.postedByAgency
    ? agencyName
      ? `Hiring managed by ${agencyName}`
      : "Hiring managed by a representing agency"
    : [hasCanonicalHiringContext ? "Hiring directly" : "", employerType ? `Employer type: ${employerType}` : ""]
        .filter(Boolean)
        .join(" · ");
  const verificationState = hiringVerificationForJob(job);
  const verificationStatus = verificationState.status;
  const verification =
    verificationState.verified
      ? { icon: "check" as const, label: "Verified hiring identity", tone: "text-emerald-100/78" }
      : verificationStatus === "PENDING"
        ? { icon: "clock" as const, label: "Verification pending", tone: "text-muted" }
        : verificationStatus === "UNVERIFIED" || verificationStatus === "REJECTED"
          ? { icon: "shield" as const, label: "Hiring identity not verified", tone: "text-muted" }
          : null;
  const platforms = uniqueJobText([...(job.platforms || []), job.platform]).map(platformLabel);
  const formats = uniqueJobText(job.formatsHiredFor || []);
  const platformAndFormat = [...platforms, ...formats.slice(0, 2)].join(" · ") || "Platform / format not specified";

  const titleBottomSpaceClass =
    fontPx >= 38 ? "mt-6" : fontPx >= 32 ? "mt-5" : fontPx >= 26 ? "mt-4" : "mt-3";

  return (
    <section className="rounded-3xl border border-white/[0.08] bg-white/[0.06] p-5 shadow-[0_18px_60px_-40px_rgba(0,0,0,0.95)] sm:p-7">
      <div className="flex min-w-0 items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">
            <span>{role.name}</span>
            {role.specialization ? (
              <>
                <span aria-hidden="true" className="text-disabled">•</span>
                <span className="normal-case tracking-normal text-white/56">{role.specialization}</span>
              </>
            ) : null}
          </p>
          <h1
            ref={titleRef}
            className="mt-2 min-w-0 break-words font-extrabold leading-[1.08] tracking-tight"
          >
            {displayTitle}
          </h1>
        </div>
        {ownerControls ? <div className="shrink-0">{ownerControls}</div> : null}
      </div>

      <div className={[titleBottomSpaceClass, "flex min-w-0 items-start gap-3 sm:gap-4"].join(" ")}>
        {job.channel.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={job.channel.logoUrl}
            alt={`${identityName} avatar`}
            loading="eager"
            decoding="async"
            className="h-11 w-11 flex-shrink-0 rounded-full border border-white/15 bg-white/10 object-cover sm:h-12 sm:w-12"
          />
        ) : (
          <span className="inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/[0.06] text-muted sm:h-12 sm:w-12">
            <Icon name="briefcase" className="h-4 w-4" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <ChannelAttribution
              channelName={identityName}
              channelProfileSlug={job.postedByAgency ? undefined : job.channelProfileSlug}
              channelExternalUrl={job.postedByAgency ? job.channelExternalUrl : undefined}
              className="max-w-full text-base font-semibold text-white sm:text-lg"
            />
            <ProfileRatingLink
              rating={channelRating}
              ariaLabel={`View ${identityName} reviews`}
              testId="job-channel-rating"
            />
          </div>
          {relationshipText ? <p className="mt-1 break-words text-sm text-white/55">{relationshipText}</p> : null}
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-subtle">
            {job.channel.subscribers !== null ? <span>{formatSubs(job.channel.subscribers)}</span> : null}
            {verification ? (
              <span className={`inline-flex items-center gap-1 ${verification.tone}`}>
                <Icon name={verification.icon} className="h-3.5 w-3.5" />
                {verification.label}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      <dl className="mt-6 grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryFact icon="cash-stack" label="Compensation" value={compensation.headline} prominent />
        <SummaryFact icon="briefcase" label="Engagement" value={engagementForJob(job)} />
        <SummaryFact icon="pin" label="Work setup" value={workSetupForJob(job)} />
        <SummaryFact icon="video" label="Platform / format" value={platformAndFormat} />
      </dl>

      {/* A closing date is part of the application instructions, not a badge on
          the header. It reads there as a separate promise the listing has to
          keep; in the instructions it reads as what it is. */}
      {postedText ? (
        <div className="mt-4 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-1 text-xs text-subtle">
          <span>{postedText}</span>
        </div>
      ) : null}
    </section>
  );
}
