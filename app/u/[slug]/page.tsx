import type { Metadata } from "next";
import Link from "next/link";
import PublicProfileTabs from "../../../components/profile/PublicProfileTabs";
import ProfileModeSwitch from "../../../components/profile/ProfileModeSwitch";
import SocialIconRow from "../../../components/profile/SocialIconRow";
import RatingDisplay from "../../../components/RatingDisplay";
import { type BackendPublicProfileResponse } from "../../../lib/backendClient";
import { buildSocialIconLinks } from "../../../lib/profileSocialLinks";
import { resolvePublicProfileWithTalentFallback } from "../../../lib/publicProfileFallback";

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function resolvePublicProfile(username: string) {
  return resolvePublicProfileWithTalentFallback(username) as Promise<BackendPublicProfileResponse | null>;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug: rawUsername } = await params;
  const username = decodeURIComponent(rawUsername || "").trim().toLowerCase();
  const profile = await resolvePublicProfile(username);

  if (!profile) {
    return {
      title: "Profile not found | CreatorJobs",
      robots: { index: false, follow: false },
    };
  }

  const description = [
    cleanPublicText(profile.headline),
    cleanPublicText(profile.location),
    cleanPublicText(profile.collaboration_preferences?.working_hours),
  ]
    .filter(Boolean)
    .join(" · ");

  return {
    title: `${profile.display_name} | CreatorJobs`,
    description: description || `Public CreatorJobs profile for ${profile.display_name}.`,
    alternates: {
      canonical: `/u/${encodeURIComponent(profile.username)}`,
    },
    openGraph: {
      title: `${profile.display_name} | CreatorJobs`,
      description: description || `Public CreatorJobs profile for ${profile.display_name}.`,
      type: "profile",
      images: profile.avatar_url ? [{ url: profile.avatar_url }] : undefined,
    },
    twitter: {
      card: profile.avatar_url ? "summary_large_image" : "summary",
      title: `${profile.display_name} | CreatorJobs`,
      description: description || `Public CreatorJobs profile for ${profile.display_name}.`,
    },
  };
}

function GenericAvatar({ className = "h-28 w-28 sm:h-[136px] sm:w-[136px]" }: { className?: string }) {
  return (
    <div className={`${className} inline-flex shrink-0 items-center justify-center overflow-hidden rounded-[28px] border border-white/20 bg-[#2a2b30]`}>
      <svg
        viewBox="0 0 24 24"
        className="h-8 w-8 text-white/65"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="8" r="4" />
        <path d="M4 20c0-3.5 3.6-6 8-6s8 2.5 8 6" />
      </svg>
    </div>
  );
}

function formatCompactNumber(value: number) {
  return Intl.NumberFormat("en", { notation: "compact" }).format(value);
}

function cleanPublicText(value?: string | null) {
  const text = value?.trim();
  if (!text) return null;
  const normalized = text.toLowerCase();
  if (["not shared", "not set", "creator-economy profile"].includes(normalized)) {
    return null;
  }
  return text;
}

function cleanPublicList(values?: string[] | null) {
  return (values || []).map(cleanPublicText).filter((item): item is string => Boolean(item));
}

type PublicProfileViewMode = "talent" | "hiring";

const hasPublicTalentMode = (profile: BackendPublicProfileResponse) =>
  Boolean(
    profile.talent_listings_active?.length ||
      profile.talent_listings_preview?.length ||
      profile.portfolio_now?.length ||
      profile.portfolio_past?.length ||
      profile.roles?.length ||
      profile.skills?.length
  );

const hasPublicHiringMode = (profile: BackendPublicProfileResponse) =>
  Boolean(
    profile.jobs_active?.length ||
      profile.jobs_past?.length ||
      profile.jobs_preview?.length ||
      cleanPublicText(profile.hiring_info?.hiring_type) ||
      cleanPublicText(profile.hiring_info?.channels_or_pages_managed) ||
      cleanPublicText(profile.hiring_info?.website_or_social_url)
  );

const resolveProfileView = (
  profile: BackendPublicProfileResponse,
  requested?: string
): PublicProfileViewMode => {
  const normalized = requested?.trim().toLowerCase();
  if (normalized === "talent") return "talent";
  if (normalized === "hiring" || normalized === "recruiter") return "hiring";
  if (hasPublicTalentMode(profile)) return "talent";
  if (hasPublicHiringMode(profile)) return "hiring";
  return "talent";
};

function sanitizePublicProfile(profile: BackendPublicProfileResponse): BackendPublicProfileResponse {
  return {
    ...profile,
    headline: cleanPublicText(profile.headline),
    bio: cleanPublicText(profile.bio),
    skills: cleanPublicList(profile.skills),
    public_links: cleanPublicList(profile.public_links),
    experience: profile.experience || [],
    collaboration_preferences: {
      ...profile.collaboration_preferences,
      turnaround: cleanPublicText(profile.collaboration_preferences?.turnaround),
      revisions: cleanPublicText(profile.collaboration_preferences?.revisions),
      working_hours: cleanPublicText(profile.collaboration_preferences?.working_hours),
      tools: cleanPublicText(profile.collaboration_preferences?.tools),
    },
    hiring_info: profile.hiring_info
      ? {
          ...profile.hiring_info,
          website_or_social_url: cleanPublicText(profile.hiring_info.website_or_social_url),
          channels_or_pages_managed: cleanPublicText(profile.hiring_info.channels_or_pages_managed),
        }
      : null,
    content_style: {
      ...profile.content_style,
      primary_niche: cleanPublicText(profile.content_style?.primary_niche),
      format: cleanPublicList(profile.content_style?.format),
      tone: cleanPublicList(profile.content_style?.tone),
      target_audience: cleanPublicText(profile.content_style?.target_audience),
      editing_complexity: cleanPublicText(profile.content_style?.editing_complexity),
    },
  };
}

export default async function PublicProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ preview?: string; view?: string }>;
}) {
  const { slug: rawUsername } = await params;
  const { preview, view } = await searchParams;
  const username = decodeURIComponent(rawUsername || "").trim().toLowerCase();
  const isPreview = preview === "1";

  const profile = await resolvePublicProfile(username);

  if (!profile) {
    return (
      <main className="min-h-[calc(100vh-56px)] bg-[#0b0b0f] px-4 py-10 text-white sm:px-6">
        <section className="mx-auto w-full max-w-xl rounded-2xl border border-white/10 bg-white/[0.06] p-6 text-center">
          <h1 className="text-xl font-semibold">Profile not found</h1>
          <p className="mt-2 text-sm text-white/60">This public profile is unavailable.</p>
          <Link
            href="/"
            className="mt-5 inline-flex h-10 items-center justify-center rounded-xl bg-white px-4 text-sm font-semibold text-black transition-colors hover:bg-white/90"
          >
            Back to jobs
          </Link>
        </section>
      </main>
    );
  }

  if (profile.moved_to_username) {
    return (
      <main className="min-h-[calc(100vh-56px)] bg-[#0b0b0f] px-4 py-10 text-white sm:px-6">
        <section className="mx-auto w-full max-w-xl rounded-2xl border border-white/10 bg-white/[0.06] p-6 text-center">
          <h1 className="text-xl font-semibold">Profile moved</h1>
          <p className="mt-2 text-sm text-white/60">
            This profile moved to <span className="text-white/85">{profile.moved_to_username}</span>.
          </p>
          <Link
            href={`/u/${encodeURIComponent(profile.moved_to_username)}`}
            className="mt-5 inline-flex h-10 items-center justify-center rounded-xl bg-white px-4 text-sm font-semibold text-black transition-colors hover:bg-white/90"
          >
            Open new profile
          </Link>
        </section>
      </main>
    );
  }

  const publicProfile = sanitizePublicProfile(profile);
  const activeProfileView = resolveProfileView(publicProfile, view);
  const usernameLabel = `@${publicProfile.username.replace(/^@+/, "")}`;
  const allPortfolio = [...(publicProfile.portfolio_now || []), ...(publicProfile.portfolio_past || [])];
  const openJobsCount = publicProfile.jobs_active.length;
  const projectsCount = publicProfile.stats?.projects_count ?? allPortfolio.length;
  const headlineValue = cleanPublicText(publicProfile.headline);
  const metadataParts = [
    usernameLabel,
    cleanPublicText(publicProfile.location),
    cleanPublicText(publicProfile.collaboration_preferences?.working_hours),
  ].filter((value): value is string => Boolean(value));
  const toolsValue = cleanPublicList(publicProfile.skills).join(" · ");
  const stats = [
    projectsCount > 0 ? { label: "Projects", value: projectsCount } : null,
    openJobsCount > 0 ? { label: "Open jobs", value: openJobsCount } : null,
  ].filter((item): item is { label: string; value: number } => Boolean(item));

  const socialIconLinks = buildSocialIconLinks({
    socialConnections: publicProfile.social_connections,
    publicLinks: publicProfile.public_links,
    websiteOrSocialUrl: publicProfile.hiring_info?.website_or_social_url,
  });

  return (
    <main className="min-h-[calc(100vh-56px)] bg-[#0b0b0f] text-white">
      {isPreview ? (
        <div className="fixed bottom-4 right-4 z-50 rounded-full border border-white/15 bg-[#111216]/90 px-3 py-2 backdrop-blur">
          <div className="inline-flex items-center gap-2 text-xs">
            <span className="text-white/70">Public preview</span>
            <Link href="/you?preview=1" className="font-semibold text-white transition-colors hover:text-white/82">
              Exit
            </Link>
          </div>
        </div>
      ) : null}

      <section className="mx-auto w-full max-w-[1560px] space-y-6 px-4 py-6 sm:px-6 sm:py-8 xl:px-8">
        <section className="overflow-hidden rounded-[30px] border border-white/10 bg-[#141519] shadow-[0_28px_90px_-52px_rgba(0,0,0,1)]">
          <div className="relative min-h-[150px] border-b border-white/10 bg-[#18191d] sm:min-h-[226px]">
            {publicProfile.banner_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={publicProfile.banner_url} alt="" className="absolute inset-0 h-full w-full object-cover" />
            ) : (
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_16%_18%,rgba(255,255,255,0.16),transparent_30%),radial-gradient(circle_at_78%_6%,rgba(255,255,255,0.08),transparent_26%),linear-gradient(135deg,rgba(255,255,255,0.09),rgba(255,255,255,0.018)_48%,rgba(0,0,0,0.28))]" />
            )}
            <div className="absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-[#141519] to-transparent" />
          </div>

          <div className="px-5 pb-6 sm:px-8 sm:pb-8">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0 flex flex-col gap-4 sm:flex-row sm:items-start">
                <div className="relative z-10 -mt-8 shrink-0 sm:-mt-12">
                  {publicProfile.avatar_url ? (
                    <img
                      src={publicProfile.avatar_url}
                      alt={publicProfile.display_name}
                      className="h-28 w-28 rounded-[28px] border border-white/20 bg-[#2a2b30] object-cover shadow-[0_24px_70px_-34px_rgba(0,0,0,1)] sm:h-[136px] sm:w-[136px]"
                    />
                  ) : (
                    <GenericAvatar />
                  )}
                  <div className="mt-3 flex justify-start sm:justify-center">
                    <ProfileModeSwitch username={publicProfile.username} activeMode={activeProfileView} />
                  </div>
                </div>

                <div className="min-w-0 flex-1 space-y-3 pt-4 sm:pt-5 lg:pt-6">
                  <div className="flex flex-wrap items-center gap-3">
                    <h1 className="max-w-full break-words text-[36px] font-semibold leading-[1.04] tracking-tight text-white sm:text-[46px] lg:text-[52px]">
                      {publicProfile.display_name}
                    </h1>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[15px] font-medium text-white/55">
                    {metadataParts.map((part, index) => (
                      <span key={`public-hero-meta-${index}-${part}`} className="inline-flex items-center gap-2.5">
                        {index > 0 ? <span className="text-white/22">•</span> : null}
                        <span>{part}</span>
                      </span>
                    ))}
                  </div>

                  <div className="max-w-4xl space-y-2.5">
                    {headlineValue ? (
                      <p className="text-base font-medium leading-relaxed text-white/78 sm:text-lg">
                        {headlineValue}
                      </p>
                    ) : null}
                    {toolsValue ? (
                      <p className="text-sm leading-6 text-white/54 sm:text-[15px]">{toolsValue}</p>
                    ) : null}
                  </div>

                  <SocialIconRow links={socialIconLinks} />

                  <RatingDisplay className="pt-0.5" />
                </div>
              </div>

              {stats.length ? (
                <div
                  className={[
                    "grid shrink-0 gap-2 rounded-2xl border border-white/[0.08] bg-white/[0.025] p-2 lg:mt-7",
                    stats.length === 1 ? "grid-cols-1 lg:min-w-[120px]" : "",
                    stats.length === 2 ? "grid-cols-2 lg:min-w-[220px]" : "",
                    stats.length >= 3 ? "grid-cols-3 lg:min-w-[300px]" : "",
                  ].join(" ")}
                >
                  {stats.map((stat) => (
                    <div key={stat.label} className="rounded-xl bg-white/[0.035] px-3 py-2 text-center">
                      <p className="text-lg font-semibold leading-none text-white/90 tabular-nums">
                        {formatCompactNumber(stat.value)}
                      </p>
                      <p className="mt-1 text-[11px] font-medium text-white/44">{stat.label}</p>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </section>

        <PublicProfileTabs profile={publicProfile} initialView={activeProfileView} />
      </section>
    </main>
  );
}
