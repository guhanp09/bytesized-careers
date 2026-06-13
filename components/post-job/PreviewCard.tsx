"use client";

import React from "react";
import { StartTimeframe } from "../../lib/types";
import { formatPostedLabel, formatStartLabel } from "../../lib/format";
import { Icon } from "../Icons";
import { MetaRow, StatRow, TagPill } from "../ui";

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

export default function PreviewCard({
  title,
  channelName,
  verified,
  subsText,
  budgetText,
  experienceText,
  locationText,
  tags,
  startWithin,
  platform,
  postedShort,
  profileImageUrl,
  authorizationStatus,
  managedByName,
}: {
  title: string;
  channelName: string;
  verified: boolean;
  subsText: string;
  budgetText: string;
  experienceText: string;
  locationText: string;
  tags: string[];
  startWithin?: StartTimeframe;
  platform?: string;
  postedShort?: string;
  profileImageUrl?: string | null;
  authorizationStatus?: string | null;
  managedByName?: string | null;
}) {
  const showChannelName = channelName.trim() || "Finance Channel";
  const showSubs = subsText.trim();
  const showTitle = title.trim() || "Your job title goes here";

  const showBudget = budgetText.trim();
  const showExperience = experienceText.trim();
  const showLocation = locationText.trim();
  const postedLabel = formatPostedLabel(postedShort || "1d");

  const topTags = tags.slice(0, 3);
  const extra = tags.length - topTags.length;

  return (
    <div className="select-none">
      <div
        className={[
          "rounded-[26px] p-5",
          "bg-white/[0.06] border border-white/[0.08]",
          "shadow-[0_18px_55px_-42px_rgba(0,0,0,0.95)]",
          "h-[340px] grid",
          "grid-rows-[56px_52px_78px_44px_1fr]",
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
              <div className="flex items-center gap-1 min-w-0">
                <p className="text-sm font-semibold text-white truncate">{showChannelName}</p>

                {verified ? (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-white/10 border border-white/10 text-white/80">
                    Verified
                  </span>
                ) : null}
              </div>

              <p className="text-xs text-white/55 truncate inline-flex items-center gap-1.5">
                <Icon name={getPlatformIcon(platform)} className="w-3.5 h-3.5" />
                {formatFollowerText(showSubs, platform) ? (
                  <>
                    <span>{formatFollowerText(showSubs, platform)}</span>
                    <span className="text-white/40">• {postedLabel}</span>
                  </>
                ) : (
                  <span>{postedLabel}</span>
                )}
              </p>
              {authorizationStatus && authorizationStatus !== "Connected" ? (
                <p className="mt-1 truncate text-[11px] text-white/42">
                  {authorizationStatus}
                  {managedByName ? ` · via ${managedByName}` : ""}
                </p>
              ) : managedByName ? (
                <p className="mt-1 truncate text-[11px] text-white/42">via {managedByName}</p>
              ) : null}
            </div>
          </div>

          {startWithin ? (
            <TagPill className="text-white/80 whitespace-nowrap">
              {`Start: ${formatStartLabel(startWithin)}`}
            </TagPill>
          ) : null}
        </div>

        <h3 className="text-[15px] font-extrabold leading-snug text-white uppercase line-clamp-2 h-[52px]">
          {showTitle}
        </h3>

        <div className="space-y-2">
          <MetaRow
            icon={showBudget.includes("per month") ? "briefcase" : "cash-stack"}
            text={showBudget ? `Budget: ${showBudget}` : "Budget:"}
          />
          <MetaRow icon="cap" text={showExperience ? `Experience: ${showExperience}` : "Experience: "} />
          <MetaRow icon="pin" text={showLocation || ""} />
        </div>

        <div className="overflow-hidden pt-2">
          <div className="flex flex-wrap gap-1.5">
            {topTags.length ? (
              topTags.map((t) => <TagPill key={t}>{t}</TagPill>)
            ) : (
              <>
                {["tag1", "tag2", "tag3", "tag4", "tag5"].map((t) => (
                  <TagPill key={t}>{t === "tag1" ? "Remote" : t === "tag2" ? "YouTube" : t === "tag3" ? "Editing" : t === "tag4" ? "Monthly" : "Creator-led media"}</TagPill>
                ))}
              </>
            )}

            {extra > 0 ? (
              <span className="text-[11px] px-2 py-1 rounded-lg bg-white/5 border border-white/10 text-white/55">
                +{extra}
              </span>
            ) : null}
          </div>
        </div>

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
