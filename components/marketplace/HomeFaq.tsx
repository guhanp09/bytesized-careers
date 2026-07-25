import Link from "next/link";

import { faqs } from "../../lib/faqData";
import { Reveal } from "../ui";

export function HomeFaq() {
  return (
    <section className="space-y-8">
      <Reveal>
        <div className="flex flex-col items-center text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-subtle">FAQ</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">Questions we get a lot</h2>
        </div>
      </Reveal>

      <div className="mx-auto grid w-full gap-3 lg:max-w-3xl">
        {faqs.map((faq, index) => (
          <Reveal key={faq.q} delay={60 + index * 55}>
            <details className="group rounded-2xl border border-white/[0.07] bg-white/[0.028] px-5 transition-colors hover:border-white/12 open:border-white/12">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-sm font-semibold text-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 [&::-webkit-details-marker]:hidden">
                {faq.q}
                <span
                  aria-hidden="true"
                  className="shrink-0 text-lg leading-none text-subtle transition-transform duration-200 group-open:rotate-45 motion-reduce:transition-none"
                >
                  +
                </span>
              </summary>
              <p className="border-t border-white/[0.06] pb-4 pt-3 text-[13px] leading-6 text-white/55">{faq.a}</p>
            </details>
          </Reveal>
        ))}
      </div>

      <Reveal delay={320}>
        <div className="flex justify-center">
          <Link
            href="/faq"
            className="group/link inline-flex items-center gap-1 text-sm font-semibold text-white/55 transition-colors hover:text-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/25 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0b0f]"
          >
            View full FAQ
            <span
              aria-hidden="true"
              className="inline-block transition-transform group-hover/link:translate-x-0.5 motion-reduce:transition-none"
            >
              →
            </span>
          </Link>
        </div>
      </Reveal>
    </section>
  );
}
