import { faqs } from "../../lib/faqData";

export const metadata = { title: "FAQ — CreatorJobs" };

export default function FaqPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16 sm:px-8">
      <div className="mb-10 flex flex-col items-center text-center">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/35">FAQ</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white sm:text-4xl">Questions we get a lot</h1>
        <p className="mt-4 max-w-xl text-sm leading-6 text-white/55">
          Everything you need to know about CreatorJobs — roles, applications, hiring, and how the platform works.
        </p>
      </div>

      <div className="grid gap-3">
        {faqs.map((faq) => (
          <details
            key={faq.q}
            className="group rounded-2xl border border-white/[0.07] bg-white/[0.028] px-5 transition-colors hover:border-white/12 open:border-white/12"
          >
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-sm font-semibold text-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 [&::-webkit-details-marker]:hidden">
              {faq.q}
              <span
                aria-hidden="true"
                className="shrink-0 text-lg leading-none text-white/40 transition-transform duration-200 group-open:rotate-45 motion-reduce:transition-none"
              >
                +
              </span>
            </summary>
            <p className="border-t border-white/[0.06] pb-4 pt-3 text-[13px] leading-6 text-white/55">{faq.a}</p>
          </details>
        ))}
      </div>
    </main>
  );
}
