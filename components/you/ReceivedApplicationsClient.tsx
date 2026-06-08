"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Icon } from "../Icons";
import RatingDisplay from "../RatingDisplay";
import { ReceivedApplicant } from "../../lib/mockApplications";

type ReceivedApplicationsClientProps = {
  applicants: ReceivedApplicant[];
};

const join = (...classes: Array<string | false | null | undefined>) =>
  classes.filter(Boolean).join(" ");

const getInitials = (name: string) => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "AP";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase();
};

export default function ReceivedApplicationsClient({
  applicants,
}: ReceivedApplicationsClientProps) {
  const [query, setQuery] = useState("");
  const [selectedApplicantId, setSelectedApplicantId] = useState<string | null>(
    applicants[0]?.id || null
  );

  const filteredApplicants = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return applicants;
    return applicants.filter((applicant) =>
      [applicant.name, applicant.username, applicant.jobAppliedToTitle]
        .join(" ")
        .toLowerCase()
        .includes(normalized)
    );
  }, [applicants, query]);

  const selectedApplicant = useMemo(
    () => filteredApplicants.find((item) => item.id === selectedApplicantId) || filteredApplicants[0] || null,
    [filteredApplicants, selectedApplicantId]
  );

  return (
    <main className="min-h-[calc(100vh-56px)] bg-[#0b0b0f] text-white">
      <section className="px-4 sm:px-6 py-8 space-y-4">
        <header className="rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-3">
          <p className="text-sm font-semibold text-white/90">Applications / Received</p>
          <p className="mt-0.5 text-xs text-white/55">
            Preview and triage incoming candidates without leaving the inbox.
          </p>
        </header>

        <div className="grid gap-4 lg:grid-cols-[minmax(280px,320px)_minmax(0,1fr)]">
          <aside className="rounded-3xl border border-white/10 bg-white/[0.06] p-4 sm:p-5 shadow-[0_18px_55px_-32px_rgba(0,0,0,0.95)] min-h-[560px] flex flex-col">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-white/95">Received</h2>
              <span className="text-xs text-white/60">{filteredApplicants.length}</span>
            </div>

            <label className="mt-3 h-9 rounded-xl border border-white/10 bg-white/[0.03] px-3 inline-flex items-center gap-2">
              <Icon name="search" className="h-4 w-4 text-white/45" />
              <input
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search applicant"
                className="w-full bg-transparent text-xs text-white/80 placeholder:text-white/35 outline-none"
              />
            </label>

            <div className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1" style={{ scrollbarGutter: "stable" }}>
              {filteredApplicants.length ? (
                <div className="space-y-1.5">
                  {filteredApplicants.map((applicant) => {
                    const isSelected = selectedApplicant?.id === applicant.id;
                    return (
                      <button
                        key={applicant.id}
                        type="button"
                        onClick={() => setSelectedApplicantId(applicant.id)}
                        className={join(
                          "w-full rounded-xl border px-2.5 py-2.5 text-left transition-colors cursor-pointer",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/25",
                          isSelected
                            ? "border-white/25 bg-white/[0.1]"
                            : "border-white/10 bg-white/[0.03] hover:bg-white/[0.07]"
                        )}
                      >
                        <div className="flex items-start gap-2.5">
                          <span className="h-9 w-9 shrink-0 rounded-full border border-white/15 bg-white/[0.08] inline-flex items-center justify-center text-[11px] font-semibold text-white/85">
                            {getInitials(applicant.name)}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold text-white/90">
                              {applicant.name}
                            </span>
                            <span className="mt-0.5 block">
                              <RatingDisplay />
                            </span>
                            <span className="mt-1 block truncate text-[11px] text-white/50">
                              Applied to: {applicant.jobAppliedToTitle}
                            </span>
                          </span>
                          <span className="text-[10px] text-white/45">{applicant.appliedAt}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-4 text-xs text-white/55">
                  No applicants found.
                </div>
              )}
            </div>
          </aside>

          <section className="rounded-3xl border border-white/10 bg-white/[0.06] p-5 sm:p-6 shadow-[0_18px_55px_-32px_rgba(0,0,0,0.95)] min-h-[560px]">
            {!selectedApplicant ? (
              <div className="h-full min-h-[500px] flex items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03] text-sm text-white/55">
                Select an applicant to preview their profile.
              </div>
            ) : (
              <div className="space-y-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h1 className="text-2xl font-semibold tracking-tight text-white/95">
                      {selectedApplicant.name}
                    </h1>
                    <p className="mt-1 text-sm text-white/55">@{selectedApplicant.username.replace(/^@+/, "")}</p>
                    <p className="mt-2 text-sm text-white/75">{selectedApplicant.headline}</p>
                    <div className="mt-2">
                      <RatingDisplay />
                    </div>
                  </div>

                  <Link
                    href={`/u/${encodeURIComponent(selectedApplicant.username.replace(/^@+/, ""))}?view=talent`}
                    className="inline-flex h-9 items-center justify-center rounded-xl border border-white/15 bg-white/[0.04] px-3 text-xs font-semibold text-white/85 hover:bg-white/[0.1] transition-colors cursor-pointer"
                  >
                    Open full profile
                  </Link>
                </div>

                <article className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                  <h2 className="text-xs uppercase tracking-[0.14em] text-white/45">Applicant summary</h2>
                  <p className="mt-2 text-sm leading-relaxed text-white/75">{selectedApplicant.bio}</p>
                </article>

                <div className="grid gap-3 sm:grid-cols-2">
                  <article className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                    <h2 className="text-xs uppercase tracking-[0.14em] text-white/45">Applied To</h2>
                    <p className="mt-2 text-sm text-white/85">{selectedApplicant.jobAppliedToTitle}</p>
                    <p className="mt-1 text-xs text-white/50">Applied {selectedApplicant.appliedAt}</p>
                  </article>
                  <article className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                    <h2 className="text-xs uppercase tracking-[0.14em] text-white/45">Location / Availability</h2>
                    <p className="mt-2 text-sm text-white/85">{selectedApplicant.location}</p>
                    <p className="mt-1 text-xs text-white/55">{selectedApplicant.availability}</p>
                  </article>
                </div>

                <article className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                  <h2 className="text-xs uppercase tracking-[0.14em] text-white/45">Skills & Tools</h2>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {[...selectedApplicant.skills, ...selectedApplicant.tools].map((item) => (
                      <span
                        key={item}
                        className="inline-flex items-center rounded-lg border border-white/12 bg-white/[0.05] px-2 py-1 text-xs text-white/75"
                      >
                        {item}
                      </span>
                    ))}
                  </div>
                </article>

                <article className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                  <h2 className="text-xs uppercase tracking-[0.14em] text-white/45">Portfolio Links</h2>
                  {selectedApplicant.portfolioLinks.length ? (
                    <ul className="mt-3 space-y-2">
                      {selectedApplicant.portfolioLinks.map((link) => (
                        <li key={link.url}>
                          <a
                            href={link.url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1.5 text-sm text-white/75 hover:text-white transition-colors cursor-pointer"
                          >
                            <Icon name="external-link" className="h-3.5 w-3.5" />
                            <span>{link.label}</span>
                          </a>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-2 text-sm text-white/55">No portfolio links provided.</p>
                  )}
                </article>
              </div>
            )}
          </section>
        </div>
      </section>
    </main>
  );
}
