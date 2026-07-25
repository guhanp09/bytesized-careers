"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";

import { saveJob } from "../lib/backendClient";
import { formatListingTitle } from "../lib/displayText";
import { formatCompactNumber, formatPostedLabel } from "../lib/format";
import {
  compensationForJob,
  deadlineForJob,
  engagementForJob,
  hiringVerificationForJob,
  roleForJob,
  trialForJob,
  uniqueJobText,
  workSetupForJob,
} from "../lib/jobPresentation";
import { normalizeCount, normalizePercent } from "../lib/listingStats";
import type { Job } from "../lib/types";
import { useCardSheen } from "../lib/useCardSheen";
import { Icon } from "./Icons";
import ChannelAttribution from "./jobs/ChannelAttribution";
import {
  CardActionFeedback,
  copyTextToClipboard,
  StatRow,
  TagPill,
  useTransientCardFeedback,
} from "./ui";

const platformIconMap: Record<
  string,
  "youtube" | "instagram" | "tiktok" | "facebook" | "linkedin" | "x" | "podcast" | "globe"
> = {
  youtube: "youtube",
  instagram: "instagram",
  tiktok: "tiktok",
  facebook: "facebook",
  linkedin: "linkedin",
  "x/twitter": "x",
  x: "x",
  podcast: "podcast",
};

const getPlatformIcon = (platform?: string) =>
  platformIconMap[(platform || "").toLowerCase()] || "globe";

const channelInitials = (value?: string | null) =>
  (value || "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

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
      className="inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-[var(--vt-line,rgba(255,255,255,0.1))] bg-[var(--vt-inset,rgba(255,255,255,0.06))] transition-colors hover:bg-[var(--vt-inset-hover,rgba(255,255,255,0.1))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vt-accent-ring,rgba(255,255,255,0.2))]"
    >
      {children}
    </button>
  );
}

function ListingCta({ onClick }: { onClick: (event: React.MouseEvent<HTMLButtonElement>) => void }) {
  return (
    <button
      type="button"
      aria-label="Apply Now"
      onClick={onClick}
      onKeyDown={(event) => event.stopPropagation()}
      className="vt-cta group/cta hidden shrink-0 cursor-pointer items-center gap-1.5 rounded-sm px-0.5 py-0.5 text-[12px] font-extrabold tracking-[0.04em] text-[var(--vt-cta-text,rgba(255,255,255,0.9))] underline-offset-4 transition-colors hover:text-[var(--vt-cta-text-hover,#ffffff)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vt-cta-focus-ring,rgba(255,255,255,0.2))] sm:inline-flex"
    >
      <span>Apply Now</span>
      <span aria-hidden="true" className="transition-transform group-hover/cta:translate-x-0.5 motion-reduce:transition-none">
        →
      </span>
    </button>
  );
}

export function JobCard({ job }: { job: Job }) {
  const router = useRouter();
  const { data: session } = useSession();
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const { feedback, showFeedback } = useTransientCardFeedback();
  const sheen = useCardSheen();
  const cardHref = `/jobs/${encodeURIComponent(String(job.id))}`;
  const postedLabel = formatPostedLabel(job.postedShort);
  const viewCount = normalizeCount(job.views);
  const applicantCount = normalizeCount(job.applicants);
  const responseRate = normalizePercent(job.responseRate);
  const role = roleForJob(job);
  const compensation = compensationForJob(job);
  const deadline = deadlineForJob(job.deadlineAt);
  const trial = job.trialStatus ? trialForJob(job) : null;
  const employerName = job.hiringDisplayName || job.channel.name || "Employer not specified";
  const representedBy = job.postedByAgency ? job.managedByAgencyName : "";
  const verified = hiringVerificationForJob(job).verified;
  const contextChips = uniqueJobText([
    job.platform,
    job.formatsHiredFor?.[0],
    trial && trial.status !== "none" ? trial.title : "",
  ]).slice(0, 3);

  const openCard = () => {
    if (job.id) router.push(cardHref);
  };

  return (
    <div className="min-w-0 select-none">
      <div
        role="link"
        tabIndex={0}
        onClick={openCard}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openCard();
          }
        }}
        {...sheen}
        className={[
          "vt-card group relative isolate flex min-h-[350px] min-w-0 cursor-pointer flex-col rounded-2xl p-4 sm:p-5",
          "border border-[var(--vt-card-line,rgba(255,255,255,0.1))] bg-[var(--vt-card,rgba(255,255,255,0.06))]",
          "[background-image:var(--vt-card-sheen,none)] shadow-[var(--vt-card-shadow,0_10px_30px_-20px_rgba(0,0,0,0.9))]",
          "transition-[transform,box-shadow,border-color,background-color] duration-200 ease-out",
          "hover:-translate-y-0.5 hover:border-[var(--vt-card-line-hover,rgba(255,255,255,0.25))] hover:bg-[var(--vt-card-hover-soft,rgba(255,255,255,0.075))]",
          "hover:shadow-[var(--vt-card-shadow-hover,0_22px_55px_-26px_rgba(0,0,0,0.95))] hover:ring-1 hover:ring-[var(--vt-accent-soft,rgba(255,255,255,0.1))]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vt-accent-ring,rgba(255,255,255,0.2))]",
        ].join(" ")}
        title="Open job"
      >
        <div aria-hidden="true" className="home-card-sheen -z-10" />
        <CardActionFeedback feedback={feedback} />

        <header className="flex min-w-0 items-start justify-between gap-2.5">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            {job.channel.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={job.channel.logoUrl}
                alt=""
                className="vt-avatar h-11 w-11 shrink-0 rounded-full border border-[var(--vt-avatar-line,rgba(255,255,255,0.15))] bg-white/10 object-cover"
              />
            ) : (
              <div className="vt-avatar flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[var(--vt-avatar-line,rgba(255,255,255,0.15))] bg-white/10 text-xs font-semibold text-white/72">
                {channelInitials(employerName) || <Icon name="briefcase" className="h-4 w-4" />}
              </div>
            )}
            <div className="min-w-0 flex-1 overflow-hidden">
              <div className="flex min-w-0 items-center gap-1.5">
                <ChannelAttribution
                  channelName={employerName}
                  channelProfileSlug={job.channelProfileSlug}
                  channelExternalUrl={job.channelExternalUrl}
                  className="min-w-0 max-w-full truncate text-sm font-semibold text-white underline-offset-4"
                />
                {verified ? (
                  <span className="inline-flex shrink-0 items-center gap-1 text-[10px] font-semibold text-emerald-100/78" aria-label="Verified hiring identity">
                    <Icon name="badge-check" className="h-3.5 w-3.5" />
                    <span className="hidden xl:inline">Verified</span>
                  </span>
                ) : null}
              </div>
              <p className="mt-0.5 block min-w-0 truncate text-[11px] text-[var(--vt-text-muted,rgba(255,255,255,0.55))]">
                {representedBy ? `Managed by ${representedBy}` : postedLabel || "Open listing"}
              </p>
            </div>
          </div>
          <ListingCta
            onClick={(event) => {
              event.stopPropagation();
              openCard();
            }}
          />
        </header>

        <div className="mt-4 min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.17em] text-subtle">
            {role.name}
          </p>
          {role.specialization ? <p className="mt-1 break-words text-xs text-white/58">{role.specialization}</p> : null}
          <h3 className="mt-2 line-clamp-2 min-h-[42px] break-words text-[15px] font-extrabold leading-snug text-[var(--vt-ink,#ffffff)] underline-offset-4 transition-colors group-hover:underline">
            {formatListingTitle(job.title)}
          </h3>
        </div>

        <div className="mt-4 min-w-0 rounded-2xl border border-white/[0.07] bg-white/[0.025] px-3.5 py-3">
          <p className="break-words text-[15px] font-semibold leading-snug text-white/90">{compensation.headline}</p>
          {compensation.note ? <p className="mt-1 line-clamp-1 break-words text-[11px] text-muted">{compensation.note}</p> : null}
        </div>

        <div className="mt-3 min-w-0 space-y-1.5 text-xs leading-relaxed text-white/62">
          <p className="flex min-w-0 items-start gap-2">
            <Icon name="briefcase" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-subtle" />
            <span className="min-w-0 break-words">{engagementForJob(job)}</span>
          </p>
          <p className="flex min-w-0 items-start gap-2">
            <Icon name="pin" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-subtle" />
            <span className="min-w-0 break-words">{workSetupForJob(job)}</span>
          </p>
          {deadline.valid ? (
            <p className={`flex min-w-0 items-start gap-2 ${deadline.expired ? "font-medium text-amber-100/80" : ""}`}>
              <Icon name="calendar-clock" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-subtle" />
              <span className="min-w-0 break-words">{deadline.label}</span>
            </p>
          ) : null}
        </div>

        {contextChips.length ? (
          <div className="mt-3 flex min-w-0 flex-wrap gap-1.5 overflow-hidden">
            {contextChips.map((chip) => (
              <TagPill key={chip}>
                <span className="inline-flex max-w-full items-center gap-1.5">
                  {chip === job.platform ? <Icon name={getPlatformIcon(job.platform)} className="h-3 w-3 shrink-0" /> : null}
                  <span className="max-w-[150px] truncate">{chip}</span>
                </span>
              </TagPill>
            ))}
          </div>
        ) : null}

        <footer className="mt-auto flex min-w-0 items-center justify-between gap-2 pt-4">
          <div className="hidden min-w-0 items-center gap-3 xl:flex">
            <StatRow icon="eye" value={formatCompactNumber(viewCount)} label="Views" interactive />
            <StatRow icon="users" value={formatCompactNumber(applicantCount)} label="Applicants" interactive />
            <StatRow icon="bolt" value={`${responseRate}%`} label="Response rate" interactive />
          </div>
          <p className="min-w-0 truncate text-[11px] text-subtle xl:hidden">
            {applicantCount} applicant{applicantCount === 1 ? "" : "s"}{postedLabel ? ` · ${postedLabel}` : ""}
          </p>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <IconAction
              label={saved ? "Saved" : "Save"}
              onClick={async (event) => {
                event.stopPropagation();
                if (!job.id) return;
                if (!session?.backendAccessToken) {
                  showFeedback("Sign in to save this job.", "info", "bookmark");
                  window.setTimeout(() => router.push(`/auth?mode=login&next=${encodeURIComponent(cardHref)}`), 900);
                  return;
                }
                if (saved) {
                  showFeedback("This job is already saved.", "info", "bookmark");
                  return;
                }
                setSaving(true);
                try {
                  await saveJob(session.backendAccessToken, String(job.id));
                  setSaved(true);
                  showFeedback("Job saved.", "success", "check", {
                    visual: "check",
                    actionLabel: "View",
                    actionHref: "/you?tab=saved",
                    durationMs: 4200,
                  });
                } catch (error) {
                  console.error("Save job failed:", error);
                  showFeedback("Couldn’t save this job. Try again.", "error", "alert");
                } finally {
                  setSaving(false);
                }
              }}
            >
              <Icon name="bookmark" className={`h-4 w-4 ${saving ? "opacity-45" : ""}`} />
            </IconAction>
            <IconAction
              label={copied ? "Copied" : "Share"}
              onClick={async (event) => {
                event.stopPropagation();
                const url = `${window.location.origin}${cardHref}`;
                try {
                  await copyTextToClipboard(url);
                  setCopied(true);
                  showFeedback("Job link copied.", "success", "share", { visual: "copy" });
                  window.setTimeout(() => setCopied(false), 1800);
                } catch (error) {
                  console.error("Share job failed:", error);
                  showFeedback("Couldn’t copy the link.", "error", "alert");
                }
              }}
            >
              <Icon name="share" className="h-4 w-4" />
            </IconAction>
          </div>
        </footer>
      </div>
    </div>
  );
}
