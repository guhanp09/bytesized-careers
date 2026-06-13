"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { BackendTalentListing } from "../lib/backendClient";
import TalentCard from "./TalentCard";

type TalentFilter = {
  label: string;
  match: (item: BackendTalentListing) => boolean;
};

const textFor = (item: BackendTalentListing) =>
  [
    item.title,
    item.primary_role,
    item.experience_level,
    item.niche,
    item.location,
    item.timezone,
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
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "cursor-pointer rounded-lg px-3 py-1.5 text-sm whitespace-nowrap transition-colors",
        active ? "bg-white text-black" : "bg-white/10 text-white hover:bg-white/15",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

export default function TalentFeedClient({ items, notice }: { items: BackendTalentListing[]; notice?: string | null }) {
  const [active, setActive] = useState("All");
  const hasActiveFilter = active !== "All";

  const filtered = useMemo(() => {
    const selected = FILTERS.find((filter) => filter.label === active) || FILTERS[0];
    return items.filter(selected.match);
  }, [active, items]);

  return (
    <main className="min-h-[calc(100vh-56px)] bg-[#0b0b0f] text-white">
      <div className="fixed left-20 right-0 top-14 z-30 bg-[#0b0b0f]/92 backdrop-blur">
        <div className="overflow-x-auto px-3 py-2 sm:px-4">
          <div className="flex w-max items-center gap-2">
            {FILTERS.map((filter) => (
              <Chip
                key={filter.label}
                label={filter.label}
                active={active === filter.label}
                onClick={() => setActive(filter.label)}
              />
            ))}
          </div>
        </div>
      </div>

      <section className="px-4 py-8 pt-24 sm:px-6">
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
            {filtered.map((item) => (
              <TalentCard key={item.id} item={item} />
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-white/10 bg-white/[0.05] px-5 py-6 text-sm text-white/70">
            <p className="font-semibold text-white/85">
              {items.length ? "No talent listings found." : "No talent listings yet."}
            </p>
            <p className="mt-1 text-white/55">
              {items.length
                ? "Try a different filter or clear filters."
                : "Create the first talent listing."}
            </p>
            {hasActiveFilter ? (
              <button
                type="button"
                onClick={() => setActive("All")}
                className="mt-4 cursor-pointer rounded-xl border border-white/12 bg-white/[0.06] px-3 py-1.5 text-xs font-semibold text-white/75 transition-colors hover:border-white/20 hover:bg-white/[0.1] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/25"
              >
                Clear filters
              </button>
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
