import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import TalentListingActionsClient from "../../../components/TalentListingActionsClient";
import OwnerListingControlsClient from "../../../components/OwnerListingControlsClient";
import TalentHero from "../../../components/talent-details/TalentHero";
import { Section, StateCard, TagPill } from "../../../components/ui";
import { authOptions } from "../../../lib/auth";
import {
  canUseLocalMockFallback,
  getTalentListing,
  listPortfolioByUserId,
  type BackendPortfolioItem,
  type BackendTalentListing,
} from "../../../lib/backendClient";
import { MOCK_TALENT_LISTINGS } from "../../../lib/mockTalentListings";
import { publicProfileFallbackSlug } from "../../../lib/profileSlug";
import { formatTalentExperience } from "../../../lib/talentListing";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const TITLE_SCALE = 0.58;

type WorkSample = {
  id: string;
  title: string;
  role?: string;
  platform?: string;
  note?: string;
  href?: string;
  thumbnailUrl?: string | null;
};

const MOCK_WORK_SAMPLES: Record<string, WorkSample[]> = {
  "mock-talent-retention-editor": [
    {
      id: "retention-1",
      title: "Education channel retention edit",
      role: "Editor",
      platform: "YouTube",
      note: "Long-form pacing, hooks, and section resets.",
    },
    {
      id: "retention-2",
      title: "Finance explainer cleanup",
      role: "Editor",
      platform: "YouTube",
      note: "Story structure, B-roll rhythm, and sound cleanup.",
    },
    {
      id: "retention-3",
      title: "Founder story cutdown",
      role: "Editor",
      platform: "YouTube",
      note: "Narrative tightening and intro restructuring.",
    },
  ],
  "mock-talent-thumbnail-designer": [
    {
      id: "thumbnail-1",
      title: "Tech launch thumbnail system",
      role: "Thumbnail designer",
      platform: "YouTube",
      note: "CTR-focused concepts and A/B variants.",
    },
    {
      id: "thumbnail-2",
      title: "Finance explainer packaging",
      role: "Thumbnail designer",
      platform: "YouTube",
      note: "High-contrast visual hierarchy and title framing.",
    },
  ],
  "mock-talent-channel-manager": [
    {
      id: "channel-1",
      title: "Weekly upload operations",
      role: "Channel manager",
      platform: "YouTube",
      note: "Upload QA, analytics review, and content calendar setup.",
    },
  ],
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

async function getListing(id: string) {
  const backendListing = await getTalentListing(id).catch(() => null);
  if (backendListing) return backendListing;
  if (!canUseLocalMockFallback()) return null;
  return MOCK_TALENT_LISTINGS.find((item) => item.id === id) || null;
}

async function getWorkSamples(listing: BackendTalentListing): Promise<WorkSample[]> {
  const mockSamples = MOCK_WORK_SAMPLES[listing.id];
  if (canUseLocalMockFallback() && mockSamples?.length) return mockSamples;

  const response = await listPortfolioByUserId(listing.owner_user_id).catch(() => ({ items: [] }));
  const publicItems = response.items.filter((item) => item.is_public && item.publish_status !== "draft");
  const selectedIds = new Set(listing.portfolio_item_ids);
  const selectedItems = selectedIds.size
    ? publicItems.filter((item) => selectedIds.has(item.id))
    : publicItems.slice(0, 4);

  return selectedItems.slice(0, 6).map(portfolioItemToWorkSample);
}

function portfolioItemToWorkSample(item: BackendPortfolioItem): WorkSample {
  const platform = titleCase(item.source_type || undefined) || item.channel_name || "Portfolio";
  return {
    id: item.id,
    title: item.title,
    role: item.role_name || item.role || item.user_role_in_project || undefined,
    platform,
    note: item.contribution_summary || item.description || undefined,
    href: item.source_url || item.youtube_url || item.media_url || item.links?.[0] || undefined,
    thumbnailUrl: item.thumbnail_url || null,
  };
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
  const context = uniq([listing.niche, ...listing.platforms, ...listing.formats]).slice(0, 3).join(", ");
  return `I help hiring teams with ${role.toLowerCase()} work${context ? ` across ${context}` : ""}.`;
}

function metadataFor(listing: BackendTalentListing) {
  return uniq([listing.primary_role || listing.roles[0], listing.location, listing.timezone]).join(" · ");
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
  const listing = await getListing(String(id));
  if (!listing) return { title: "Talent listing not found | CreatorJobs" };
  return {
    title: `${listing.title} | CreatorJobs`,
    description: [displayName(listing), listing.primary_role || listing.roles[0], listing.location, rateLabel(listing)]
      .filter(Boolean)
      .join(" · "),
    alternates: {
      canonical: `/talent/${encodeURIComponent(listing.id)}`,
    },
    openGraph: {
      title: `${listing.title} | CreatorJobs`,
      description: [displayName(listing), listing.primary_role || listing.roles[0], listing.location, rateLabel(listing)]
        .filter(Boolean)
        .join(" · "),
      type: "article",
    },
  };
}

export default async function TalentListingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const listing = await getListing(String(id));
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
  const role = listing.primary_role || listing.roles[0] || "Talent";
  const meta = metadataFor(listing);
  const postedText = `Posted ${formatTalentPostedLabel(listing.created_at)}`;
  const workSamples = await getWorkSamples(listing);
  const sampleCount = workSamples.length || listing.portfolio_item_ids.length;
  const bestFitTags = uniq([...listing.platforms, ...listing.formats, listing.niche]).slice(0, 12);
  const tools = uniq(listing.tools);
  const tags = uniq([...listing.tools, ...listing.platforms, listing.niche, ...listing.formats, ...listing.roles]).slice(0, 14);
  const services = servicesFor(listing);
  const rows = collaborationRows(listing);
  const isOwner = Boolean(session?.backendUserId && listing.owner_user_id === session.backendUserId);
  const topStats = [
    { icon: "cash-stack" as const, label: "Rate", value: rateLabel(listing) },
    { icon: "cap" as const, label: "Experience", value: formatTalentExperience(listing.experience_level) || "Not specified" },
    { icon: "pin" as const, label: "Location", value: listing.location || titleCase(listing.work_mode) || "Remote" },
    { icon: "image" as const, label: "Work samples", value: sampleCount ? String(sampleCount) : "0" },
  ];

  return (
    <main className="min-h-screen bg-[#0b0b0f] px-4 py-8 text-white sm:px-6">
      <div className="mx-auto grid max-w-6xl items-start gap-6 lg:grid-cols-[1fr_420px]">
        <div className="space-y-6">
          <TalentHero
            title={listing.title}
            name={name}
            profileHref={publicProfileHref}
            avatarUrl={listing.owner_avatar_url}
            initials={initials(name)}
            metaLine={meta || role}
            postedText={postedText}
            titleScale={TITLE_SCALE}
            stats={topStats}
          />

          <Section title="About this talent" bodyClassName="mt-3 text-sm leading-relaxed text-white/80">
            <p className="whitespace-pre-line">{aboutFor(listing)}</p>
          </Section>

          {services.length ? (
            <Section title="Services offered" bodyClassName="mt-3 text-sm leading-relaxed text-white/80">
              <ul className="list-disc space-y-2 pl-5">
                {services.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </Section>
          ) : null}

          {bestFitTags.length ? (
            <Section title="Best-fit content" bodyClassName="mt-3">
              <TagList values={bestFitTags} />
            </Section>
          ) : null}

          <Section title="Work samples" bodyClassName="mt-4">
            {workSamples.length ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {workSamples.map((sample, index) => (
                  <WorkSampleCard key={sample.id || `${sample.title}-${index}`} sample={sample} index={index} />
                ))}
              </div>
            ) : (
              <p className="text-sm text-white/58">No work samples added yet.</p>
            )}
          </Section>

          {tools.length ? (
            <Section title="Tools" bodyClassName="mt-3">
              <TagList values={tools} />
            </Section>
          ) : null}

          {rows.length ? (
            <Section title="Collaboration preferences" bodyClassName="mt-4">
              <dl className="grid gap-4 sm:grid-cols-2">
                {rows.map((row) => (
                  <div key={row.label}>
                    <dt className="text-xs font-semibold uppercase tracking-[0.14em] text-white/38">{row.label}</dt>
                    <dd className="mt-2 text-sm leading-6 text-white/76">{row.value}</dd>
                  </div>
                ))}
              </dl>
            </Section>
          ) : null}

          {tags.length ? (
            <Section title="Tags" bodyClassName="mt-3">
              <TagList values={tags} />
            </Section>
          ) : null}
        </div>

        <aside className="lg:sticky lg:top-20">
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
                views={listing.views}
              />
            ) : null}
          </div>
        </aside>
      </div>
    </main>
  );
}

function TagList({ values }: { values: string[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {values.map((value) => (
        <TagPill key={value}>{value}</TagPill>
      ))}
    </div>
  );
}

function WorkSampleCard({ sample, index }: { sample: WorkSample; index: number }) {
  const inner = (
    <>
      <div className="relative aspect-video w-full bg-black/30">
        {sample.thumbnailUrl ? (
          <div
            className="h-full w-full bg-cover bg-center opacity-90 transition-opacity group-hover:opacity-100"
            style={{ backgroundImage: `url(${sample.thumbnailUrl})` }}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-sm text-white/42">
            Work sample {index + 1}
          </div>
        )}
      </div>
      <div className="px-4 py-3">
        <div className="line-clamp-1 text-sm font-semibold text-white/90">{sample.title}</div>
        <div className="mt-1 line-clamp-1 text-xs text-white/55">
          {[sample.role, sample.platform].filter(Boolean).join(" · ") || "Portfolio"}
        </div>
        {sample.note ? <p className="mt-2 line-clamp-2 text-xs leading-5 text-white/48">{sample.note}</p> : null}
      </div>
    </>
  );

  const className = [
    "group block overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.06]",
    "shadow-[0_18px_55px_-42px_rgba(0,0,0,0.95)] transition-all duration-150",
    sample.href ? "cursor-pointer hover:-translate-y-[1px] hover:border-white/20" : "",
  ].join(" ");

  if (sample.href) {
    return (
      <a href={sample.href} target="_blank" rel="noopener noreferrer" className={className}>
        {inner}
      </a>
    );
  }

  return <div className={className}>{inner}</div>;
}
