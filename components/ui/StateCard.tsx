"use client";

import Link from "next/link";
import React, { type ReactNode } from "react";

import { Icon } from "../Icons";

type StateIcon =
  | "inbox"
  | "bookmark"
  | "search"
  | "bell"
  | "user"
  | "users"
  | "briefcase"
  | "send"
  | "alert";

export default function StateCard({
  icon,
  title,
  description,
  actionLabel,
  actionHref,
  action,
  align = "left",
  className = "",
}: {
  icon?: StateIcon;
  title: string;
  description?: string;
  actionLabel?: string;
  actionHref?: string;
  action?: ReactNode;
  align?: "left" | "center";
  className?: string;
}) {
  return (
    <section
      className={[
        "rounded-[28px] border border-white/[0.08] bg-white/[0.04] p-6 shadow-[0_18px_60px_-42px_rgba(0,0,0,0.95)]",
        align === "center" ? "text-center" : "",
        className,
      ].join(" ")}
    >
      <div
        className={[
          "space-y-3",
          align === "center" ? "flex flex-col items-center" : "",
        ].join(" ")}
      >
        {icon ? (
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.045] text-white/58">
            <Icon name={icon} className="h-5 w-5" />
          </span>
        ) : null}
        <div className="space-y-2">
          <h2 className="text-base font-semibold tracking-tight text-white/92">{title}</h2>
          {description ? (
            <p className="max-w-xl text-sm leading-6 text-white/55">{description}</p>
          ) : null}
        </div>
        {action ? action : null}
        {!action && actionLabel && actionHref ? (
          <Link
            href={actionHref}
            className="inline-flex h-10 cursor-pointer items-center justify-center rounded-xl border border-white/[0.1] bg-white/[0.045] px-4 text-sm font-semibold text-white/78 transition hover:-translate-y-0.5 hover:border-white/[0.18] hover:bg-white/[0.075] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
          >
            {actionLabel}
          </Link>
        ) : null}
      </div>
    </section>
  );
}
