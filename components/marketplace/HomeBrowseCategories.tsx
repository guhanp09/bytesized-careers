import Link from "next/link";

import { Icon } from "../Icons";
import { Reveal } from "../ui";

type IconName = Parameters<typeof Icon>[0]["name"];

// Creator-economy role categories. Each card opens the jobs feed filtered by a search
// term using the same ?q= convention the roles marquee already uses — no job counts are
// shown. `query` is the search keyword that best matches real listings for the role.
const categories: Array<{ label: string; icon: IconName; query: string }> = [
  { label: "Video Editor", icon: "circle-play", query: "Video editor" },
  { label: "Thumbnail Designer", icon: "image", query: "Thumbnail designer" },
  { label: "Shorts Editor", icon: "youtube", query: "Shorts editor" },
  { label: "Designer", icon: "pencil", query: "Designer" },
  { label: "Motion Graphics Artist", icon: "bolt", query: "Motion graphics" },
  { label: "Script Writer", icon: "file", query: "Script writer" },
  { label: "Voice Over Artist", icon: "mic", query: "Voice" },
  { label: "Channel Manager", icon: "trending-up", query: "Channel manager" },
  { label: "Creative Director", icon: "briefcase", query: "Creative director" },
];

export function HomeBrowseCategories() {
  return (
    <section className="space-y-6" data-testid="browse-categories">
      <Reveal>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/35">Explore</p>
            <h2 className="mt-2 inline-flex items-center gap-2 text-xl font-semibold tracking-tight text-white">
              <Icon name="layout-grid" className="h-5 w-5 text-white/55" />
              <span>Browse by category</span>
            </h2>
          </div>
          <Link
            href="/jobs"
            className="group/link inline-flex h-9 w-fit shrink-0 items-center gap-1.5 rounded-full border border-white/12 bg-white/[0.04] px-4 text-sm font-semibold text-white/80 transition-colors hover:border-white/25 hover:bg-white/[0.07] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/25 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0b0f]"
          >
            All categories
            <span
              aria-hidden="true"
              className="inline-block transition-transform group-hover/link:translate-x-0.5 motion-reduce:transition-none"
            >
              →
            </span>
          </Link>
        </div>
      </Reveal>

      <Reveal delay={80}>
        <div
          data-testid="browse-categories-row"
          className="-mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {categories.map((category) => (
            <Link
              key={category.label}
              href={`/jobs?q=${encodeURIComponent(category.query)}`}
              className="group flex h-[152px] w-[156px] shrink-0 snap-start flex-col items-center justify-center gap-3.5 rounded-2xl border border-white/[0.07] bg-white/[0.028] px-4 text-center transition-colors hover:border-white/15 hover:bg-white/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/25 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0b0f]"
            >
              <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.06] text-white/85 transition-colors group-hover:bg-white/[0.1] group-hover:text-white">
                <Icon name={category.icon} className="h-5 w-5" />
              </span>
              {/*
               * Reserve two lines of label height so cards whose labels wrap
               * (e.g. "Thumbnail Designer", "Motion Graphics Artist") aren't
               * taller than single-line cards. Equal content height keeps the
               * vertically-centered icon chips aligned across the row.
               */}
              <span className="min-h-[2.5rem] text-sm font-semibold leading-snug text-white">{category.label}</span>
            </Link>
          ))}
        </div>
      </Reveal>
    </section>
  );
}
