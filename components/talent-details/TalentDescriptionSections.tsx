import Link from "next/link";
import type { ReactNode } from "react";
import type { BackendPortfolioItem } from "../../lib/backendClient";
import {
  BodySection,
  BulletList,
  LISTING_PANEL_CLASS,
  Pills,
  SectionLabel,
} from "../listing-details/ListingSections";
import PortfolioDetailRail from "../profile/PortfolioDetailRail";

type CollaborationRow = { label: string; value: string };

export default function TalentDescriptionSections({
  about,
  services,
  rows,
  portfolioItems,
  fullPortfolioHref,
  tags,
}: {
  about: string;
  services: string[];
  rows: CollaborationRow[];
  portfolioItems: BackendPortfolioItem[];
  fullPortfolioHref?: string | null;
  tags: string[];
}) {
  const aboutText = about?.trim();
  const contentSections: ReactNode[] = [];

  if (aboutText) {
    contentSections.push(
      <BodySection key="about" title="About this talent" icon="user">
        <p className="whitespace-pre-line">{aboutText}</p>
      </BodySection>
    );
  }

  if (services.length) {
    contentSections.push(
      <BodySection key="services" title="Services offered" icon="briefcase">
        <BulletList items={services} />
      </BodySection>
    );
  }

  if (rows.length) {
    contentSections.push(
      <BodySection key="collaboration" title="Collaboration preferences" icon="sliders-horizontal">
        <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
          {rows.map((row) => (
            <div key={row.label}>
              <dt className="text-[11px] font-semibold uppercase tracking-[0.18em] text-subtle">
                {row.label}
              </dt>
              <dd className="mt-2 text-sm leading-6 text-white/75">{row.value}</dd>
            </div>
          ))}
        </dl>
      </BodySection>
    );
  }

  const hasContent = contentSections.length > 0;
  const hasPortfolioItems = portfolioItems.length > 0;
  const hasTags = tags.length > 0;

  if (!hasContent && !hasPortfolioItems && !hasTags) {
    return (
      <section className={`${LISTING_PANEL_CLASS} py-8`}>
        <SectionLabel icon="file">Listing details</SectionLabel>
        <p className="mt-4 text-sm leading-relaxed text-white/55">
          This listing does not have additional details yet.
        </p>
      </section>
    );
  }

  return (
    <div className="min-w-0 space-y-6">
      {hasContent ? (
        <section className={`${LISTING_PANEL_CLASS} min-w-0`}>
          <div className="divide-y divide-white/[0.08]">{contentSections}</div>
        </section>
      ) : null}

      {hasPortfolioItems ? (
        <section className={`${LISTING_PANEL_CLASS} min-w-0 py-8`}>
          <div className="flex items-center justify-between gap-4">
            <SectionLabel icon="images">Relevant portfolio</SectionLabel>
            {fullPortfolioHref ? (
              <Link
                href={fullPortfolioHref}
                className="shrink-0 cursor-pointer text-xs font-medium text-muted transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/15"
              >
                View Full Portfolio <span aria-hidden="true">→</span>
              </Link>
            ) : null}
          </div>
          <div className="mt-5 min-w-0">
            <PortfolioDetailRail
              items={portfolioItems}
              ariaLabel="Relevant portfolio"
              keyPrefix="talent-relevant-portfolio"
            />
          </div>
        </section>
      ) : null}

      {hasTags ? (
        <div className="min-w-0 px-1">
          <Pills items={tags} />
        </div>
      ) : null}
    </div>
  );
}
