"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import type { Job } from "../../lib/types";
import { BackendTalentListing, saveJob, saveTalentListing } from "../../lib/backendClient";
import { Icon } from "../Icons";

const initials = (value: string) =>
  value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

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

const talentRateLabel = (item: BackendTalentListing) => {
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

const experienceRange = (value?: string | null) => {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return "";
  if (/0\s*[–-]\s*1|less than 1|entry|beginner/.test(normalized)) return "0–1 year";
  if (/1\s*[–-]\s*2|junior/.test(normalized)) return "1–2 years";
  if (/2\s*[–-]\s*4|mid/.test(normalized)) return "2–4 years";
  if (/4\s*[–-]\s*6|senior/.test(normalized)) return "4–6 years";
  if (/6\+|expert|lead|principal/.test(normalized)) return "6+ years";
  const years = normalized.match(/(\d+)\s*\+?\s*years?/);
  if (years) {
    const count = Number(years[1]);
    if (count <= 1) return "0–1 year";
    if (count <= 2) return "1–2 years";
    if (count <= 4) return "2–4 years";
    if (count <= 6) return "4–6 years";
    return "6+ years";
  }
  return "";
};

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
  const href = `/jobs/${encodeURIComponent(String(job.id))}`;
  const meta = [job.budget, job.location, job.experience || job.contractType].filter(Boolean).join(" · ");
  const tags = job.tags.slice(0, 2).join(" · ");

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
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full border border-white/[0.10] bg-white/[0.07] text-xs font-bold text-white/72">
          {initials(job.channel.name) || <Icon name="briefcase" className="h-4 w-4" />}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-white/86">{job.channel.name}</p>
          <p className="mt-1 truncate text-xs text-white/45">{[job.category, job.platform || "YouTube"].filter(Boolean).join(" · ")}</p>
        </div>
      </div>

      <h3 className="mt-5 line-clamp-2 text-lg font-semibold leading-tight tracking-tight text-white">{job.title}</h3>

      {meta ? <p className="mt-4 line-clamp-2 text-sm leading-6 text-white/58">{meta}</p> : null}
      {tags ? <p className="mt-2 line-clamp-1 text-xs font-medium uppercase tracking-[0.12em] text-white/36">{tags}</p> : null}

      <div className="mt-auto flex items-center justify-end gap-3 pt-5">
        <div className="flex items-center gap-2">
          <PreviewIconButton
            label={saved ? "Saved" : "Save"}
            onClick={async (event) => {
              stop(event);
              if (!session?.backendAccessToken) {
                router.push(`/auth?mode=login&next=${encodeURIComponent(href)}`);
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
            <Icon name="bookmark" className={["h-4 w-4", saving ? "opacity-45" : ""].join(" ")} />
          </PreviewIconButton>
          <PreviewIconButton
            label={copied ? "Copied" : "Share"}
            onClick={async (event) => {
              stop(event);
              await navigator.clipboard?.writeText(`${window.location.origin}${href}`);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1400);
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
  const href = `/talent/${encodeURIComponent(item.id)}`;
  const publicProfileHref = item.owner_username ? `/u/${encodeURIComponent(item.owner_username)}?view=talent` : null;
  const name = displayName(item);
  const role = item.primary_role || item.roles[0] || "Content talent";
  const meta = [role, item.location || titleCase(item.work_mode) || "Remote", item.timezone].filter(Boolean).join(" · ");
  const tags = uniq([item.niche, ...item.platforms, ...item.tools]).slice(0, 3).join(" · ");
  const experience = experienceRange(item.experience_level);
  const details = [talentRateLabel(item), experience ? `Experience: ${experience}` : null, titleCase(item.work_mode)]
    .filter(Boolean)
    .join(" · ");

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
            <p className="mt-1 truncate text-xs text-white/45">{meta}</p>
          </div>
        </div>
      </div>

      <h3 className="mt-5 line-clamp-2 text-lg font-semibold leading-tight tracking-tight text-white">{item.title}</h3>

      {details ? <p className="mt-4 line-clamp-2 text-sm leading-6 text-white/58">{details}</p> : null}
      {tags ? <p className="mt-2 line-clamp-1 text-xs font-medium uppercase tracking-[0.12em] text-white/36">{tags}</p> : null}

      <div className="mt-auto flex items-center justify-end gap-3 pt-5">
        <div className="flex items-center gap-2">
          <PreviewIconButton
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
          </PreviewIconButton>
          <PreviewIconButton
            label={copied ? "Copied" : "Share"}
            onClick={async (event) => {
              stop(event);
              await navigator.clipboard?.writeText(`${window.location.origin}${href}`);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1400);
            }}
          >
            <Icon name="share" className="h-4 w-4" />
          </PreviewIconButton>
        </div>
      </div>
    </article>
  );
}
