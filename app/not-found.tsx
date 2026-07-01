import Link from "next/link";

import { PageHeader, StateCard } from "../components/ui";

const primaryButton =
  "inline-flex h-10 cursor-pointer items-center justify-center rounded-xl bg-white px-4 text-sm font-semibold text-black transition hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30";
const secondaryButton =
  "inline-flex h-10 cursor-pointer items-center justify-center rounded-xl border border-white/[0.1] bg-white/[0.045] px-4 text-sm font-semibold text-white/78 transition hover:-translate-y-0.5 hover:border-white/[0.18] hover:bg-white/[0.075] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20";

export default function NotFound() {
  return (
    <main className="min-h-[calc(100vh-56px)] bg-[#0b0b0f] px-4 py-10 text-white sm:px-6">
      <section className="mx-auto max-w-3xl space-y-6">
        <PageHeader
          title="Page not found"
          description="The page you’re looking for doesn’t exist, moved, or the listing was removed."
        />
        <StateCard
          icon="search"
          title="We couldn’t find that page."
          description="Check the link, or head back to browse open jobs and talent."
          action={
            <div className="flex flex-wrap gap-2.5">
              <Link href="/" className={primaryButton}>
                Go home
              </Link>
              <Link href="/jobs" className={secondaryButton}>
                Browse jobs
              </Link>
              <Link href="/talent" className={secondaryButton}>
                Browse talent
              </Link>
            </div>
          }
        />
      </section>
    </main>
  );
}
