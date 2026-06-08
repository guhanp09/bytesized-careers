"use client";

import React, { useMemo, useState } from "react";
import { CATEGORIES, START_TIME_VALUES } from "../lib/jobs";
import { formatStartFilterLabel } from "../lib/format";
import { StartTimeframe, Job } from "../lib/types";
import { JobCard } from "./JobCard";

function Chip({
  label,
  active,
  onClick,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={[
        "cursor-pointer px-3 py-1.5 rounded-lg text-sm whitespace-nowrap transition-colors",
        active ? "bg-white text-black" : "bg-white/10 text-white hover:bg-white/15",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

export default function JobGridClient({
  jobs,
  notice,
}: {
  jobs: Job[];
  notice?: string | null;
}) {
  const [activeCat, setActiveCat] = useState<(typeof CATEGORIES)[number]>("All");
  const [startOpen, setStartOpen] = useState(false);
  const [selectedStarts, setSelectedStarts] = useState<StartTimeframe[]>([]);

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

  return (
    <main className="text-white bg-[#0b0b0f] min-h-[calc(100vh-56px)]">
      {/* FIXED filters bar: behaves like YouTube chips row (does NOT scroll) */}
      <div className="fixed top-14 left-20 right-0 z-30 bg-[#0b0b0f]/92 backdrop-blur">
        <div className="px-3 sm:px-4 py-2 overflow-x-auto">
          <div className="flex items-center gap-2 w-max">
            {CATEGORIES.map((c) => (
              <Chip key={c} label={c} active={activeCat === c} onClick={() => setActiveCat(c)} />
            ))}

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
      </div>

      {/* Scrollable content starts BELOW the fixed filters bar */}
      <section className="px-4 sm:px-6 py-8 pt-24">
        {notice ? (
          <div className="mb-6 rounded-2xl border border-white/12 bg-white/[0.06] px-4 py-3 text-sm text-white/85">
            {notice}
          </div>
        ) : null}
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.length === 0 ? (
            <div className="col-span-full rounded-2xl border border-white/10 bg-white/[0.05] px-5 py-6 text-sm text-white/70">
              No jobs found
            </div>
          ) : (
            filtered.map((job) => <JobCard key={job.id} job={job} />)
          )}
        </div>
      </section>
    </main>
  );
}
