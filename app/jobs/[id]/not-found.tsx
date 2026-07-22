import Link from "next/link";

import { PageHeader, StateCard } from "../../../components/ui";

const primaryButton =
  "inline-flex h-10 cursor-pointer items-center justify-center rounded-xl bg-white px-4 text-sm font-semibold text-black transition hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30";
const secondaryButton =
  "inline-flex h-10 cursor-pointer items-center justify-center rounded-xl border border-white/[0.1] bg-white/[0.045] px-4 text-sm font-semibold text-white/78 transition hover:border-white/[0.18] hover:bg-white/[0.075] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20";

export default function JobNotFound() {
  return (
    <main className="min-h-[calc(100vh-56px)] bg-[#0b0b0f] px-4 py-10 text-white sm:px-6">
      <section className="mx-auto max-w-3xl space-y-6">
        <PageHeader
          title="Job no longer available"
          description="This listing is not currently available to candidates. It may have closed, paused, moved, or been removed."
        />
        <StateCard
          icon="briefcase"
          title="You can’t apply to this listing right now."
          description="Browse current jobs to find roles that are still accepting applications."
          action={
            <div className="flex flex-wrap gap-2.5">
              <Link href="/jobs" className={primaryButton}>
                Browse open jobs
              </Link>
              <Link href="/you?tab=saved" className={secondaryButton}>
                View saved jobs
              </Link>
            </div>
          }
        />
      </section>
    </main>
  );
}
