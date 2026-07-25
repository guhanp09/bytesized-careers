"use client";

import React from "react";
import { Icon } from "../Icons";

export default function Section({
  title,
  icon,
  hint,
  children,
  className = "",
  bodyClassName = "mt-3",
}: {
  title: string;
  icon?: React.ComponentProps<typeof Icon>["name"];
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
        <h2 className="inline-flex items-center gap-2 text-sm font-semibold tracking-tight text-white/90">
          {icon ? (
            <span aria-hidden="true" className="inline-flex shrink-0 text-muted">
              <Icon name={icon} className="h-4 w-4" />
            </span>
          ) : null}
          <span>{title}</span>
        </h2>
        {hint ? <div className="text-xs text-muted">{hint}</div> : null}
      </div>
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}
