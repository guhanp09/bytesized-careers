"use client";

import Link from "next/link";
import type { KeyboardEvent, MouseEvent } from "react";

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
      ? "cursor-pointer underline-offset-2 hover:text-[var(--vt-link-hover,#ffffff)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vt-accent-ring,rgba(255,255,255,0.2))]"
      : "text-[var(--vt-text-muted,rgba(255,255,255,0.55))]",
    className,
  ].join(" ");

  const stopParentNavigation = (event: MouseEvent<HTMLAnchorElement>) => {
    event.stopPropagation();
  };
  const stopParentKeyboardNavigation = (event: KeyboardEvent<HTMLAnchorElement>) => {
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
            onKeyDown={stopParentKeyboardNavigation}
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
            onKeyDown={stopParentKeyboardNavigation}
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
