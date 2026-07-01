"use client";

import React from "react";
import { Job } from "../../lib/types";
import { formatListingTitle } from "../../lib/displayText";
import { formatSubs } from "../../lib/format";
import type { ProfileRatingSummary } from "../../lib/profileRating";
import useFitTitle from "./useFitTitle";
import ChannelAttribution from "../jobs/ChannelAttribution";
import ListingStatTile from "../listing-details/ListingStatTile";
import ProfileRatingLink from "../profile/ProfileRatingLink";

const TITLE_MAX_LINES = 2;
const TITLE_BASE_PX = 44;
const TITLE_MIN_PX = 20;
const TITLE_STEP_PX = 1;

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

  const titleBottomSpaceClass =
    fontPx >= 38 ? "mt-6" : fontPx >= 32 ? "mt-5" : fontPx >= 26 ? "mt-4" : "mt-3";
  const tiles = [
    job.budget ? { icon: "briefcase" as const, label: "Budget / rate", value: job.budget } : null,
    job.experience ? { icon: "cap" as const, label: "Experience", value: job.experience } : null,
    job.location ? { icon: "pin" as const, label: "Location", value: job.location } : null,
  ].filter(Boolean) as Array<{ icon: "briefcase" | "cap" | "pin"; label: string; value: string }>;

  const tileGridClass =
    tiles.length === 1
      ? "sm:grid-cols-1"
      : tiles.length === 2
        ? "sm:grid-cols-2"
        : "sm:grid-cols-3";

  return (
    <section className="rounded-3xl bg-white/[0.06] border border-white/[0.08] p-6 sm:p-7 shadow-[0_18px_60px_-40px_rgba(0,0,0,0.95)]">
      <div className="flex items-start gap-3">
        <h1
          ref={titleRef}
          className="min-w-0 flex-1 break-words font-extrabold leading-[1.08] tracking-tight"
        >
          {displayTitle}
        </h1>
        {ownerControls ? <div className="shrink-0">{ownerControls}</div> : null}
      </div>

      <div className={[titleBottomSpaceClass, "flex items-center gap-4"].join(" ")}>
        <img
          src={job.channel.logoUrl}
          alt={job.channel.name}
          className="h-12 w-12 rounded-full border border-white/15 bg-white/10 flex-shrink-0"
        />
        <div className="min-w-0">
          <div className="flex items-center gap-2 min-w-0 flex-wrap">
            <ChannelAttribution
              channelName={job.channel.name}
              channelProfileSlug={job.channelProfileSlug}
              channelExternalUrl={job.postedByAgency ? job.channelExternalUrl : undefined}
              className="text-lg font-semibold text-white max-w-[320px]"
            />
            <ProfileRatingLink
              rating={channelRating}
              ariaLabel={`View ${job.channel.name} reviews`}
              testId="job-channel-rating"
            />
          </div>
          <div className="text-white/55 text-sm">{formatSubs(job.channel.subscribers)}</div>
          <div className="text-white/45 text-sm">{postedText}</div>
        </div>
      </div>

      {tiles.length ? (
        <div className={`mt-6 grid gap-3 ${tileGridClass}`}>
          {tiles.map((tile) => (
            <ListingStatTile key={tile.label} icon={tile.icon} label={tile.label} value={tile.value} />
          ))}
        </div>
      ) : null}
    </section>
  );
}
