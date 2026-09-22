"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { BackendTalentListing, saveTalentListing } from "../lib/backendClient";
import { formatListingTitle } from "../lib/displayText";
import { publicProfileFallbackSlug } from "../lib/profileSlug";
import { formatTalentListingExperience, formatTalentRate } from "../lib/talentListing";
import { useCardSheen } from "../lib/useCardSheen";
import { Icon } from "./Icons";
import SearchMatchReasons from "./search/SearchMatchReasons";
import { CardActionFeedback, copyTextToClipboard, MetaRow, TagPill, useTransientCardFeedback } from "./ui";

const displayName = (item: BackendTalentListing) =>
  item.owner_display_name ||
  item.owner_username
    ?.split(/[-_.\s]+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ") ||
  "Talent profile";

const initials = (value: string) =>
  value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

const titleCase = (value?: string | null) =>
  value
    ? value
        .split(/[_-\s]+/)
        .filter(Boolean)
        .map((part) => part[0]?.toUpperCase() + part.slice(1))
        .join(" ")
    : "";

const uniq = (values: Array<string | null | undefined>) => {
  const seen = new Set<string>();
  return values
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .filter((value) => {
      const key = value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

function IconAction({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: (event: React.MouseEvent) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      onKeyDown={(event) => event.stopPropagation()}
      className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-xl border border-white/10 bg-white/6 transition-colors hover:bg-white/10"
    >
      {children}
    </button>
  );
}

function TagRow({ tags }: { tags: string[] }) {
  const firstThreeLength = tags.slice(0, 3).join("").length;
  const visibleCount = tags.length > 2 && firstThreeLength > 28 ? 2 : 3;
  const visible = tags.slice(0, visibleCount);
  const extra = tags.length - visible.length;

  return (
    <div className="flex min-w-0 flex-nowrap gap-1.5 overflow-hidden">
      {visible.map((tag) => (
        <TagPill key={tag} className="shrink-0 whitespace-nowrap">
          {tag}
        </TagPill>
      ))}
      {extra > 0 ? (
        <span className="shrink-0 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/55">
          +{extra}
        </span>
      ) : null}
    </div>
  );
}

function ListingCta({
  label,
  onClick,
}: {
  label: string;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onKeyDown={(event) => event.stopPropagation()}
      className="group/cta inline-flex min-h-6 shrink-0 cursor-pointer items-center gap-1.5 rounded-sm px-0.5 py-0.5 text-[12px] font-extrabold tracking-[0.04em] text-white/90 underline-offset-4 transition-colors hover:text-white hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
    >
      <span>{label}</span>
      <span
        aria-hidden="true"
        className="inline-block transition-transform group-hover/cta:translate-x-0.5 motion-reduce:transition-none"
      >
        →
      </span>
    </button>
  );
}

export default function TalentCard({
  item,
  matchReasons,
}: {
  item: BackendTalentListing;
  matchReasons?: string[];
}) {
  const router = useRouter();
  const { data: session } = useSession();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const { feedback, showFeedback } = useTransientCardFeedback();
  const sheen = useCardSheen();
  const href = `/talent/${encodeURIComponent(item.id)}`;
  const publicProfileSlug = (item.owner_username || publicProfileFallbackSlug(item.owner_display_name || item.id)).trim();
  const publicProfileHref = publicProfileSlug ? `/u/${encodeURIComponent(publicProfileSlug)}?view=talent` : null;
  const name = displayName(item);
  const role = item.primary_role || item.roles[0] || "Content talent";
  const location = item.location || titleCase(item.work_mode) || "Remote";
  const metadata = [role, location, item.timezone].filter(Boolean).join(" · ");
  const workMode = titleCase(item.work_mode);
  const experience = formatTalentListingExperience(item) || "Not specified";
  const tags = uniq([
    ...item.formats,
    ...(item.content_niches || []),
    ...(item.content_genres || []),
    ...item.tools,
    ...item.platforms,
    item.niche,
  ]);
  const modeOrLocation = workMode || location || "Remote";
  const displayTitle = formatListingTitle(item.title);

  const open = () => {
    router.push(href);
  };

  const stop = (event: React.MouseEvent) => {
    event.stopPropagation();
  };

  return (
    <div className="min-w-0 select-none">
      <div
        role="link"
        tabIndex={0}
        aria-label={`Open talent listing: ${item.title}`}
        onClick={open}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            open();
          }
        }}
        {...sheen}
        className={[
          "group relative isolate flex h-[340px] w-full min-w-0 cursor-pointer flex-col rounded-2xl p-5",
          "border border-white/10 bg-white/[0.06]",
          "shadow-[0_10px_30px_-20px_rgba(0,0,0,0.9)]",
          "transition-[transform,box-shadow,border-color,background-color] duration-200 ease-out",
          "hover:-translate-y-0.5 hover:border-white/25 hover:bg-white/[0.075]",
          "hover:shadow-[0_22px_55px_-26px_rgba(0,0,0,0.95)] hover:ring-1 hover:ring-white/10",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20",
        ].join(" ")}
        title="Open talent listing"
      >
        <div aria-hidden="true" className="home-card-sheen -z-10" />
        <CardActionFeedback feedback={feedback} />
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            {item.owner_avatar_url ? (
              <div
                aria-label={name}
                className="h-12 w-12 flex-shrink-0 rounded-full border border-white/15 bg-cover bg-center bg-white/10"
                style={{ backgroundImage: `url(${item.owner_avatar_url})` }}
              />
            ) : (
              <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/10 text-xs font-bold text-white/70">
                {initials(name) || <Icon name="user" className="h-5 w-5" />}
              </div>
            )}
            <div className="min-w-0">
              {publicProfileHref ? (
                <Link
                  href={publicProfileHref}
                  prefetch={false}
                  onClick={(event) => {
                    event.stopPropagation();
                  }}
                  onKeyDown={(event) => event.stopPropagation()}
                  className="flex min-h-6 max-w-full cursor-pointer items-center truncate rounded-sm text-left text-sm font-semibold text-white/88 underline-offset-4 transition-colors hover:text-white hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
                >
                  {name}
                </Link>
              ) : (
                <p className="truncate text-sm font-semibold text-white/88">{name}</p>
              )}
              <p className="mt-1 truncate text-xs text-white/55">{metadata}</p>
            </div>
          </div>
          <ListingCta
            label="Hire Me"
            onClick={(event) => {
              event.stopPropagation();
              open();
            }}
          />
        </div>

        <h2 className="mt-4 h-[52px] cursor-pointer line-clamp-2 text-[15px] font-extrabold leading-snug text-white underline-offset-4 transition-colors hover:underline">
          {displayTitle}
        </h2>

        <div className="mt-4 space-y-2">
          <MetaRow icon="cash-stack" text={formatTalentRate(item)} />
          <MetaRow icon="cap" text={`Experience: ${experience}`} />
          <MetaRow icon="pin" text={modeOrLocation} />
        </div>

        {tags.length ? (
          <div className="mt-4 overflow-hidden">
            <TagRow tags={tags} />
          </div>
        ) : null}

        <div className="mt-auto flex h-10 items-center justify-end gap-3">
          <div className="flex flex-shrink-0 items-center gap-2">
            <IconAction
              label={saved ? "Saved" : "Save"}
              onClick={async (event) => {
                stop(event);
                if (!session?.backendAccessToken) {
                  showFeedback("Sign in to save this talent listing.", "info", "bookmark");
                  window.setTimeout(() => {
                    router.push(`/auth?mode=login&next=${encodeURIComponent(href)}`);
                  }, 900);
                  return;
                }
                if (saved) {
                  showFeedback("This talent listing is already saved.", "info", "bookmark");
                  return;
                }
                setSaving(true);
                try {
                  await saveTalentListing(session.backendAccessToken, item.id);
                  setSaved(true);
                  showFeedback("Talent listing saved.", "success", "check", {
                    visual: "check",
                    actionLabel: "View",
                    actionHref: "/you?tab=saved",
                    durationMs: 4200,
                  });
                } catch (error) {
                  console.error("Save talent listing failed:", error);
                  showFeedback("Couldn’t save this listing. Try again.", "error", "alert");
                } finally {
                  setSaving(false);
                }
              }}
            >
              <Icon name="bookmark" className={["h-4 w-4", saving ? "opacity-45" : ""].join(" ")} />
            </IconAction>
            <IconAction
              label={copied ? "Copied" : "Share"}
              onClick={async (event) => {
                stop(event);
                try {
                  await copyTextToClipboard(`${window.location.origin}${href}`);
                  setCopied(true);
                  showFeedback("Talent link copied.", "success", "share", { visual: "copy" });
                  window.setTimeout(() => setCopied(false), 1800);
                } catch (error) {
                  console.error("Share talent listing failed:", error);
                  showFeedback("Couldn’t copy the link.", "error", "alert");
                }
              }}
            >
              <Icon name="share" className="h-4 w-4" />
            </IconAction>
          </div>
        </div>
      </div>
      <SearchMatchReasons reasons={matchReasons} />
    </div>
  );
}
