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
  icon: "eye" | "clock" | "users" | "bolt";
  value: string;
  label?: string;
  interactive?: boolean;
  className?: string;
}) {
  return (
    <span className={["relative inline-flex", className].join(" ")}>
      <span
        className={[
          "inline-flex h-10 items-center gap-1 text-xs text-white/70",
          interactive ? "hover:text-white/90 transition-colors peer" : "",
        ].join(" ")}
      >
        <span className="text-current inline-flex w-4 justify-center">
          <Icon name={icon} className="w-4 h-4" />
        </span>
        <span className="tabular-nums">{value}</span>
      </span>

      {label ? <IconTooltip label={label} className="-top-5" /> : null}
    </span>
  );
}
