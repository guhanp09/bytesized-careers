import Link from "next/link";

import { Icon } from "../../components/Icons";
import { PageHeader, StateCard } from "../../components/ui";

type IconName = Parameters<typeof Icon>[0]["name"];

export const metadata = {
  title: "Privacy | CreatorJobs",
  description: "Beta privacy summary for CreatorJobs.",
};

const sections = [
  {
    title: "Information you provide",
    icon: "file",
    body: "CreatorJobs stores account details, profile fields, job posts, talent listings, applications, saved items, reports, and messages needed to operate the marketplace.",
  },
  {
    title: "Public marketplace information",
    icon: "globe",
    body: "Published jobs, talent listings, public profiles, and public work samples may be visible to other users and visitors. Keep private client information out of public descriptions and portfolio notes.",
  },
  {
    title: "Service operations",
    icon: "settings",
    body: "We use authentication, email delivery, logs, rate limiting, and health checks to run the service, protect accounts, and diagnose issues.",
  },
  {
    title: "Your choices",
    icon: "sliders-horizontal",
    body: "You can edit profile details, manage listings, remove saved items, and report unsafe listings. During beta, contact support for account or data requests.",
  },
] satisfies Array<{ title: string; icon: IconName; body: string }>;

export default function PrivacyPage() {
  return (
    <main className="min-h-[calc(100vh-56px)] bg-[#0b0b0f] px-4 py-8 text-white sm:px-6">
      <section className="mx-auto max-w-4xl space-y-6">
        <PageHeader
          title="Privacy"
          description="A practical beta privacy summary for CreatorJobs. This page should be reviewed by counsel before a full public launch."
        />

        <StateCard
          icon="user"
          title="Public by design, private by default where possible"
          description="Marketplace listings and public profiles are meant to be discoverable. Account security, saved items, drafts, and private workflow data should remain protected."
        />

        <div className="grid gap-4">
          {sections.map((section) => (
            <section key={section.title} className="rounded-[28px] border border-white/[0.08] bg-white/[0.04] p-6">
              <h2 className="inline-flex items-center gap-2 text-base font-semibold tracking-tight text-white/92">
                <span aria-hidden="true" className="inline-flex shrink-0 text-white/50">
                  <Icon name={section.icon} className="h-4 w-4" />
                </span>
                <span>{section.title}</span>
              </h2>
              <p className="mt-2 text-sm leading-6 text-white/58">{section.body}</p>
            </section>
          ))}
        </div>

        <p className="text-sm text-white/48">
          For privacy or account requests,{" "}
          <Link href="/support" className="font-semibold text-white/78 hover:text-white hover:underline">
            contact support
          </Link>
          .
        </p>
      </section>
    </main>
  );
}
