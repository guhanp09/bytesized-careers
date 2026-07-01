"use client";

import Link from "next/link";
import { useEffect } from "react";

import { PageHeader, StateCard } from "../components/ui";

const primaryButton =
  "inline-flex h-10 cursor-pointer items-center justify-center rounded-xl bg-white px-4 text-sm font-semibold text-black transition hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30";
const secondaryButton =
  "inline-flex h-10 cursor-pointer items-center justify-center rounded-xl border border-white/[0.1] bg-white/[0.045] px-4 text-sm font-semibold text-white/78 transition hover:-translate-y-0.5 hover:border-white/[0.18] hover:bg-white/[0.075] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20";

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface for local debugging; wire to an error tracker (e.g. Sentry) later.
    console.error("Route error:", error);
  }, [error]);

  return (
    <main className="min-h-[calc(100vh-56px)] bg-[#0b0b0f] px-4 py-10 text-white sm:px-6">
      <section className="mx-auto max-w-3xl space-y-6">
        <PageHeader
          title="Something went wrong"
          description="An unexpected error interrupted this page. Your account and saved work are safe."
        />
        <StateCard
          icon="alert"
          title="This page hit an unexpected error."
          description="Try again — if it keeps happening, head back home or let us know through support."
          action={
            <div className="flex flex-wrap gap-2.5">
              <button type="button" onClick={() => reset()} className={primaryButton}>
                Try again
              </button>
              <Link href="/" className={secondaryButton}>
                Go home
              </Link>
              <Link href="/support" className={secondaryButton}>
                Contact support
              </Link>
            </div>
          }
        />
      </section>
    </main>
  );
}
