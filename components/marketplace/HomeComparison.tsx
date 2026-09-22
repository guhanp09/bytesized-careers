import { Icon } from "../Icons";
import { Reveal } from "../ui";

// Product behavior implemented in the current beta. Keeping this as a finite
// capability list avoids unsupported external comparisons.
const rows: Array<{ feature: string; detail: string }> = [
  {
    feature: "Creator-native job and talent listings",
    detail: "Browse published roles and public talent listings.",
  },
  {
    feature: "One profile to look for work and hire",
    detail: "Use the same account across both marketplace paths.",
  },
  {
    feature: "Applications and hiring requests",
    detail: "Start a conversation from either side of the marketplace.",
  },
  {
    feature: "Portfolio-based public profiles",
    detail: "Show selected work samples and creator-work context.",
  },
  {
    feature: "Saved jobs and talent",
    detail: "Keep both kinds of listing in one saved workspace.",
  },
  {
    feature: "Messaging and pipeline workspaces",
    detail: "Review conversations and record application next steps.",
  },
];

const GRID = "lg:grid lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1.4fr)]";

// The detail column carries a restrained cool tint so implemented behavior is
// visually distinct from each capability label.
const COL = {
  feature: { head: "bg-white/[0.02]", body: "" },
  cj: { head: "bg-[#4a68be21]", body: "bg-[#4a68be0f]" },
};
const VRULE = "lg:border-l lg:border-white/[0.06]";

export function HomeComparison() {
  return (
    <section className="space-y-8" data-testid="home-comparison">
      <Reveal>
        <div className="flex flex-col items-center text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-subtle">Product capabilities</p>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            Creator hiring in one workspace
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
              Capability
            </div>
            <div
              className={`px-5 py-4 text-center text-sm font-semibold text-white lg:flex lg:items-center lg:justify-center ${COL.cj.head} ${VRULE}`}
            >
              Available in CreatorJobs beta
            </div>
          </div>

          {rows.map((row, index) => (
            <div key={row.feature} className={`${GRID} ${index > 0 ? "border-t border-white/[0.05]" : ""}`}>
              <div
                className={`px-5 pb-1 pt-5 text-sm leading-6 text-white/85 lg:flex lg:items-center lg:justify-center lg:py-5 lg:text-center ${COL.feature.body}`}
              >
                {row.feature}
              </div>

              <div className={`flex items-start gap-2.5 px-5 pb-5 pt-2 lg:items-center lg:py-5 ${COL.cj.body} ${VRULE}`}>
                <Icon name="check" className="h-[18px] w-[18px] shrink-0 text-white/90" />
                <span className="text-sm leading-6 text-white/62">{row.detail}</span>
              </div>
            </div>
          ))}
        </div>
      </Reveal>
    </section>
  );
}
