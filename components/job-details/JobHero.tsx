"use client";

import React from "react";
import { Job } from "../../lib/types";
import { formatSubs } from "../../lib/format";
import { Icon } from "../Icons";
import useFitTitle from "./useFitTitle";
import ChannelAttribution from "../jobs/ChannelAttribution";

const TITLE_MAX_LINES = 2;
const TITLE_BASE_PX = 44;
const TITLE_MIN_PX = 20;
const TITLE_STEP_PX = 1;

const verificationLabel = (status?: string) => {
  const normalized = (status || "").toUpperCase();
  if (normalized === "VERIFIED") return "Verified Channel";
  if (normalized === "PENDING") return "Pending Channel";
  if (normalized === "REJECTED") return "Rejected Channel";
  return null;
};

const platformLabel = (platform?: string) => {
  const normalized = (platform || "").toUpperCase();
  if (normalized === "INSTAGRAM") return "Instagram";
  return "YouTube";
};

function TileShell({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={[
        "rounded-2xl",
        "bg-white/[0.045] border border-white/[0.08]",
        "shadow-[0_18px_55px_-42px_rgba(0,0,0,0.95)]",
        "px-4 py-3",
        "select-none",
        className,
      ].join(" ")}
    >
      {children}
    </div>
  );
}

function DetailTile({
  icon,
  label,
  value,
}: {
  icon: "briefcase" | "cap" | "pin";
  label: string;
  value: string;
}) {
  return (
    <TileShell className="h-[108px] flex items-center justify-center">
      <div className="flex flex-col items-center justify-center text-center gap-1">
        <span className="text-white/70">
          <Icon name={icon} className="w-4 h-4" />
        </span>
        <div className="text-[11px] text-white/60 leading-snug">{label}</div>
        <div className="text-sm text-white/90 font-medium leading-snug tabular-nums">{value}</div>
      </div>
    </TileShell>
  );
}

export default function JobHero({
  job,
  postedText,
  titleScale,
}: {
  job: Job;
  postedText: string;
  titleScale: number;
}) {
  const { ref: titleRef, fontPx } = useFitTitle({
    text: job.title,
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
      <h1 ref={titleRef} className="font-extrabold tracking-tight leading-[1.08] break-words uppercase">
        {job.title}
      </h1>

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
              postedByAgency={job.postedByAgency}
              className="text-lg font-semibold text-white max-w-[320px]"
            />
            {job.channel.verified ? (
              <span className="text-[11px] px-2 py-1 rounded-lg bg-white/8 border border-white/10 text-white/70">
                Verified
              </span>
            ) : null}
          </div>
          <div className="text-white/55 text-sm">{formatSubs(job.channel.subscribers)}</div>
          <div className="text-white/45 text-sm">{postedText}</div>
          {job.hiringDisplayName ? (
            <div className="mt-3 rounded-2xl border border-white/[0.08] bg-black/15 px-3 py-3">
              <p className="text-xs text-white/55">
                Hiring for: <span className="font-semibold text-white/85">{job.hiringDisplayName}</span>
              </p>
              <p className="mt-1 text-xs text-white/55">
                {[platformLabel(job.hiringPlatform), verificationLabel(job.hiringVerificationStatus)]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              {job.managedByAgencyName ? (
                <p className="mt-1 text-xs text-white/55">
                  Managed by: <span className="font-semibold text-white/80">{job.managedByAgencyName}</span>
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {tiles.length ? (
        <div className={`mt-6 grid gap-3 ${tileGridClass}`}>
          {tiles.map((tile) => (
            <DetailTile key={tile.label} icon={tile.icon} label={tile.label} value={tile.value} />
          ))}
        </div>
      ) : null}
    </section>
  );
}
