"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { formatListingTitle } from "../../lib/displayText";
import type { Job } from "../../lib/types";
import { TagPill } from "../ui";

type ProfileTabsProps = {
  marketplaceJobs: Job[];
};

type TabKey = "overview" | "hiring" | "working" | "saved";

type TabButtonProps = {
  active: boolean;
  label: string;
  onClick: () => void;
};

function TabButton({ active, label, onClick }: TabButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "h-10 px-4 rounded-xl border text-sm font-semibold whitespace-nowrap transition-colors",
        active
          ? "bg-white text-black border-white"
          : "bg-white/[0.04] border-white/10 text-white/75 hover:bg-white/[0.08] hover:text-white",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

function SubCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <article className="rounded-2xl border border-white/10 bg-white/[0.05] p-4">
      <h3 className="text-sm font-semibold text-white/90">{title}</h3>
      <div className="mt-2 text-sm text-white/70">{children}</div>
    </article>
  );
}

function EmptyState({
  title,
  ctaLabel,
}: {
  title: string;
  ctaLabel: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-6 text-center">
      <p className="text-sm text-white/70">{title}</p>
      <Link
        href="/"
        className="mt-4 inline-flex h-10 items-center justify-center rounded-xl bg-white px-4 text-sm font-semibold text-black hover:bg-white/90 transition-colors"
      >
        {ctaLabel}
      </Link>
    </div>
  );
}

export default function ProfileTabs({ marketplaceJobs }: ProfileTabsProps) {
  const [activeTab, setActiveTab] = useState<TabKey>("overview");

  const recentJobs = useMemo(() => marketplaceJobs.slice(0, 4), [marketplaceJobs]);

  return (
    <section className="rounded-3xl border border-white/10 bg-white/[0.06] p-4 sm:p-5 shadow-[0_18px_55px_-32px_rgba(0,0,0,0.95)]">
      <div className="overflow-x-auto pb-1">
        <div className="inline-flex items-center gap-2 min-w-full sm:min-w-0">
          <TabButton
            label="Overview"
            active={activeTab === "overview"}
            onClick={() => setActiveTab("overview")}
          />
          <TabButton
            label="Hiring"
            active={activeTab === "hiring"}
            onClick={() => setActiveTab("hiring")}
          />
          <TabButton
            label="Working"
            active={activeTab === "working"}
            onClick={() => setActiveTab("working")}
          />
          <TabButton
            label="Saved"
            active={activeTab === "saved"}
            onClick={() => setActiveTab("saved")}
          />
        </div>
      </div>

      <div className="mt-4">
        {activeTab === "overview" ? (
          <div className="grid gap-3 md:grid-cols-2">
            <SubCard title="Skills & tools">
              <div className="flex flex-wrap gap-2">
                <TagPill>Premiere Pro</TagPill>
                <TagPill>After Effects</TagPill>
                <TagPill>Thumbnail design</TagPill>
                <TagPill>Content strategy</TagPill>
              </div>
            </SubCard>

            <SubCard title="Portfolio links">
              <ul className="space-y-1.5">
                <li className="text-white/65">Add links to your best work from Portfolio</li>
                <li className="text-muted">youtube.com/@yourchannel</li>
                <li className="text-muted">behance.net/yourprofile</li>
              </ul>
            </SubCard>

            <SubCard title="Availability">
              <p className="text-white/65">
                Set your weekly availability and preferred project cadence.
              </p>
            </SubCard>
          </div>
        ) : null}

        {activeTab === "hiring" ? (
          <div className="space-y-3">
            <div>
              <h3 className="text-sm font-semibold text-white/90">Your posted jobs</h3>
              <p className="mt-1 text-xs text-muted">
                Recent jobs you posted
              </p>
            </div>

            {recentJobs.length ? (
              <div className="space-y-2">
                {recentJobs.map((job) => (
                  <article
                    key={job.id}
                    className="rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-white/90 truncate">
                          {formatListingTitle(job.title)}
                        </p>
                        <p className="mt-1 text-xs text-white/55 truncate">
                          {job.channel.name} | {job.category}
                        </p>
                      </div>
                      <span className="text-xs text-muted whitespace-nowrap">
                        {job.postedShort}
                      </span>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-6 text-center">
                <p className="text-sm text-white/70">No jobs posted yet.</p>
              </div>
            )}
          </div>
        ) : null}

        {activeTab === "working" ? (
          <EmptyState
            title="You haven't applied to any jobs yet."
            ctaLabel="Browse jobs"
          />
        ) : null}

        {activeTab === "saved" ? (
          <EmptyState title="No saved jobs yet." ctaLabel="Browse jobs" />
        ) : null}
      </div>
    </section>
  );
}
