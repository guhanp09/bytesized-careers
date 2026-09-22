"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import type { Job } from "../../lib/types";
import { BackendTalentListing, saveJob, saveTalentListing } from "../../lib/backendClient";
import { formatListingTitle } from "../../lib/displayText";
import { jobDisplayChips } from "../../lib/jobCreatorContext";
import { compensationForJob } from "../../lib/jobPresentation";
import { formatTalentListingExperience, formatTalentRate } from "../../lib/talentListing";
import { Icon } from "../Icons";
import { CardActionFeedback, copyTextToClipboard, IconFact, useTransientCardFeedback } from "../ui";

const initials = (value: string) =>
  value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

const displayName = (item: BackendTalentListing) =>
  item.owner_display_name ||
  item.owner_username
    ?.split(/[-_.\s]+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ") ||
  "Talent profile";

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

function useCardSheen() {
  const rectRef = React.useRef<DOMRect | null>(null);

  const onPointerEnter = (event: React.PointerEvent<HTMLElement>) => {
    rectRef.current = event.currentTarget.getBoundingClientRect();
  };

  const onPointerMove = (event: React.PointerEvent<HTMLElement>) => {
    const rect = rectRef.current ?? event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty("--mx", `${event.clientX - rect.left}px`);
    event.currentTarget.style.setProperty("--my", `${event.clientY - rect.top}px`);
  };

  return { onPointerEnter, onPointerMove };
}

const PREVIEW_CARD_CLASSES =
  "group relative isolate flex h-full min-h-[260px] cursor-pointer flex-col rounded-[26px] border border-white/[0.08] bg-white/[0.045] p-5 transition-all duration-200 hover:-translate-y-1 hover:border-white/18 hover:bg-white/[0.065] hover:shadow-[0_24px_48px_-28px_rgba(0,0,0,0.7)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 motion-reduce:hover:translate-y-0";

function PreviewIconButton({
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
      className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.045] text-white/70 transition hover:border-white/15 hover:bg-white/[0.08] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/25"
    >
      {children}
    </button>
  );
}

export function HomeJobPreviewCard({ job }: { job: Job }) {
  const router = useRouter();
  const { data: session } = useSession();
  const sheen = useCardSheen();
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const { feedback, showFeedback } = useTransientCardFeedback();
  const href = `/jobs/${encodeURIComponent(String(job.id))}`;
  const displayTitle = formatListingTitle(job.title);
  const compensation = compensationForJob(job);
  const compensationLabel =
    compensation.headline === "Compensation not specified" && compensation.note
      ? compensation.note
      : compensation.headline;
  const meta = [compensationLabel, job.location, job.experience || job.contractType].filter(Boolean).join(" · ");
  const tags = jobDisplayChips(job).slice(0, 2).join(" · ");

  const open = () => {
    router.push(href);
  };

  const stop = (event: React.MouseEvent) => {
    event.stopPropagation();
  };

  return (
    <article
      role="link"
      tabIndex={0}
      onClick={open}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") open();
      }}
      {...sheen}
      className={PREVIEW_CARD_CLASSES}
    >
      <div aria-hidden="true" className="home-card-sheen -z-10" />
      <CardActionFeedback feedback={feedback} className="bottom-14 right-4" />
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full border border-white/[0.10] bg-white/[0.07] text-xs font-bold text-white/72">
          {initials(job.channel.name) || <Icon name="briefcase" className="h-4 w-4" />}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-white/86">{job.channel.name}</p>
          <p className="mt-1 truncate text-xs text-muted">{[job.category, job.platform || "YouTube"].filter(Boolean).join(" · ")}</p>
        </div>
      </div>

      <h3 className="mt-5 line-clamp-2 text-lg font-semibold leading-tight tracking-tight text-white">{displayTitle}</h3>

      {meta ? <p className="mt-4 line-clamp-2 text-sm leading-6 text-white/58">{meta}</p> : null}
      {tags ? <p className="mt-2 line-clamp-1 text-xs font-medium uppercase tracking-[0.12em] text-subtle">{tags}</p> : null}

      <div className="mt-auto flex items-center justify-end gap-3 pt-5">
        <div className="flex items-center gap-2">
          <PreviewIconButton
            label={saved ? "Saved" : "Save"}
            onClick={async (event) => {
              stop(event);
              if (!session?.backendAccessToken) {
                showFeedback("Sign in to save this job.", "info", "bookmark");
                window.setTimeout(() => {
                  router.push(`/auth?mode=login&next=${encodeURIComponent(href)}`);
                }, 900);
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
            <Icon name="bookmark" className={["h-4 w-4", saving ? "opacity-45" : ""].join(" ")} />
          </PreviewIconButton>
          <PreviewIconButton
            label={copied ? "Copied" : "Share"}
            onClick={async (event) => {
              stop(event);
              try {
                await copyTextToClipboard(`${window.location.origin}${href}`);
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
          </PreviewIconButton>
        </div>
      </div>
    </article>
  );
}

export function HomeTalentPreviewCard({ item }: { item: BackendTalentListing }) {
  const router = useRouter();
  const { data: session } = useSession();
  const sheen = useCardSheen();
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const { feedback, showFeedback } = useTransientCardFeedback();
  const href = `/talent/${encodeURIComponent(item.id)}`;
  const displayTitle = formatListingTitle(item.title);
  const publicProfileHref = item.owner_username ? `/u/${encodeURIComponent(item.owner_username)}?view=talent` : null;
  const name = displayName(item);
  const role = item.primary_role || item.roles[0] || "Content talent";
  const meta = [role, item.location || titleCase(item.work_mode) || "Remote", item.timezone].filter(Boolean).join(" · ");
  const tags = uniq([item.niche, ...item.platforms, ...item.tools]).slice(0, 3).join(" · ");
  const experience = formatTalentListingExperience(item);
  const detailFacts = [
    { icon: "cash-stack" as const, label: "Rate", value: formatTalentRate(item) },
    experience ? { icon: "cap" as const, label: "Experience", value: experience } : null,
    titleCase(item.work_mode) ? { icon: "pin" as const, label: "Work mode", value: titleCase(item.work_mode) } : null,
  ].filter(Boolean) as Array<{ icon: "cash-stack" | "cap" | "pin"; label: string; value: string }>;

  const open = () => {
    router.push(href);
  };

  const stop = (event: React.MouseEvent) => {
    event.stopPropagation();
  };

  return (
    <article
      role="link"
      tabIndex={0}
      onClick={open}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          open();
        }
      }}
      {...sheen}
      className={PREVIEW_CARD_CLASSES}
    >
      <div aria-hidden="true" className="home-card-sheen -z-10" />
      <CardActionFeedback feedback={feedback} className="bottom-14 right-4" />
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {item.owner_avatar_url ? (
            <div
              aria-label={name}
              className="h-11 w-11 flex-shrink-0 rounded-full border border-white/[0.10] bg-cover bg-center bg-white/[0.07]"
              style={{ backgroundImage: `url(${item.owner_avatar_url})` }}
            />
          ) : (
            <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full border border-white/[0.10] bg-white/[0.07] text-xs font-bold text-white/72">
              {initials(name) || <Icon name="user" className="h-4 w-4" />}
            </div>
          )}
          <div className="min-w-0">
            {publicProfileHref ? (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  router.push(publicProfileHref);
                }}
                onKeyDown={(event) => event.stopPropagation()}
                className="block max-w-full cursor-pointer truncate rounded-sm text-left text-sm font-semibold text-white/86 transition-colors hover:text-white hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
              >
                {name}
              </button>
            ) : (
              <p className="truncate text-sm font-semibold text-white/86">{name}</p>
            )}
            <p className="mt-1 truncate text-xs text-muted">{meta}</p>
          </div>
        </div>
      </div>

      <h3 className="mt-5 line-clamp-2 text-lg font-semibold leading-tight tracking-tight text-white">{displayTitle}</h3>

      {detailFacts.length ? (
        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2">
          {detailFacts.map((fact) => (
            <IconFact
              key={fact.label}
              icon={fact.icon}
              label={fact.label}
              value={fact.value}
              valueClassName="text-sm text-white/58"
            />
          ))}
        </div>
      ) : null}
      {tags ? <p className="mt-2 line-clamp-1 text-xs font-medium uppercase tracking-[0.12em] text-subtle">{tags}</p> : null}

      <div className="mt-auto flex items-center justify-end gap-3 pt-5">
        <div className="flex items-center gap-2">
          <PreviewIconButton
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
          </PreviewIconButton>
          <PreviewIconButton
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
          </PreviewIconButton>
        </div>
      </div>
    </article>
  );
}
