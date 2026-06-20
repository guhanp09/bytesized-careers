"use client";

import Link from "next/link";
import type { MouseEvent } from "react";

const normalizeHttpUrl = (value?: string | null) => {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
};

type ChannelAttributionProps = {
  channelName: string;
  channelProfileSlug?: string;
  channelExternalUrl?: string;
  className?: string;
  ariaLabel?: string;
};

export default function ChannelAttribution({
  channelName,
  channelProfileSlug,
  channelExternalUrl,
  className = "",
  ariaLabel,
}: ChannelAttributionProps) {
  const externalHref = normalizeHttpUrl(channelExternalUrl);
  const profileHref = channelProfileSlug
    ? `/u/${encodeURIComponent(channelProfileSlug)}?view=hiring`
    : null;
  const href = externalHref || profileHref;
  const isExternal = Boolean(externalHref);

  const baseClass = [
    "truncate text-left transition-colors",
    href
      ? "cursor-pointer underline-offset-2 hover:text-white hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
      : "text-white/55",
    className,
  ].join(" ");

  const stopParentNavigation = (event: MouseEvent<HTMLAnchorElement>) => {
    event.stopPropagation();
  };

  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      {href ? (
        isExternal ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={stopParentNavigation}
            className={baseClass}
            title={channelName}
            aria-label={ariaLabel || `Open ${channelName} channel or page`}
          >
            {channelName}
          </a>
        ) : (
          <Link
            href={href}
            onClick={stopParentNavigation}
            className={baseClass}
            title={channelName}
            aria-label={ariaLabel || `Open ${channelName} CreatorJobs profile`}
          >
            {channelName}
          </Link>
        )
      ) : (
        <span className={baseClass} title={channelName}>
          {channelName}
        </span>
      )}
    </span>
  );
}
