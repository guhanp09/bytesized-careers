"use client";

import React, { useId, useRef, useState } from "react";
import IconTooltip from "./IconTooltip";

/**
 * A single, consistent question-mark affordance for moving non-critical helper
 * text off the page and into an on-demand tooltip. Accessible by mouse (hover),
 * keyboard (focus + Escape), and touch (click toggle); the floating content is
 * portalled and viewport-clamped by {@link IconTooltip} so it never clips.
 *
 * Do NOT use this for critical information (validation errors, unpaid-trial
 * confirmation, usage/attribution rights, sensitive-access warnings, publication
 * blockers) — those must stay visibly rendered.
 */
export default function QuestionTooltip({
  label,
  srLabel = "More information",
  className = "",
}: {
  /** The explanation shown inside the tooltip. */
  label: string;
  /** Accessible name for the trigger button. */
  srLabel?: string;
  className?: string;
}) {
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const rawId = useId();
  const tooltipId = `qtip-${rawId.replace(/[:]/g, "")}`;

  return (
    <span className="inline-flex align-middle">
      <button
        ref={anchorRef}
        type="button"
        aria-label={srLabel}
        aria-expanded={open}
        aria-describedby={open ? tooltipId : undefined}
        className={[
          "inline-flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center rounded-full",
          "border border-white/25 text-[9px] font-bold leading-none text-white/55",
          "transition-colors hover:border-white/45 hover:text-white/85",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/35",
          className,
        ].join(" ")}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={(event) => {
          // Toggle for touch/click without ever submitting the surrounding form.
          event.preventDefault();
          setOpen((value) => !value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && open) {
            event.stopPropagation();
            setOpen(false);
          }
        }}
      >
        ?
      </button>
      <IconTooltip
        label={label}
        anchorRef={anchorRef}
        open={open}
        id={tooltipId}
        className="max-w-[260px] !whitespace-normal text-left leading-4"
      />
    </span>
  );
}
