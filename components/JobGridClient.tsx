"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import React, { useMemo, useState } from "react";

import type { BackendRole, BackendSearchIntent } from "../lib/backendClient";
import { formatStartFilterLabel } from "../lib/format";
import {
  JOB_DISCOVERY_PARAMS,
  activeJobDiscoveryCount,
  clearJobDiscoveryQuery,
  jobMatchesDiscovery,
  parseJobDiscovery,
  updateJobDiscoveryQuery,
  type JobDiscoveryState,
} from "../lib/jobDiscovery";
import { uniqueJobText } from "../lib/jobPresentation";
import { CATEGORIES } from "../lib/jobs";
import {
  primaryRoleChipsForType,
  seoSelectedChipLabels,
  subfiltersForRoute,
  type SeoFilterRoute,
} from "../lib/seoFilterRoutes";
import type { Job } from "../lib/types";
import { JobCard } from "./JobCard";
import JobFiltersDrawer from "./jobs/JobFiltersDrawer";
import SearchSummary from "./search/SearchSummary";
import SubfilterRow from "./SubfilterRow";
import { Reveal } from "./ui";

function Chip({ label, active, href, onClick }: { label: string; active?: boolean; href?: string; onClick?: () => void }) {
  const className = [
    "inline-flex max-w-[190px] cursor-pointer items-center rounded-lg px-3 py-1.5 text-sm whitespace-nowrap transition-colors",
    active
      ? "bg-[var(--vt-chip-active-bg,#ffffff)] [background-image:var(--vt-chip-active-grad,none)] text-[var(--vt-chip-active-text,#000000)] shadow-[var(--vt-chip-active-glow,none)]"
      : "bg-[var(--vt-chip-bg,rgba(255,255,255,0.1))] text-[var(--vt-ink,#ffffff)] shadow-[var(--vt-chip-shell,none)] hover:bg-[var(--vt-chip-hover,rgba(255,255,255,0.15))]",
  ].join(" ");
  return href ? <Link href={href} className={className}>{label}</Link> : <button type="button" onClick={onClick} className={className}>{label}</button>;
}

type JobSortKey = "relevance" | "newest" | "rate";

const parseJobRate = (job: Job) =>
  job.budgetAmount ?? (Number(job.budget?.match(/[\d,]+/)?.[0].replaceAll(",", "")) || 0);
const parseJobDate = (job: Job) => (job.createdAt ? Date.parse(job.createdAt) || 0 : 0);

const queryHref = (pathname: string, params: URLSearchParams) => {
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
};

export default function JobGridClient({
  jobs,
  notice,
  query,
  seoRoute,
  roles = [],
  searchIntent,
  searchTotal,
  noExactMatch,
  matchReasons = {},
}: {
  jobs: Job[];
  notice?: string | null;
  query?: string;
  seoRoute?: SeoFilterRoute | null;
  roles?: BackendRole[];
  searchIntent?: BackendSearchIntent | null;
  searchTotal?: number;
  noExactMatch?: boolean;
  matchReasons?: Record<string, string[]>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const discovery = useMemo(() => parseJobDiscovery(searchParams), [searchParams]);
  const [sort, setSort] = useState<JobSortKey>("relevance");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const activeSeoLabels = seoSelectedChipLabels(seoRoute);
  const hasSubfilterRow = subfiltersForRoute(seoRoute).length > 0;
  const seoChips = primaryRoleChipsForType("jobs");
  const seoChipLabels = new Set(seoChips.map((route) => route.chipLabel.toLocaleLowerCase()));
  const localCategoryChips = CATEGORIES.filter((category) => category !== "All" && !seoChipLabels.has(category.toLocaleLowerCase()));
  const activeCount = activeJobDiscoveryCount(discovery);
  const activeLegacyCategory = discovery.filter[0] || "";

  const availablePlatforms = useMemo(
    () => uniqueJobText(["YouTube", "Instagram", "TikTok", "Podcast", ...jobs.flatMap((job) => job.platforms?.length ? job.platforms : [job.platform || ""])]),
    [jobs],
  );
  const availableFormats = useMemo(
    () => uniqueJobText(jobs.flatMap((job) => job.formatsHiredFor || [])),
    [jobs],
  );

  const filtered = useMemo(() => jobs.filter((job) => jobMatchesDiscovery(job, discovery)), [discovery, jobs]);
  const sorted = useMemo(() => {
    if (sort === "relevance") return filtered;
    const next = [...filtered];
    next.sort(sort === "newest" ? (a, b) => parseJobDate(b) - parseJobDate(a) : (a, b) => parseJobRate(b) - parseJobRate(a));
    return next;
  }, [filtered, sort]);

  const hasActiveFilters = activeCount > 0 || activeSeoLabels.length > 0;
  const isSearchEmpty = Boolean(query?.trim()) && jobs.length === 0 && !hasActiveFilters;

  const applyDiscovery = (next: JobDiscoveryState) => {
    let params = new URLSearchParams(searchParams.toString());
    for (const key of JOB_DISCOVERY_PARAMS) {
      params = updateJobDiscoveryQuery(params, key, next[key]);
    }
    router.push(queryHref(pathname, params));
    setFiltersOpen(false);
  };

  const clearHref = queryHref(pathname, clearJobDiscoveryQuery(searchParams, true));

  return (
    <main className="min-h-[calc(100vh-56px)] min-w-0 bg-[var(--vt-canvas,#0b0b0f)] text-[var(--vt-ink,#ffffff)]">
      <div className="fixed top-14 left-20 right-0 z-30 min-w-0 border-b border-b-[var(--vt-bar-line,transparent)] bg-[var(--vt-canvas-translucent,rgba(11,11,15,0.92))] shadow-[var(--vt-bar-shadow,none)] backdrop-blur">
        <div className="flex min-w-0 items-center gap-2 px-2 py-2 sm:gap-3 sm:px-4">
          <div className="min-w-0 flex-1 overflow-x-auto overscroll-x-contain">
            <div className="flex w-max max-w-none items-center gap-2">
              <Chip label="All" active={!activeLegacyCategory && activeSeoLabels.length === 0 && !discovery.role.length} href="/jobs" />
              {seoChips.map((route) => <Chip key={route.path} label={route.chipLabel} active={activeSeoLabels.includes(route.chipLabel)} href={route.path} />)}
              {localCategoryChips.map((category) => {
                const params = updateJobDiscoveryQuery(searchParams, "filter", [category]);
                return <Chip key={category} label={category} active={activeLegacyCategory === category} href={queryHref("/jobs", params)} />;
              })}
              {discovery.start_timeframe[0] ? (
                <Chip label={`Starts ${formatStartFilterLabel(discovery.start_timeframe[0] as Job["startTimeframe"])}`} active onClick={() => router.push(queryHref(pathname, updateJobDiscoveryQuery(searchParams, "start_timeframe", [])))} />
              ) : null}
              <button
                type="button"
                onClick={() => setFiltersOpen(true)}
                aria-expanded={filtersOpen}
                className="inline-flex cursor-pointer items-center gap-2 whitespace-nowrap rounded-lg border border-white/10 bg-white/[0.07] px-3 py-1.5 text-sm font-semibold text-white/80 transition-colors hover:border-white/18 hover:bg-white/[0.11] hover:text-white"
              >
                Filters
                {activeCount ? <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-white px-1 text-[10px] font-bold text-black">{activeCount}</span> : null}
              </button>
            </div>
          </div>
          <label className="flex shrink-0 items-center gap-2">
            <span className="sr-only sm:not-sr-only sm:text-xs sm:text-[var(--vt-text-faint,rgba(255,255,255,0.45))]">Sort</span>
            <select
              aria-label="Sort jobs"
              value={sort}
              onChange={(event) => setSort(event.target.value as JobSortKey)}
              className="h-8 w-[86px] cursor-pointer rounded-lg border border-[var(--vt-line-mid,rgba(255,255,255,0.12))] bg-[var(--vt-card,rgba(255,255,255,0.06))] px-2 text-xs text-[var(--vt-ink,#ffffff)] outline-none transition-colors hover:bg-[var(--vt-card-hover,rgba(255,255,255,0.09))] focus-visible:ring-2 focus-visible:ring-[var(--vt-accent-ring,rgba(255,255,255,0.2))] sm:w-auto sm:px-2.5 sm:text-sm"
            >
              <option value="relevance">Relevance</option>
              <option value="newest">Newest</option>
              <option value="rate">Highest rate</option>
            </select>
          </label>
        </div>
        <SubfilterRow seoRoute={seoRoute} />
      </div>

      <section className={`min-w-0 px-3 py-8 sm:px-6 ${hasSubfilterRow ? "pt-[8.5rem]" : "pt-24"}`}>
        {notice ? <div className="mb-6 rounded-2xl border border-[var(--vt-line-mid,rgba(255,255,255,0.12))] bg-[var(--vt-card,rgba(255,255,255,0.06))] px-4 py-3 text-sm text-[var(--vt-text-secondary,rgba(255,255,255,0.85))]">{notice}</div> : null}
        {searchIntent ? (
          <SearchSummary
            domain="jobs"
            intent={searchIntent}
            total={searchTotal ?? jobs.length}
            noExactMatch={noExactMatch}
          />
        ) : null}
        {activeCount ? (
          <div className="mb-5 flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted" aria-live="polite">
            <span>{filtered.length} matching job{filtered.length === 1 ? "" : "s"}</span>
            <Link href={clearHref} className="cursor-pointer font-semibold text-white/72 underline decoration-white/20 underline-offset-4 hover:text-white">Reset filters</Link>
          </div>
        ) : null}
        <div className="grid min-w-0 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.length === 0 ? (
            <div className="col-span-full min-w-0 rounded-2xl border border-[var(--vt-line,rgba(255,255,255,0.1))] bg-[var(--vt-card-strong,rgba(255,255,255,0.05))] px-5 py-6 text-sm text-[var(--vt-text-soft,rgba(255,255,255,0.7))]">
              <p className="font-semibold text-[var(--vt-text-secondary,rgba(255,255,255,0.85))]">
                {isSearchEmpty ? "No matching jobs found" : hasActiveFilters ? "No jobs match these filters." : jobs.length ? "No jobs found." : "No open jobs right now."}
              </p>
              <p className="mt-1 text-[var(--vt-text-muted,rgba(255,255,255,0.55))]">
                {isSearchEmpty
                  ? "Try removing budget, location, or platform terms to broaden the search."
                  : hasActiveFilters
                    ? "Remove one or more filters to broaden the results."
                    : "New roles are posted regularly. Post a job to start hiring, or browse available talent."}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {isSearchEmpty || activeSeoLabels.length > 0 ? (
                  <Link href="/jobs" className="inline-flex cursor-pointer rounded-xl border border-white/12 bg-white/[0.06] px-3 py-1.5 text-xs font-semibold text-white/75 hover:bg-white/[0.1] hover:text-white">Browse all jobs</Link>
                ) : hasActiveFilters ? (
                  <Link href={clearHref} className="inline-flex cursor-pointer rounded-xl border border-white/12 bg-white/[0.06] px-3 py-1.5 text-xs font-semibold text-white/75 hover:bg-white/[0.1] hover:text-white">Reset filters</Link>
                ) : (
                  <>
                    <Link href="/post-job" className="inline-flex cursor-pointer rounded-xl border border-white/12 bg-white/[0.06] px-3 py-1.5 text-xs font-semibold text-white/75 hover:bg-white/[0.1] hover:text-white">Post a job</Link>
                    <Link href="/talent" className="inline-flex cursor-pointer rounded-xl border border-white/12 bg-white/[0.06] px-3 py-1.5 text-xs font-semibold text-white/75 hover:bg-white/[0.1] hover:text-white">Browse talent</Link>
                  </>
                )}
              </div>
            </div>
          ) : (
            sorted.map((job, index) => (
              <Reveal key={job.id} delay={Math.min(index, 7) * 55} className="h-full min-w-0">
                <JobCard job={job} matchReasons={matchReasons[String(job.id)]} />
              </Reveal>
            ))
          )}
        </div>
      </section>

      <JobFiltersDrawer
        open={filtersOpen}
        initialState={discovery}
        roles={roles}
        platforms={availablePlatforms}
        formats={availableFormats}
        onApply={applyDiscovery}
        onClose={() => setFiltersOpen(false)}
      />
    </main>
  );
}
