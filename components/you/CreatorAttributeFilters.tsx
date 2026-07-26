"use client";

/**
 * Creator-attribute filters.
 *
 * Deliberately small. A hiring inbox does not need a query builder — a creator
 * hiring for a finance channel wants "YouTube, finance, delivers in a week",
 * and everything past that is a control nobody touches.
 *
 * Kept structurally apart from the work queues: queues are recommendations
 * about *what needs you*, these are facts about *what the work is*. They
 * compose, so they must not look like one control with two halves — the queue
 * control lives on the scope row, and this is its own labelled disclosure.
 *
 * Options are derived from the records on screen, so the control can only offer
 * a value some record actually has. A menu built from a static vocabulary would
 * offer Twitch on a board with no Twitch work and return nothing, which teaches
 * people the filter is broken.
 */

import { useEffect, useRef, useState } from "react";
import { Icon } from "../Icons";
import {
  CREATOR_FILTER_LABELS,
  creatorFacetLabel,
  type CreatorFilterKey,
  type CreatorFilters,
} from "../../lib/creatorProjection";

const FILTER_ORDER: CreatorFilterKey[] = ["platform", "format", "niche", "turnaround", "structure"];

export function CreatorAttributeFilters({
  available,
  filters,
  onChange,
}: {
  /** Values present in the current records, per key. Empty keys are not offered. */
  available: Record<CreatorFilterKey, string[]>;
  filters: CreatorFilters;
  onChange: (next: CreatorFilters) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const offered = FILTER_ORDER.filter((key) => available[key]?.length > 0);
  const active = FILTER_ORDER.filter((key) => filters[key]);
  // Nothing to filter by means no control. An empty filter menu is an inert
  // affordance, and the board is more honest without it.
  if (offered.length === 0 && active.length === 0) return null;

  const set = (key: CreatorFilterKey, value: string | undefined) => {
    const next = { ...filters };
    if (value) next[key] = value;
    else delete next[key];
    onChange(next);
  };

  return (
    <div ref={rootRef} className="relative flex shrink-0 items-center gap-1.5" data-testid="creator-filters">
      <button
        ref={triggerRef}
        type="button"
        data-testid="creator-filters-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={
          active.length > 0
            ? `Creator filters. ${active.length} applied.`
            : "Filter by platform, format, niche, turnaround or pay structure."
        }
        onClick={() => setOpen((value) => !value)}
        className={[
          "inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border px-2 text-[11.5px] font-semibold transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
          active.length > 0
            ? "border-line-strong bg-elevated text-ink elev-1"
            : "border-line bg-wash text-muted hover:border-line-mid hover:text-default",
        ].join(" ")}
      >
        <Icon name="tag" className="h-3 w-3 shrink-0" aria-hidden="true" />
        <span className="hidden sm:inline">Creator</span>
        {active.length > 0 ? (
          <span className="rounded bg-wash-strong px-1 text-[10.5px] tabular-nums text-default">
            {active.length}
          </span>
        ) : null}
      </button>

      {/*
        Active filters are named outside the menu. A count alone makes people
        reopen the menu to remember what they narrowed to, and each chip clears
        its own filter in one click.
      */}
      {active.map((key) => (
        <button
          key={key}
          type="button"
          data-testid={`creator-filter-active-${key}`}
          onClick={() => set(key, undefined)}
          aria-label={`Remove ${CREATOR_FILTER_LABELS[key]} filter: ${creatorFacetLabel(key, filters[key] as string)}`}
          className="inline-flex h-8 max-w-[168px] shrink-0 cursor-pointer items-center gap-1 rounded-lg border border-line-strong bg-elevated px-2 text-[11.5px] font-medium text-ink transition-colors hover:bg-overlay focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        >
          <span className="truncate">{creatorFacetLabel(key, filters[key] as string)}</span>
          <Icon name="close" className="h-3 w-3 shrink-0 text-muted" aria-hidden="true" />
        </button>
      ))}

      {open ? (
        <div
          role="menu"
          data-testid="creator-filters-menu"
          aria-label="Creator filters"
          className="absolute left-0 top-[calc(100%+6px)] z-30 max-h-[60vh] w-[248px] overflow-y-auto rounded-2xl border border-line-mid bg-overlay p-2 elev-4"
        >
          {offered.map((key) => (
            <div key={key} className="mb-2 last:mb-0">
              <p className="px-1 pb-1 text-[11px] font-semibold text-subtle">
                {CREATOR_FILTER_LABELS[key]}
              </p>
              <div className="flex flex-wrap gap-1">
                {available[key].map((value) => {
                  const isActive = filters[key] === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      role="menuitemradio"
                      aria-checked={isActive}
                      data-testid={`creator-filter-${key}-${value}`}
                      onClick={() => set(key, isActive ? undefined : value)}
                      className={[
                        "max-w-full cursor-pointer truncate rounded-md px-1.5 py-1 text-[11.5px] transition-colors",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
                        isActive
                          ? "bg-elevated font-semibold text-ink"
                          : "bg-wash font-medium text-secondary hover:bg-wash-strong hover:text-ink",
                      ].join(" ")}
                    >
                      {creatorFacetLabel(key, value)}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          {active.length > 0 ? (
            <button
              type="button"
              data-testid="creator-filters-reset"
              onClick={() => {
                onChange({});
                setOpen(false);
                triggerRef.current?.focus();
              }}
              className="mt-1 w-full cursor-pointer rounded-lg border border-line px-2 py-1.5 text-[11.5px] font-semibold text-muted transition-colors hover:border-line-mid hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            >
              Clear all filters
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
