import Link from "next/link";

import { Icon } from "../../components/Icons";
import { CURRENT_LEGAL_VERSION } from "../../lib/legal";
import { PageHeader, StateCard } from "../../components/ui";

type IconName = Parameters<typeof Icon>[0]["name"];

export const metadata = {
  title: "Privacy | CreatorJobs",
  description: "Beta privacy summary for CreatorJobs.",
  alternates: { canonical: "/privacy" },
};

// The wording comes from the published version rather than living here, so an
// acceptance record naming a version can be resolved to the exact text. Editing
// this page can no longer change what a prior acceptance appears to mean.
const sections = CURRENT_LEGAL_VERSION.privacy as ReadonlyArray<{
  title: string;
  icon: IconName;
  body: string;
}>;

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

        <p className="text-xs text-muted">
          {/* Shown because an acceptance record stores this version; a reader
              should be able to see which wording they are looking at. */}
          Version {CURRENT_LEGAL_VERSION.version}
        </p>

        <div className="grid gap-4">
          {sections.map((section) => (
            <section key={section.title} className="rounded-[28px] border border-white/[0.08] bg-white/[0.04] p-6">
              <h2 className="inline-flex items-center gap-2 text-base font-semibold tracking-tight text-white/92">
                <span aria-hidden="true" className="inline-flex shrink-0 text-muted">
                  <Icon name={section.icon} className="h-4 w-4" />
                </span>
                <span>{section.title}</span>
              </h2>
              <p className="mt-2 text-sm leading-6 text-white/58">{section.body}</p>
            </section>
          ))}
        </div>

        <p className="text-sm text-muted">
          {/* A permalink to this exact wording, so an acceptance record naming
              this version stays readable after the wording changes. */}
          Permanent link to this version:{" "}
          <Link
            href={`/privacy/${CURRENT_LEGAL_VERSION.version}`}
            className="font-semibold text-white/78 hover:text-white hover:underline"
          >
            /privacy/{CURRENT_LEGAL_VERSION.version}
          </Link>
        </p>

        <p className="text-sm text-muted">
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
