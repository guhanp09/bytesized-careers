"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { unsaveJob, unsaveTalentListing } from "../lib/backendClient";
import { formatListingTitle } from "../lib/displayText";
import { Icon } from "./Icons";
import { StateCard, TagPill } from "./ui";

export type SavedJobView = {
  savedId: string;
  jobId: string;
  title: string;
  identity: string;
  budget: string;
  location: string;
  tags: string[];
};

export type SavedTalentView = {
  savedId: string;
  listingId: string;
  title: string;
  name: string;
  profileHref?: string | null;
  rate: string;
  location: string;
  tags: string[];
  workSamplesCount: number;
};

function EmptyState({ label }: { label: string }) {
  return (
    <StateCard icon="bookmark" title={label} description="Save a few roles or listings to build a shortlist you can come back to." />
  );
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-xl border border-white/10 bg-white/[0.05] text-white/70 transition hover:bg-white/[0.1] hover:text-white"
    >
      {children}
    </button>
  );
}

function TagRow({ tags }: { tags: string[] }) {
  const visible = tags.slice(0, 3);
  const extra = tags.length - visible.length;
  return (
    <div className="mt-4 flex flex-wrap gap-1.5">
      {visible.map((tag) => (
        <TagPill key={tag}>{tag}</TagPill>
      ))}
      {extra > 0 ? (
        <span className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/55">
          +{extra}
        </span>
      ) : null}
    </div>
  );
}

export default function SavedLibraryClient({
  jobs,
  talent,
}: {
  jobs: SavedJobView[];
  talent: SavedTalentView[];
}) {
  const router = useRouter();
  const { data: session } = useSession();
  const [tab, setTab] = React.useState<"jobs" | "talent">("jobs");
  const [jobItems, setJobItems] = React.useState(jobs);
  const [talentItems, setTalentItems] = React.useState(talent);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [feedback, setFeedback] = React.useState<string | null>(null);

  const removeJob = async (event: React.MouseEvent<HTMLButtonElement>, item: SavedJobView) => {
    event.stopPropagation();
    const token = session?.backendAccessToken;
    if (!token) return;
    setBusyId(item.savedId);
    try {
      await unsaveJob(token, item.jobId);
      setJobItems((current) => current.filter((entry) => entry.savedId !== item.savedId));
    } finally {
      setBusyId(null);
    }
  };

  const removeTalent = async (event: React.MouseEvent<HTMLButtonElement>, item: SavedTalentView) => {
    event.stopPropagation();
    const token = session?.backendAccessToken;
    if (!token) return;
    setBusyId(item.savedId);
    try {
      await unsaveTalentListing(token, item.listingId);
      setTalentItems((current) => current.filter((entry) => entry.savedId !== item.savedId));
    } finally {
      setBusyId(null);
    }
  };

  const share = async (event: React.MouseEvent<HTMLButtonElement>, href: string) => {
    event.stopPropagation();
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    if (!origin) return;
    await navigator.clipboard?.writeText(`${origin}${href}`);
    setFeedback("Link copied");
    window.setTimeout(() => setFeedback(null), 1800);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-1.5">
        {[
          { id: "jobs" as const, label: `Jobs ${jobItems.length}` },
          { id: "talent" as const, label: `Talent ${talentItems.length}` },
        ].map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={[
              "cursor-pointer rounded-xl px-3 py-2 text-sm font-semibold transition",
              tab === item.id
                ? "bg-white text-black shadow-[0_12px_30px_-24px_rgba(0,0,0,1)]"
                : "text-white/65 hover:bg-white/[0.06] hover:text-white",
            ].join(" ")}
          >
            {item.label}
          </button>
        ))}
        </div>
        <p className="text-xs text-white/42">{feedback || "Your shortlist stays private to your account."}</p>
      </div>

      {tab === "jobs" ? (
        jobItems.length ? (
          <div className="grid gap-4 lg:grid-cols-2">
            {jobItems.map((item) => {
              const href = `/jobs/${encodeURIComponent(item.jobId)}`;
              return (
                <article
                  key={item.savedId}
                  role="link"
                  tabIndex={0}
                  onClick={() => router.push(href)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      router.push(href);
                    }
                  }}
                  className="group flex min-h-[210px] cursor-pointer flex-col rounded-2xl border border-white/10 bg-white/[0.055] p-5 transition hover:-translate-y-0.5 hover:border-white/20 hover:bg-white/[0.075] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
                >
                  <p className="text-sm font-semibold text-white/82">{item.identity}</p>
                  <h2 className="mt-3 line-clamp-2 text-lg font-extrabold leading-tight text-white">
                    {formatListingTitle(item.title)}
                  </h2>
                  <div className="mt-4 space-y-2 text-sm text-white/68">
                    <p>{item.budget}</p>
                    <p>{item.location}</p>
                  </div>
                  <TagRow tags={item.tags} />
                  <div className="mt-auto flex items-center justify-end gap-2 pt-4">
                    <IconButton label="Share job" onClick={(event) => void share(event, href)}>
                      <Icon name="share" className="h-4 w-4" />
                    </IconButton>
                    <IconButton label={busyId === item.savedId ? "Removing" : "Remove saved job"} onClick={(event) => void removeJob(event, item)}>
                      <Icon name="bookmark" className={busyId === item.savedId ? "h-4 w-4 opacity-45" : "h-4 w-4"} />
                    </IconButton>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <EmptyState label="Saved jobs will appear here." />
        )
      ) : talentItems.length ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {talentItems.map((item) => {
            const href = `/talent/${encodeURIComponent(item.listingId)}`;
            return (
              <article
                key={item.savedId}
                role="link"
                tabIndex={0}
                onClick={() => router.push(href)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    router.push(href);
                  }
                }}
                className="group flex min-h-[230px] cursor-pointer flex-col rounded-2xl border border-white/10 bg-white/[0.055] p-5 transition hover:-translate-y-0.5 hover:border-white/20 hover:bg-white/[0.075] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
              >
                <div className="min-w-0">
                  {item.profileHref ? (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        router.push(item.profileHref || "");
                      }}
                      className="cursor-pointer truncate rounded-sm text-left text-sm font-semibold text-white/82 hover:text-white hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
                    >
                      {item.name}
                    </button>
                  ) : (
                    <p className="truncate text-sm font-semibold text-white/82">{item.name}</p>
                  )}
                </div>
                <h2 className="mt-3 line-clamp-2 text-lg font-extrabold leading-tight text-white">
                  {formatListingTitle(item.title)}
                </h2>
                <div className="mt-4 space-y-2 text-sm text-white/68">
                  <p>{item.rate}</p>
                  <p>{item.location}</p>
                  {item.workSamplesCount > 0 ? <p>{item.workSamplesCount} work samples</p> : null}
                </div>
                <TagRow tags={item.tags} />
                <div className="mt-auto flex items-center justify-end gap-2 pt-4">
                  <IconButton label="Share talent listing" onClick={(event) => void share(event, href)}>
                    <Icon name="share" className="h-4 w-4" />
                  </IconButton>
                  <IconButton label={busyId === item.savedId ? "Removing" : "Remove saved talent"} onClick={(event) => void removeTalent(event, item)}>
                    <Icon name="bookmark" className={busyId === item.savedId ? "h-4 w-4 opacity-45" : "h-4 w-4"} />
                  </IconButton>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <EmptyState label="Saved talent listings will appear here." />
      )}
    </div>
  );
}
