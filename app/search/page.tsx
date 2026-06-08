import Link from "next/link";

import { JobCard } from "../../components/JobCard";
import { Icon } from "../../components/Icons";
import { PageHeader, StateCard, TagPill } from "../../components/ui";
import {
  canUseLocalMockFallback,
  isLocalMocksEnabled,
  listJobsWithMeta,
  listTalentListings,
} from "../../lib/backendClient";
import { filterMockTalentListings } from "../../lib/mockTalentListings";
import { listJobs as listJobsFromLocal } from "../../lib/repositories/jobRepository";
import { Job } from "../../lib/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const first = (value?: string | string[]) => (Array.isArray(value) ? value[0] : value) || "";
const formatInr = (amount: number) => `₹${new Intl.NumberFormat("en-IN").format(amount)}`;

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const q = first(params.q).trim();
  let jobs: Job[] = [];
  const usingLocal = isLocalMocksEnabled();
  const canUseMocks = canUseLocalMockFallback();

  if (usingLocal) {
    const localJobs = await listJobsFromLocal();
    jobs = q
      ? localJobs.filter((job) =>
          [job.title, job.category, job.channel.name, job.location, job.budget, ...job.tags]
            .join(" ")
            .toLowerCase()
            .includes(q.toLowerCase())
        )
      : [];
  } else if (q) {
    try {
      const response = await listJobsWithMeta({ q, status: "published", limit: 12, offset: 0 });
      jobs = response.items;
    } catch {
      if (canUseMocks) {
        const localJobs = await listJobsFromLocal();
        jobs = localJobs
          .filter((job) =>
            [job.title, job.category, job.channel.name, job.location, job.budget, ...job.tags]
              .join(" ")
              .toLowerCase()
              .includes(q.toLowerCase())
          )
          .slice(0, 12);
      } else {
        jobs = [];
      }
    }
  }

  const talent = q
    ? await listTalentListings({ q, status: "published", limit: 12, offset: 0 }).catch(() => {
        if (!canUseMocks) {
          return { items: [], total: 0, limit: 12, offset: 0 };
        }
        const items = filterMockTalentListings({ q }).slice(0, 12);
        return {
          items,
          total: items.length,
          limit: 12,
          offset: 0,
        };
      })
    : { items: [], total: 0, limit: 12, offset: 0 };

  const hasResults = jobs.length > 0 || talent.items.length > 0;

  return (
    <main className="min-h-[calc(100vh-56px)] bg-[#0b0b0f] px-4 py-8 text-white sm:px-6">
      <section className="mx-auto max-w-7xl space-y-8">
        <PageHeader
          title={q ? `Results for "${q}"` : "Search"}
          description={
            q
              ? "Jobs and talent listings matching your search."
              : "Search jobs and talent from the header to find active marketplace listings."
          }
        />

        {!q ? (
          <StateCard
            icon="search"
            align="center"
            title="Start with a role, platform, or niche."
            description="Search for editors, designers, strategists, channel operators, and open creator-economy roles from the header."
            action={
              <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                <Link
                  href="/jobs"
                  className="inline-flex h-10 cursor-pointer items-center justify-center rounded-xl border border-white/[0.1] bg-white/[0.045] px-4 text-sm font-semibold text-white/78 transition hover:-translate-y-0.5 hover:border-white/[0.18] hover:bg-white/[0.075] hover:text-white"
                >
                  Browse jobs
                </Link>
                <Link
                  href="/talent"
                  className="inline-flex h-10 cursor-pointer items-center justify-center rounded-xl border border-white/[0.1] bg-white/[0.045] px-4 text-sm font-semibold text-white/78 transition hover:-translate-y-0.5 hover:border-white/[0.18] hover:bg-white/[0.075] hover:text-white"
                >
                  Browse talent
                </Link>
              </div>
            }
          />
        ) : hasResults ? (
          <>
            <section className="space-y-4">
              <div className="flex items-center justify-between gap-4">
                <p className="text-sm font-semibold text-white/84">Jobs</p>
                <Link
                  href={`/jobs?q=${encodeURIComponent(q)}`}
                  className="cursor-pointer text-xs font-semibold text-white/50 transition hover:text-white"
                >
                  View jobs →
                </Link>
              </div>
              {jobs.length ? (
                <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {jobs.slice(0, 8).map((job) => (
                    <JobCard key={job.id} job={job} />
                  ))}
                </div>
              ) : (
                <StateCard
                  icon="briefcase"
                  title="No matching jobs."
                  description="Try a broader role, a platform like YouTube, or a niche such as finance or gaming."
                />
              )}
            </section>

            <section className="space-y-4">
              <div className="flex items-center justify-between gap-4">
                <p className="text-sm font-semibold text-white/84">Talent</p>
                <Link
                  href={`/talent?q=${encodeURIComponent(q)}`}
                  className="cursor-pointer text-xs font-semibold text-white/50 transition hover:text-white"
                >
                  View talent →
                </Link>
              </div>
              {talent.items.length ? (
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {talent.items.slice(0, 6).map((item) => (
                    <Link
                      key={item.id}
                      href={`/talent/${encodeURIComponent(item.id)}`}
                      className="group cursor-pointer rounded-[26px] border border-white/[0.08] bg-white/[0.045] p-5 transition-[border-color,background-color,transform] duration-200 hover:-translate-y-0.5 hover:border-white/[0.14] hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
                      aria-label={`Open talent listing: ${item.title}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-white/82">
                            {item.owner_display_name || item.owner_username || "Talent"}
                          </p>
                          <p className="mt-1 line-clamp-1 text-xs text-white/46">
                            {[item.primary_role || item.roles[0], item.location, item.timezone]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                        </div>
                      </div>
                      <h2 className="mt-4 line-clamp-2 text-lg font-extrabold uppercase leading-tight text-white">
                        {item.title}
                      </h2>
                      <div className="mt-4 space-y-2 text-sm text-white/66">
                        <p>
                          {item.rate_note ||
                            (item.rate_min != null
                              ? `${formatInr(Number(item.rate_min))}${item.rate_max != null ? `-${formatInr(Number(item.rate_max))}` : "+"}`
                              : "Rate flexible")}
                        </p>
                        <p>{[item.work_mode, item.location || "Remote"].filter(Boolean).join(" · ")}</p>
                      </div>
                      {!!item.portfolio_item_ids?.length ? (
                        <div className="mt-3 inline-flex items-center gap-2 text-xs text-white/48">
                          <Icon name="image" className="h-3.5 w-3.5" />
                          <span>{item.portfolio_item_ids.length} work samples</span>
                        </div>
                      ) : null}
                      <div className="mt-4 flex flex-wrap gap-1.5">
                        {[...item.tools, ...item.platforms, item.niche, ...item.formats]
                          .filter((tag): tag is string => Boolean(tag))
                          .slice(0, 3)
                          .map((tag) => (
                            <TagPill key={`${item.id}-${tag}`}>{tag}</TagPill>
                          ))}
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                <StateCard
                  icon="user"
                  title="No matching talent."
                  description="Try a role, tool, platform, or niche so the search can narrow to relevant listings."
                />
              )}
            </section>
          </>
        ) : (
          <StateCard
            icon="search"
            align="center"
            title="Nothing matched this search yet."
            description="Try fewer keywords, a broader role, or browse the latest jobs and talent instead."
          />
        )}
      </section>
    </main>
  );
}
