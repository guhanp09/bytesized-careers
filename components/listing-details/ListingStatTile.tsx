import React from "react";
import { Icon } from "../Icons";

type IconName = React.ComponentProps<typeof Icon>["name"];

/**
 * Shared metric/stat tile for job + talent listing detail heroes.
 *
 * The icon lives in a fixed-size slot (`flex items-center justify-center`,
 * `leading-none`) so the SVG renders as a centered flex item instead of a
 * baseline-aligned inline element. That keeps every icon on the same visual
 * line across the row regardless of how each glyph sits inside its viewBox —
 * no per-icon margin nudging required.
 */
export default function ListingStatTile({
  icon,
  label,
  value,
}: {
  icon: IconName;
  label: string;
  value: string;
}) {
  return (
    <div className="flex h-[108px] select-none items-center justify-center rounded-2xl border border-white/[0.06] bg-white/[0.03] px-4 py-3">
      <div className="flex flex-col items-center justify-center gap-1 text-center">
        <span className="flex h-5 w-5 items-center justify-center leading-none text-white/75">
          <Icon name={icon} className="h-4 w-4" />
        </span>
        <div className="text-[11px] leading-snug text-white/60">{label}</div>
        {/*
         * Reserve two lines of value height so a tile with a wrapping value
         * (e.g. a long rate) isn't taller than its single-line neighbours.
         * Equal content height keeps the vertically-centered icons on the same
         * line across the row.
         */}
        <div className="min-h-[2.5rem] text-sm font-medium leading-snug text-white/90 tabular-nums">
          {value}
        </div>
      </div>
    </div>
  );
}
