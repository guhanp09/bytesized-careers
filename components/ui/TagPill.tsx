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
        "text-[11px] px-2 py-1 rounded-lg bg-[var(--vt-tag-bg,rgba(255,255,255,0.08))] border border-[var(--vt-tag-line,rgba(255,255,255,0.1))] text-[var(--vt-tag-text,rgba(255,255,255,0.7))]",
        className,
      ].join(" ")}
    >
      {children}
    </span>
  );
}
