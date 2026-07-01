import type { BackendPortfolioItem } from "./backendClient";
import type { PortfolioOption } from "../components/first-message/FirstMessageFields";

/**
 * Map a backend portfolio item to the shape the first-message portfolio picker
 * needs. Used by the job-apply and talent hiring-request flows so the requester
 * selects from their *real* profile portfolio, not faked entries.
 */
export function toPortfolioOption(item: BackendPortfolioItem): PortfolioOption {
  const url =
    item.source_url ||
    item.youtube_url ||
    item.media_url ||
    (item.links && item.links.length ? item.links[0] : undefined) ||
    undefined;
  const subtitle = item.role_name || item.role || item.channel_name || null;
  return {
    id: item.id,
    title: item.title || "Untitled work",
    url: url || undefined,
    thumbnailUrl: item.thumbnail_url || null,
    subtitle,
  };
}

/** Keep only public, published portfolio items — what an owner could actually see. */
export function toPortfolioOptions(items: BackendPortfolioItem[]): PortfolioOption[] {
  return items
    .filter((item) => item.is_public && item.publish_status !== "draft")
    .map(toPortfolioOption);
}
