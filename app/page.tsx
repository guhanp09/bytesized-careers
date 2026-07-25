import Link from "next/link";

import { HomeBetaBanner } from "../components/marketplace/HomeBetaBanner";
import { HomeBrowseCategories } from "../components/marketplace/HomeBrowseCategories";
import { HomeClosingCta } from "../components/marketplace/HomeClosingCta";
import { HomeComparison } from "../components/marketplace/HomeComparison";
import { HomeFaq } from "../components/marketplace/HomeFaq";
import { HomeHowItWorks } from "../components/marketplace/HomeHowItWorks";
import { HomeJobAlerts } from "../components/marketplace/HomeJobAlerts";
import { HomeJobAlertsPopup } from "../components/marketplace/HomeJobAlertsPopup";
import { HomeMarketSignalHero } from "../components/marketplace/HomeMarketSignalHero";
import { HomeRolesMarquee } from "../components/marketplace/HomeRolesMarquee";
import { HomeWhySection } from "../components/marketplace/HomeWhySection";
import { JobCard } from "../components/JobCard";
import TalentCard from "../components/TalentCard";
import { Icon } from "../components/Icons";
import { Reveal } from "../components/ui";
import {
  canUseLocalMockFallback,
  listJobsWithMeta,
  listTalentListings,
} from "../lib/backendClient";
import { getMarketplaceDataSourceState } from "../lib/devDataSource.server";
import { JOBS } from "../lib/jobs";
import { filterMockTalentListings } from "../lib/mockTalentListings";
import { Job } from "../lib/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function Home() {
  const dataSource = await getMarketplaceDataSourceState();
  const usingMock = dataSource.source === "mock";
  const canUseMocks = canUseLocalMockFallback() && dataSource.overrideSource !== "backend";
  let jobs: Job[] = [];

  if (usingMock) {
    jobs = JOBS;
  } else {
    try {
      const response = await listJobsWithMeta({ status: "published", limit: 8, offset: 0 });
      jobs = response.items;
    } catch {
      jobs = canUseMocks ? JOBS : [];
    }
  }

  const talentItems = usingMock
    ? filterMockTalentListings({}).slice(0, 6)
    : await listTalentListings({ status: "published", limit: 6 })
        .then((response) => {
          if (canUseMocks && response.total === 0 && response.items.length === 0) {
            return filterMockTalentListings({}).slice(0, 6);
          }
          return response.items;
        })
        .catch(() => (canUseMocks ? filterMockTalentListings({}).slice(0, 6) : []));
  const previewJobs = jobs.slice(0, 3);
  const previewTalent = talentItems.slice(0, 3);

  return (
    <main className="min-h-[calc(100vh-56px)] overflow-hidden bg-[#0b0b0f] px-4 py-7 text-white sm:px-6 lg:px-8">
      <section className="mx-auto w-full max-w-[1480px] space-y-16">
        <div className="space-y-8">
          <HomeBetaBanner />
          <HomeMarketSignalHero />
          <HomeRolesMarquee />
        </div>

        <HomeWhySection />

        <HomeHowItWorks />

        <HomeBrowseCategories />

        <section className="home-rise-delay-jobs space-y-5">
          <Reveal>
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-subtle">
                  Marketplace · Jobs
                </p>
                <h2 className="mt-2 inline-flex items-center gap-2 text-xl font-semibold tracking-tight text-white">
                  <Icon name="briefcase" className="h-5 w-5 text-white/55" />
                  <span>Recent Job Listings</span>
                </h2>
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
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-subtle">
                  Marketplace · Talent
                </p>
                <h2 className="mt-2 inline-flex items-center gap-2 text-xl font-semibold tracking-tight text-white">
                  <Icon name="user" className="h-5 w-5 text-white/55" />
                  <span>Recent Talent Listings</span>
                </h2>
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

        <HomeComparison />

        <HomeJobAlerts />

        <HomeFaq />

        <Reveal>
          <HomeClosingCta />
        </Reveal>
      </section>

      {/* Gentle, capped email-capture popup for new visitors (see HomeJobAlertsPopup). */}
      <HomeJobAlertsPopup />
    </main>
  );
}
