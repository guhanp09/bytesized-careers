import { Icon } from "../Icons";
import { Reveal } from "../ui";

// Feature/benefit comparison vs. generic freelance marketplaces — no competitor names.
const rows: string[] = [
  "Profiles & listings designed around the needs of the creator economy",
  "One login to hire and get hired",
  "UPI payments",
  "Live jobs + talent listings",
  "Unlimited free applications & hires",
  "Portfolio-driven talent profiles",
];

// `items-stretch` (the grid default) is essential: every cell fills the full row
// height so each column's tint runs continuously top-to-bottom instead of shrinking to
// its content and leaving untinted gaps. Content is centered inside each stretched cell.
const GRID = "lg:grid lg:grid-cols-[1.5fr_1fr_1fr]";

// Subtle per-column tonal variation. The CreatorJobs column carries a restrained cool
// (navy/indigo-charcoal) tint so it reads as the "hero" column; the other two stay
// neutral-dark but tonally distinct. Header cells are a touch stronger than body cells.
const COL = {
  feature: { head: "bg-white/[0.02]", body: "" },
  // Cool navy/indigo-charcoal tint as 8-digit hex (#rrggbbaa) so Tailwind reliably
  // emits it — header ~13% alpha, body ~6% alpha.
  cj: { head: "bg-[#4a68be21]", body: "bg-[#4a68be0f]" },
  general: { head: "bg-white/[0.03]", body: "bg-white/[0.018]" },
};
// Soft vertical separators on desktop that bound the CreatorJobs panel.
const VRULE = "lg:border-l lg:border-white/[0.06]";

export function HomeComparison() {
  return (
    <section className="space-y-8" data-testid="home-comparison">
      <Reveal>
        <div className="flex flex-col items-center text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-subtle">Comparison</p>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            Built for creator hiring, not generic freelancing
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-white/55">
            CreatorJobs is designed around creator-native roles, channel context, portfolios, and hiring workflows.
          </p>
        </div>
      </Reveal>

      <Reveal delay={80}>
        <div className="mx-auto w-full max-w-5xl overflow-hidden rounded-3xl border border-white/[0.08] bg-white/[0.012] shadow-[0_40px_90px_-60px_rgba(0,0,0,0.95)]">
          {/* Column headers (desktop only; mobile rows carry their own labels) */}
          <div className={`hidden ${GRID} border-b border-white/[0.08]`}>
            <div
              className={`px-5 py-4 text-center text-sm font-semibold text-white/55 lg:flex lg:items-center lg:justify-center ${COL.feature.head}`}
            >
              Feature / Benefit
            </div>
            <div
              className={`px-5 py-4 text-center text-sm font-semibold text-white lg:flex lg:items-center lg:justify-center ${COL.cj.head} ${VRULE}`}
            >
              CreatorJobs
            </div>
            <div
              className={`px-5 py-4 text-center text-sm font-semibold text-white/55 lg:flex lg:items-center lg:justify-center ${COL.general.head} ${VRULE}`}
            >
              General Freelance Platforms
            </div>
          </div>

          {rows.map((feature, index) => (
            <div key={feature} className={`${GRID} ${index > 0 ? "border-t border-white/[0.05]" : ""}`}>
              {/* Feature / Benefit */}
              <div
                className={`px-5 pb-1 pt-5 text-sm leading-6 text-white/85 lg:flex lg:items-center lg:justify-center lg:py-5 lg:text-center ${COL.feature.body}`}
              >
                {feature}
              </div>

              {/* CreatorJobs — included */}
              <div className={`flex items-center gap-2.5 px-5 pb-1 pt-1 lg:justify-center lg:py-5 ${COL.cj.body} ${VRULE}`}>
                <span
                  aria-hidden="true"
                  className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted lg:hidden"
                >
                  CreatorJobs
                </span>
                <Icon name="check" className="h-[18px] w-[18px] shrink-0 text-white/90" />
                <span className="sr-only">CreatorJobs: yes</span>
              </div>

              {/* General freelance platforms — not included */}
              <div className={`flex items-center gap-2.5 px-5 pb-4 pt-1 lg:justify-center lg:py-5 ${COL.general.body} ${VRULE}`}>
                <span
                  aria-hidden="true"
                  className="text-[11px] font-semibold uppercase tracking-[0.14em] text-subtle lg:hidden"
                >
                  General Freelance Platforms
                </span>
                <Icon name="close" className="h-[18px] w-[18px] shrink-0 text-subtle" />
                <span className="sr-only">General freelance platforms: no</span>
              </div>
            </div>
          ))}
        </div>
      </Reveal>
    </section>
  );
}
