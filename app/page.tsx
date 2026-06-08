import Link from "next/link";

import { HomeMarketSignalHero } from "../components/marketplace/HomeMarketSignalHero";
import { HomeJobPreviewCard, HomeTalentPreviewCard } from "../components/marketplace/HomePreviewCards";
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
    talent.items.length || !usingLocal
      ? talent.items
      : filterMockTalentListings({}).slice(0, 6);
  const previewJobs = jobs.slice(0, 3);
  const previewTalent = talentItems.slice(0, 3);

  return (
    <main className="min-h-[calc(100vh-56px)] overflow-hidden bg-[#0b0b0f] px-4 py-7 text-white sm:px-6 lg:px-8">
      <section className="mx-auto w-full max-w-[1480px] space-y-16">
        <HomeMarketSignalHero />

        <section className="home-rise home-rise-delay-jobs space-y-5">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold tracking-tight text-white">Recent Job Listings</h2>
            </div>
            <Link href="/jobs" className="cursor-pointer text-sm font-semibold text-white/70 hover:text-white">
              View jobs →
            </Link>
          </div>
          {previewJobs.length ? (
            <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {previewJobs.map((job) => (
                <HomeJobPreviewCard key={job.id} job={job} />
              ))}
            </div>
          ) : (
            <div className="rounded-[28px] border border-white/[0.07] bg-white/[0.028] px-6 py-10 text-sm text-white/55">
              No open jobs yet.
            </div>
          )}
        </section>

        <section className="home-rise home-rise-delay-talent space-y-5 pb-4">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold tracking-tight text-white">Recent Talent Listings</h2>
            </div>
            <Link href="/talent" className="cursor-pointer text-sm font-semibold text-white/70 hover:text-white">
              View talent →
            </Link>
          </div>
          {previewTalent.length ? (
            <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {previewTalent.map((item) => (
                <HomeTalentPreviewCard key={item.id} item={item} />
              ))}
            </div>
          ) : (
            <div className="rounded-[28px] border border-white/[0.07] bg-white/[0.028] px-6 py-10 text-sm text-white/55">
              No recent talent listings yet.
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
