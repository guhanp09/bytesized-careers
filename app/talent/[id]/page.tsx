import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { notFound } from "next/navigation";
import TalentListingActionsClient from "../../../components/TalentListingActionsClient";
import OwnerListingControlsClient from "../../../components/OwnerListingControlsClient";
import TalentHero from "../../../components/talent-details/TalentHero";
import TalentDescriptionSections from "../../../components/talent-details/TalentDescriptionSections";
import { TalentBrowse } from "../page";
import { authOptions } from "../../../lib/auth";
import {
  canUseLocalMockFallback,
  getPublicProfile,
  getTalentListing,
  listPortfolioByUserId,
  type BackendPortfolioItem,
  type BackendTalentListing,
} from "../../../lib/backendClient";
import { getMarketplaceDataSourceState } from "../../../lib/devDataSource.server";
import type { MarketplaceDataSourceState } from "../../../lib/devDataSource";
import { getMockPublicTalentProfile } from "../../../lib/mockPublicTalentProfiles";
import { MOCK_TALENT_LISTINGS } from "../../../lib/mockTalentListings";
import { publicProfileFallbackSlug } from "../../../lib/profileSlug";
import { buildProfileReviewsHref, profileRatingSummaryFromProfile } from "../../../lib/profileRating";
import { getSeoFilterRoute, isSeoRouteIndexApproved } from "../../../lib/seoFilterRoutes";
import { formatTalentListingExperience, formatTalentRate } from "../../../lib/talentListing";
import { serializeJsonLd } from "../../../lib/jsonLd";
import { talentListingVisibility } from "../../../lib/seo/jobPostingLifecycle";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const TITLE_SCALE = 0.58;
const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXTAUTH_URL || "http://localhost:3000").replace(
  /\/+$/,
  ""
);

const mockPortfolioTitles: Record<string, string[]> = {
  "mock-talent-retention-editor": [
    "Education channel retention edit",
    "Finance explainer cleanup",
    "Founder story cutdown",
  ],
  "mock-talent-thumbnail-designer": [
    "Tech launch thumbnail system",
    "Finance explainer packaging",
  ],
  "mock-talent-channel-manager": ["Weekly upload operations"],
};

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

const displayName = (listing: BackendTalentListing) =>
  listing.owner_display_name ||
  listing.owner_username
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

const formatTalentPostedLabel = (value?: string | null) => {
  if (!value) return "recently";
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return "recently";

  const seconds = Math.max(0, Math.floor((Date.now() - parsed) / 1000));
  if (seconds < 60) return "just now";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;

  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks} week${weeks === 1 ? "" : "s"} ago`;

  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;

  const years = Math.floor(days / 365);
  return `${years} year${years === 1 ? "" : "s"} ago`;
};

async function getListing(id: string, dataSource: MarketplaceDataSourceState) {
  if (dataSource.source === "mock") {
    return MOCK_TALENT_LISTINGS.find((item) => item.id === id) || null;
  }

  const backendListing = await getTalentListing(id).catch(() => null);
  if (backendListing) return backendListing;
  if (dataSource.overrideSource === "backend" || !canUseLocalMockFallback()) return null;
  return MOCK_TALENT_LISTINGS.find((item) => item.id === id) || null;
}

async function getRelevantPortfolioItems(
  listing: BackendTalentListing,
  dataSource: MarketplaceDataSourceState
): Promise<BackendPortfolioItem[]> {
  if (dataSource.source === "mock") {
    return mockPortfolioItemsFor(listing);
  }

  const response = await listPortfolioByUserId(listing.owner_user_id).catch(() => ({ items: [] }));
  const publicItems = response.items.filter((item) => item.is_public && item.publish_status !== "draft");
  const selectedIds = listing.portfolio_item_ids || [];
  if (!selectedIds.length) return [];

  const byId = new Map(publicItems.map((item) => [item.id, item]));
  return selectedIds.map((id) => byId.get(id)).filter((item): item is BackendPortfolioItem => Boolean(item));
}

function mockPortfolioItemsFor(listing: BackendTalentListing): BackendPortfolioItem[] {
  const ids = listing.portfolio_item_ids || [];
  if (!ids.length) return [];

  const titles = mockPortfolioTitles[listing.id] || [];
  const role = listing.primary_role || listing.roles[0] || "Creator talent";
  const niche = listing.niche || listing.content_niches?.[0] || "creator-led content";

  return ids.map((id, index) => {
    const platform = listing.platforms[index % Math.max(listing.platforms.length, 1)] || "YouTube";
    const format = listing.formats[index % Math.max(listing.formats.length, 1)] || "project";
    const title = titles[index] || `${titleCase(role)} sample for ${niche}`;
    const summary =
      index === 0
        ? `A focused ${format.toLowerCase()} project showing ${role.toLowerCase()} work for ${niche}.`
        : `Packaging, pacing, and execution for a creator-led ${platform} workflow.`;
    const videoUrl = `https://www.youtube.com/watch?v=${index === 0 ? "dQw4w9WgXcQ" : index === 1 ? "3JZ_D3ELwOQ" : "aqz-KE-bpKQ"}`;

    return {
      id,
      user_id: listing.owner_user_id,
      title,
      source_type: "youtube",
      source_url: videoUrl,
      role_id: null,
      role_name: role,
      role,
      user_role_in_project: role,
      description: summary,
      contribution_summary: summary,
      what_i_did: `Handled the ${role.toLowerCase()} contribution for this ${niche} project: ${summary}`,
      contribution_highlights: [
        `Mapped the ${format.toLowerCase()} structure`,
        `Handled ${role.toLowerCase()} execution`,
        `Prepared reusable notes for similar ${platform} work`,
      ],
      timestamp_notes: [
        {
          id: `${id}-hook`,
          time: "0:12",
          seconds: 12,
          title: "Opening hook",
          description: "Reworked the first beat so the value proposition lands quickly.",
        },
        {
          id: `${id}-pacing`,
          time: "0:42",
          seconds: 42,
          title: "Pacing reset",
          description: "Tightened the mid-section and made the edit easier to scan.",
        },
      ],
      timeframe: "now",
      media_url: videoUrl,
      metrics: null,
      youtube_url: videoUrl,
      thumbnail_url: `https://picsum.photos/seed/${encodeURIComponent(id)}/760/428`,
      thumbnail_options: [],
      channel_name: platform,
      channel_id: null,
      views: index === 0 ? 18000 : index === 1 ? 9200 : 5400,
      published_date: null,
      published_at: null,
      duration: null,
      retention_percent: null,
      links: [videoUrl],
      tags: uniq([listing.niche, ...listing.formats, ...listing.platforms]).slice(0, 5),
      contribution_tags: uniq([role, listing.niche, ...listing.formats]).slice(0, 4),
      tools: listing.tools.slice(0, 4),
      content_niches: uniq([niche, ...(listing.content_niches || [])]).slice(0, 4),
      content_genres: uniq(listing.content_genres || []).slice(0, 4),
      platforms: uniq(listing.platforms.length ? listing.platforms : [platform]).slice(0, 4),
      formats: uniq(listing.formats.length ? listing.formats : [format]).slice(0, 4),
      results: index === 0 ? ["18K views", "Delivered in 5 days"] : ["Reusable workflow"],
      public_metrics: {},
      manual_metrics: {},
      verification_status: "manual",
      visibility: "public",
      publish_status: "published",
      portfolio_status: "now",
      is_featured: index === 0,
      status: "now",
      is_public: true,
      created_at: listing.created_at,
      updated_at: listing.updated_at,
    };
  });
}

function serviceLinesFromDescription(description?: string | null) {
  return (description || "")
    .split("\n")
    .map((line) => line.replace(/^\s*[-•]\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 5);
}

function servicesFor(listing: BackendTalentListing) {
  const descriptionLines = serviceLinesFromDescription(listing.description);
  if (descriptionLines.length >= 2) return descriptionLines;

  const role = listing.primary_role || listing.roles[0] || "content work";
  const formats = listing.formats.length ? listing.formats : ["creator-led content"];
  return uniq([
    ...formats.slice(0, 3).map((format) => `${format} ${role}`),
    listing.niche ? `${listing.niche} content support` : null,
  ]).slice(0, 6);
}

function aboutFor(listing: BackendTalentListing) {
  const descriptionLines = serviceLinesFromDescription(listing.description);
  if (descriptionLines.length < 2 && listing.description?.trim()) return listing.description.trim();
  const role = listing.primary_role || listing.roles[0] || "talent";
  const context = uniq([
    ...(listing.content_niches || []),
    ...(listing.content_genres || []),
    listing.niche,
    ...listing.platforms,
    ...listing.formats,
  ]).slice(0, 3).join(", ");
  return `I help hiring teams with ${role.toLowerCase()} work${context ? ` across ${context}` : ""}.`;
}

function metadataFor(listing: BackendTalentListing) {
  return uniq([listing.primary_role || listing.roles[0], listing.location, listing.timezone]).join(" · ");
}

async function ratingFor(
  publicProfileSlug: string | null,
  dataSource: MarketplaceDataSourceState
) {
  if (!publicProfileSlug) return null;
  const href = buildProfileReviewsHref(publicProfileSlug, "talent");

  if (dataSource.source === "mock") {
    return profileRatingSummaryFromProfile(getMockPublicTalentProfile(publicProfileSlug), href, "talent");
  }

  const profile = await getPublicProfile(publicProfileSlug).catch(() => null);
  if (profile) return profileRatingSummaryFromProfile(profile, href, "talent");

  if (dataSource.overrideSource !== "backend" && canUseLocalMockFallback()) {
    return profileRatingSummaryFromProfile(getMockPublicTalentProfile(publicProfileSlug), href, "talent");
  }
  return null;
}

function collaborationRows(listing: BackendTalentListing) {
  return [
    listing.turnaround ? { label: "Turnaround", value: listing.turnaround } : null,
    listing.formats.length ? { label: "Project fit", value: listing.formats.slice(0, 4).join(" · ") } : null,
    listing.platforms.length ? { label: "Platform focus", value: listing.platforms.slice(0, 4).join(" · ") } : null,
  ].filter(Boolean) as Array<{ label: string; value: string }>;
}

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const { id } = await params;
  const seoRoute = getSeoFilterRoute("talent", String(id));
  if (seoRoute) {
    const sp = (await searchParams) ?? {};
    const hasParams = Object.values(sp).some((v) => (Array.isArray(v) ? v.length > 0 : v != null && v !== ""));
    // Index only vouched curated routes with a clean URL; un-vouched routes and
    // Row-2 refinement variants are noindex,follow, canonical → the clean route.
    const indexApproved = isSeoRouteIndexApproved(seoRoute) && !hasParams;
    return {
      title: seoRoute.metaTitle,
      description: seoRoute.metaDescription,
      alternates: {
        canonical: seoRoute.path,
      },
      robots: indexApproved ? undefined : { index: false, follow: true },
      openGraph: {
        title: seoRoute.metaTitle,
        description: seoRoute.metaDescription,
        siteName: "CreatorJobs",
        type: "website",
      },
      twitter: {
        card: "summary",
        title: seoRoute.metaTitle,
        description: seoRoute.metaDescription,
      },
    };
  }
  const dataSource = await getMarketplaceDataSourceState();
  const listing = await getListing(String(id), dataSource);
  if (!listing) return { title: "Talent listing not found", robots: { index: false, follow: false } };
  const description = [displayName(listing), listing.primary_role || listing.roles[0], listing.location, formatTalentRate(listing)]
    .filter(Boolean)
    .join(" · ");
  const image = listing.owner_avatar_url || undefined;
  // A closed, paused, archived or draft listing stops being indexable. Without
  // this a recruiter searches, finds a listing, and reaches a creator who took it
  // down — the talent-side equivalent of an expired job posting.
  //
  // Availability is deliberately not part of this: "unavailable" means busy, not
  // gone, and a recruiter planning next quarter should still be able to find them.
  const visibility = talentListingVisibility(listing);
  return {
    title: `${listing.title} | CreatorJobs`,
    description,
    ...(visibility.indexable ? {} : { robots: { index: false, follow: true } }),
    alternates: {
      canonical: `/talent/${encodeURIComponent(listing.id)}`,
    },
    openGraph: {
      title: `${listing.title} | CreatorJobs`,
      description,
      siteName: "CreatorJobs",
      type: "article",
      images: image ? [{ url: image }] : undefined,
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title: `${listing.title} | CreatorJobs`,
      description,
    },
  };
}

export default async function TalentListingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const seoRoute = getSeoFilterRoute("talent", String(id));
  if (seoRoute) {
    return (
      <>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: serializeJsonLd({
              "@context": "https://schema.org",
              "@type": "BreadcrumbList",
              itemListElement: [
                { "@type": "ListItem", position: 1, name: "Talent", item: `${siteUrl}/talent` },
                { "@type": "ListItem", position: 2, name: seoRoute.h1, item: `${siteUrl}${seoRoute.path}` },
              ],
            }),
          }}
        />
        <TalentBrowse searchParams={Promise.resolve({})} seoRoute={seoRoute} />
      </>
    );
  }
  const dataSource = await getMarketplaceDataSourceState();
  const listing = await getListing(String(id), dataSource);
  const session = await getServerSession(authOptions);

  if (!listing) {
    notFound();
  }

  const name = displayName(listing);
  const publicProfileSlug = (listing.owner_username || publicProfileFallbackSlug(listing.owner_display_name || listing.id)).trim();
  const publicProfileHref = publicProfileSlug ? `/u/${encodeURIComponent(publicProfileSlug)}?view=talent` : null;
  const rating = await ratingFor(publicProfileSlug || null, dataSource);
  const publicProfilePortfolioHref = publicProfileSlug
    ? `/u/${encodeURIComponent(publicProfileSlug)}?view=talent&tab=portfolio#portfolio`
    : null;
  const role = listing.primary_role || listing.roles[0] || "Talent";
  const meta = metadataFor(listing);
  const postedText = `Posted ${formatTalentPostedLabel(listing.created_at)}`;
  const portfolioItems = await getRelevantPortfolioItems(listing, dataSource);
  const creatorContextRows = [
    { label: "Content niches", values: uniq(listing.content_niches || []) },
    { label: "Genres", values: uniq(listing.content_genres || []) },
    { label: "Formats offered", values: uniq(listing.formats || []) },
  ].filter((row) => row.values.length > 0);
  const tools = uniq(listing.tools);
  const tags = uniq([
    ...listing.platforms,
    ...listing.roles,
  ]).slice(0, 14);
  const services = servicesFor(listing);
  const rows = collaborationRows(listing);
  const isOwner = Boolean(session?.backendUserId && listing.owner_user_id === session.backendUserId);
  const topStats = [
    { icon: "cash-stack" as const, label: "Rate", value: formatTalentRate(listing) },
    { icon: "cap" as const, label: "Experience", value: formatTalentListingExperience(listing) || "Not specified" },
    { icon: "pin" as const, label: "Location", value: listing.location || titleCase(listing.work_mode) || "Remote" },
  ];

  return (
    <main className="min-h-screen bg-[#0b0b0f] px-4 py-8 text-white sm:px-6">
      <div className="mx-auto grid w-full max-w-6xl min-w-0 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
        <div className="min-w-0 space-y-6">
          <TalentHero
            title={listing.title}
            name={name}
            profileHref={publicProfileHref}
            rating={rating}
            avatarUrl={listing.owner_avatar_url}
            initials={initials(name)}
            metaLine={meta || role}
            postedText={postedText}
            titleScale={TITLE_SCALE}
            stats={topStats}
          />

          <TalentDescriptionSections
            about={aboutFor(listing)}
            services={services}
            rows={rows}
            portfolioItems={portfolioItems}
            fullPortfolioHref={publicProfilePortfolioHref}
            tags={tags}
          />
        </div>

        <aside className="min-w-0 lg:sticky lg:top-20">
          <div className="space-y-6">
            {isOwner ? (
              <OwnerListingControlsClient
                kind="talent"
                id={listing.id}
                status={listing.status}
                editHref={`/post-talent?draftId=${encodeURIComponent(listing.id)}`}
                inboxHref="/applications?view=talent"
              />
            ) : null}
            {!isOwner ? (
              <TalentListingActionsClient
                listingId={listing.id}
                requirementKeys={listing.first_message_requirements || []}
                customInstructionPrompt={listing.first_message_custom_instruction || null}
                metadataRows={creatorContextRows}
                tools={tools}
              />
            ) : null}
          </div>
        </aside>
      </div>
    </main>
  );
}
