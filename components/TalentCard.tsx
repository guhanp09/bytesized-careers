"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { BackendTalentListing, saveTalentListing } from "../lib/backendClient";
import { formatCompactNumber } from "../lib/format";
import { Icon } from "./Icons";
import { MetaRow, TagPill } from "./ui";

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

function TalentStat({
  icon,
  children,
}: {
  icon: React.ComponentProps<typeof Icon>["name"];
  children: React.ReactNode;
}) {
  return (
    <span className="inline-flex h-7 items-center gap-1.5 whitespace-nowrap text-xs text-white/70">
      <Icon name={icon} className="h-3.5 w-3.5" />
      <span>{children}</span>
    </span>
  );
}

export default function TalentCard({ item }: { item: BackendTalentListing }) {
  const router = useRouter();
  const { data: session } = useSession();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const href = `/talent/${encodeURIComponent(item.id)}`;
  const publicProfileHref = item.owner_username ? `/u/${encodeURIComponent(item.owner_username)}?view=talent` : null;
  const name = displayName(item);
  const role = item.primary_role || item.roles[0] || "Content talent";
  const location = item.location || titleCase(item.work_mode) || "Remote";
  const metadata = [role, location, item.timezone].filter(Boolean).join(" · ");
  const workMode = titleCase(item.work_mode);
  const experience = experienceRange(item.experience_level);
  const tags = uniq([...item.tools, ...item.platforms, item.niche, ...item.formats]);
  const sampleCount = item.portfolio_item_ids.length;

  const open = () => {
    router.push(href);
  };

  const stop = (event: React.MouseEvent) => {
    event.stopPropagation();
  };

  return (
    <div className="select-none">
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
        className={[
          "group flex h-[340px] cursor-pointer flex-col rounded-2xl p-5",
          "border border-white/10 bg-white/[0.06]",
          "shadow-[0_10px_30px_-20px_rgba(0,0,0,0.9)]",
          "transition-all duration-200",
          "hover:-translate-y-0.5 hover:border-white/25 hover:bg-white/[0.075]",
          "hover:shadow-[0_22px_55px_-26px_rgba(0,0,0,0.95)] hover:ring-1 hover:ring-white/10",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20",
        ].join(" ")}
        title="Open talent listing"
      >
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
          {experience ? <MetaRow icon="cap" text={`Experience: ${experience}`} /> : null}
          {workMode ? <MetaRow icon="pin" text={workMode} /> : null}
        </div>

        {tags.length ? (
          <div className="mt-4 overflow-hidden">
            <TagRow tags={tags} />
          </div>
        ) : null}

        <div className="mt-auto flex h-10 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3 overflow-hidden">
            <TalentStat icon="eye">{formatCompactNumber(item.views)}</TalentStat>
            {sampleCount > 0 ? <TalentStat icon="image">{sampleCount} work samples</TalentStat> : null}
            {!sampleCount && item.saves > 0 ? <TalentStat icon="bookmark">{formatCompactNumber(item.saves)} saved</TalentStat> : null}
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
