"use client";

import React from "react";

export default function IconTooltip({
  label,
  className = "",
}: {
  label: string;
  className?: string;
}) {
  return (
    <span
      className={[
        "pointer-events-none",
        "absolute left-1/2 -translate-x-1/2",
        "px-2 py-1 rounded-md",
        "text-[11px] text-white/90",
        "bg-black/80 border border-white/10",
        "shadow-[0_8px_18px_-10px_rgba(0,0,0,0.9)]",
        "opacity-0 translate-y-1",
        "transition-all duration-150",
        "whitespace-nowrap",
        "peer-hover:opacity-100 peer-hover:translate-y-0",
        className,
      ].join(" ")}
    >
      {label}
    </span>
  );
}
