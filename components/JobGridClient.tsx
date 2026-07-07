"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CATEGORIES, START_TIME_VALUES } from "../lib/jobs";
import { formatStartFilterLabel } from "../lib/format";
import { StartTimeframe, Job } from "../lib/types";
import {
  seoFilterRoutesForType,
  seoSelectedChipLabels,
  type SeoFilterRoute,
} from "../lib/seoFilterRoutes";
import { JobCard } from "./JobCard";
import { Reveal } from "./ui";

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
    "cursor-pointer px-3 py-1.5 rounded-lg text-sm whitespace-nowrap transition-colors",
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

type JobSortKey = "relevance" | "newest" | "rate";

// Best-effort numeric rate from a budget string like "₹20,000 per video" or a
// range "₹1,500–₹3,000" (sorts by the first/lower amount). Falsy → 0 (sorts last).
const parseJobRate = (budget: string) => {
  const match = budget?.match(/[\d,]+/);
  return match ? Number(match[0].replace(/,/g, "")) : 0;
};
const parseJobDate = (job: Job) => (job.createdAt ? Date.parse(job.createdAt) || 0 : 0);

export default function JobGridClient({
  jobs,
  notice,
  query,
  seoRoute,
}: {
  jobs: Job[];
  notice?: string | null;
  query?: string;
  seoRoute?: SeoFilterRoute | null;
}) {
  // Local category chips are single-select with the SEO chips. Landing on the
  // base list with ?filter=<category> — how a local chip replaces an SEO
  // selection — restores that category as active on mount.
  const searchParams = useSearchParams();
  const filterParam = searchParams.get("filter");
  const [activeCat, setActiveCat] = useState<(typeof CATEGORIES)[number]>(
    filterParam && (CATEGORIES as readonly string[]).includes(filterParam)
      ? (filterParam as (typeof CATEGORIES)[number])
      : "All"
  );
  const [startOpen, setStartOpen] = useState(false);
  const [selectedStarts, setSelectedStarts] = useState<StartTimeframe[]>([]);
  const [sort, setSort] = useState<JobSortKey>("relevance");
  const activeSeoLabels = seoSelectedChipLabels(seoRoute);
  const seoChips = seoFilterRoutesForType("jobs");
  const seoChipLabels = new Set(seoChips.map((route) => route.chipLabel.toLowerCase()));
  const localCategoryChips = CATEGORIES.filter((category) => category !== "All" && !seoChipLabels.has(category.toLowerCase()));

  const toggleStart = (value: StartTimeframe) => {
    setSelectedStarts((prev) => {
      const has = prev.includes(value);
      if (has) return prev.filter((v) => v !== value);
      return [...prev, value];
    });
  };

  const filtered = useMemo(() => {
    let list = jobs;

    if (activeCat !== "All") {
      list = list.filter((j) => j.category === activeCat);
    }

    if (selectedStarts.length > 0) {
      list = list.filter((j) => selectedStarts.includes(j.startTimeframe));
    }

    return list;
  }, [activeCat, selectedStarts, jobs]);

  const hasActiveFilters = activeCat !== "All" || selectedStarts.length > 0 || activeSeoLabels.length > 0;
  const isSearchEmpty = Boolean(query?.trim()) && jobs.length === 0 && !hasActiveFilters;

  const clearFilters = () => {
    setActiveCat("All");
    setSelectedStarts([]);
    setStartOpen(false);
  };

  const sorted = useMemo(() => {
    if (sort === "relevance") return filtered;
    const list = [...filtered];
    if (sort === "newest") {
      list.sort((a, b) => parseJobDate(b) - parseJobDate(a));
    } else if (sort === "rate") {
      list.sort((a, b) => parseJobRate(b.budget) - parseJobRate(a.budget));
    }
    return list;
  }, [filtered, sort]);

  return (
    <main className="text-white bg-[#0b0b0f] min-h-[calc(100vh-56px)]">
      {/* FIXED filters bar: behaves like YouTube chips row (does NOT scroll) */}
      <div className="fixed top-14 left-20 right-0 z-30 bg-[#0b0b0f]/92 backdrop-blur">
        <div className="flex items-center gap-3 px-3 sm:px-4 py-2">
          <div className="min-w-0 flex-1 overflow-x-auto">
          <div className="flex items-center gap-2 w-max">
            <Chip label="All" active={activeCat === "All" && activeSeoLabels.length === 0} href="/jobs" />
            {seoChips.map((route) => (
              <Chip
                key={route.path}
                label={route.chipLabel}
                active={activeSeoLabels.includes(route.chipLabel)}
                href={route.path}
              />
            ))}
            {localCategoryChips.map((c) =>
              // On a curated SEO route, a local category replaces the SEO
              // selection (navigates to the base list with the category applied)
              // rather than narrowing the SEO subset. On the base list it stays an
              // instant client-side toggle.
              seoRoute ? (
                <Chip key={c} label={c} href={`/jobs?filter=${encodeURIComponent(c)}`} />
              ) : (
                <Chip key={c} label={c} active={activeCat === c} onClick={() => setActiveCat(c)} />
              )
            )}

            <button
              onClick={() => setStartOpen((v) => !v)}
              className={[
                "cursor-pointer px-3 py-1.5 rounded-lg text-sm whitespace-nowrap transition-colors",
                "bg-white/10 text-white hover:bg-white/15",
                "border border-transparent",
                startOpen ? "bg-white/15 text-white" : "",
              ].join(" ")}
            >
              <span className="inline-flex items-center gap-2">
                Start within <span className="text-white/70">{startOpen ? "▾" : "▸"}</span>
              </span>
            </button>

            {startOpen ? (
              <div className="flex items-center gap-2">
                {START_TIME_VALUES.map((value) => (
                  <Chip
                    key={value}
                    label={formatStartFilterLabel(value)}
                    active={selectedStarts.includes(value)}
                    onClick={() => toggleStart(value)}
                  />
                ))}
              </div>
            ) : null}
          </div>
          </div>
          <label className="flex shrink-0 items-center gap-2">
            <span className="hidden text-xs text-white/45 sm:inline">Sort</span>
            <select
              aria-label="Sort jobs"
              value={sort}
              onChange={(event) => setSort(event.target.value as JobSortKey)}
              className="h-8 cursor-pointer rounded-lg border border-white/12 bg-white/[0.06] px-2.5 text-sm text-white outline-none transition-colors hover:bg-white/[0.09] focus-visible:ring-2 focus-visible:ring-white/20"
            >
              <option value="relevance">Relevance</option>
              <option value="newest">Newest</option>
              <option value="rate">Highest rate</option>
            </select>
          </label>
        </div>
      </div>

      {/* Scrollable content starts BELOW the fixed filters bar. A curated SEO
          route renders no visible title/intro — the highlighted filter chip and
          the filtered results convey the niche, exactly like a selected chip on
          the normal browse page (the SEO name lives only in metadata/canonical). */}
      <section className="px-4 sm:px-6 py-8 pt-24">
        {notice ? (
          <div className="mb-6 rounded-2xl border border-white/12 bg-white/[0.06] px-4 py-3 text-sm text-white/85">
            {notice}
          </div>
        ) : null}
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.length === 0 ? (
            <div className="col-span-full rounded-2xl border border-white/10 bg-white/[0.05] px-5 py-6 text-sm text-white/70">
              <p className="font-semibold text-white/85">
                {isSearchEmpty
                  ? "No matching jobs found"
                  : hasActiveFilters
                  ? "No jobs match these filters."
                  : jobs.length
                    ? "No jobs found."
                    : "No open jobs right now."}
              </p>
              <p className="mt-1 text-white/55">
                {isSearchEmpty
                  ? "Try removing budget, location, or platform terms to broaden the search."
                  : hasActiveFilters
                  ? "Try a different category or start window, or clear filters to see every open role."
                  : "New roles are posted regularly. Post a job to start hiring, or browse available talent."}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {isSearchEmpty ? (
                  <Link
                    href="/jobs"
                    className="inline-flex cursor-pointer rounded-xl border border-white/12 bg-white/[0.06] px-3 py-1.5 text-xs font-semibold text-white/75 transition-colors hover:border-white/20 hover:bg-white/[0.1] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/25"
                  >
                    Browse all jobs
                  </Link>
                ) : activeSeoLabels.length > 0 ? (
                  <Link
                    href="/jobs"
                    className="inline-flex cursor-pointer rounded-xl border border-white/12 bg-white/[0.06] px-3 py-1.5 text-xs font-semibold text-white/75 transition-colors hover:border-white/20 hover:bg-white/[0.1] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/25"
                  >
                    Browse all jobs
                  </Link>
                ) : hasActiveFilters ? (
                  <button
                    type="button"
                    onClick={clearFilters}
                    className="inline-flex cursor-pointer rounded-xl border border-white/12 bg-white/[0.06] px-3 py-1.5 text-xs font-semibold text-white/75 transition-colors hover:border-white/20 hover:bg-white/[0.1] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/25"
                  >
                    Clear filters
                  </button>
                ) : (
                  <>
                    <Link
                      href="/post-job"
                      className="inline-flex cursor-pointer rounded-xl border border-white/12 bg-white/[0.06] px-3 py-1.5 text-xs font-semibold text-white/75 transition-colors hover:border-white/20 hover:bg-white/[0.1] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/25"
                    >
                      Post a job
                    </Link>
                    <Link
                      href="/talent"
                      className="inline-flex cursor-pointer rounded-xl border border-white/12 bg-white/[0.06] px-3 py-1.5 text-xs font-semibold text-white/75 transition-colors hover:border-white/20 hover:bg-white/[0.1] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/25"
                    >
                      Browse talent
                    </Link>
                  </>
                )}
              </div>
            </div>
          ) : (
            sorted.map((job, index) => (
              <Reveal key={job.id} delay={Math.min(index, 7) * 55} className="h-full min-w-0">
                <JobCard job={job} />
              </Reveal>
            ))
          )}
        </div>
      </section>
    </main>
  );
}
