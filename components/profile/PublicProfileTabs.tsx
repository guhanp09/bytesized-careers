"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { BackendPublicProfileResponse } from "../../lib/backendClient";
import { Icon } from "../Icons";
import JobsEmptyState from "../jobs/JobsEmptyState";
import { TagPill } from "../ui";
import ProfileExperienceList from "./ProfileExperienceList";

type PublicProfileTabsProps = {
  profile: BackendPublicProfileResponse;
  initialView?: ProfileViewMode;
};

type ProfileViewMode = "talent" | "hiring";
type TopTab = "overview" | "portfolio" | "jobs";

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

const formatTextValue = (value?: string | null) => {
  const text = cleanText(value);
  return text || "–";
};

const formatHiringType = (value?: string | null) => {
  const text = cleanText(value);
  if (!text) return "–";
  return text
    .split(" ")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
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
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <article className="border-b border-white/[0.08] py-7 first:pt-0 last:border-b-0 last:pb-0">
      <h3 className="text-base font-semibold tracking-tight text-white/92">{title}</h3>
      <div className="mt-4">{children}</div>
    </article>
  );
}

function OverviewRow({ label, value }: { label: string; value?: ReactNode }) {
  if (!value) return null;
  return (
    <div className="grid gap-1.5 py-2 text-sm sm:grid-cols-[145px_minmax(0,1fr)] sm:gap-6">
      <dt className="text-white/42">{label}</dt>
      <dd className="min-w-0 text-white/78">{value}</dd>
    </div>
  );
}

function RailCard({
  title,
  count,
  actionLabel,
  actionHref,
  onAction,
  children,
}: {
  title: string;
  count?: string;
  actionLabel?: string;
  actionHref?: string;
  onAction?: () => void;
  children: ReactNode;
}) {
  const actionClass = "shrink-0 cursor-pointer text-xs font-medium text-white/45 transition-colors hover:text-white";
  return (
    <section className="border-t border-white/10 py-5 first:border-t-0 first:pt-0">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-white/90">{title}</h3>
          {count ? <p className="mt-1 text-xs text-white/45">{count}</p> : null}
        </div>
        {actionLabel && actionHref ? (
          <Link href={actionHref} className={actionClass}>
            {actionLabel}
          </Link>
        ) : actionLabel && onAction ? (
          <button type="button" onClick={onAction} className={actionClass}>
            {actionLabel}
          </button>
        ) : null}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function EmptyLine({ children }: { children: ReactNode }) {
  return <p className="text-sm text-white/52">{children}</p>;
}

const formatCountLabel = (count: number, singular: string, plural: string) =>
  `${count} ${count === 1 ? singular : plural}`;

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
  const connectedChannelNames = channelRows.map((channel) => `${channel.label}: ${channel.name}`);
  const websiteOrSocialUrl = cleanText(hiringInfo?.website_or_social_url);

  const portfolioPreview = portfolioProjects.slice(0, 2);
  const jobsPreview = activeJobs.slice(0, 2);
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
  const hiringRoles = cleanList([
    ...activeJobs.map((job) => job.category),
    ...activeJobs.map((job) => job.title),
  ]).slice(0, 5);
  const talentRows = [
    ["Roles", roleNames.length ? roleNames.join(", ") : activeRole],
    ["Primary niche", primaryNiche],
    ["Formats", contentFormats.length ? contentFormats.join(", ") : null],
    ["Tone", contentTones.length ? contentTones.join(", ") : null],
    ["Target audience", targetAudience],
  ] satisfies Array<[string, string | null | undefined]>;
  const profileDetailRows = [
    ["Primary platform", cleanText(hiringInfo?.primary_platform) || (connectedChannelNames.length ? "YouTube" : null)],
    ["Connected channels/pages", connectedChannelNames.length ? connectedChannelNames.join(", ") : null],
    ["Website / social URL", websiteOrSocialUrl || "–"],
  ] satisfies Array<[string, string | null | undefined]>;
  const collaborationRows = [
    ["Project type preference", formatProjectType(profile.collaboration_preferences?.project_type_preference)],
    ["Turnaround", cleanText(profile.collaboration_preferences?.turnaround)],
    ["Revisions", cleanText(profile.collaboration_preferences?.revisions)],
    ["Working hours", cleanText(profile.collaboration_preferences?.working_hours)],
    ["Tools", cleanText(profile.collaboration_preferences?.tools)],
  ] satisfies Array<[string, string | null | undefined]>;
  const recruiterProfileRows = [
    ["Hiring type", formatHiringType(hiringInfo?.hiring_type) !== "–" ? formatHiringType(hiringInfo?.hiring_type) : null],
    ["Primary platform", cleanText(hiringInfo?.primary_platform)],
    ["Channels/pages", cleanText(hiringInfo?.channels_or_pages_managed) || (connectedChannelNames.length ? connectedChannelNames.join(", ") : null)],
    ["Typical roles", hiringRoles.length ? hiringRoles.join(" · ") : null],
    ["Content niche", primaryNiche],
  ] satisfies Array<[string, string | null | undefined]>;
  const recruiterDetailRows = [
    ["Website / social URL", websiteOrSocialUrl || "–"],
    ["Channel or brand context", connectedChannelNames.length ? connectedChannelNames.join(", ") : null],
    ["Hiring context", cleanText(hiringInfo?.channels_or_pages_managed)],
  ] satisfies Array<[string, string | null | undefined]>;
  const recruiterCollaborationRows = [
    ["Project type preference", formatProjectType(profile.collaboration_preferences?.project_type_preference)],
    ["Typical turnaround", cleanText(profile.collaboration_preferences?.turnaround)],
    ["Revision expectations", cleanText(profile.collaboration_preferences?.revisions)],
    ["Working hours", cleanText(profile.collaboration_preferences?.working_hours)],
    ["Tools/workflow", cleanText(profile.collaboration_preferences?.tools)],
  ] satisfies Array<[string, string | null | undefined]>;
  const mainSections = profileMode === "hiring"
    ? [
        { title: "Hiring profile", rows: recruiterProfileRows },
        { title: "Recruiter details", rows: recruiterDetailRows },
        { title: "Collaboration", rows: recruiterCollaborationRows },
      ]
    : [
        { title: "Roles & content", rows: talentRows },
        { title: "Profile details", rows: profileDetailRows },
        { title: "Collaboration", rows: collaborationRows },
      ];

  const overview = (
    <div className="grid w-full max-w-7xl gap-10 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-12">
      <div className="min-w-0">
        {profileMode === "talent" && profile.experience?.length ? (
          <OverviewModule title="Experience">
            <ProfileExperienceList items={profile.experience} />
          </OverviewModule>
        ) : null}
        {mainSections.map((section) => {
          const visibleRows = section.rows.filter(([, value]) => value !== null && value !== undefined && value !== "");
          return (
            <OverviewModule key={`overview-section-${profileMode}-${section.title}`} title={section.title}>
              {visibleRows.length ? (
                <dl className="space-y-1">
                  {visibleRows.map(([label, value]) => (
                    <OverviewRow key={`overview-row-${profileMode}-${section.title}-${label}`} label={label} value={value} />
                  ))}
                </dl>
              ) : (
                <EmptyLine>No details added yet.</EmptyLine>
              )}
            </OverviewModule>
          );
        })}
      </div>

      <aside className="min-w-0 lg:border-l lg:border-white/[0.08] lg:pl-8">
        {profileMode === "hiring" ? (
          <RailCard
            title="Jobs"
            count={formatCountLabel(activeJobs.length, "open job", "open jobs")}
            actionLabel={activeJobs.length ? "View jobs →" : undefined}
            onAction={activeJobs.length ? () => setTopTab("jobs") : undefined}
          >
            {jobsPreview.length ? (
              <div className="space-y-3">
                {jobsPreview.map((job) => (
                  <Link
                    key={`overview-recruiter-job-${job.id}`}
                    href={`/jobs/${encodeURIComponent(String(job.id))}`}
                    className="group block cursor-pointer text-sm"
                  >
                    <span className="block truncate font-medium text-white/78 transition-colors group-hover:text-white">
                      {job.title}
                    </span>
                    <span className="mt-1 block truncate text-xs text-white/42">
                      {[job.category, job.location].filter(Boolean).join(" · ") || "Open job"}
                    </span>
                  </Link>
                ))}
              </div>
            ) : (
              <EmptyLine>No open jobs right now.</EmptyLine>
            )}
          </RailCard>
        ) : (
          <RailCard
            title="Portfolio"
            count={formatCountLabel(portfolioProjects.length, "project", "projects")}
            actionLabel={portfolioProjects.length ? "View portfolio →" : undefined}
            onAction={portfolioProjects.length ? () => setTopTab("portfolio") : undefined}
          >
            {portfolioPreview.length ? (
              <div className="space-y-3">
                {portfolioPreview.map((item) => (
                  <Link
                    key={`overview-portfolio-${item.id}`}
                    href={`/u/${encodeURIComponent(profile.username)}/projects/${encodeURIComponent(item.id)}`}
                    className="group block cursor-pointer text-sm"
                  >
                    <span className="block truncate font-medium text-white/78 transition-colors group-hover:text-white">
                      {item.title}
                    </span>
                    <span className="mt-1 block truncate text-xs text-white/42">
                      {[item.role_name || item.role || item.user_role_in_project, item.channel_name]
                        .filter(Boolean)
                        .join(" · ") || "Work sample"}
                    </span>
                  </Link>
                ))}
              </div>
            ) : (
              <EmptyLine>No work samples added yet.</EmptyLine>
            )}
          </RailCard>
        )}

        {profileMode === "hiring" ? (
          <RailCard
            title="Portfolio"
            count={formatCountLabel(portfolioProjects.length, "project", "projects")}
            actionLabel={portfolioProjects.length ? "View portfolio →" : undefined}
            onAction={portfolioProjects.length ? () => setTopTab("portfolio") : undefined}
          >
            {portfolioPreview.length ? (
              <div className="space-y-3">
                {portfolioPreview.slice(0, 2).map((item) => (
                  <Link
                    key={`overview-recruiter-portfolio-${item.id}`}
                    href={`/u/${encodeURIComponent(profile.username)}/projects/${encodeURIComponent(item.id)}`}
                    className="group block cursor-pointer text-sm"
                  >
                    <span className="block truncate font-medium text-white/78 transition-colors group-hover:text-white">
                      {item.title}
                    </span>
                    <span className="mt-1 block truncate text-xs text-white/42">
                      {[item.role_name || item.role || item.user_role_in_project, item.channel_name]
                        .filter(Boolean)
                        .join(" · ") || "Work sample"}
                    </span>
                  </Link>
                ))}
              </div>
            ) : (
              <EmptyLine>No work samples added yet.</EmptyLine>
            )}
          </RailCard>
        ) : (
          <RailCard
            title="Talent listings"
            count={formatCountLabel(activeTalentListings.length, "talent listing", "talent listings")}
            actionLabel={activeTalentListing ? "View talent listing →" : undefined}
            actionHref={activeTalentListing ? `/talent/${encodeURIComponent(String(activeTalentListing.id))}` : undefined}
          >
            {talentListingsPreview.length ? (
              <div className="space-y-3">
                {talentListingsPreview.map((listing) => (
                  <Link
                    key={`overview-talent-listing-${listing.id}`}
                    href={`/talent/${encodeURIComponent(String(listing.id))}`}
                    className="group block cursor-pointer text-sm"
                  >
                    <span className="block truncate font-medium text-white/78 transition-colors group-hover:text-white">
                      {listing.title}
                    </span>
                    <span className="mt-1 block truncate text-xs text-white/42">
                      {[listing.primary_role, listing.location, listing.timezone].filter(Boolean).join(" · ") || "Talent listing"}
                    </span>
                  </Link>
                ))}
              </div>
            ) : (
              <EmptyLine>No talent listings added yet.</EmptyLine>
            )}
          </RailCard>
        )}

        <RailCard
          title={profileMode === "hiring" ? "Talent listings" : "Jobs"}
          count={
            profileMode === "hiring"
              ? formatCountLabel(activeTalentListings.length, "talent listing", "talent listings")
              : formatCountLabel(activeJobs.length, "open job", "open jobs")
          }
          actionLabel={
            profileMode === "hiring"
              ? activeTalentListing ? "View talent listing →" : undefined
              : activeJobs.length ? "View jobs →" : undefined
          }
          actionHref={profileMode === "hiring" && activeTalentListing ? `/talent/${encodeURIComponent(String(activeTalentListing.id))}` : undefined}
          onAction={profileMode === "talent" && activeJobs.length ? () => setTopTab("jobs") : undefined}
        >
          {profileMode === "hiring" && talentListingsPreview.length ? (
            <div className="space-y-3">
              {talentListingsPreview.map((listing) => (
                <Link
                  key={`overview-recruiter-talent-listing-${listing.id}`}
                  href={`/talent/${encodeURIComponent(String(listing.id))}`}
                  className="group block cursor-pointer text-sm"
                >
                  <span className="block truncate font-medium text-white/78 transition-colors group-hover:text-white">
                    {listing.title}
                  </span>
                  <span className="mt-1 block truncate text-xs text-white/42">
                    {[listing.primary_role, listing.location].filter(Boolean).join(" · ") || "Talent listing"}
                  </span>
                </Link>
              ))}
            </div>
          ) : profileMode === "talent" && jobsPreview.length ? (
            <div className="space-y-3">
              {jobsPreview.map((job) => (
                <Link
                  key={`overview-talent-job-${job.id}`}
                  href={`/jobs/${encodeURIComponent(String(job.id))}`}
                  className="group block cursor-pointer text-sm"
                >
                  <span className="block truncate font-medium text-white/78 transition-colors group-hover:text-white">
                    {job.title}
                  </span>
                  <span className="mt-1 block truncate text-xs text-white/42">
                    {[job.category, job.location].filter(Boolean).join(" · ") || "Open job"}
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <EmptyLine>{profileMode === "hiring" ? "No talent listings added yet." : "No open jobs."}</EmptyLine>
          )}
        </RailCard>
      </aside>
    </div>
  );

  return (
    <section className="overflow-hidden rounded-[30px] border border-white/10 bg-[#141519] shadow-[0_24px_80px_-52px_rgba(0,0,0,1)]">
      <div className="overflow-x-auto border-b border-white/[0.08] px-5 pt-1 sm:px-8">
        <div className="flex min-w-max items-end gap-8">
          <TabButton label="Overview" active={topTab === "overview"} onClick={() => setTopTab("overview")} />
          <TabButton label="Portfolio" active={topTab === "portfolio"} onClick={() => setTopTab("portfolio")} />
          <TabButton label="Jobs" active={topTab === "jobs"} onClick={() => setTopTab("jobs")} />
        </div>
      </div>

      <div className="px-5 py-5 sm:px-8 sm:py-7">
        {topTab === "overview" ? overview : null}

        {topTab === "portfolio" ? (
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

        {topTab === "jobs" ? (
          <div className="space-y-5">
            {activeJobs.length ? (
              <div className="grid gap-3">
                {activeJobs.map((job) => (
                  <Link
                    key={job.id}
                    href={`/jobs/${encodeURIComponent(String(job.id))}`}
                    className="group cursor-pointer rounded-3xl border border-white/[0.085] bg-white/[0.04] p-4 transition-colors hover:border-white/[0.16] hover:bg-white/[0.065] sm:p-5"
                  >
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full border border-white/[0.09] bg-white/[0.035] px-2.5 py-1 text-[11px] font-semibold text-white/58">
                            Open
                          </span>
                          <span className="rounded-full border border-white/[0.09] bg-white/[0.035] px-2.5 py-1 text-[11px] font-semibold text-white/58">
                            {job.category}
                          </span>
                        </div>
                        <h3 className="mt-3 text-base font-semibold tracking-tight text-white/92 sm:text-lg">
                          {job.title}
                        </h3>
                        <p className="mt-1 text-sm text-white/55">
                          {[job.channel_name || profile.display_name, job.location].filter(Boolean).join(" · ")}
                        </p>
                      </div>
                      <span className="inline-flex h-9 w-fit items-center gap-2 rounded-full border border-white/[0.1] bg-white/[0.035] px-3 text-xs font-semibold text-white/68 transition-colors group-hover:bg-white/[0.07] group-hover:text-white">
                        View job
                        <Icon name="external-link" className="h-3.5 w-3.5" />
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <JobsEmptyState owner={false} />
            )}
          </div>
        ) : null}

      </div>
    </section>
  );
}
