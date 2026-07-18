"use client";

import React from "react";
import { Icon } from "../Icons";

export default function MetaRow({
  icon,
  text,
  className = "",
  truncate = false,
}: {
  icon: "briefcase" | "cap" | "pin" | "cash" | "cash-stack" | "clock";
  text: string;
  className?: string;
  /** Keep the row to a single line, eliding overflow. Off by default to preserve wrapping callers. */
  truncate?: boolean;
}) {
  return (
    <div className={["flex items-center gap-2 text-sm", truncate ? "min-w-0" : "", className].join(" ")}>
      <span className="shrink-0 text-[var(--vt-meta-icon,rgba(255,255,255,0.7))]">
        <Icon name={icon} className="w-4 h-4" />
      </span>
      <span className={["text-[var(--vt-meta-text,rgba(255,255,255,0.9))] leading-snug", truncate ? "min-w-0 truncate" : ""].join(" ")}>{text}</span>
    </div>
  );
}
