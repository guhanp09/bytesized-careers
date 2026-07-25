import Link from "next/link";

export function HomeClosingCta() {
  return (
    <section className="home-cta-band relative isolate overflow-hidden rounded-[42px] px-6 py-16 text-center sm:py-20">
      <div className="pointer-events-none absolute inset-0">
        <div className="market-signal-vignette absolute inset-0" />
        <div className="home-grain absolute inset-0" />
      </div>
      <div className="relative z-10 mx-auto max-w-2xl">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-subtle">CreatorJobs</p>
        <h2 className="mt-4 text-4xl font-semibold tracking-tight text-white sm:text-5xl">
          Build your creator team.
        </h2>
        <p className="mx-auto mt-4 max-w-md text-base leading-7 text-white/55">
          Hire for your channel, or get hired for your craft.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/post-job"
            className="home-cta-sheen inline-flex h-11 cursor-pointer items-center justify-center rounded-full bg-white px-6 text-sm font-semibold text-[#0b0b0f] transition-colors hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
          >
            Post a job
          </Link>
          <Link
            href="/you"
            className="inline-flex h-11 cursor-pointer items-center justify-center rounded-full border border-white/15 px-6 text-sm font-semibold text-white/85 transition-colors hover:border-white/30 hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
          >
            Create your profile
          </Link>
        </div>
      </div>
    </section>
  );
}
