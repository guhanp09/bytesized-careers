"use client";

import React from "react";
import { Icon } from "../Icons";
import IconTooltip from "./IconTooltip";

export default function StatRow({
  icon,
  value,
  label,
  interactive = false,
  className = "",
}: {
  icon: "eye" | "clock" | "users" | "bolt" | "image" | "bookmark" | "user-plus";
  value: string;
  label?: string;
  interactive?: boolean;
  className?: string;
}) {
  const tooltipId = React.useId();
  const anchorRef = React.useRef<HTMLSpanElement | null>(null);
  const [open, setOpen] = React.useState(false);

  return (
    <span className={["relative inline-flex", className].join(" ")}>
      <span
        ref={anchorRef}
        tabIndex={interactive ? 0 : undefined}
        aria-describedby={label && open ? tooltipId : undefined}
        onMouseEnter={interactive ? () => setOpen(true) : undefined}
        onMouseLeave={interactive ? () => setOpen(false) : undefined}
        onFocus={interactive ? () => setOpen(true) : undefined}
        onBlur={interactive ? () => setOpen(false) : undefined}
        onKeyDown={
          interactive
            ? (event) => {
                event.stopPropagation();
              }
            : undefined
        }
        className={[
          "inline-flex items-center gap-1 rounded-md text-xs leading-4 text-white/70",
          interactive
            ? "cursor-pointer transition-colors hover:text-white/90 focus-visible:text-white/90 focus-visible:outline-none"
            : "",
        ].join(" ")}
      >
        <span className="text-current inline-flex w-4 justify-center">
          <Icon name={icon} className="w-4 h-4" />
        </span>
        <span className="tabular-nums">{value}</span>
        {label ? <span className="sr-only">{label}</span> : null}
      </span>

      {label ? (
        <IconTooltip
          label={label}
          anchorRef={anchorRef}
          open={open}
          id={tooltipId}
          sideOffset={4}
        />
      ) : null}
    </span>
  );
}
