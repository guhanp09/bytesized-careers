"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import {
  BackendPublicProfileResponse,
  type BackendPortfolioItem,
  type BackendPublicJobItem,
  type BackendProfileReviewItem,
  type BackendRepresentedChannel,
} from "../../lib/backendClient";
import { JOBS } from "../../lib/jobs";
import type { Job } from "../../lib/types";
import { Icon } from "../Icons";
import { JobCard } from "../JobCard";
import JobsEmptyState from "../jobs/JobsEmptyState";
import { ProfileReviewsPreviewRail, ProfileReviewsTabContent } from "./ProfileReviews";
import { TagPill } from "../ui";
import ProfileExperienceList from "./ProfileExperienceList";

type PublicProfileTabsProps = {
  profile: BackendPublicProfileResponse;
  initialView?: ProfileViewMode;
};

type ProfileViewMode = "talent" | "hiring";
type TopTab = "overview" | "portfolio" | "jobs" | "reviews";

const sourceLabel = (source?: string | null, previewSource?: unknown) => {
  const preview = typeof previewSource === "string" ? previewSource.toLowerCase() : "";
  if (preview === "google_docs") return "Google Docs";
  if (preview === "notion") return "Notion";
  if (preview === "figma") return "Figma";
  if (preview === "canva") return "Canva";
  const normalized = (source || "custom").toLowerCase();
  if (normalized === "youtube") return "YouTube";
  if (normalized === "drive") return "Google Drive";
  if (normalized === "behance") return "Behance";
  if (normalized === "instagram") return "Instagram";
  if (normalized === "website") return "Custom URL";
  if (normalized === "custom") return "Custom URL";
  if (normalized === "vimeo") return "Vimeo";
  if (normalized === "other") return "Custom URL";
  return "Custom URL";
};

const metricNumber = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const formatCompactNumber = (value: unknown) => {
  const number = metricNumber(value);
  return number === null ? null : Intl.NumberFormat("en", { notation: "compact" }).format(number);
};

const formatDateShort = (value?: string | null) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
};

const cleanText = (value?: string | null) => {
  const text = value?.trim();
  if (!text) return null;
  const normalized = text.toLowerCase();
  if (["not shared", "not set", "creator-economy profile"].includes(normalized)) {
    return null;
  }
  return text;
};

const normalizedIdentityKey = (value?: string | null) =>
  cleanText(value)
    ?.toLowerCase()
    .replace(/^@+/, "")
    .replace(/^https?:\/\/(www\.)?/, "")
    .replace(/\/$/, "") || "";

const initialsForHiringFor = (value?: string | null) =>
  (value || "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");

const formatTextValue = (value?: string | null) => {
  const text = cleanText(value);
  return text || "–";
};

const formatProjectType = (value?: string | null) => {
  if (value === "oneOff") return "One-off projects";
  if (value === "retainer") return "Retainers";
  if (value === "either") return "One-off or retainer";
  return formatTextValue(value);
};

function TabButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={[
        "relative h-11 px-1.5 text-sm font-semibold whitespace-nowrap transition-colors cursor-pointer after:absolute after:inset-x-1.5 after:bottom-0 after:h-px after:rounded-full",
        active
          ? "text-white after:bg-white"
          : "text-white/55 after:bg-transparent hover:text-white/82",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

function cleanList(values: Array<string | null | undefined>) {
  return values.map(cleanText).filter((item): item is string => Boolean(item));
}

function OverviewModule({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <article className="border-b border-white/[0.08] py-7 first:pt-0 last:border-b-0 last:pb-0">
      <div className="flex items-start justify-between gap-4">
        <h3 className="text-base font-semibold tracking-tight text-white/92">{title}</h3>
        {actions}
      </div>
      <div className="mt-4">{children}</div>
    </article>
  );
}

function MetadataRail({
  groups,
}: {
  groups: Array<{ label: string; values: string[] }>;
}) {
  const visibleGroups = groups.filter((group) => group.values.length);
  if (!visibleGroups.length) return null;

  return (
    <aside className="min-w-0 lg:border-l lg:border-white/[0.08] lg:pl-8">
      <div className="space-y-5">
        {visibleGroups.map((group) => (
          <div key={`metadata-${group.label}`} className="space-y-2">
            <h4 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/34">{group.label}</h4>
            <div className="flex flex-wrap gap-1.5">
              {group.values.slice(0, 8).map((value) => (
                <TagPill key={`metadata-${group.label}-${value}`}>{value}</TagPill>
              ))}
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}

const splitCompactValues = (value?: string | null) =>
  cleanList((value || "").split(/[·,]/).map((part) => part.trim()));

const sortPortfolioPreview = (items: BackendPortfolioItem[]) =>
  [...items]
    .sort((a, b) => {
      const featuredDelta = Number(Boolean(b.is_featured)) - Number(Boolean(a.is_featured));
      if (featuredDelta !== 0) return featuredDelta;
      const bTime = new Date(b.updated_at || b.created_at || 0).getTime();
      const aTime = new Date(a.updated_at || a.created_at || 0).getTime();
      return bTime - aTime;
    })
    .slice(0, 3);

const sortJobsPreview = (activeJobs: BackendPublicJobItem[], pastJobs: BackendPublicJobItem[]) =>
  [...activeJobs, ...pastJobs]
    .sort((a, b) => {
      const aActive = activeJobs.some((job) => job.id === a.id);
      const bActive = activeJobs.some((job) => job.id === b.id);
      if (aActive !== bActive) return aActive ? -1 : 1;
      return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
    })
    .slice(0, 3);

const sortProfileJobs = (activeJobs: BackendPublicJobItem[], pastJobs: BackendPublicJobItem[]) =>
  [...activeJobs, ...pastJobs].sort((a, b) => {
    const aActive = activeJobs.some((job) => job.id === a.id);
    const bActive = activeJobs.some((job) => job.id === b.id);
    if (aActive !== bActive) return aActive ? -1 : 1;
    return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
  });

const publicJobLookup = new Map(JOBS.map((job) => [String(job.id), job] as const));

const basePublicJobId = (value: string) => value.split("-past-hiring-")[0];

const RECENT_HIRE_ROLE_LABELS: Record<string, string> = {
  editing: "Video Editor",
  design: "Designer",
  writing: "Scriptwriter",
  thumbnails: "Thumbnail Designer",
  shorts: "Shorts Editor",
  "motion graphics": "Motion Designer",
  "channel manager": "Channel Manager",
  research: "Researcher",
  "voice over": "Voice Actor",
  marketing: "Marketing Strategist",
};

const normalizeRecentHireRole = (value?: string | null) => {
  const text = cleanText(value);
  if (!text) return "Creator Role";
  const withoutPrefix = text.replace(/^hired\s+/i, "").trim();
  const mapped = RECENT_HIRE_ROLE_LABELS[withoutPrefix.toLowerCase()];
  return mapped || withoutPrefix;
};

const mapPublicJobToCanonical = (
  item: BackendPublicJobItem,
  fallbackChannelName?: string | null
): Job => {
  const lookupId = String(item.id || "");
  const baseJob = publicJobLookup.get(lookupId) || publicJobLookup.get(basePublicJobId(lookupId));
  const channelName = cleanText(item.channel_name) || baseJob?.channel.name || cleanText(fallbackChannelName) || "Creator profile";
  const isClosed = String(item.status || "").toLowerCase() === "closed";

  return {
    ...(baseJob || {
      id: lookupId,
      title: cleanText(item.title) || "Job listing",
      category: (cleanText(item.category) as Job["category"]) || "Editing",
      budget: "",
      experience: "",
      location: cleanText(item.location) || "",
      postedShort: "",
      views: 0,
      applicants: 0,
      responseRate: 0,
      channel: {
        name: channelName,
        logoUrl: "",
        subscribers: null,
        verified: false,
      },
      tags: [],
      startTimeframe: "Flexible" as const,
      type: "One-time" as const,
    }),
    id: baseJob?.id || lookupId,
    title: cleanText(item.title) || baseJob?.title || "Job listing",
    category: (cleanText(item.category) as Job["category"]) || baseJob?.category || "Editing",
    location: cleanText(item.location) || baseJob?.location || "",
    channel: {
      name: channelName,
      logoUrl: baseJob?.channel.logoUrl || "",
      subscribers: baseJob?.channel.subscribers ?? null,
      verified: baseJob?.channel.verified ?? false,
    },
    tags:
      baseJob?.tags?.length
        ? baseJob.tags
        : cleanList([
            cleanText(item.category),
            cleanText(item.location),
            isClosed ? "Closed" : "Open",
          ]),
    status: isClosed ? "closed" : baseJob?.status || "published",
    createdAt: item.created_at || baseJob?.createdAt,
    updatedAt: item.created_at || baseJob?.updatedAt,
  };
};

function PortfolioPreviewList({
  items,
  username,
}: {
  items: BackendPortfolioItem[];
  username: string;
}) {
  return (
    <div className="overflow-hidden">
      <div className="flex snap-x snap-proximity gap-4 overflow-x-auto pb-1 [-ms-overflow-style:none] [mask-image:linear-gradient(to_right,transparent,black_18px,black_calc(100%-18px),transparent)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {items.map((item) => (
        <Link
          key={`overview-portfolio-preview-${item.id}`}
          href={`/u/${encodeURIComponent(username)}/projects/${encodeURIComponent(item.id)}`}
          aria-label={`Open project detail: ${item.title}`}
          className="group block min-w-[340px] snap-start cursor-pointer overflow-hidden rounded-2xl border border-white/10 bg-white/[0.045] transition-[border-color,background-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-white/18 hover:bg-white/[0.066] hover:shadow-[0_26px_70px_-38px_rgba(0,0,0,1)] focus:outline-none focus:ring-2 focus:ring-white/15 sm:min-w-[360px] lg:min-w-[380px]"
        >
          <div className="aspect-video overflow-hidden bg-[radial-gradient(circle_at_26%_22%,rgba(255,255,255,0.11),transparent_32%),linear-gradient(135deg,rgba(255,255,255,0.07),rgba(255,255,255,0.018)_52%,rgba(0,0,0,0.25))]">
            {item.thumbnail_url ? (
              <img
                src={item.thumbnail_url}
                alt={item.title}
                className="h-full w-full object-cover transition-[filter,transform] duration-500 group-hover:scale-[1.015] group-hover:brightness-110"
              />
            ) : (
              <div className="flex h-full min-h-[150px] w-full items-center justify-center text-white/34">
                <Icon name="image" className="h-8 w-8" />
              </div>
            )}
          </div>
          <div className="p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-white/10 bg-white/[0.05] px-2 py-1 text-[11px] font-semibold text-white/65">
                {sourceLabel(item.source_type, item.public_metrics?.source_type)}
              </span>
              {item.verification_status === "youtube_metadata_verified" ? (
                <span className="rounded-full border border-white/10 bg-white/[0.05] px-2 py-1 text-[11px] font-semibold text-white/65">
                  Verified
                </span>
              ) : null}
            </div>
            <p className="mt-3 truncate text-sm font-semibold text-white/90 transition-colors group-hover:text-white">{item.title}</p>
            {cleanText(item.role_name || item.role || item.user_role_in_project) ? (
              <p className="mt-1 text-sm font-medium text-white/72">
                {cleanText(item.role_name || item.role || item.user_role_in_project)}
              </p>
            ) : null}
            {(() => {
              const views = formatCompactNumber((item.public_metrics as Record<string, unknown> | null)?.views ?? item.views);
              const published = formatDateShort(item.published_at || item.published_date || item.created_at);
              const sourceLine = [
                item.channel_name,
                views ? `${views} views` : null,
                published,
                item.duration,
              ]
                .filter(Boolean)
                .join(" · ");
              return sourceLine ? <p className="mt-1 text-xs text-white/45">{sourceLine}</p> : null;
            })()}
            {item.contribution_summary || item.description ? (
              <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-white/65">
                {item.contribution_summary || item.description}
              </p>
            ) : null}
            {(item.contribution_tags || []).length ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {(item.contribution_tags || []).slice(0, 4).map((tag) => (
                  <TagPill key={`${item.id}-preview-contribution-${tag}`}>{tag}</TagPill>
                ))}
              </div>
            ) : null}
            {item.tools?.length ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {item.tools.slice(0, 4).map((tool) => (
                  <TagPill key={`${item.id}-preview-tool-${tool}`}>{tool}</TagPill>
                ))}
              </div>
            ) : null}
          </div>
        </Link>
      ))}
      </div>
    </div>
  );
}

function JobsPreviewList({ items }: { items: Array<{ key: string; job: Job }> }) {
  return (
    <div className="overflow-hidden">
      <div
        aria-label="Jobs preview"
        className="flex snap-x snap-proximity gap-4 overflow-x-auto pb-1 [-ms-overflow-style:none] [mask-image:linear-gradient(to_right,transparent,black_18px,black_calc(100%-18px),transparent)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {items.map(({ key, job }) => (
          <div key={key} className="min-w-[340px] snap-start sm:min-w-[360px] lg:min-w-[390px]">
            <JobCard job={job} />
          </div>
        ))}
      </div>
    </div>
  );
}

const authorizedRepresentedChannels = (
  profile: BackendPublicProfileResponse
): BackendRepresentedChannel[] => {
  const profileNames = new Set([
    normalizedIdentityKey(profile.display_name),
    normalizedIdentityKey(profile.username),
    normalizedIdentityKey(profile.hiring_info?.website_or_social_url),
  ].filter(Boolean));

  return (profile.represented_channels || []).filter((channel) => {
    if (channel.authorization_status !== "verified") return false;
    if (channel.is_self) return false;
    const channelNames = [
      normalizedIdentityKey(channel.id),
      normalizedIdentityKey(channel.name),
      normalizedIdentityKey(channel.url),
    ].filter(Boolean);
    return !channelNames.some((key) => profileNames.has(key));
  });
};

function HiringForRail({ items }: { items: BackendRepresentedChannel[] }) {
  if (!items.length) return null;

  return (
    <div className="overflow-hidden">
      <div
        aria-label="Hiring For channels"
        className="flex snap-x snap-proximity gap-5 overflow-x-auto pb-1 [-ms-overflow-style:none] [mask-image:linear-gradient(to_right,black_0,black_calc(100%-24px),transparent)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {items.map((item) => {
          const initials = initialsForHiringFor(item.name);
          return (
            <a
              key={`hiring-for-${item.id}`}
              href={item.url || undefined}
              target={item.url ? "_blank" : undefined}
              rel={item.url ? "noopener noreferrer" : undefined}
              aria-label={item.url ? `Open ${item.name}` : item.name}
              className={[
                "group flex min-w-[126px] snap-start flex-col items-center gap-3 rounded-2xl px-2 py-2 text-center",
                item.url
                  ? "cursor-pointer transition-colors hover:bg-white/[0.035] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/15"
                  : "cursor-default",
              ].join(" ")}
            >
              <span className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/12 bg-white/[0.045] text-sm font-semibold text-white/66 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                {item.avatar_url ? (
                  <img src={item.avatar_url} alt="" aria-hidden="true" className="h-full w-full object-cover" />
                ) : initials ? (
                  <span>{initials}</span>
                ) : (
                  <Icon name="briefcase" className="h-5 w-5" />
                )}
              </span>
              <span className="flex max-w-[116px] items-start justify-center gap-1 text-sm font-semibold leading-snug text-white/76 group-hover:text-white">
                <span className="line-clamp-2 min-w-0">{item.name}</span>
                <Icon name="check" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-white/48" />
              </span>
            </a>
          );
        })}
      </div>
    </div>
  );
}

function HiringExperienceList({ items }: { items: BackendPublicJobItem[] }) {
  return (
    <div className="divide-y divide-white/[0.08]">
      {items.map((job) => {
        const orgName = cleanText(job.channel_name) || "Creator team";
        const roleLabel = normalizeRecentHireRole(job.category || job.title);
        const roleText = roleLabel.toLowerCase();
        const normalizedDescription = (() => {
          const rawTitle = cleanText(job.title);
          if (!rawTitle) {
            return `Brought in ${roleText} support for creator-led publishing work.`;
          }
          if (/^hired\s+/i.test(rawTitle) || /creator production support/i.test(rawTitle)) {
            return `Brought in ${roleText} support for creator-led publishing work.`;
          }
          return rawTitle;
        })();
        const initials = orgName
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 2)
          .map((part) => part.charAt(0).toUpperCase())
          .join("");
        return (
          <div key={`hiring-experience-${job.id}`} className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3 py-4 first:pt-0 last:pb-0">
            <div className="flex h-11 w-11 shrink-0 self-start items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-xs font-semibold text-white/62">
              {initials || "CJ"}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-white/88">
                {roleLabel} | {orgName}
              </p>
              <p className="mt-1 text-sm font-medium text-white/58">{job.status === "closed" ? "Completed engagement" : "Open engagement"}</p>
              <p className="mt-1 text-xs text-white/45">
                {[formatDateShort(job.created_at), job.location].filter(Boolean).join(" · ")}
              </p>
              <p className="mt-2 text-sm leading-6 text-white/62">{normalizedDescription}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

const hasTalentProfileData = (profile: BackendPublicProfileResponse) =>
  Boolean(
    profile.talent_listings_active?.length ||
      profile.talent_listings_preview?.length ||
      profile.portfolio_now?.length ||
      profile.portfolio_past?.length ||
      profile.roles?.length ||
      profile.skills?.length
  );

const hasHiringProfileData = (profile: BackendPublicProfileResponse) =>
  Boolean(
    profile.jobs_active?.length ||
      profile.jobs_past?.length ||
      profile.jobs_preview?.length ||
      cleanText(profile.hiring_info?.hiring_type) ||
      cleanText(profile.hiring_info?.channels_or_pages_managed) ||
      cleanText(profile.hiring_info?.website_or_social_url)
  );

const modeFromProfile = (profile: BackendPublicProfileResponse, requested?: ProfileViewMode): ProfileViewMode => {
  if (requested) return requested;
  if (hasTalentProfileData(profile)) return "talent";
  if (hasHiringProfileData(profile)) return "hiring";
  return "talent";
};

export default function PublicProfileTabs({ profile, initialView }: PublicProfileTabsProps) {
  const [topTab, setTopTab] = useState<TopTab>("overview");
  const profileMode = modeFromProfile(profile, initialView);

  const activeJobs = useMemo(() => profile.jobs_active || [], [profile.jobs_active]);
  const nowPortfolio = useMemo(() => profile.portfolio_now || [], [profile.portfolio_now]);
  const pastPortfolio = useMemo(() => profile.portfolio_past || [], [profile.portfolio_past]);
  const portfolioProjects = useMemo(
    () => [...nowPortfolio, ...pastPortfolio],
    [nowPortfolio, pastPortfolio]
  );

  const roleNames = (profile.roles || [])
    .map((role) => cleanText(role.name))
    .filter((item): item is string => Boolean(item));
  const primaryNiche = cleanText(profile.content_style?.primary_niche);
  const targetAudience = cleanText(profile.content_style?.target_audience);
  const contentFormats = cleanList(profile.content_style?.format || []);
  const contentTones = cleanList(profile.content_style?.tone || []);

  const youtubeConnection = profile.social_connections?.youtube;
  const instagramConnection = profile.social_connections?.instagram;
  const hiringInfo = profile.hiring_info || null;
  const channelRows = [
    youtubeConnection?.connected ||
    youtubeConnection?.channel_title ||
    youtubeConnection?.channel_handle ||
    youtubeConnection?.channel_url
      ? {
          label: "YouTube",
          name:
            cleanText(youtubeConnection.channel_title) ||
            cleanText(youtubeConnection.channel_handle) ||
            "YouTube channel",
        }
      : null,
    instagramConnection?.connected || instagramConnection?.handle || instagramConnection?.url
      ? {
          label: "Instagram",
          name:
            cleanText(
              instagramConnection.handle?.startsWith("@")
                ? instagramConnection.handle
                : instagramConnection.handle
                  ? `@${instagramConnection.handle}`
                  : null
            ) || "Instagram",
        }
      : null,
  ].filter((row): row is { label: string; name: string } => Boolean(row));
  const pastJobs = useMemo(() => profile.jobs_past || [], [profile.jobs_past]);
  const portfolioPreview = useMemo(() => sortPortfolioPreview(portfolioProjects), [portfolioProjects]);
  const jobsPreview = useMemo(() => sortJobsPreview(activeJobs, pastJobs), [activeJobs, pastJobs]);
  const recruiterJobs = useMemo(() => sortProfileJobs(activeJobs, pastJobs), [activeJobs, pastJobs]);
  const recruiterPreviewJobs = useMemo(
    () =>
      jobsPreview.map((item) => ({
        key: String(item.id),
        job: mapPublicJobToCanonical(item, profile.display_name),
      })),
    [jobsPreview, profile.display_name]
  );
  const recruiterTabJobs = useMemo(
    () =>
      recruiterJobs.map((item) => ({
        key: String(item.id),
        job: mapPublicJobToCanonical(item, profile.display_name),
      })),
    [recruiterJobs, profile.display_name]
  );
  const hiringExperiencePreview = useMemo(() => pastJobs.slice(0, 3), [pastJobs]);
  const hiringForChannels = useMemo(() => authorizedRepresentedChannels(profile), [profile]);
  const activeTalentListings = useMemo(
    () => profile.talent_listings_active || [],
    [profile.talent_listings_active]
  );
  const talentListingsPreview = useMemo(
    () =>
      (profile.talent_listings_preview?.length
        ? profile.talent_listings_preview
        : activeTalentListings
      ).slice(0, 2),
    [profile.talent_listings_preview, activeTalentListings]
  );
  const activeTalentListing = talentListingsPreview[0] || activeTalentListings[0] || null;
  const activeRole = activeTalentListing?.primary_role || roleNames[0] || null;
  const talentListingFormats = cleanList(talentListingsPreview.flatMap((listing) => [listing.primary_role]));
  const hiringRoles = cleanList([
    ...activeJobs.map((job) => job.category),
    ...pastJobs.map((job) => job.category),
  ]).slice(0, 5);
  const bioText = cleanText(profile.headline);
  const reviewCount = profile.reviews?.review_count || 0;
  const reviewAverage = profile.reviews?.avg_rating || 0;
  const reviewItems = useMemo<BackendProfileReviewItem[]>(() => profile.review_items || [], [profile.review_items]);

  const talentMetadataGroups = [
    { label: "Specialization", values: cleanList([activeRole, ...roleNames]) },
    { label: "Niches", values: splitCompactValues(primaryNiche) },
    { label: "Genres", values: contentTones },
    { label: "Content formats", values: contentFormats.length ? contentFormats : talentListingFormats },
    { label: "Platforms", values: cleanList([cleanText(hiringInfo?.primary_platform), ...channelRows.map((row) => row.label)]) },
    { label: "Tools", values: cleanList([...profile.skills, ...splitCompactValues(profile.collaboration_preferences?.tools)]) },
    { label: "Availability", values: cleanList([profile.availability_status]) },
    {
      label: "Work preferences",
      values: cleanList([
        formatProjectType(profile.collaboration_preferences?.project_type_preference),
        cleanText(profile.collaboration_preferences?.turnaround),
        cleanText(profile.collaboration_preferences?.working_hours),
      ]).filter((value) => value !== "–"),
    },
    { label: "Tags", values: cleanList([targetAudience, ...contentTones]).slice(0, 6) },
  ];
  const recruiterMetadataGroups = [
    { label: "Hiring focus", values: hiringRoles },
    { label: "Content niches", values: splitCompactValues(primaryNiche) },
    { label: "Genres", values: contentTones },
    { label: "Formats hired for", values: contentFormats },
    { label: "Platforms", values: cleanList([cleanText(hiringInfo?.primary_platform), ...channelRows.map((row) => row.label)]) },
    {
      label: "Collaboration style",
      values: cleanList([
        formatProjectType(profile.collaboration_preferences?.project_type_preference),
        cleanText(profile.collaboration_preferences?.turnaround),
        cleanText(profile.collaboration_preferences?.revisions),
      ]).filter((value) => value !== "–"),
    },
    { label: "Work model", values: cleanList([profile.location, profile.timezone, cleanText(profile.collaboration_preferences?.working_hours)]) },
    { label: "Tags", values: cleanList([...hiringRoles, ...splitCompactValues(hiringInfo?.channels_or_pages_managed)]).slice(0, 6) },
  ];

  const visibleTopTab =
    profileMode === "talent" && topTab === "jobs"
      ? "overview"
      : profileMode === "hiring" && topTab === "portfolio"
        ? "overview"
        : topTab;

  const overview = (
    <div className="grid w-full max-w-7xl gap-10 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-12">
      <div className="min-w-0">
        {bioText ? (
          <OverviewModule title="Bio">
            <p className="max-w-3xl text-sm leading-6 text-white/68 sm:text-[15px]">{bioText}</p>
          </OverviewModule>
        ) : null}

        {profileMode === "talent" && profile.experience?.length ? (
          <OverviewModule title="Experience">
            <ProfileExperienceList items={profile.experience} />
          </OverviewModule>
        ) : null}

        {profileMode === "talent" && portfolioPreview.length ? (
          <OverviewModule
            title="Portfolio"
            actions={
              <button
                type="button"
                aria-label="View Full Portfolio"
                onClick={() => setTopTab("portfolio")}
                className="shrink-0 cursor-pointer text-xs font-medium text-white/50 transition-colors hover:text-white"
              >
                <span className="inline-flex items-center gap-1">
                  <span>View Full Portfolio</span>
                  <span aria-hidden="true">→</span>
                </span>
              </button>
            }
          >
            <PortfolioPreviewList items={portfolioPreview} username={profile.username} />
          </OverviewModule>
        ) : null}

        {profileMode === "hiring" && hiringExperiencePreview.length ? (
          <OverviewModule title="Recent Hires">
            <HiringExperienceList items={hiringExperiencePreview} />
          </OverviewModule>
        ) : null}

        {profileMode === "hiring" && hiringForChannels.length ? (
          <OverviewModule title="Hiring For">
            <HiringForRail items={hiringForChannels} />
          </OverviewModule>
        ) : null}

        {profileMode === "hiring" && jobsPreview.length ? (
          <OverviewModule
            title="Jobs"
            actions={
              <button
                type="button"
                onClick={() => setTopTab("jobs")}
                className="shrink-0 cursor-pointer text-xs font-medium text-white/50 transition-colors hover:text-white"
              >
                View All Jobs <span aria-hidden="true">→</span>
              </button>
            }
          >
            <JobsPreviewList items={recruiterPreviewJobs} />
          </OverviewModule>
        ) : null}

        {reviewItems.length ? (
          <OverviewModule
            title="Reviews"
            actions={
              <button
                type="button"
                onClick={() => setTopTab("reviews")}
                className="shrink-0 cursor-pointer text-xs font-medium text-white/50 transition-colors hover:text-white"
              >
                View All Reviews <span aria-hidden="true">→</span>
              </button>
            }
          >
            <ProfileReviewsPreviewRail items={reviewItems} />
          </OverviewModule>
        ) : null}
      </div>

      <MetadataRail groups={profileMode === "hiring" ? recruiterMetadataGroups : talentMetadataGroups} />
    </div>
  );

  return (
    <section className="overflow-hidden rounded-[30px] border border-white/10 bg-[#141519] shadow-[0_24px_80px_-52px_rgba(0,0,0,1)]">
      <div className="overflow-x-auto border-b border-white/[0.08] px-5 pt-1 sm:px-8">
        <div className="flex min-w-max items-end gap-8">
          <TabButton label="Overview" active={visibleTopTab === "overview"} onClick={() => setTopTab("overview")} />
          {profileMode === "talent" ? (
            <TabButton label="Portfolio" active={visibleTopTab === "portfolio"} onClick={() => setTopTab("portfolio")} />
          ) : null}
          {profileMode === "hiring" ? (
            <TabButton label="Jobs" active={visibleTopTab === "jobs"} onClick={() => setTopTab("jobs")} />
          ) : null}
          <TabButton label="Reviews" active={visibleTopTab === "reviews"} onClick={() => setTopTab("reviews")} />
        </div>
      </div>

      <div className="px-5 py-5 sm:px-8 sm:py-7">
        {visibleTopTab === "overview" ? overview : null}

        {profileMode === "talent" && visibleTopTab === "portfolio" ? (
          <div className="space-y-3">
            {portfolioProjects.length ? (
              <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
                {portfolioProjects.map((item) => {
                  const publicMetrics = item.public_metrics || {};
                  const manualMetrics = item.manual_metrics || {};
                  const views = formatCompactNumber(publicMetrics.views ?? item.views);
                  const likes = formatCompactNumber(publicMetrics.likes);
                  const comments = formatCompactNumber(publicMetrics.comments);
                  const retention = metricNumber(manualMetrics.retention_percent ?? item.retention_percent);
                  const ctr = metricNumber(manualMetrics.ctr_percent);
                  const turnaround = metricNumber(manualMetrics.turnaround_days);
                  const sourceLine = [
                    item.channel_name,
                    views ? `${views} views` : null,
                    formatDateShort(item.published_at || item.published_date || item.created_at),
                    item.duration,
                  ].filter(Boolean).join(" · ");
                  const projectHref = `/u/${encodeURIComponent(profile.username)}/projects/${encodeURIComponent(item.id)}`;
                  const roleLabel = cleanText(item.role_name || item.role || item.user_role_in_project);

                  return (
                    <Link
                      key={item.id}
                      href={projectHref}
                      aria-label={`Open project detail: ${item.title}`}
                      className="group cursor-pointer rounded-2xl border border-white/10 bg-white/[0.045] transition-[border-color,background-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-white/18 hover:bg-white/[0.066] hover:shadow-[0_26px_70px_-38px_rgba(0,0,0,1)] focus:outline-none focus:ring-2 focus:ring-white/15"
                    >
                      <div className="aspect-video overflow-hidden rounded-t-2xl bg-[radial-gradient(circle_at_26%_22%,rgba(255,255,255,0.11),transparent_32%),linear-gradient(135deg,rgba(255,255,255,0.07),rgba(255,255,255,0.018)_52%,rgba(0,0,0,0.25))]">
                        {item.thumbnail_url ? (
                          <img
                            src={item.thumbnail_url}
                            alt={item.title}
                            className="h-full w-full object-cover transition-[filter,transform] duration-500 group-hover:scale-[1.015] group-hover:brightness-110"
                          />
                        ) : (
                          <div className="flex h-full min-h-[150px] w-full items-center justify-center text-white/34">
                            <Icon name="image" className="h-8 w-8" />
                          </div>
                        )}
                      </div>
                      <div className="p-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full border border-white/10 bg-white/[0.05] px-2 py-1 text-[11px] font-semibold text-white/65">
                            {sourceLabel(item.source_type, item.public_metrics?.source_type)}
                          </span>
                          {item.verification_status === "youtube_metadata_verified" ? (
                            <span className="rounded-full border border-white/10 bg-white/[0.05] px-2 py-1 text-[11px] font-semibold text-white/65">
                              Verified
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-3 text-sm font-semibold text-white/90">{item.title}</p>
                        {roleLabel ? <p className="mt-1 text-sm font-medium text-white/72">{roleLabel}</p> : null}
                        {sourceLine ? <p className="mt-1 text-xs text-white/45">{sourceLine}</p> : null}
                        {item.contribution_summary || item.description ? (
                          <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-white/65">
                            {item.contribution_summary || item.description}
                          </p>
                        ) : null}
                        {(item.contribution_tags || []).length ? (
                          <div className="mt-3 flex flex-wrap gap-1.5">
                            {(item.contribution_tags || []).slice(0, 4).map((tag) => (
                              <TagPill key={`${item.id}-contribution-${tag}`}>{tag}</TagPill>
                            ))}
                          </div>
                        ) : null}
                        {item.tools?.length ? (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {item.tools.slice(0, 4).map((tool) => (
                              <TagPill key={`${item.id}-tool-${tool}`}>{tool}</TagPill>
                            ))}
                          </div>
                        ) : null}
                        <div className="mt-3 flex flex-wrap gap-2 text-xs text-white/60">
                          {views ? <span>{views} views</span> : null}
                          {likes ? <span>{likes} likes</span> : null}
                          {comments ? <span>{comments} comments</span> : null}
                          {retention !== null ? <span>Retention {retention}%</span> : null}
                          {ctr !== null ? <span>CTR {ctr}%</span> : null}
                          {turnaround !== null ? <span>{turnaround} day turnaround</span> : null}
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-3xl border border-white/10 bg-white/[0.035] px-6 py-12 text-center">
                <p className="text-base font-semibold text-white/86">No projects yet.</p>
              </div>
            )}
          </div>
        ) : null}

        {profileMode === "hiring" && visibleTopTab === "jobs" ? (
          <div className="space-y-5">
            {recruiterTabJobs.length ? (
              <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {recruiterTabJobs.map(({ key, job }) => (
                  <JobCard key={key} job={job} />
                ))}
              </div>
            ) : (
              <JobsEmptyState owner={false} />
            )}
          </div>
        ) : null}

        {visibleTopTab === "reviews" ? (
          <ProfileReviewsTabContent
            items={reviewItems}
            averageRating={reviewAverage}
            reviewCount={reviewCount}
          />
        ) : null}

      </div>
    </section>
  );
}
