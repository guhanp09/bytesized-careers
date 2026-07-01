import type { BackendPortfolioItem } from "./backendClient";
import type { ReferenceTimestampNote } from "./types.ts";
import {
  buildTimestampedVideoUrl,
  formatReferenceTimestamp,
  normalizeReferenceTimestampNote,
} from "./referenceVideos.ts";

export const MAX_PORTFOLIO_TIMESTAMP_NOTES = 10;

const compact = (value: unknown) => {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned || null;
};

export function uniquePortfolioList(values: unknown, maxItems = 12): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const cleaned = compact(value)?.slice(0, 80);
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(cleaned);
    if (result.length >= maxItems) break;
  }
  return result;
}

export function getPortfolioProjectUrl(item: BackendPortfolioItem): string | null {
  return (
    compact(item.source_url) ||
    compact(item.youtube_url) ||
    compact(item.media_url) ||
    compact(item.links?.[0]) ||
    null
  );
}

export function getPortfolioWhatIDid(item: BackendPortfolioItem): string | null {
  return (
    compact(item.what_i_did ?? item.whatIDid) ||
    compact(item.contribution_summary) ||
    compact(item.description) ||
    null
  );
}

export function getPortfolioHighlights(item: BackendPortfolioItem): string[] {
  const highlights = uniquePortfolioList(item.contribution_highlights ?? item.contributionHighlights, 8);
  if (highlights.length) return highlights;
  return uniquePortfolioList(item.contribution_tags, 6);
}

export function getPortfolioTimestampNotes(item: BackendPortfolioItem): ReferenceTimestampNote[] {
  const raw = item.timestamp_notes ?? item.timestampNotes;
  if (!Array.isArray(raw)) return [];
  return raw
    .map(normalizeReferenceTimestampNote)
    .filter((note): note is ReferenceTimestampNote => Boolean(note))
    .slice(0, MAX_PORTFOLIO_TIMESTAMP_NOTES);
}

export function getPortfolioTools(item: BackendPortfolioItem): string[] {
  return uniquePortfolioList(item.tools, 12);
}

export function getPortfolioContextChips(item: BackendPortfolioItem): string[] {
  return uniquePortfolioList(
    [
      ...(item.content_niches ?? item.contentNiches ?? []),
      ...(item.content_genres ?? item.contentGenres ?? []),
      ...(item.platforms ?? []),
      ...(item.formats ?? []),
      ...(item.tags ?? []),
    ],
    14
  );
}

const metricNumber = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const compactNumber = (value: unknown) => {
  const number = metricNumber(value);
  return number === null ? null : Intl.NumberFormat("en", { notation: "compact" }).format(number);
};

export function getPortfolioResults(item: BackendPortfolioItem): string[] {
  const publicMetrics = item.public_metrics || {};
  const manualMetrics = item.manual_metrics || {};
  const explicit = uniquePortfolioList(item.results, 8);
  const derived = [
    compactNumber(publicMetrics.views ?? item.views)
      ? `${compactNumber(publicMetrics.views ?? item.views)} views`
      : null,
    metricNumber(manualMetrics.retention_percent ?? item.retention_percent) !== null
      ? `Retention ${metricNumber(manualMetrics.retention_percent ?? item.retention_percent)}%`
      : null,
    metricNumber(manualMetrics.ctr_percent) !== null ? `CTR ${metricNumber(manualMetrics.ctr_percent)}%` : null,
    metricNumber(manualMetrics.turnaround_days) !== null
      ? `Delivered in ${metricNumber(manualMetrics.turnaround_days)} days`
      : null,
    compact(manualMetrics.metric_notes),
  ].filter((value): value is string => Boolean(value));

  return uniquePortfolioList([...explicit, ...derived], 10);
}

export function buildPortfolioTimestampUrl(projectUrl: string, seconds: number): string | null {
  const next = buildTimestampedVideoUrl(projectUrl, seconds);
  return next === projectUrl ? null : next;
}

export function formatPortfolioTimestamp(seconds: number): string {
  return formatReferenceTimestamp(seconds);
}
