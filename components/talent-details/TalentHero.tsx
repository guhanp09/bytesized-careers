"use client";

import Link from "next/link";
import React from "react";
import { formatListingTitle } from "../../lib/displayText";
import type { ProfileRatingSummary } from "../../lib/profileRating";
import { Icon } from "../Icons";
import useFitTitle from "../job-details/useFitTitle";
import ListingStatTile from "../listing-details/ListingStatTile";
import ProfileRatingLink from "../profile/ProfileRatingLink";

const TITLE_MAX_LINES = 2;
const TITLE_BASE_PX = 44;
const TITLE_MIN_PX = 20;
const TITLE_STEP_PX = 1;

type DetailIconName = React.ComponentProps<typeof Icon>["name"];

function TalentAvatar({
  avatarUrl,
  name,
  initials,
}: {
  avatarUrl?: string | null;
  name: string;
  initials: string;
}) {
  if (avatarUrl) {
    return (
      <div
        aria-label={name}
        className="h-12 w-12 flex-shrink-0 rounded-full border border-white/15 bg-white/10 bg-cover bg-center"
        style={{ backgroundImage: `url(${avatarUrl})` }}
      />
    );
  }

  return (
    <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/10 text-xs font-bold text-white/70">
      {initials || <Icon name="user" className="h-5 w-5" />}
    </div>
  );
}

export default function TalentHero({
  title,
  name,
  profileHref,
  rating,
  avatarUrl,
  initials,
  metaLine,
  postedText,
  titleScale,
  stats,
}: {
  title: string;
  name: string;
  profileHref?: string | null;
  rating?: ProfileRatingSummary | null;
  avatarUrl?: string | null;
  initials: string;
  metaLine: string;
  postedText: string;
  titleScale: number;
  stats: Array<{
    icon: Extract<DetailIconName, "cash-stack" | "cap" | "pin">;
    label: string;
    value: string;
  }>;
}) {
  const displayTitle = formatListingTitle(title);
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
  return (
    <section className="rounded-3xl border border-white/[0.08] bg-white/[0.06] p-6 shadow-[0_18px_60px_-40px_rgba(0,0,0,0.95)] sm:p-7">
      <h1
        ref={titleRef}
        className="min-w-0 break-words font-extrabold leading-[1.08] tracking-tight"
      >
        {displayTitle}
      </h1>

      <div className={[titleBottomSpaceClass, "flex items-center gap-4"].join(" ")}>
        <TalentAvatar avatarUrl={avatarUrl} name={name} initials={initials} />
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
            {profileHref ? (
              <Link
                href={profileHref}
                className="block max-w-[320px] cursor-pointer truncate rounded-sm text-lg font-semibold text-white underline-offset-4 transition-colors hover:text-white hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
              >
                {name}
              </Link>
            ) : (
              <p className="max-w-[320px] truncate text-lg font-semibold text-white">{name}</p>
            )}
            <ProfileRatingLink rating={rating} ariaLabel="View talent reviews" testId="talent-hero-rating" />
          </div>
          <div className="text-sm text-white/55">{metaLine}</div>
          <div className="text-sm text-white/45">{postedText}</div>
        </div>
      </div>

      {stats.length ? (
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          {stats.map((stat) => (
            <ListingStatTile key={stat.label} icon={stat.icon} label={stat.label} value={stat.value} />
          ))}
        </div>
      ) : null}
    </section>
  );
}
