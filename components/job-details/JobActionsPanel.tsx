"use client";

import Link from "next/link";
import React from "react";
import { Job } from "../../lib/types";
import { formatCompactNumber } from "../../lib/format";
import {
  buildJobTransparency,
  employerContextLabel,
  hiringVerificationForJob,
} from "../../lib/jobPresentation";
import { Icon } from "../Icons";
import { IconTooltip, Section } from "../ui";


// Secondary action buttons (Save / Share): clearly pressable — filled surface
// with a subtle lift + shadow — but deliberately subordinate to the solid white
// primary (Apply) and visually distinct from the flat, passive stat chips.
const SECONDARY_ACTION_CLASS =
  "inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/[0.08] text-sm font-semibold text-white/85 shadow-[0_10px_26px_-20px_rgba(0,0,0,0.95)] transition-all duration-150 hover:-translate-y-[1px] hover:border-white/25 hover:bg-white/[0.13] hover:text-white active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/25 disabled:cursor-not-allowed disabled:opacity-60";

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
        "bg-white/[0.03] border border-white/[0.06]",
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
  const usesCanonicalEmployerContext = (job.listingSchemaVersion || 1) >= 3;
  const agencyName =
    cleanText(job.managedByAgencyName) ||
    titleFromSlug(job.agencyProfileSlug) ||
    "Agency identity unavailable";
  const agencyHref = job.agencyProfileSlug
    ? `/u/${encodeURIComponent(job.agencyProfileSlug)}?view=hiring`
    : null;
  const creatorHref = job.channelProfileSlug
    ? `/u/${encodeURIComponent(job.channelProfileSlug)}?view=hiring`
    : null;
  const channelExternalHref = normalizeHttpUrl(job.channelExternalUrl);
  const employerName = cleanText(job.hiringDisplayName) || cleanText(job.channel.name) || "Hiring identity unavailable";
  const employerType = employerContextLabel(job.employerContextType);
  const verificationState = hiringVerificationForJob(job);
  const verificationStatus = verificationState.status;
  const verified = verificationState.verified;
  const verificationLabel = verified
    ? "Verified hiring identity"
    : verificationStatus
      ? verificationStatus === "PENDING"
        ? "Verification pending"
        : "Hiring identity not verified"
      : null;

  return (
    <section
      data-testid="posted-by-card"
      aria-label="Posted by"
      className="min-w-0 rounded-2xl bg-white/[0.06] border border-white/10 p-4 sm:p-5 shadow-[0_10px_30px_-20px_rgba(0,0,0,0.9)]"
    >
      <h2 className="sr-only">Posted by</h2>
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-white/12 bg-white/[0.055] text-white/62">
          {isAgencyPost ? (
            <Icon name="briefcase" className="h-4 w-4" />
          ) : job.channel.logoUrl ? (
            <span
              aria-hidden="true"
              className="h-full w-full bg-cover bg-center"
              style={{ backgroundImage: `url(${job.channel.logoUrl})` }}
            />
          ) : (
            <Icon name="briefcase" className="h-4 w-4" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="break-words text-sm font-semibold text-white/88">
            {isAgencyPost ? (
              <InlineIdentityLink
                href={agencyHref}
                ariaLabel={`Open ${agencyName} CreatorJobs profile`}
                className="block break-words"
              >
                {agencyName}
              </InlineIdentityLink>
            ) : (
              <InlineIdentityLink
                href={creatorHref}
                ariaLabel={`Open ${employerName} CreatorJobs profile`}
                className="block break-words"
              >
                {employerName}
              </InlineIdentityLink>
            )}
          </p>

          {isAgencyPost ? (
            <p className="mt-1 text-xs leading-5 text-white/50">
              <span>Hiring on behalf of </span>
              <InlineIdentityLink
                href={channelExternalHref}
                external
                ariaLabel={`Open ${employerName} channel or page`}
                className="font-medium text-white/58"
              >
                {employerName}
              </InlineIdentityLink>
            </p>
          ) : (
            usesCanonicalEmployerContext ? (
              <p className="mt-1 text-xs leading-5 text-white/50">
                Hiring directly{employerType ? ` · ${employerType}` : ""}
              </p>
            ) : employerType ? (
              <p className="mt-1 text-xs leading-5 text-white/50">{employerType}</p>
            ) : null
          )}
          {verificationLabel ? (
            <p className={verified ? "mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-emerald-100/75" : "mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-white/45"}>
              <Icon name={verified ? "badge-check" : "shield"} className="h-3.5 w-3.5" />
              {verificationLabel}
            </p>
          ) : null}
          {isAgencyPost ? <p className="mt-1 text-xs text-white/42">Managed by {agencyName}</p> : null}
        </div>
      </div>
    </section>
  );
}

function TransparencyCard({ job }: { job: Job }) {
  const transparency = buildJobTransparency(job);
  if (!transparency.explicit.length && !transparency.attention.length && !transparency.legacyNotice) return null;
  return (
    <section
      aria-labelledby="listing-transparency-title"
      className="min-w-0 rounded-2xl border border-white/10 bg-white/[0.045] p-4 sm:p-5"
      data-testid="job-transparency-card"
    >
      <h2 id="listing-transparency-title" className="text-sm font-semibold text-white/88">Listing transparency</h2>
      <p className="mt-1 text-xs leading-relaxed text-white/45">Factual details disclosed on this listing, not a safety or quality score.</p>
      {transparency.explicit.length ? (
        <ul className="mt-4 space-y-2 text-xs leading-relaxed text-white/66">
          {transparency.explicit.map((item) => (
            <li key={item.label} className="flex min-w-0 gap-2">
              <Icon name="check" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-200/70" />
              <span className="min-w-0 break-words">{item.label}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {transparency.attention.length ? (
        <div className="mt-4 border-t border-white/[0.07] pt-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/38">Worth confirming</p>
          <ul className="mt-2 space-y-2 text-xs leading-relaxed text-white/58">
            {transparency.attention.map((item) => (
              <li key={item.label} className="flex min-w-0 gap-2">
                <Icon name="alert" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-100/65" />
                <span className="min-w-0 break-words">{item.label}{item.detail ? ` · ${item.detail}` : ""}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {transparency.legacyNotice ? <p className="mt-4 border-t border-white/[0.07] pt-3 text-xs leading-relaxed text-white/48">{transparency.legacyNotice}</p> : null}
    </section>
  );
}

type PrimaryAction = {
  label: string;
  icon: "send" | "inbox" | "refresh" | "calendar-clock" | "external-link" | "alert";
  disabled?: boolean;
  href?: string;
  external?: boolean;
};

function PrimaryApplicationAction({
  action,
  applyState,
  onApply,
  className = "",
}: {
  action?: PrimaryAction;
  applyState: "idle" | "saving" | "sent" | "error";
  onApply: () => void;
  className?: string;
}) {
  const content = (
    <span className="inline-flex min-w-0 items-center justify-center gap-2" aria-live="polite" aria-atomic="true">
      <Icon name={action?.icon ?? "send"} className="h-5 w-5 shrink-0" />
      <span className="min-w-0 break-words">
        {applyState === "saving" ? "Sending…" : action?.label ?? (applyState === "sent" ? "Applied" : "Apply")}
      </span>
    </span>
  );
  const classes = [
    "min-h-14 w-full cursor-pointer items-center justify-center rounded-2xl bg-white px-3 py-2.5 text-base font-extrabold leading-tight text-black shadow-[0_18px_40px_-28px_rgba(0,0,0,0.9)] transition-transform duration-150 hover:-translate-y-[1px] hover:bg-white/95 active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/35 disabled:cursor-not-allowed disabled:opacity-65",
    className || "flex",
  ].join(" ");
  if (action?.href && !action.disabled) {
    return (
      <a
        href={action.href}
        target={action.external ? "_blank" : undefined}
        rel={action.external ? "noopener noreferrer" : undefined}
        aria-label={action.external ? `${action.label} (opens in a new tab)` : undefined}
        className={classes}
        data-testid="job-apply-button"
      >
        {content}
      </a>
    );
  }
  return (
    <button
      type="button"
      className={classes}
      onClick={onApply}
      disabled={action?.disabled || applyState === "saving" || (applyState === "sent" && !action)}
      data-testid="job-apply-button"
    >
      {content}
    </button>
  );
}

function CreatorContextCard({ job }: { job: Job }) {
  const groups = [
    { label: "Content niches", items: job.contentNiches ?? [] },
    { label: "Genres", items: job.contentGenres ?? [] },
    { label: "Formats hired for", items: job.formatsHiredFor ?? [] },
  ]
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => item.trim().length > 0),
    }))
    .filter((group) => group.items.length > 0);

  if (!groups.length) {
    return null;
  }

  return (
    <section
      data-testid="job-creator-context-card"
      aria-label="Structured job metadata"
      className="min-w-0 rounded-2xl border border-white/10 bg-white/[0.06] p-5 shadow-[0_10px_30px_-20px_rgba(0,0,0,0.9)]"
    >
      <div className="space-y-4">
        {groups.map((group) => (
          <div key={group.label} className="min-w-0 space-y-2.5">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/38">
              {group.label}
            </div>
            <div className="flex min-w-0 flex-wrap gap-2">
              {group.items.map((item) => (
                <span
                  key={`${group.label}-${item}`}
                  className="max-w-full break-words rounded-full border border-white/[0.09] bg-white/[0.04] px-3 py-1.5 text-xs font-medium leading-relaxed text-white/64"
                >
                  {item}
                </span>
              ))}
            </div>
          </div>
        ))}
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
  shareState = "idle",
  isOwner = false,
  primaryAction,
  applicationStatusLabel,
  applicationMode = "internal",
  applicationNotice = null,
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
  shareState?: "idle" | "copied";
  isOwner?: boolean;
  primaryAction?: PrimaryAction;
  applicationStatusLabel?: string | null;
  applicationMode?: "internal" | "external";
  applicationNotice?: string | null;
}) {
  const responseRate = Number.isFinite(job.responseRate) ? Math.max(0, job.responseRate) : 0;
  const views = Number.isFinite(job.views) ? Math.max(0, job.views) : 0;

  return (
    <div className="min-w-0 space-y-6">
      {isOwner ? null : (
      <section
        data-testid="job-apply-panel"
        className="rounded-3xl bg-white/[0.06] border border-white/[0.08] p-6 shadow-[0_18px_60px_-40px_rgba(0,0,0,0.95)]"
      >
        <PrimaryApplicationAction action={primaryAction} applyState={applyState} onApply={onApply} className="hidden lg:flex" />
        {applicationNotice ? <p className="mt-3 text-xs leading-relaxed text-white/52">{applicationNotice}</p> : null}
        {applicationStatusLabel ? (
          <p data-testid="job-application-status" className="mt-2 text-center text-xs font-medium text-white/52">
            {applicationStatusLabel}
          </p>
        ) : null}
        {applyState === "error" ? (
          <p role="alert" aria-live="assertive" className="mt-2 text-xs text-amber-200/80">
            {applyError || "Couldn’t send the application. Try again."}
          </p>
        ) : null}

        <div className="mt-4 grid grid-cols-2 gap-3">
          <button
            type="button"
            className={SECONDARY_ACTION_CLASS}
            onClick={onSave}
            disabled={saveState === "saving"}
          >
            <Icon name="bookmark" className="w-4 h-4" />
            {saveState === "saving" ? "Saving..." : saveState === "saved" ? "Saved" : "Save"}
          </button>

          <button
            type="button"
            className={SECONDARY_ACTION_CLASS}
            onClick={onShare}
          >
            <Icon name="share" className="w-4 h-4" />
            {shareState === "copied" ? "Copied" : "Share"}
          </button>
        </div>
        {saveState === "error" ? (
          <p role="alert" className="mt-2 text-xs text-amber-200/80">{saveError || "Couldn’t save this job right now."}</p>
        ) : null}
        {shareState === "copied" ? <p role="status" className="mt-2 text-xs text-white/45">Link copied to your clipboard.</p> : null}

        <div className="mt-4 hidden grid-cols-3 gap-3 lg:grid">
          <StatTile icon="users" value={`${job.applicants}`} label="Applicants" />
          <StatTile icon="eye" value={formatCompactNumber(views)} label="Views" />
          <StatTile icon="bolt" value={`${responseRate}%`} label="Response rate" />
        </div>
      </section>
      )}

      <PostedByCard job={job} />

      <CreatorContextCard job={job} />

      <TransparencyCard job={job} />

      <div data-testid="job-safety-card">
        <Section title="Safety & expectations" icon="shield" bodyClassName="mt-3 text-sm text-white/80 leading-relaxed">
          {primaryAction?.external && primaryAction.href
            ? "Use only the disclosed application link, and confirm deliverables, timeline, revisions, and payment terms before starting."
            : "Keep communication inside the platform, share clear scope, and confirm deliverables, timeline, revisions, and payment terms before starting."}
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
      {isOwner ? null : (
        <div className="fixed bottom-0 left-20 right-0 z-40 border-t border-white/10 bg-[#0b0b0f]/95 px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur lg:hidden" data-testid="job-mobile-apply-bar">
          <PrimaryApplicationAction action={primaryAction} applyState={applyState} onApply={onApply} />
          {applicationMode === "external" && primaryAction?.href ? <p className="mt-1.5 text-center text-[10px] text-white/45">Opens another site in a new tab</p> : null}
        </div>
      )}
    </div>
  );
}
