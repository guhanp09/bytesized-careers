"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Job } from "../lib/types";
import { formatCompactNumber, formatPostedLabel } from "../lib/format";
import { saveJob } from "../lib/backendClient";
import { useCardSheen } from "../lib/useCardSheen";
import { MetaRow, StatRow, TagPill } from "./ui";
import { Icon } from "./Icons";
import ChannelAttribution from "./jobs/ChannelAttribution";

const platformIconMap: Record<string, "youtube" | "instagram" | "tiktok" | "facebook" | "linkedin" | "x" | "podcast"> =
  {
    youtube: "youtube",
    instagram: "instagram",
    tiktok: "tiktok",
    facebook: "facebook",
    linkedin: "linkedin",
    "x/twitter": "x",
    x: "x",
    podcast: "podcast",
  };

const getPlatform = (platform?: string) => (platform || "YouTube").toLowerCase();

const getPlatformIcon = (platform?: string) => {
  const key = getPlatform(platform);
  return platformIconMap[key] || "youtube";
};

const formatFollowersLabel = (count: number | null, platform?: string) => {
  if (count === null) {
    return getPlatform(platform) === "youtube" ? "Subscribers hidden" : "Followers hidden";
  }
  const base = formatCompactNumber(count);
  const isYoutube = getPlatform(platform) === "youtube";
  return `${base} ${isYoutube ? "subscribers" : "followers"}`;
};

const channelInitials = (value?: string | null) =>
  (value || "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

function TagRow({ tags }: { tags: string[] }) {
  const top = tags.slice(0, 3);
  const extra = tags.length - top.length;

  return (
    <div className="flex flex-wrap gap-1.5">
      {top.map((t) => (
        <TagPill key={t}>{t}</TagPill>
      ))}
      {extra > 0 ? (
        <span className="text-[11px] px-2 py-1 rounded-lg bg-white/5 border border-white/10 text-white/55">
          +{extra}
        </span>
      ) : null}
    </div>
  );
}

function IconAction({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: (e: React.MouseEvent) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      onKeyDown={(event) => event.stopPropagation()}
      className="h-9 w-9 cursor-pointer inline-flex items-center justify-center rounded-xl bg-white/6 border border-white/10 hover:bg-white/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
    >
      {children}
    </button>
  );
}

export function JobCard({ job }: { job: Job }) {
  const router = useRouter();
  const { data: session } = useSession();
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const sheen = useCardSheen();
  const cardHref = `/jobs/${encodeURIComponent(String(job.id))}`;
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  const postedLabel = formatPostedLabel(job.postedShort);
  const currentlyViewing = Number.isFinite(job.views) ? Math.max(0, job.views) : 0;
  const responseRate = Number.isFinite(job.responseRate) ? Math.max(0, job.responseRate) : 0;

  const onCardClick = () => {
    if (!job.id) return;
    router.push(cardHref);
  };

  return (
    <div className="min-w-0 select-none">
      <div
        role="link"
        tabIndex={0}
        onClick={onCardClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onCardClick();
          }
        }}
        {...sheen}
        className={[
          "group relative isolate cursor-pointer rounded-2xl p-5 min-w-0",
          "bg-white/[0.06] border border-white/10",
          "shadow-[0_10px_30px_-20px_rgba(0,0,0,0.9)]",
          "transition-[transform,box-shadow,border-color,background-color] duration-200 ease-out",
          "hover:-translate-y-0.5 hover:bg-white/[0.075] hover:border-white/25",
          "hover:shadow-[0_22px_55px_-26px_rgba(0,0,0,0.95)]",
          "hover:ring-1 hover:ring-white/10",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20",
          "h-[340px] flex flex-col",
        ].join(" ")}
        title="Click to open"
      >
        <div aria-hidden="true" className="home-card-sheen -z-10" />
        {/* Header row */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {job.channel.logoUrl ? (
              <img
                src={job.channel.logoUrl}
                alt={job.channel.name}
                className="h-12 w-12 rounded-full border border-white/15 bg-white/10 flex-shrink-0"
              />
            ) : (
              <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/10 text-xs font-semibold text-white/72">
                {channelInitials(job.channel.name) || <Icon name="briefcase" className="h-4 w-4" />}
              </div>
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                <ChannelAttribution
                  channelName={job.channel.name}
                  channelProfileSlug={job.channelProfileSlug}
                  className="text-sm font-semibold text-white max-w-[170px]"
                />
              </div>
              <p className="text-xs text-white/55 truncate inline-flex items-center gap-1.5">
                <Icon name={getPlatformIcon(job.platform)} className="w-3.5 h-3.5" />
                <span>{formatFollowersLabel(job.channel.subscribers, job.platform)}</span>
                {postedLabel ? <span className="text-white/40">• {postedLabel}</span> : null}
              </p>
              {job.hiringDisplayName ? (
                <p className="mt-1 truncate text-[11px] text-white/50">
                  Hiring for {job.hiringDisplayName}
                  {job.managedByAgencyName ? ` · Managed by ${job.managedByAgencyName}` : ""}
                </p>
              ) : null}
            </div>
          </div>

        </div>

        {/* Title row */}
        <h3 className="mt-4 text-[15px] font-extrabold leading-snug text-white uppercase line-clamp-2 h-[52px]">
          {job.title}
        </h3>

        {/* Details rows */}
        {(job.budget || job.experience || job.location) ? (
          <div className="mt-4 space-y-2">
            {job.budget ? (
              <MetaRow icon={job.budget.includes("per month") ? "briefcase" : "cash-stack"} text={job.budget} />
            ) : null}
            {job.experience ? <MetaRow icon="cap" text={`Experience: ${job.experience}`} /> : null}
            {job.location ? <MetaRow icon="pin" text={job.location} /> : null}
          </div>
        ) : null}

        {/* Tags row */}
        {job.tags?.length ? (
          <div className="mt-4 overflow-hidden">
            <TagRow tags={job.tags} />
          </div>
        ) : null}

        {/* Bottom row */}
        <div className="mt-auto flex h-10 items-center justify-between gap-3">
          <div className="flex items-center gap-4">
            <StatRow
              icon="eye"
              value={formatCompactNumber(currentlyViewing)}
              label="Currently viewing"
              interactive
            />
            <StatRow icon="users" value={`${job.applicants}`} label="Applicants" interactive />
            <StatRow icon="bolt" value={`${responseRate}%`} label="Response rate" interactive />
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            <IconAction
              label={saved ? "Saved" : "Save"}
              onClick={async (e) => {
                stop(e);
                if (!job.id) return;
                if (!session?.backendAccessToken) {
                  router.push(`/auth?mode=login&next=${encodeURIComponent(cardHref)}`);
                  return;
                }
                setSaving(true);
                try {
                  await saveJob(session.backendAccessToken, String(job.id));
                  setSaved(true);
                } finally {
                  setSaving(false);
                }
              }}
            >
              <Icon name="bookmark" className={["w-4 h-4", saving ? "opacity-45" : ""].join(" ")} />
            </IconAction>

            <IconAction
              label={copied ? "Copied" : "Share"}
              onClick={async (e) => {
                stop(e);
                const url = `${window.location.origin}${cardHref}`;
                await navigator.clipboard?.writeText(url);
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1400);
              }}
            >
              <Icon name="share" className="w-4 h-4" />
            </IconAction>
          </div>
        </div>
      </div>
    </div>
  );
}
