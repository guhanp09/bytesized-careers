"use client";

import Link from "next/link";
import React from "react";
import { Job } from "../../lib/types";
import { formatCompactNumber } from "../../lib/format";
import { Icon } from "../Icons";
import { IconTooltip, Section } from "../ui";

const APPLY_NOTE_MAX_LENGTH = 600;
const EMPTY_REVIEW_STARS = "☆☆☆☆☆";

const cleanText = (value?: string | null) => {
  const text = value?.trim();
  return text || null;
};

const titleFromSlug = (value?: string | null) => {
  const text = cleanText(value);
  if (!text) return null;
  return text
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
};

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

function InlineIdentityLink({
  href,
  external = false,
  children,
  ariaLabel,
  className = "",
}: {
  href?: string | null;
  external?: boolean;
  children: React.ReactNode;
  ariaLabel: string;
  className?: string;
}) {
  const baseClass = [
    "underline-offset-4 transition-colors hover:text-white hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20",
    className,
  ].join(" ");

  if (!href) {
    return <span className={className}>{children}</span>;
  }

  if (external) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" aria-label={ariaLabel} className={baseClass}>
        {children}
      </a>
    );
  }

  return (
    <Link href={href} aria-label={ariaLabel} className={baseClass}>
      {children}
    </Link>
  );
}

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

function StatTile({ icon, value, label }: { icon: "users" | "eye" | "bolt"; value: string; label: string }) {
  const tooltipId = React.useId();
  const anchorRef = React.useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = React.useState(false);

  return (
    <div className="relative">
      <div
        tabIndex={0}
        aria-describedby={open ? tooltipId : undefined}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="cursor-pointer focus-visible:outline-none"
      >
        <TileShell className="h-[54px] flex items-center justify-center">
          <div ref={anchorRef} className="flex items-center justify-center gap-2 text-white/75 transition-colors duration-150 hover:text-white">
            <Icon name={icon} className="w-4 h-4" />
            <span className="tabular-nums text-sm">{value}</span>
            <span className="sr-only">{label}</span>
          </div>
        </TileShell>
      </div>
      <IconTooltip label={label} anchorRef={anchorRef} open={open} id={tooltipId} sideOffset={4} />
    </div>
  );
}

function PostedByCard({ job }: { job: Job }) {
  const isAgencyPost = Boolean(job.postedByAgency);
  const agencyName =
    cleanText(job.managedByAgencyName) ||
    titleFromSlug(job.agencyProfileSlug) ||
    cleanText(job.hiringDisplayName) ||
    "Creator agency";
  const agencyHref = job.agencyProfileSlug
    ? `/u/${encodeURIComponent(job.agencyProfileSlug)}?view=hiring`
    : null;
  const creatorHref = job.channelProfileSlug
    ? `/u/${encodeURIComponent(job.channelProfileSlug)}?view=hiring`
    : null;
  const channelExternalHref = normalizeHttpUrl(job.channelExternalUrl);
  const creatorMeta = "Creator";

  return (
    <section
      data-testid="posted-by-card"
      aria-label="Posted by"
      className="rounded-2xl bg-white/[0.06] border border-white/10 p-5 shadow-[0_10px_30px_-20px_rgba(0,0,0,0.9)]"
    >
      <h2 className="sr-only">Posted by</h2>
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-white/12 bg-white/[0.055] text-white/62">
          {isAgencyPost ? (
            <Icon name="briefcase" className="h-4 w-4" />
          ) : (
            <span
              aria-hidden="true"
              className="h-full w-full bg-cover bg-center"
              style={{ backgroundImage: `url(${job.channel.logoUrl})` }}
            />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-white/88">
            {isAgencyPost ? (
              <InlineIdentityLink
                href={agencyHref}
                ariaLabel={`Open ${agencyName} CreatorJobs profile`}
                className="block truncate"
              >
                {agencyName}
              </InlineIdentityLink>
            ) : (
              <InlineIdentityLink
                href={creatorHref}
                ariaLabel={`Open ${job.channel.name} CreatorJobs profile`}
                className="block truncate"
              >
                {job.channel.name}
              </InlineIdentityLink>
            )}
          </p>

          {isAgencyPost ? (
            <p className="mt-1 text-xs leading-5 text-white/50">
              <span>Agency</span>
              <span aria-hidden="true"> · </span>
              <span>Hiring for </span>
              <InlineIdentityLink
                href={channelExternalHref}
                external
                ariaLabel={`Open ${job.channel.name} channel or page`}
                className="font-medium text-white/58"
              >
                {job.channel.name}
              </InlineIdentityLink>
            </p>
          ) : (
            <p className="mt-1 text-xs leading-5 text-white/50">{creatorMeta}</p>
          )}
          <p
            className="mt-2 text-xs font-medium tracking-[0.04em] text-white/52"
            aria-label="0 reviews as recruiter"
          >
            {EMPTY_REVIEW_STARS} 0 reviews as recruiter
          </p>
        </div>
      </div>
    </section>
  );
}

export default function JobActionsPanel({
  job,
  onShare,
  onSave,
  onApply,
  onReport,
  saveState = "idle",
  applyState = "idle",
  applyError = null,
  saveError = null,
  reportState = "idle",
  applyNote,
  onApplyNoteChange,
  secondaryBtnBrightness,
  shareState = "idle",
  isOwner = false,
}: {
  job: Job;
  onShare: () => void;
  onSave: () => void;
  onApply: () => void;
  onReport: () => void;
  saveState?: "idle" | "saving" | "saved" | "error";
  applyState?: "idle" | "saving" | "sent" | "error";
  applyError?: string | null;
  saveError?: string | null;
  reportState?: "idle" | "sending" | "sent" | "error";
  applyNote: string;
  onApplyNoteChange: (value: string) => void;
  secondaryBtnBrightness: number;
  shareState?: "idle" | "copied";
  isOwner?: boolean;
}) {
  const responseRate = Number.isFinite(job.responseRate) ? Math.max(0, job.responseRate) : 0;
  const currentlyViewing = Number.isFinite(job.views) ? Math.max(0, job.views) : 0;

  return (
    <div className="space-y-6">
      {isOwner ? null : (
      <section
        data-testid="job-apply-panel"
        className="rounded-3xl bg-white/[0.06] border border-white/[0.08] p-6 shadow-[0_18px_60px_-40px_rgba(0,0,0,0.95)]"
      >
        <div
          className="relative rounded-2xl border border-white/10 bg-white/[0.045] transition focus-within:ring-2 focus-within:ring-white/15"
          data-testid="proposal-textarea-frame"
        >
          <textarea
            value={applyNote}
            onChange={(event) => onApplyNoteChange(event.target.value)}
            maxLength={APPLY_NOTE_MAX_LENGTH}
            className="min-h-[112px] w-full resize-none bg-transparent px-3 pb-8 pt-2 text-sm leading-6 text-white placeholder:text-white/35 focus:outline-none"
            placeholder="Add a short proposal or context for the hiring team."
          />
          <span className="pointer-events-none absolute bottom-2.5 right-3 text-xs font-medium tabular-nums text-white/38">
            {applyNote.length}/{APPLY_NOTE_MAX_LENGTH}
          </span>
        </div>

        <button
          className={[
            "mt-3 w-full h-14 cursor-pointer rounded-2xl bg-white text-black font-extrabold text-lg",
            "shadow-[0_18px_40px_-28px_rgba(0,0,0,0.9)]",
            "transition-transform duration-150 hover:-translate-y-[1px] hover:bg-white/95",
            "active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-65",
          ].join(" ")}
          onClick={onApply}
          disabled={applyState === "saving" || applyState === "sent"}
        >
          <span className="inline-flex items-center justify-center gap-2">
            <Icon name="send" className="w-5 h-5" />
            {applyState === "saving" ? "Sending..." : applyState === "sent" ? "Applied" : "Apply"}
          </span>
        </button>
        {applyState === "error" ? (
          <p className="mt-2 text-xs text-amber-200/80">
            {applyError || "Couldn’t send the application. Try again."}
          </p>
        ) : null}

        <div className="mt-4 grid grid-cols-2 gap-3">
          <button
            className="h-10 cursor-pointer inline-flex items-center justify-center gap-2 rounded-xl text-black text-sm font-semibold shadow-[0_14px_35px_-26px_rgba(0,0,0,0.95)] transition-transform duration-150 hover:-translate-y-[1px] active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-65"
            style={{ backgroundColor: `rgba(255,255,255,${secondaryBtnBrightness})` }}
            onClick={onSave}
            disabled={saveState === "saving"}
          >
            <Icon name="bookmark" className="w-4 h-4" />
            {saveState === "saving" ? "Saving..." : saveState === "saved" ? "Saved" : "Save"}
          </button>

          <button
            className="h-10 cursor-pointer inline-flex items-center justify-center gap-2 rounded-xl text-black text-sm font-semibold shadow-[0_14px_35px_-26px_rgba(0,0,0,0.95)] transition-transform duration-150 hover:-translate-y-[1px] active:translate-y-0"
            style={{ backgroundColor: `rgba(255,255,255,${secondaryBtnBrightness})` }}
            onClick={onShare}
          >
            <Icon name="share" className="w-4 h-4" />
            {shareState === "copied" ? "Copied" : "Share"}
          </button>
        </div>
        {saveState === "error" ? (
          <p className="mt-2 text-xs text-amber-200/80">{saveError || "Couldn’t save this job right now."}</p>
        ) : null}
        {shareState === "copied" ? <p className="mt-2 text-xs text-white/45">Link copied to your clipboard.</p> : null}

        <div className="mt-4 grid grid-cols-3 gap-3">
          <StatTile icon="users" value={`${job.applicants}`} label="Applicants" />
          <StatTile icon="eye" value={formatCompactNumber(currentlyViewing)} label="Currently viewing" />
          <StatTile icon="bolt" value={`${responseRate}%`} label="Response rate" />
        </div>
      </section>
      )}

      <PostedByCard job={job} />

      <div data-testid="job-safety-card">
        <Section title="Safety & expectations" bodyClassName="mt-3 text-sm text-white/80 leading-relaxed">
          Keep communication inside the platform, share clear scope, and confirm deliverables, timeline, revisions, and payment terms before starting.
        </Section>
      </div>

      {isOwner ? null : (
      <div className="-mt-3 px-1">
        <button
          type="button"
          onClick={onReport}
          disabled={reportState === "sending" || reportState === "sent"}
          className="cursor-pointer inline-flex items-center gap-2 rounded-md text-xs font-semibold text-white/42 underline-offset-4 transition hover:text-white/72 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/18 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0b0f] disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Icon name="alert" className="h-3.5 w-3.5" />
          {reportState === "sending" ? "Reporting..." : reportState === "sent" ? "Reported" : "Report this listing"}
        </button>
        {reportState === "error" ? (
          <p className="mt-2 text-xs text-white/45">Couldn’t send the report. Try again.</p>
        ) : null}
      </div>
      )}
    </div>
  );
}
