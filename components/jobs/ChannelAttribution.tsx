"use client";

import Link from "next/link";
import type { MouseEvent } from "react";

type ChannelAttributionProps = {
  channelName: string;
  channelProfileSlug?: string;
  postedByAgency?: boolean;
  showAgencyBadge?: boolean;
  className?: string;
};

export default function ChannelAttribution({
  channelName,
  channelProfileSlug,
  postedByAgency = false,
  showAgencyBadge,
  className = "",
}: ChannelAttributionProps) {
  const shouldShowAgencyBadge = showAgencyBadge ?? postedByAgency;
  const profileHref = channelProfileSlug
    ? `/u/${encodeURIComponent(channelProfileSlug)}?view=hiring`
    : null;

  const baseClass = [
    "truncate text-left transition-colors",
    profileHref
      ? "cursor-pointer underline-offset-2 hover:text-white hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
      : "text-white/55 cursor-not-allowed",
    className,
  ].join(" ");

  const stopParentNavigation = (event: MouseEvent<HTMLAnchorElement>) => {
    event.stopPropagation();
  };

  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      {profileHref ? (
        <Link
          href={profileHref}
          onClick={stopParentNavigation}
          className={baseClass}
          title={channelName}
        >
          {channelName}
        </Link>
      ) : (
        <span className={baseClass} title="Profile not available" aria-disabled="true">
          {channelName}
        </span>
      )}

      {shouldShowAgencyBadge ? (
        <span className="inline-flex items-center rounded-md border border-white/10 bg-white/[0.08] px-2 py-0.5 text-[10px] font-medium tracking-wide text-white/65 whitespace-nowrap">
          Posted by agency
        </span>
      ) : null}
    </span>
  );
}
