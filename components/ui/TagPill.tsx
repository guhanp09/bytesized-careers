"use client";

import React from "react";

export default function TagPill({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={[
        "text-[11px] px-2 py-1 rounded-lg bg-white/8 border border-white/10 text-white/70",
        className,
      ].join(" ")}
    >
      {children}
    </span>
  );
}
