import Link from "next/link";

import { HomeClosingCta } from "../components/marketplace/HomeClosingCta";
import { HomeMarketSignalHero } from "../components/marketplace/HomeMarketSignalHero";
import { HomeRolesMarquee } from "../components/marketplace/HomeRolesMarquee";
import { JobCard } from "../components/JobCard";
import TalentCard from "../components/TalentCard";
import { Reveal } from "../components/ui";
import {
  canUseLocalMockFallback,
  isLocalMocksEnabled,
  listJobsWithMeta,
  listTalentListings,
} from "../lib/backendClient";
import { filterMockTalentListings } from "../lib/mockTalentListings";
import { listJobs as listJobsFromLocal } from "../lib/repositories/jobRepository";
import { Job } from "../lib/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function Home() {
  const usingLocal = isLocalMocksEnabled();
  const canUseMocks = canUseLocalMockFallback();
  let jobs: Job[] = [];

  if (usingLocal) {
    jobs = await listJobsFromLocal();
  } else {
    try {
      const response = await listJobsWithMeta({ status: "published", limit: 8, offset: 0 });
      jobs = response.items;
    } catch {
      jobs = canUseMocks ? await listJobsFromLocal() : [];
    }
  }

  const talent = await listTalentListings({ status: "published", limit: 6 }).catch(() => {
    if (!canUseMocks) {
      return { items: [], total: 0, limit: 6, offset: 0 };
    }
    const items = filterMockTalentListings({}).slice(0, 6);
    return { items, total: items.length, limit: 6, offset: 0 };
  });
  const talentItems =
    canUseMocks && talent.total === 0 && talent.items.length === 0
      ? filterMockTalentListings({}).slice(0, 6)
      : talent.items.length || usingLocal
        ? talent.items
        : filterMockTalentListings({}).slice(0, 6);
  const previewJobs = jobs.slice(0, 3);
  const previewTalent = talentItems.slice(0, 3);

  return (
    <main className="min-h-[calc(100vh-56px)] overflow-hidden bg-[#0b0b0f] px-4 py-7 text-white sm:px-6 lg:px-8">
      <section className="mx-auto w-full max-w-[1480px] space-y-16">
        <div className="space-y-8">
          <HomeMarketSignalHero />
          <HomeRolesMarquee />
        </div>

        <section className="home-rise-delay-jobs space-y-5">
          <Reveal>
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/35">
                  Marketplace · Jobs
                </p>
                <h2 className="mt-2 text-xl font-semibold tracking-tight text-white">Recent Job Listings</h2>
              </div>
              <Link
                href="/jobs"
                className="group/link cursor-pointer text-sm font-semibold text-white/70 transition-colors hover:text-white"
              >
                View jobs{" "}
                <span
                  aria-hidden="true"
                  className="inline-block transition-transform group-hover/link:translate-x-1 motion-reduce:transition-none"
                >
                  →
                </span>
              </Link>
            </div>
          </Reveal>
          {previewJobs.length ? (
            <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {previewJobs.map((job, index) => (
                <Reveal key={job.id} delay={80 + index * 80} className="h-full">
                  <JobCard job={job} />
                </Reveal>
              ))}
            </div>
          ) : (
            <div className="rounded-[28px] border border-white/[0.07] bg-white/[0.028] px-6 py-10 text-sm text-white/55">
              No open jobs yet.
            </div>
          )}
        </section>

        <section className="home-rise-delay-talent space-y-5 pb-4">
          <Reveal>
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/35">
                  Marketplace · Talent
                </p>
                <h2 className="mt-2 text-xl font-semibold tracking-tight text-white">Recent Talent Listings</h2>
              </div>
              <Link
                href="/talent"
                className="group/link cursor-pointer text-sm font-semibold text-white/70 transition-colors hover:text-white"
              >
                View talent{" "}
                <span
                  aria-hidden="true"
                  className="inline-block transition-transform group-hover/link:translate-x-1 motion-reduce:transition-none"
                >
                  →
                </span>
              </Link>
            </div>
          </Reveal>
          {previewTalent.length ? (
            <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {previewTalent.map((item, index) => (
                <Reveal key={item.id} delay={80 + index * 80} className="h-full">
                  <TalentCard item={item} />
                </Reveal>
              ))}
            </div>
          ) : (
            <div className="rounded-[28px] border border-white/[0.07] bg-white/[0.028] px-6 py-10 text-sm text-white/55">
              No recent talent listings yet.
            </div>
          )}
        </section>

        <Reveal>
          <HomeClosingCta />
        </Reveal>
      </section>
    </main>
  );
}
