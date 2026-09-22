import { Icon } from "../Icons";
import { Reveal } from "../ui";

type IconName = Parameters<typeof Icon>[0]["name"];

const items: Array<{ icon: IconName; title: string; body: string }> = [
  {
    icon: "shield",
    title: "Profile context in one place",
    body: "Profiles can show roles, tools, availability, and selected work samples before a conversation starts.",
  },
  {
    icon: "trending-up",
    title: "Creator-native role details",
    body: "Browse editors, writers, strategists, and operators with channel, format, and workflow context.",
  },
  {
    icon: "clock",
    title: "Applications and requests together",
    body: "Send applications or hiring requests, then review messages and next steps in one workspace.",
  },
  {
    icon: "bolt",
    title: "Free during beta",
    body: "No payment method is required to apply, post jobs, or publish talent listings during the beta.",
  },
];

export function HomeWhySection() {
  return (
    <section className="space-y-8">
      <Reveal>
        <div className="flex flex-col items-center text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-subtle">Why CreatorJobs</p>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            Everything creator work needs
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-white/55">
            Creator-native jobs, talent, and hiring workflows — built for YouTube, Instagram, Shorts, and everything in
            between.
          </p>
        </div>
      </Reveal>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((item, index) => (
          <Reveal key={item.title} delay={80 + index * 70} className="h-full">
            <div className="flex h-full flex-col gap-3 rounded-3xl border border-white/[0.07] bg-white/[0.028] p-5 transition-colors hover:border-white/15 hover:bg-white/[0.045]">
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-white/12 bg-white/[0.08] text-white shadow-[0_14px_34px_-20px_rgba(255,255,255,0.45)]">
                <Icon name={item.icon} className="h-5 w-5" />
              </span>
              <p className="text-sm font-semibold text-white">{item.title}</p>
              <p className="text-[13px] leading-6 text-muted">{item.body}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
