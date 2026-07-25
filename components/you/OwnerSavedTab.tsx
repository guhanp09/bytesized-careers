"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { getSavedSummary, isLocalMocksEnabled, type SavedSummary } from "../../lib/backendClient";
import { JobCard } from "../JobCard";
import TalentCard from "../TalentCard";

type LoadState = "loading" | "ready" | "error";

/**
 * Owner Saved tab inside /you. Loads the real saved jobs + talent for the
 * signed-in user (same data as the /saved library) and reuses JobCard/TalentCard
 * so the tab is never a false-empty stub.
 */
export default function OwnerSavedTab({ backendAccessToken }: { backendAccessToken?: string }) {
  const live = Boolean(backendAccessToken) && !isLocalMocksEnabled();
  const [summary, setSummary] = useState<SavedSummary | null>(null);
  const [loadState, setLoadState] = useState<LoadState>(live ? "loading" : "ready");
  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => {
    if (!live || !backendAccessToken) return;
    let cancelled = false;
    getSavedSummary(backendAccessToken)
      .then((data) => {
        if (cancelled) return;
        setSummary(data);
        setLoadState("ready");
      })
      .catch(() => {
        if (!cancelled) setLoadState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [live, backendAccessToken, reloadNonce]);

  const savedJobs = (summary?.jobs ?? []).map((row) => row.job).filter((job): job is NonNullable<typeof job> => Boolean(job));
  const savedTalent = (summary?.talent ?? [])
    .map((row) => row.talent)
    .filter((talent): talent is NonNullable<typeof talent> => Boolean(talent));
  const isEmpty = savedJobs.length === 0 && savedTalent.length === 0;

  if (live && loadState === "loading") {
    return (
      <div className="w-full max-w-7xl rounded-2xl border border-white/10 bg-white/[0.03] px-6 py-12 text-center text-sm text-white/55">
        Loading your saved items…
      </div>
    );
  }

  if (live && loadState === "error") {
    return (
      <div className="w-full max-w-7xl rounded-2xl border border-white/10 bg-white/[0.03] px-6 py-12 text-center">
        <p className="text-sm text-white/70">Couldn’t load your saved items right now.</p>
        <button
          type="button"
          onClick={() => {
            setLoadState("loading");
            setReloadNonce((n) => n + 1);
          }}
          className="mt-4 inline-flex h-9 cursor-pointer items-center justify-center rounded-xl border border-white/15 bg-white/[0.04] px-3.5 text-xs font-semibold text-white/80 transition-colors hover:bg-white/[0.08]"
        >
          Retry
        </button>
      </div>
    );
  }

  if (isEmpty) {
    return (
      <div className="w-full max-w-7xl rounded-2xl border border-white/10 bg-white/[0.04] px-6 py-12 text-center">
        <p className="text-sm text-white/70">Nothing saved yet.</p>
        <p className="mx-auto mt-1.5 max-w-md text-xs text-muted">
          Save jobs and talent while browsing to keep your shortlist together here.
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
          <Link
            href="/jobs"
            className="inline-flex h-10 cursor-pointer items-center justify-center rounded-xl bg-white px-4 text-sm font-semibold text-black transition-colors hover:bg-white/90"
          >
            Browse jobs
          </Link>
          <Link
            href="/talent"
            className="inline-flex h-10 cursor-pointer items-center justify-center rounded-xl border border-white/15 bg-white/[0.04] px-4 text-sm font-semibold text-white/80 transition-colors hover:bg-white/[0.08]"
          >
            Browse talent
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-7xl space-y-8">
      {savedJobs.length > 0 ? (
        <section className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-white/90">Saved jobs</h3>
            <Link href="/saved" className="cursor-pointer text-xs font-semibold text-white/55 hover:text-white">
              Open saved library →
            </Link>
          </div>
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {savedJobs.map((job) => (
              <JobCard key={`saved-job-${job.id}`} job={job} />
            ))}
          </div>
        </section>
      ) : null}

      {savedTalent.length > 0 ? (
        <section className="space-y-4">
          <h3 className="text-sm font-semibold text-white/90">Saved talent</h3>
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {savedTalent.map((talent) => (
              <TalentCard key={`saved-talent-${talent.id}`} item={talent} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
