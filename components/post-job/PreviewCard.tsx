"use client";

import React from "react";
import { formatListingTitle } from "../../lib/displayText";
import { formatPostedLabel } from "../../lib/format";
import { jobDisplayChips } from "../../lib/jobCreatorContext";
import { Icon } from "../Icons";
import { MetaRow, StatRow, TagPill } from "../ui";
import ChannelAttribution from "../jobs/ChannelAttribution";

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

const formatFollowerText = (raw: string, platform?: string) => {
  const trimmed = raw.trim();
  const base = trimmed.replace(/\bsubs\b/i, "").trim();
  const isYoutube = getPlatform(platform) === "youtube";
  if (!base) return "";
  return `${base} ${isYoutube ? "subscribers" : "followers"}`.trim();
};

function PreviewIconButton({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className="h-9 w-9 inline-flex items-center justify-center rounded-xl bg-white/6 border border-white/10 hover:bg-white/10 transition-colors"
      onClick={(e) => e.preventDefault()}
    >
      {children}
    </button>
  );
}

function PreviewCta({ label }: { label: string }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-sm px-0.5 py-0.5 text-[12px] font-extrabold tracking-[0.04em] text-white/90">
      <span>{label}</span>
      <span aria-hidden="true">→</span>
    </span>
  );
}

export default function PreviewCard({
  title,
  channelName,
  subsText,
  budgetText,
  experienceText,
  locationText,
  tags,
  contentNiches = [],
  contentGenres = [],
  formatsHiredFor = [],
  platform,
  postedShort,
  profileImageUrl,
}: {
  title: string;
  channelName: string;
  subsText: string;
  budgetText: string;
  experienceText: string;
  locationText: string;
  tags: string[];
  contentNiches?: string[];
  contentGenres?: string[];
  formatsHiredFor?: string[];
  platform?: string;
  postedShort?: string;
  profileImageUrl?: string | null;
}) {
  const showChannelName = channelName.trim() || "Finance Channel";
  const showSubs = subsText.trim();
  const showTitle = formatListingTitle(title.trim() || "Your job title goes here");

  const showBudget = budgetText.trim();
  const showExperience = experienceText.trim();
  const showLocation = locationText.trim();
  const postedLabel = formatPostedLabel(postedShort || "1d");

  const displayChips = jobDisplayChips({ tags, contentNiches, contentGenres, formatsHiredFor }).slice(0, 8);
  const topTags = displayChips.slice(0, 3);
  const extra = displayChips.length - topTags.length;

  return (
    <div className="select-none">
      <div
        className={[
          "rounded-2xl p-5",
          "bg-white/[0.06] border border-white/10",
          "shadow-[0_10px_30px_-20px_rgba(0,0,0,0.9)]",
          "h-[340px] flex flex-col",
        ].join(" ")}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-12 w-12 rounded-full border border-white/15 bg-white/10 flex-shrink-0 inline-flex items-center justify-center">
              {profileImageUrl ? (
                <img src={profileImageUrl} alt="Brand" className="h-full w-full rounded-full object-cover" />
              ) : (
                <Icon name={getPlatformIcon(platform)} className="w-6 h-6 text-white/70" />
              )}
            </div>

            <div className="min-w-0">
              <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                <ChannelAttribution
                  channelName={showChannelName}
                  className="text-sm font-semibold text-white max-w-[170px]"
                />
              </div>

              <p className="text-xs text-white/55 truncate inline-flex items-center gap-1.5">
                <Icon name={getPlatformIcon(platform)} className="w-3.5 h-3.5" />
                {formatFollowerText(showSubs, platform) ? (
                  <>
                    <span>{formatFollowerText(showSubs, platform)}</span>
                    <span className="text-subtle">• {postedLabel}</span>
                  </>
                ) : (
                  <span>{postedLabel}</span>
                )}
              </p>
            </div>
          </div>
          <PreviewCta label="Apply Now" />
        </div>

        <h3 className="mt-4 h-[52px] line-clamp-2 text-[15px] font-extrabold leading-snug text-white">
          {showTitle}
        </h3>

        <div className="mt-4 space-y-2">
          <MetaRow
            icon={showBudget.includes("per month") ? "briefcase" : "cash-stack"}
            text={showBudget ? `Budget: ${showBudget}` : "Budget:"}
          />
          <MetaRow icon="cap" text={showExperience ? `Experience: ${showExperience}` : "Experience: "} />
          <MetaRow icon="pin" text={showLocation || ""} />
        </div>

        {topTags.length ? (
          <div className="mt-4 overflow-hidden">
            <div className="flex flex-wrap gap-1.5">
              {topTags.map((t) => (
                <TagPill key={t}>{t}</TagPill>
              ))}

              {extra > 0 ? (
                <span className="text-[11px] px-2 py-1 rounded-lg bg-white/5 border border-white/10 text-white/55">
                  +{extra}
                </span>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="mt-auto flex h-10 items-center justify-between gap-3">
          <div className="flex items-center gap-4">
            <StatRow icon="eye" value="-" />
            <StatRow icon="users" value="-" />
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            <PreviewIconButton label="Save">
              <Icon name="bookmark" className="w-4 h-4" />
            </PreviewIconButton>

            <PreviewIconButton label="Share">
              <Icon name="share" className="w-4 h-4" />
            </PreviewIconButton>
          </div>
        </div>
      </div>
    </div>
  );
}
