import Link from "next/link";

import { PageHeader, StateCard } from "../../components/ui";

export const metadata = {
  title: "Terms | CreatorJobs",
  description: "Beta terms for using CreatorJobs.",
};

const sections = [
  {
    title: "Use the marketplace responsibly",
    body: "CreatorJobs helps hiring teams and talent discover each other. Do not post misleading listings, impersonate another person or business, scrape the platform, or use the service for spam or harassment.",
  },
  {
    title: "Listings, profiles, and work samples",
    body: "You are responsible for the accuracy of the jobs, talent listings, profiles, portfolio links, and messages you share. Only publish work samples you are allowed to share.",
  },
  {
    title: "Hiring and payment expectations",
    body: "Agree on scope, timeline, revisions, ownership, and payment terms before starting work. During beta, CreatorJobs may offer launch-free posting or listing access without processing payment.",
  },
  {
    title: "Reports and moderation",
    body: "CreatorJobs may remove listings, profiles, or accounts that appear unsafe, misleading, abusive, or outside the marketplace purpose.",
  },
];

export default function TermsPage() {
  return (
    <main className="min-h-[calc(100vh-56px)] bg-[#0b0b0f] px-4 py-8 text-white sm:px-6">
      <section className="mx-auto max-w-4xl space-y-6">
        <PageHeader
          title="Terms"
          description="A concise beta policy for using CreatorJobs. This page should be reviewed by counsel before a full public launch."
        />

        <StateCard
          icon="alert"
          title="Beta notice"
          description="These terms are an operational placeholder for beta readiness, not final legal advice."
        />

        <div className="grid gap-4">
          {sections.map((section) => (
            <section key={section.title} className="rounded-[28px] border border-white/[0.08] bg-white/[0.04] p-6">
              <h2 className="text-base font-semibold tracking-tight text-white/92">{section.title}</h2>
              <p className="mt-2 text-sm leading-6 text-white/58">{section.body}</p>
            </section>
          ))}
        </div>

        <p className="text-sm text-white/48">
          Questions about these terms?{" "}
          <Link href="/support" className="font-semibold text-white/78 hover:text-white hover:underline">
            Contact support
          </Link>
          .
        </p>
      </section>
    </main>
  );
}
