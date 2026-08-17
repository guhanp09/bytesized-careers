import { notFound } from "next/navigation";
import Link from "next/link";

import { Icon } from "../../../components/Icons";
import { PageHeader, StateCard } from "../../../components/ui";
import { CURRENT_LEGAL_VERSION, legalVersion } from "../../../lib/legal";

type IconName = Parameters<typeof Icon>[0]["name"];

/**
 * A superseded version of the privacy, exactly as it was published.
 *
 * This exists so an acceptance record can be READ, not so the page can be
 * found. Somebody who agreed to `2026-06-01` can be shown that wording even
 * after it is replaced — which is the whole value of storing a version rather
 * than a boolean.
 *
 * It is deliberately `noindex`: a provenance surface, not an acquisition one.
 * Search results carrying old terms would compete with the current ones, and the
 * unversioned page stays the canonical reader surface.
 *
 * An unknown version is a 404. Falling back to current wording would be the
 * worst possible answer — it would show one text while claiming to be another,
 * which is exactly the confusion the archive exists to remove.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ version: string }>;
}) {
  const { version } = await params;
  const archived = legalVersion(version);
  if (!archived) {
    return { title: "Version not found", robots: { index: false, follow: false } };
  }
  return {
    title: `Privacy ($\{archived.version}) | CreatorJobs`,
    description: `The privacy published as version $\{archived.version}.`,
    robots: { index: false, follow: false },
    alternates: { canonical: "/privacy" },
  };
}

export default async function ArchivedPrivacyPage({
  params,
}: {
  params: Promise<{ version: string }>;
}) {
  const { version } = await params;
  const archived = legalVersion(version);
  if (!archived) {
    notFound();
  }

  const sections = archived.privacy as ReadonlyArray<{
    title: string;
    icon: IconName;
    body: string;
  }>;
  const isCurrent = archived.version === CURRENT_LEGAL_VERSION.version;

  return (
    <main className="min-h-[calc(100vh-56px)] bg-[#0b0b0f] px-4 py-8 text-white sm:px-6">
      <section className="mx-auto max-w-4xl space-y-6">
        <PageHeader
          title={`Privacy — version $\{archived.version}`}
          description={`The privacy exactly as published in version $\{archived.version}.`}
        />

        {!isCurrent ? (
          <StateCard
            icon="alert"
            title="Superseded version"
            description="This is a historical record kept so an earlier agreement can be read. It is not the wording in effect now."
          />
        ) : null}

        <p className="text-xs text-muted">Version {archived.version}</p>

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
          Read the current privacy at{" "}
          <Link href="/privacy" className="font-semibold text-white/78 hover:text-white hover:underline">
            /privacy
          </Link>
          .
        </p>
      </section>
    </main>
  );
}
