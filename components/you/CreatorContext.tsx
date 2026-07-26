"use client";

/**
 * Creator-specific context: who is hiring, what the work is, and what the
 * arrangement actually is.
 *
 * Everything here renders the projection in `lib/creatorProjection.ts` and
 * knows nothing about backend response shapes. All three components render
 * nothing at all when they have nothing to say — an empty labelled slot is
 * worse than an absent one, because it reads as missing data rather than as
 * information that was never part of this listing.
 */

import { type ComponentProps } from "react";
import { Icon } from "../Icons";
import {
  clientContextLines,
  type CreatorClientContext,
  type CreatorCommercialTerms,
  type CreatorTurnaround,
} from "../../lib/creatorProjection";

/**
 * Fit at a glance: platform/format, niche, turnaround.
 *
 * A row of quiet facts rather than a cluster of coloured badges. These are
 * attributes, not states — giving them the visual weight of a status pill
 * would make every card look like it needed something.
 */
export function CreatorFitSummary({
  platforms,
  formats,
  niches,
  turnaround,
  className = "",
}: {
  platforms: string[];
  formats: string[];
  niches: string[];
  turnaround?: CreatorTurnaround | null;
  className?: string;
}) {
  const facts: Array<{ key: string; icon: ComponentProps<typeof Icon>["name"]; label: string }> = [];
  const surface = [...formats.slice(0, 1), ...platforms.slice(0, 1)].filter(Boolean);
  if (surface.length > 0) {
    facts.push({ key: "surface", icon: "screen", label: surface.join(" · ") });
  }
  if (niches.length > 0) {
    facts.push({ key: "niche", icon: "tag", label: niches.slice(0, 2).join(" · ") });
  }
  if (turnaround && turnaround.hours !== null) {
    facts.push({ key: "turnaround", icon: "timer-reset", label: turnaround.label });
  }
  if (facts.length === 0) return null;

  return (
    <ul
      data-testid="creator-fit"
      className={`flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-muted ${className}`}
    >
      {facts.map((fact) => (
        <li key={fact.key} className="inline-flex min-w-0 items-center gap-1">
          <Icon name={fact.icon} className="h-3 w-3 shrink-0 text-subtle" aria-hidden="true" />
          <span className="truncate">{fact.label}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The commercial arrangement.
 *
 * The headline already carries its unit, because the projection refuses to
 * produce a bare amount. A trial is shown beside it, never folded into it: an
 * audition fee and an ongoing rate are different commitments, and a reader who
 * conflates them has been misled about what the job pays.
 *
 * Unpaid work is stated in words and never styled like a rate — no currency
 * glyph, no tabular figures, nothing that makes it scan as compensation.
 */
export function CommercialTerms({
  terms,
  size = "sm",
}: {
  terms: CreatorCommercialTerms;
  size?: "sm" | "md";
}) {
  if (!terms.disclosed) {
    return (
      <p data-testid="commercial-terms" data-disclosed="false" className="text-[11px] text-subtle">
        Rate not specified
      </p>
    );
  }
  const headlineClass =
    size === "md"
      ? "text-[15px] font-semibold text-ink"
      : "text-[12px] font-semibold text-default";

  return (
    <div data-testid="commercial-terms" data-structure={terms.structure} data-disclosed="true" className="min-w-0">
      <p className={terms.unpaid ? `${headlineClass} text-state-interview` : headlineClass}>
        {terms.headline}
      </p>
      {terms.trial ? (
        <p
          data-testid="commercial-trial"
          data-trial-paid={terms.trial.paid}
          className="mt-0.5 text-[11px] text-muted"
        >
          {/* Beside the rate, never merged into it. */}
          {terms.trial.label} before the ongoing rate
        </p>
      ) : null}
      {terms.note ? <p className="mt-0.5 text-[11px] text-muted">{terms.note}</p> : null}
    </div>
  );
}

/**
 * Who is hiring, in two lines rather than a grid of tiny uppercase labels.
 *
 * The lines are assembled by the projection and skip anything absent, so a
 * listing with no subscriber count simply has a shorter summary instead of a
 * slot reading "Unknown".
 */
export function ClientContextSummary({
  context,
  turnaround,
  className = "",
}: {
  context: CreatorClientContext;
  turnaround?: CreatorTurnaround | null;
  className?: string;
}) {
  const lines = clientContextLines(context, turnaround);
  const identity = [context.handle, context.kind].filter(Boolean).join(" · ");
  if (lines.length === 0 && !identity) return null;

  return (
    <div data-testid="client-context" className={`min-w-0 space-y-0.5 ${className}`}>
      {identity ? (
        <p className="truncate text-[11.5px] font-medium text-secondary">{identity}</p>
      ) : null}
      {lines.map((line) => (
        <p key={line} className="truncate text-[11px] text-muted">
          {line}
        </p>
      ))}
    </div>
  );
}
