"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { BackendTalentListing } from "../lib/backendClient";
import {
  primaryRoleChipsForType,
  seoSelectedChipLabels,
  subfiltersForRoute,
  type SeoFilterRoute,
} from "../lib/seoFilterRoutes";
import SubfilterRow from "./SubfilterRow";
import TalentCard from "./TalentCard";
import { Reveal } from "./ui";

type TalentFilter = {
  label: string;
  match: (item: BackendTalentListing) => boolean;
};

const textFor = (item: BackendTalentListing) =>
  [
    item.title,
    item.primary_role,
    item.experience_years != null ? `${item.experience_years} years` : null,
    item.niche,
    item.location,
    item.timezone,
    ...(item.content_niches || []),
    ...(item.content_genres || []),
    ...item.roles,
    ...item.platforms,
    ...item.formats,
    ...item.tools,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

const FILTERS: TalentFilter[] = [
  { label: "All", match: () => true },
  { label: "Video editor", match: (item) => textFor(item).includes("video editor") || textFor(item).includes("editing") },
  { label: "Shorts editor", match: (item) => textFor(item).includes("shorts") },
  { label: "Thumbnail designer", match: (item) => textFor(item).includes("thumbnail") },
  { label: "Scriptwriter", match: (item) => textFor(item).includes("script") || textFor(item).includes("writer") },
  { label: "YouTube", match: (item) => textFor(item).includes("youtube") },
  { label: "Remote", match: (item) => textFor(item).includes("remote") },
];

function Chip({
  label,
  active,
  onClick,
  href,
}: {
  label: string;
  active?: boolean;
  onClick?: () => void;
  href?: string;
}) {
  const className = [
    "cursor-pointer rounded-lg px-3 py-1.5 text-sm whitespace-nowrap transition-colors",
    active ? "bg-white text-black" : "bg-white/10 text-white hover:bg-white/15",
  ].join(" ");

  if (href) {
    return (
      <Link href={href} className={className}>
        {label}
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={className}
    >
      {label}
    </button>
  );
}

type TalentSortKey = "relevance" | "newest" | "rate";
const talentRate = (item: BackendTalentListing) => item.rate_min ?? item.rate_max ?? 0;
const talentDate = (item: BackendTalentListing) => (item.created_at ? Date.parse(item.created_at) || 0 : 0);

export default function TalentFeedClient({
  items,
  notice,
  query,
  seoRoute,
}: {
  items: BackendTalentListing[];
  notice?: string | null;
  query?: string;
  seoRoute?: SeoFilterRoute | null;
}) {
  // Local (client-side) filters are single-select with the SEO chips. Landing on
  // the base list with ?filter=<label> — how the local chips replace an SEO
  // selection — restores that chip as active on mount.
  const searchParams = useSearchParams();
  const filterParam = searchParams.get("filter");
  const [active, setActive] = useState(
    filterParam && FILTERS.some((filter) => filter.label === filterParam) ? filterParam : "All"
  );
  const [sort, setSort] = useState<TalentSortKey>("relevance");
  const activeSeoLabels = seoSelectedChipLabels(seoRoute);
  const hasSubfilterRow = subfiltersForRoute(seoRoute).length > 0;
  const seoChips = primaryRoleChipsForType("talent");
  const seoChipLabels = new Set(seoChips.map((route) => route.chipLabel.toLowerCase()));
  const localFilters = FILTERS.filter((filter) => filter.label === "All" || !seoChipLabels.has(filter.label.toLowerCase()));
  const hasActiveFilter = active !== "All" || activeSeoLabels.length > 0;
  const isSearchEmpty = Boolean(query?.trim()) && items.length === 0 && !hasActiveFilter;

  const filtered = useMemo(() => {
    const selected = FILTERS.find((filter) => filter.label === active) || FILTERS[0];
    return items.filter(selected.match);
  }, [active, items]);

  const sorted = useMemo(() => {
    if (sort === "relevance") return filtered;
    const list = [...filtered];
    if (sort === "newest") list.sort((a, b) => talentDate(b) - talentDate(a));
    else if (sort === "rate") list.sort((a, b) => talentRate(b) - talentRate(a));
    return list;
  }, [filtered, sort]);

  return (
    <main className="min-h-[calc(100vh-56px)] bg-[#0b0b0f] text-white">
      <div className="fixed left-20 right-0 top-14 z-30 bg-[#0b0b0f]/92 backdrop-blur">
        <div className="flex items-center gap-3 px-3 py-2 sm:px-4">
          <div className="min-w-0 flex-1 overflow-x-auto">
          <div className="flex w-max items-center gap-2">
            {localFilters.map((filter) => {
              // Single-select chip row. "All" always clears to the base list.
              // On a curated SEO route the other local filters *replace* the SEO
              // selection: they navigate to the base list with the filter applied
              // (as a client-read ?filter= param) instead of silently narrowing
              // the SEO subset with no visible highlight. On the base list they
              // stay instant client-side toggles.
              if (filter.label === "All") {
                return (
                  <Chip
                    key={filter.label}
                    label="All"
                    href="/talent"
                    active={active === "All" && activeSeoLabels.length === 0}
                  />
                );
              }
              if (seoRoute) {
                return (
                  <Chip
                    key={filter.label}
                    label={filter.label}
                    href={`/talent?filter=${encodeURIComponent(filter.label)}`}
                  />
                );
              }
              return (
                <Chip
                  key={filter.label}
                  label={filter.label}
                  active={active === filter.label}
                  onClick={() => setActive(filter.label)}
                />
              );
            })}
            {seoChips.map((route) => (
              <Chip
                key={route.path}
                label={route.chipLabel}
                active={activeSeoLabels.includes(route.chipLabel)}
                href={route.path}
              />
            ))}
          </div>
          </div>
          <label className="flex shrink-0 items-center gap-2">
            <span className="hidden text-xs text-muted sm:inline">Sort</span>
            <select
              aria-label="Sort talent"
              value={sort}
              onChange={(event) => setSort(event.target.value as TalentSortKey)}
              className="h-8 cursor-pointer rounded-lg border border-white/12 bg-white/[0.06] px-2.5 text-sm text-white outline-none transition-colors hover:bg-white/[0.09] focus-visible:ring-2 focus-visible:ring-white/20"
            >
              <option value="relevance">Relevance</option>
              <option value="newest">Newest</option>
              <option value="rate">Highest rate</option>
            </select>
          </label>
        </div>
        <SubfilterRow seoRoute={seoRoute} />
      </div>

      {/* A curated SEO route renders no visible title/intro — the highlighted
          filter chip and the filtered results convey the niche, exactly like a
          selected chip on the normal browse page (the SEO name lives only in
          metadata/canonical). */}
      <section className={`px-4 py-8 sm:px-6 ${hasSubfilterRow ? "pt-[8.5rem]" : "pt-24"}`}>
        {notice ? (
          <div className="mb-6 flex flex-col gap-3 rounded-2xl border border-white/12 bg-white/[0.06] px-4 py-3 text-sm text-white/85 sm:flex-row sm:items-center sm:justify-between">
            <span>{notice}</span>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="w-fit cursor-pointer rounded-xl border border-white/12 bg-white/[0.06] px-3 py-1.5 text-xs font-semibold text-white/75 transition-colors hover:border-white/20 hover:bg-white/[0.1] hover:text-white"
            >
              Retry
            </button>
          </div>
        ) : null}
        {filtered.length ? (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {sorted.map((item, index) => (
              <Reveal key={item.id} delay={Math.min(index, 7) * 55} className="h-full min-w-0">
                <TalentCard item={item} />
              </Reveal>
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-white/10 bg-white/[0.05] px-5 py-6 text-sm text-white/70">
            <p className="font-semibold text-white/85">
              {isSearchEmpty
                ? "No matching talent found"
                : items.length
                  ? "No talent listings found."
                  : "No talent listings yet."}
            </p>
            <p className="mt-1 text-white/55">
              {isSearchEmpty
                ? "Try searching by role, tool, location, or platform."
                : items.length
                ? "Try a different filter or clear filters."
                : "Create the first talent listing."}
            </p>
            {activeSeoLabels.length > 0 ? (
              <Link
                href="/talent"
                className="mt-4 inline-flex cursor-pointer rounded-xl border border-white/12 bg-white/[0.06] px-3 py-1.5 text-xs font-semibold text-white/75 transition-colors hover:border-white/20 hover:bg-white/[0.1] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/25"
              >
                Browse all talent
              </Link>
            ) : hasActiveFilter ? (
              <button
                type="button"
                onClick={() => setActive("All")}
                className="mt-4 cursor-pointer rounded-xl border border-white/12 bg-white/[0.06] px-3 py-1.5 text-xs font-semibold text-white/75 transition-colors hover:border-white/20 hover:bg-white/[0.1] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/25"
              >
                Clear filters
              </button>
            ) : isSearchEmpty ? (
              <Link
                href="/talent"
                className="mt-4 inline-flex cursor-pointer rounded-xl border border-white/12 bg-white/[0.06] px-3 py-1.5 text-xs font-semibold text-white/75 transition-colors hover:border-white/20 hover:bg-white/[0.1] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/25"
              >
                Browse all talent
              </Link>
            ) : !items.length ? (
              <Link
                href="/post-talent"
                className="mt-4 inline-flex cursor-pointer rounded-xl border border-white/12 bg-white/[0.06] px-3 py-1.5 text-xs font-semibold text-white/75 transition-colors hover:border-white/20 hover:bg-white/[0.1] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/25"
              >
                Create talent listing
              </Link>
            ) : null}
          </div>
        )}
      </section>
    </main>
  );
}
