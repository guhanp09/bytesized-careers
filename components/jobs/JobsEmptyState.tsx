"use client";

import Link from "next/link";
import { Icon } from "../Icons";

type JobsEmptyStateProps = {
  owner: boolean;
};

export default function JobsEmptyState({ owner }: JobsEmptyStateProps) {
  return (
    <section className="relative isolate min-h-[280px] overflow-hidden rounded-3xl border border-white/10 bg-[#101115] px-6 py-10 text-center shadow-[0_24px_80px_-52px_rgba(0,0,0,1)] sm:min-h-[320px] sm:px-10">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_34%,rgba(255,255,255,0.11),transparent_28%),radial-gradient(circle_at_15%_80%,rgba(255,255,255,0.055),transparent_28%),linear-gradient(180deg,rgba(255,255,255,0.045),rgba(255,255,255,0.015)_45%,rgba(0,0,0,0.18))]" />
      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:46px_46px] opacity-[0.16] [mask-image:radial-gradient(circle_at_center,black,transparent_72%)]" />

      <div className="pointer-events-none absolute left-1/2 top-1/2 h-56 w-56 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/[0.055] opacity-80 sm:h-64 sm:w-64">
        <div className="absolute inset-x-0 top-1/2 border-t border-white/[0.05]" />
        <div className="absolute inset-y-0 left-1/2 border-l border-white/[0.045]" />
        <div className="absolute left-1/2 top-0 h-full w-20 -translate-x-1/2 rounded-full border border-white/[0.04]" />
      </div>
      <div className="pointer-events-none absolute -left-8 bottom-12 h-20 w-44 rotate-[-8deg] rounded-2xl border border-white/[0.055] bg-white/[0.025] blur-[0.2px]" />
      <div className="pointer-events-none absolute -right-6 top-12 h-16 w-40 rotate-[9deg] rounded-2xl border border-white/[0.05] bg-white/[0.02] blur-[0.2px]" />
      <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-[#101115] to-transparent" />

      <div className="relative z-10 mx-auto flex min-h-[200px] max-w-md flex-col items-center justify-center sm:min-h-[240px]">
        <div className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.045] text-white/72 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
          <Icon name="globe" className="h-5 w-5" />
        </div>
        <h3 className="text-lg font-semibold tracking-tight text-white/92">
          {owner ? "No jobs posted yet." : "No open jobs right now."}
        </h3>
        {owner ? (
          <p className="mt-2 max-w-sm text-sm leading-relaxed text-white/56">
            Start hiring content creators, editors, designers, writers, and collaborators.
          </p>
        ) : null}
        {owner ? (
          <Link
            href="/post-job"
            className="mt-6 inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-full bg-white px-4 text-xs font-bold uppercase tracking-[0.12em] text-black transition-colors hover:bg-white/90"
          >
            <Icon name="globe" className="h-4 w-4" />
            Post a job
          </Link>
        ) : null}
      </div>
    </section>
  );
}
