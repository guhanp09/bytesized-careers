import type { BackendPortfolioItem } from "./backendClient";

// Shared content model for portfolio project cards across the Portfolio tab and the
// Overview preview rails. Keeping the field selection in one place is what makes the
// surfaces consistent — they differ only in size (line-clamp), never in *what* they
// show. Truncation itself is handled by CSS `line-clamp-*` (which appends an ellipsis).

type SummarySource = Pick<BackendPortfolioItem, "contribution_summary" | "description">;

/**
 * The "summary of what I did" shown as a preview on the card. Prefers the explicit
 * contribution summary, falling back to the project description. Returns null when
 * there is nothing meaningful to show so callers can omit the area entirely.
 */
export function portfolioSummaryPreview(item: SummarySource): string | null {
  const raw = (item.contribution_summary || item.description || "").trim();
  return raw.length > 0 ? raw : null;
}
