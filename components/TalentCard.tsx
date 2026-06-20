"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { BackendTalentListing, saveTalentListing } from "../lib/backendClient";
import { publicProfileFallbackSlug } from "../lib/profileSlug";
import { formatTalentExperience } from "../lib/talentListing";
import { useCardSheen } from "../lib/useCardSheen";
import { formatCompactNumber } from "../lib/format";
import { Icon } from "./Icons";
import { MetaRow, StatRow, TagPill } from "./ui";

const formatInr = (amount: number) => `₹${new Intl.NumberFormat("en-IN").format(amount)}`;

const roleBasedRateLabel = (item: BackendTalentListing) => {
  const text = [item.primary_role, item.title, ...item.roles, item.niche].filter(Boolean).join(" ").toLowerCase();
  if (text.includes("thumbnail")) return "₹1,500 per thumbnail";
  if (text.includes("short")) return "₹3,000 per short";
  if (text.includes("script")) return "₹8,000 per script";
  if (text.includes("motion")) return "₹12,000 per project";
  if (text.includes("podcast")) return "₹18,000 per episode";
  if (text.includes("channel manager")) return "₹80,000 monthly";
  if (text.includes("strategist")) return "₹1,000/hr";
  if (text.includes("ugc")) return "₹15,000 per video";
  if (text.includes("retention analyst")) return "₹25,000 per project";
  if (text.includes("faceless")) return "₹18,000 per video";
  if (text.includes("editor")) return "₹20,000 per long-form video";
  return "Rate flexible";
};

const rateLabel = (item: BackendTalentListing) => {
  const note = item.rate_note?.trim();
  const currency = item.rate_currency?.toUpperCase();
  const legacyCurrencyCode = ["U", "S", "D"].join("");
  const legacyCurrencyPattern = new RegExp(legacyCurrencyCode, "i");
  const noteLooksUsd = note ? /[$]/.test(note) || legacyCurrencyPattern.test(note) : false;

  if (currency === "INR") {
    if (note && !noteLooksUsd) return note;
    if (item.rate_min != null && item.rate_max != null) return `${formatInr(item.rate_min)}-${formatInr(item.rate_max)}`;
    if (item.rate_min != null) return `${formatInr(item.rate_min)}+`;
  }

  if (note && !noteLooksUsd && currency !== legacyCurrencyCode) return note;
  if (currency === legacyCurrencyCode || noteLooksUsd) return roleBasedRateLabel(item);
  return "Rate flexible";
};

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

export default function TalentCard({ item }: { item: BackendTalentListing }) {
  const router = useRouter();
  const { data: session } = useSession();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const sheen = useCardSheen();
  const href = `/talent/${encodeURIComponent(item.id)}`;
  const publicProfileSlug = (item.owner_username || publicProfileFallbackSlug(item.owner_display_name || item.id)).trim();
  const publicProfileHref = publicProfileSlug ? `/u/${encodeURIComponent(publicProfileSlug)}?view=talent` : null;
  const name = displayName(item);
  const role = item.primary_role || item.roles[0] || "Content talent";
  const location = item.location || titleCase(item.work_mode) || "Remote";
  const metadata = [role, location, item.timezone].filter(Boolean).join(" · ");
  const workMode = titleCase(item.work_mode);
  const experience = formatTalentExperience(item.experience_level) || "Not specified";
  const tags = uniq([...item.tools, ...item.platforms, item.niche, ...item.formats]);
  const viewCount = Number.isFinite(item.views) ? Math.max(0, item.views) : 0;
  const interestedRecruitersCount = 0;
  const responseRate = 0;
  const modeOrLocation = workMode || location || "Remote";

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
                  onClick={(event) => {
                    event.stopPropagation();
                  }}
                  onKeyDown={(event) => event.stopPropagation()}
                  className="block max-w-full cursor-pointer truncate rounded-sm text-left text-sm font-semibold text-white/88 transition-colors hover:text-white hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
                >
                  {name}
                </Link>
              ) : (
                <p className="truncate text-sm font-semibold text-white/88">{name}</p>
              )}
              <p className="mt-1 truncate text-xs text-white/55">{metadata}</p>
            </div>
          </div>
        </div>

        <h2 className="mt-4 h-[52px] line-clamp-2 text-[15px] font-extrabold uppercase leading-snug text-white">
          {item.title}
        </h2>

        <div className="mt-4 space-y-2">
          <MetaRow icon="cash-stack" text={rateLabel(item)} />
          <MetaRow icon="cap" text={`Experience: ${experience}`} />
          <MetaRow icon="pin" text={modeOrLocation} />
        </div>

        {tags.length ? (
          <div className="mt-4 overflow-hidden">
            <TagRow tags={tags} />
          </div>
        ) : null}

        <div className="mt-auto flex h-10 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-4 overflow-hidden">
            <StatRow
              icon="eye"
              value={formatCompactNumber(viewCount)}
              label="Currently viewing"
              interactive
              className="shrink-0"
            />
            <StatRow
              icon="user-plus"
              value={`${interestedRecruitersCount}`}
              label="Interested recruiters"
              interactive
              className="shrink-0"
            />
            <StatRow
              icon="bolt"
              value={`${responseRate}%`}
              label="Response rate"
              interactive
              className="shrink-0"
            />
          </div>

          <div className="flex flex-shrink-0 items-center gap-2">
            <IconAction
              label={saved ? "Saved" : "Save"}
              onClick={async (event) => {
                stop(event);
                if (!session?.backendAccessToken) {
                  router.push(`/auth?mode=login&next=${encodeURIComponent(href)}`);
                  return;
                }
                setSaving(true);
                try {
                  await saveTalentListing(session.backendAccessToken, item.id);
                  setSaved(true);
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
                await navigator.clipboard?.writeText(`${window.location.origin}${href}`);
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1400);
              }}
            >
              <Icon name="share" className="h-4 w-4" />
            </IconAction>
          </div>
        </div>
      </div>
    </div>
  );
}
