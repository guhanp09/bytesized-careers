"use client";

/**
 * Portfolio evidence, rendered.
 *
 * This is the strongest qualification signal a creator marketplace has, and it
 * was previously reduced to a link chip labelled with a filename. The surfaces
 * here put the work first while keeping identity and the primary action ahead
 * of it — a wall of thumbnails that buries who applied is a different failure,
 * not a fix.
 *
 * Nothing here fetches anything. Real thumbnails are used when a record has
 * one; everything else gets a deterministic local poster.
 */

import { useState } from "react";
import { Icon } from "../Icons";
import {
  MEDIA_KIND_LABELS,
  type CreatorPortfolioItem,
} from "../../lib/creatorProjection";
import {
  MEDIA_ICONS,
  portfolioPoster,
  posterGradient,
  posterPatternUrl,
} from "../../lib/portfolioPoster";

type PreviewSize = "xs" | "sm" | "md" | "lg";

/**
 * A poster is evidence, not decoration, so it earns width — but only as much as
 * the title can spare. At a 280px pipeline card a 132px poster left ~120px for
 * the title, which truncated every real one to "Retention reb…". The card sizes
 * are therefore smaller than the review surface's.
 */
const SIZE_CLASSES: Record<PreviewSize, string> = {
  xs: "h-[34px] w-[58px]",
  sm: "h-[46px] w-[80px]",
  md: "h-[74px] w-[132px]",
  lg: "h-[104px] w-full",
};

/**
 * One item's artwork.
 *
 * A real thumbnail is preferred; a broken one falls back to the poster rather
 * than leaving the browser's broken-image glyph, which is the single ugliest
 * thing that can appear on a card and says nothing.
 *
 * There is no play button. A play affordance that opens a link is a lie about
 * what will happen, and one that does nothing is worse — so the media type is
 * stated as a small cue instead, and the whole tile is the link when a URL
 * exists.
 */
export function PortfolioPoster({
  item,
  size = "md",
  className = "",
}: {
  item: CreatorPortfolioItem;
  size?: PreviewSize;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  const poster = portfolioPoster(item.id, item.title);
  const showImage = Boolean(item.thumbnailUrl) && !broken;

  return (
    <span
      data-testid="portfolio-poster"
      data-poster-palette={poster.palette.key}
      data-poster-pattern={poster.pattern}
      data-poster-fallback={showImage ? "image" : "generated"}
      className={[
        "relative block shrink-0 overflow-hidden rounded-lg border border-line",
        SIZE_CLASSES[size],
        className,
      ].join(" ")}
      style={showImage ? undefined : { backgroundImage: posterGradient(poster) }}
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.thumbnailUrl ?? ""}
          alt=""
          loading="lazy"
          onError={() => setBroken(true)}
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <>
          <span
            aria-hidden="true"
            className="absolute inset-0"
            style={{ backgroundImage: posterPatternUrl(poster) }}
          />
          <span
            aria-hidden="true"
            className="absolute inset-0 flex items-center justify-center text-[15px] font-bold tracking-wide text-white/85"
          >
            {poster.initials}
          </span>
        </>
      )}
      {/* A scrim so the badges below stay readable over artwork of any brightness. */}
      <span
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/70 to-transparent"
      />
      <span className="absolute inset-x-1 bottom-1 flex items-end justify-between gap-1">
        <span
          data-testid="portfolio-media-cue"
          className="inline-flex items-center gap-0.5 rounded bg-black/55 px-1 py-px text-[9px] font-semibold text-white/90 backdrop-blur-[2px]"
        >
          <Icon name={MEDIA_ICONS[item.media]} className="h-2.5 w-2.5" aria-hidden="true" />
          <span className="sr-only">{MEDIA_KIND_LABELS[item.media]}</span>
        </span>
        {item.duration ? (
          <span
            data-testid="portfolio-duration"
            className="rounded bg-black/55 px-1 py-px text-[9px] font-semibold tabular-nums text-white/90 backdrop-blur-[2px]"
          >
            {item.duration}
          </span>
        ) : null}
      </span>
    </span>
  );
}

/** The facts worth reading beside a piece of work, in the order they matter. */
function itemFacts(item: CreatorPortfolioItem): string[] {
  return [item.role, item.format, item.platform, item.niche].filter(
    (value): value is string => Boolean(value)
  );
}

/**
 * The lead item: one piece of work, large enough to actually judge.
 *
 * A link when the record has a URL, plain markup when it does not — rather than
 * an anchor that goes nowhere.
 */
export function PortfolioLead({
  item,
  size = "md",
}: {
  item: CreatorPortfolioItem;
  size?: PreviewSize;
}) {
  const facts = itemFacts(item);
  const body = (
    <>
      <PortfolioPoster item={item} size={size} />
      <span className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
        <span className="truncate text-[12.5px] font-semibold text-ink" title={item.title}>
          {item.title}
        </span>
        {facts.length > 0 ? (
          <span className="truncate text-[11px] text-muted">{facts.join(" · ")}</span>
        ) : null}
      </span>
      {item.url ? (
        <Icon
          name="external-link"
          className="mt-1 h-3.5 w-3.5 shrink-0 self-start text-subtle"
          aria-hidden="true"
        />
      ) : null}
    </>
  );

  const className =
    "group/lead flex w-full min-w-0 items-stretch gap-2.5 rounded-xl border border-line bg-raised p-1.5 text-left transition-colors";

  if (!item.url) {
    return (
      <span data-testid="portfolio-lead" className={className}>
        {body}
      </span>
    );
  }
  return (
    <a
      data-testid="portfolio-lead"
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(event) => event.stopPropagation()}
      aria-label={`Open “${item.title}” in a new tab`}
      className={`${className} cursor-pointer hover:border-line-mid hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus`}
    >
      {body}
    </a>
  );
}

/**
 * Portfolio on a card: one strong lead, a short supporting strip, a count.
 *
 * Twenty thumbnails at once is not evidence, it is wallpaper — and on a
 * pipeline card it would bury the person and the action. So the strip is
 * capped, and the remainder becomes a count that says how much more there is
 * without pretending to show it.
 */
export function PortfolioStrip({
  items,
  max = 3,
  compact = false,
  onViewAll,
}: {
  items: CreatorPortfolioItem[];
  max?: number;
  /** Card context: smaller artwork so the title is readable at 280px. */
  compact?: boolean;
  /** Opens the fuller review surface. Omitted when there is nowhere to go. */
  onViewAll?: () => void;
}) {
  if (items.length === 0) return null;
  const [lead, ...rest] = items;
  const supporting = rest.slice(0, Math.max(0, max - 1));
  const remaining = items.length - 1 - supporting.length;
  const leadSize: PreviewSize = compact ? "sm" : "md";

  return (
    <div data-testid="portfolio-strip" data-portfolio-count={items.length} className="min-w-0 space-y-1.5">
      <PortfolioLead item={lead} size={leadSize} />
      {supporting.length > 0 || remaining > 0 ? (
        <div className="flex items-center gap-1.5">
          {supporting.map((item) => (
            <PortfolioThumb key={item.id} item={item} size={compact ? "xs" : "sm"} />
          ))}
          {remaining > 0 ? (
            onViewAll ? (
              <button
                type="button"
                data-testid="portfolio-view-all"
                onClick={(event) => {
                  event.stopPropagation();
                  onViewAll();
                }}
                className="inline-flex h-[34px] shrink-0 cursor-pointer items-center rounded-lg border border-line bg-wash px-2 text-[11px] font-semibold text-muted transition-colors hover:border-line-mid hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
              >
                +{remaining} more
              </button>
            ) : (
              <span
                data-testid="portfolio-more-count"
                className="inline-flex h-[34px] shrink-0 items-center rounded-lg border border-line bg-wash px-2 text-[11px] font-semibold text-muted"
              >
                +{remaining} more
              </span>
            )
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function PortfolioThumb({ item, size = "sm" }: { item: CreatorPortfolioItem; size?: PreviewSize }) {
  const label = [item.title, item.format, item.platform].filter(Boolean).join(" · ");
  if (!item.url) {
    return (
      <span title={label} aria-label={label}>
        <PortfolioPoster item={item} size={size} />
      </span>
    );
  }
  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(event) => event.stopPropagation()}
      title={label}
      aria-label={`Open “${item.title}” in a new tab`}
      className="shrink-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
    >
      <PortfolioPoster item={item} size={size} />
    </a>
  );
}

/**
 * The review surface: every item, with everything known about each.
 *
 * The card's job is triage — is this worth opening. This one's job is
 * judgement, so nothing is truncated away and the facts are laid out rather
 * than joined into a line.
 */
export function PortfolioReview({ items }: { items: CreatorPortfolioItem[] }) {
  if (items.length === 0) {
    return (
      <p data-testid="portfolio-empty" className="text-[12px] text-muted">
        No portfolio was shared with this application.
      </p>
    );
  }
  return (
    <ul data-testid="portfolio-review" className="space-y-2">
      {items.map((item) => {
        const facts = itemFacts(item);
        const inner = (
          <>
            <PortfolioPoster item={item} size="md" />
            <span className="flex min-w-0 flex-1 flex-col gap-1 py-0.5">
              <span className="text-[12.5px] font-semibold leading-snug text-ink">{item.title}</span>
              {facts.length > 0 ? (
                <span className="flex flex-wrap gap-1">
                  {facts.map((fact) => (
                    <span
                      key={fact}
                      className="rounded-md bg-wash px-1.5 py-px text-[10.5px] font-medium text-secondary"
                    >
                      {fact}
                    </span>
                  ))}
                </span>
              ) : null}
              <span className="text-[10.5px] text-subtle">
                {MEDIA_KIND_LABELS[item.media]}
                {item.duration ? ` · ${item.duration}` : ""}
                {item.url ? "" : " · no link shared"}
              </span>
            </span>
            {item.url ? (
              <Icon name="external-link" className="h-3.5 w-3.5 shrink-0 self-center text-subtle" aria-hidden="true" />
            ) : null}
          </>
        );
        const className = "flex items-stretch gap-2.5 rounded-xl border border-line bg-raised p-2";
        return (
          <li key={item.id} data-testid="portfolio-review-item">
            {item.url ? (
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Open “${item.title}” in a new tab`}
                className={`${className} cursor-pointer transition-colors hover:border-line-mid hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus`}
              >
                {inner}
              </a>
            ) : (
              <div className={className}>{inner}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
