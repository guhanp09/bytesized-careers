import Link from "next/link";
import type { BackendPortfolioItem } from "../../lib/backendClient";
import { portfolioSummaryPreview } from "../../lib/portfolioCard";
import { Icon } from "../Icons";

type ActivationOrigin = {
  x: number;
  y: number;
};

const metricNumber = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const formatCompactNumber = (value: unknown) => {
  const number = metricNumber(value);
  return number === null ? null : Intl.NumberFormat("en", { notation: "compact" }).format(number);
};

const formatDateShort = (value?: string | null) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
};

const cleanText = (value?: string | null) => {
  const text = value?.trim();
  if (!text) return null;
  const normalized = text.toLowerCase();
  if (["not shared", "not set", "creator-economy profile"].includes(normalized)) {
    return null;
  }
  return text;
};

type PortfolioPreviewRailProps = {
  items: BackendPortfolioItem[];
  getHref?: (item: BackendPortfolioItem) => string | null | undefined;
  onItemActivate?: (item: BackendPortfolioItem, target: HTMLElement, origin?: ActivationOrigin) => void;
  activeItemId?: string | null;
  itemControlsId?: string;
  ariaLabel?: string;
  keyPrefix?: string;
  externalLinkLabelPrefix?: string;
  internalLinkLabelPrefix?: string;
  showCreatedDateFallback?: boolean;
};

export default function PortfolioPreviewRail({
  items,
  getHref,
  onItemActivate,
  activeItemId,
  itemControlsId,
  ariaLabel = "Portfolio preview",
  keyPrefix = "portfolio-preview",
  externalLinkLabelPrefix = "Open project",
  internalLinkLabelPrefix = "Open project detail",
  showCreatedDateFallback = true,
}: PortfolioPreviewRailProps) {
  return (
    <div className="min-w-0 max-w-full overflow-hidden">
      <div
        aria-label={ariaLabel}
        className="flex max-w-full snap-x snap-proximity gap-4 overflow-x-auto px-1 pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {items.map((item) => {
          const href = getHref?.(item) || item.source_url || item.youtube_url || item.media_url || item.links?.[0] || null;
          const publicMetrics = item.public_metrics || {};
          const views = formatCompactNumber(publicMetrics.views ?? item.views);
          const published = formatDateShort(
            item.published_at || item.published_date || (showCreatedDateFallback ? item.created_at : null)
          );
          const sourceLine = [item.channel_name, views ? `${views} views` : null, published, item.duration]
            .filter(Boolean)
            .join(" · ");
          const roleLabel = cleanText(item.role_name || item.role || item.user_role_in_project);
          const summaryPreview = portfolioSummaryPreview(item);
          const content = (
            <>
              <div className="aspect-video overflow-hidden bg-[radial-gradient(circle_at_26%_22%,rgba(255,255,255,0.11),transparent_32%),linear-gradient(135deg,rgba(255,255,255,0.07),rgba(255,255,255,0.018)_52%,rgba(0,0,0,0.25))]">
                {item.thumbnail_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.thumbnail_url}
                    alt={item.title}
                    className="h-full w-full object-cover transition-[filter,transform] duration-500 group-hover:scale-[1.015] group-hover:brightness-110"
                  />
                ) : (
                  <div className="flex h-full min-h-[150px] w-full items-center justify-center text-subtle">
                    <Icon name="image" className="h-8 w-8" />
                  </div>
                )}
              </div>
              <div className="p-4">
                <p className="truncate text-sm font-semibold text-white/90 transition-colors group-hover:text-white">{item.title}</p>
                {roleLabel ? <p className="mt-1 text-sm font-medium text-white/72">{roleLabel}</p> : null}
                {sourceLine ? <p className="mt-1 text-xs text-muted">{sourceLine}</p> : null}
                {summaryPreview ? (
                  <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-white/65">{summaryPreview}</p>
                ) : null}
              </div>
            </>
          );

          const className =
            "group block w-[340px] shrink-0 snap-start overflow-hidden rounded-2xl border border-white/10 bg-white/[0.045] transition-[border-color,background-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-white/18 hover:bg-white/[0.066] hover:shadow-[0_26px_70px_-38px_rgba(0,0,0,1)] focus:outline-none focus:ring-2 focus:ring-white/15 sm:w-[360px] lg:w-[380px]";

          if (onItemActivate) {
            const active = activeItemId === item.id;
            return (
              <button
                key={`${keyPrefix}-${item.id}`}
                type="button"
                aria-label={`${externalLinkLabelPrefix}: ${item.title}`}
                aria-expanded={active}
                aria-controls={active ? itemControlsId : undefined}
                onClick={(event) => {
                  const origin = event.clientX || event.clientY ? { x: event.clientX, y: event.clientY } : undefined;
                  onItemActivate(item, event.currentTarget, origin);
                }}
                className={`${className} cursor-pointer text-left`}
              >
                {content}
              </button>
            );
          }

          if (href) {
            const external = /^https?:\/\//i.test(href);
            if (external) {
              return (
                <a
                  key={`${keyPrefix}-${item.id}`}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`${externalLinkLabelPrefix}: ${item.title}`}
                  className={`${className} cursor-pointer`}
                >
                  {content}
                </a>
              );
            }

            return (
              <Link
                key={`${keyPrefix}-${item.id}`}
                href={href}
                aria-label={`${internalLinkLabelPrefix}: ${item.title}`}
                className={`${className} cursor-pointer`}
              >
                {content}
              </Link>
            );
          }

          return (
            <article key={`${keyPrefix}-${item.id}`} className={className}>
              {content}
            </article>
          );
        })}
      </div>
    </div>
  );
}
