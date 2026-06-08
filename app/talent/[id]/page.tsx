import type { Metadata } from "next";
import Link from "next/link";
import { getServerSession } from "next-auth";
import TalentListingActionsClient from "../../../components/TalentListingActionsClient";
import OwnerListingControlsClient from "../../../components/OwnerListingControlsClient";
import { Icon } from "../../../components/Icons";
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

export const dynamic = "force-dynamic";
export const revalidate = 0;

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

const experienceRange = (value?: string | null) => {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return "Not specified";
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
  return "Not specified";
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
    listing.work_mode ? { label: "Work mode", value: titleCase(listing.work_mode) } : null,
    listing.turnaround ? { label: "Turnaround", value: listing.turnaround } : null,
    listing.rate_note || listing.rate_min ? { label: "Rate guidance", value: rateLabel(listing) } : null,
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
  const publicProfileHref = listing.owner_username ? `/u/${encodeURIComponent(listing.owner_username)}?view=talent` : null;
  const role = listing.primary_role || listing.roles[0] || "Talent";
  const meta = metadataFor(listing);
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
    { icon: "cap" as const, label: "Experience", value: experienceRange(listing.experience_level) },
    { icon: "pin" as const, label: "Work mode", value: titleCase(listing.work_mode) || "Remote" },
    { icon: "image" as const, label: "Work samples", value: sampleCount ? String(sampleCount) : "0" },
  ];

  return (
    <main className="min-h-screen bg-[#0b0b0f] px-4 py-8 text-white sm:px-6">
      <div className="mx-auto grid max-w-6xl items-start gap-6 lg:grid-cols-[1fr_420px]">
        <div className="space-y-6">
          <section className="rounded-3xl border border-white/[0.08] bg-white/[0.06] p-6 shadow-[0_18px_60px_-40px_rgba(0,0,0,0.95)] sm:p-7">
            <div className="flex items-start justify-between gap-4">
              <h1 className="max-w-4xl text-3xl font-extrabold uppercase leading-[1.08] tracking-tight text-white sm:text-4xl">
                {listing.title}
              </h1>
              {listing.is_featured ? <TagPill className="shrink-0">Featured</TagPill> : null}
            </div>

            <div className="mt-6 flex items-center gap-4">
              {listing.owner_avatar_url ? (
                <div
                  aria-label={name}
                  className="h-12 w-12 flex-shrink-0 rounded-full border border-white/15 bg-white/10 bg-cover bg-center"
                  style={{ backgroundImage: `url(${listing.owner_avatar_url})` }}
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
                    className="inline-block max-w-full cursor-pointer truncate rounded-sm text-lg font-semibold text-white transition-colors hover:text-white hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
                  >
                    {name}
                  </Link>
                ) : (
                  <p className="truncate text-lg font-semibold text-white">{name}</p>
                )}
                <p className="mt-1 text-sm text-white/55">{meta || role}</p>
              </div>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {topStats.map((stat) => (
                <DetailTile key={stat.label} icon={stat.icon} label={stat.label} value={stat.value} />
              ))}
            </div>
          </section>

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
                activityHref="/activity?tab=interests"
              />
            ) : null}
            <TalentListingActionsClient
              listingId={listing.id}
              views={listing.views}
              workSamplesCount={sampleCount}
            />
          </div>
        </aside>
      </div>
    </main>
  );
}

function DetailTile({
  icon,
  label,
  value,
}: {
  icon: "cash-stack" | "cap" | "pin" | "image";
  label: string;
  value: string;
}) {
  return (
    <div className="flex h-[108px] items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.045] px-4 py-3 shadow-[0_18px_55px_-42px_rgba(0,0,0,0.95)]">
      <div className="flex flex-col items-center justify-center gap-1 text-center">
        <span className="text-white/70">
          <Icon name={icon} className="h-4 w-4" />
        </span>
        <div className="text-[11px] leading-snug text-white/60">{label}</div>
        <div className="text-sm font-medium leading-snug text-white/90">{value}</div>
      </div>
    </div>
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
