"use client";

import React, { type ReactNode } from "react";

export default function PageHeader({
  title,
  description,
  eyebrow,
  action,
  className = "",
}: {
  title: string;
  description?: string;
  eyebrow?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={[
        "flex flex-col gap-4 border-b border-white/[0.08] pb-5 sm:flex-row sm:items-end sm:justify-between",
        className,
      ].join(" ")}
    >
      <div className="space-y-2">
        {eyebrow ? (
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-subtle">
            {eyebrow}
          </p>
        ) : null}
        <div className="space-y-1.5">
          <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-[30px]">
            {title}
          </h1>
          {description ? (
            <p className="max-w-2xl text-sm leading-6 text-muted">{description}</p>
          ) : null}
        </div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}
