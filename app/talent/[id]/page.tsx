import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import TalentListingActionsClient from "../../../components/TalentListingActionsClient";
import OwnerListingControlsClient from "../../../components/OwnerListingControlsClient";
import TalentHero from "../../../components/talent-details/TalentHero";
import TalentDescriptionSections from "../../../components/talent-details/TalentDescriptionSections";
import { StateCard } from "../../../components/ui";
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
import { formatTalentListingExperience } from "../../../lib/talentListing";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const TITLE_SCALE = 0.58;

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

const formatInr = (amount: number) => `₹${new Intl.NumberFormat("en-IN").format(amount)}`;

const roleBasedRateLabel = (listing: BackendTalentListing) => {
  const text = [listing.primary_role, listing.title, ...listing.roles, listing.niche]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
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

const rateLabel = (listing: BackendTalentListing) => {
  const note = listing.rate_note?.trim();
  const currency = listing.rate_currency?.toUpperCase();
  const legacyCurrencyCode = ["U", "S", "D"].join("");
  const legacyCurrencyPattern = new RegExp(legacyCurrencyCode, "i");
  const noteLooksUsd = note ? /[$]/.test(note) || legacyCurrencyPattern.test(note) : false;

  if (currency === "INR") {
    if (note && !noteLooksUsd) return note;
    if (listing.rate_min != null && listing.rate_max != null) {
      return `${formatInr(Number(listing.rate_min))}-${formatInr(Number(listing.rate_max))}`;
    }
    if (listing.rate_min != null) return `${formatInr(Number(listing.rate_min))}+`;
  }

  if (note && !noteLooksUsd && currency !== legacyCurrencyCode) return note;
  if (currency === legacyCurrencyCode || noteLooksUsd) return roleBasedRateLabel(listing);
  return "Rate flexible";
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
  if (dataSource.source === "mock" || dataSource.overrideSource !== "backend") {
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

function servicesFor(listing: BackendTalentListing) {
  const descriptionLines = (listing.description || "")
    .split("\n")
    .map((line) => line.replace(/^\s*[-•]\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 5);
  if (descriptionLines.length >= 2) return descriptionLines;

  const role = listing.primary_role || listing.roles[0] || "content work";
  const formats = listing.formats.length ? listing.formats : ["creator-led content"];
  return uniq([
    ...formats.slice(0, 3).map((format) => `${format} ${role}`),
    listing.niche ? `${listing.niche} content support` : null,
  ]).slice(0, 6);
}

function aboutFor(listing: BackendTalentListing) {
  if (listing.description?.trim()) return listing.description.trim();
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
    return profileRatingSummaryFromProfile(getMockPublicTalentProfile(publicProfileSlug), href);
  }

  const profile = await getPublicProfile(publicProfileSlug).catch(() => null);
  if (profile) return profileRatingSummaryFromProfile(profile, href);

  if (dataSource.overrideSource !== "backend" && canUseLocalMockFallback()) {
    return profileRatingSummaryFromProfile(getMockPublicTalentProfile(publicProfileSlug), href);
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
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const dataSource = await getMarketplaceDataSourceState();
  const listing = await getListing(String(id), dataSource);
  if (!listing) return { title: "Talent listing not found | CreatorJobs" };
  const description = [displayName(listing), listing.primary_role || listing.roles[0], listing.location, rateLabel(listing)]
    .filter(Boolean)
    .join(" · ");
  const image = listing.owner_avatar_url || undefined;
  return {
    title: `${listing.title} | CreatorJobs`,
    description,
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
  const dataSource = await getMarketplaceDataSourceState();
  const listing = await getListing(String(id), dataSource);
  const session = await getServerSession(authOptions);

  if (!listing) {
    return (
      <main className="min-h-screen bg-[#0b0b0f] px-4 py-10 text-white sm:px-6">
        <section className="mx-auto max-w-4xl">
          <StateCard
            icon="user"
            title="Talent listing not found"
            description="This listing is unavailable or has already been removed."
            actionLabel="Browse talent"
            actionHref="/talent"
          />
        </section>
      </main>
    );
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
    { icon: "cash-stack" as const, label: "Rate", value: rateLabel(listing) },
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
                talentName={name}
                views={listing.views}
                requirementKeys={listing.first_message_requirements || []}
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
