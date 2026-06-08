"use client";

import React from "react";

export default function Section({
  title,
  hint,
  children,
  className = "",
  bodyClassName = "mt-3",
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section
      className={[
        "rounded-2xl bg-white/[0.06] border border-white/10 p-5",
        "shadow-[0_10px_30px_-20px_rgba(0,0,0,0.9)]",
        className,
      ].join(" ")}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold tracking-tight text-white/90">{title}</h2>
        {hint ? <div className="text-xs text-white/45">{hint}</div> : null}
      </div>
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}
