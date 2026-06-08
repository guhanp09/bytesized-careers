"use client";

import Link from "next/link";
import { Icon } from "../Icons";

export function EmptyState({
  title,
  subtitle,
  href,
  action,
  icon = "globe",
}: {
  title: string;
  subtitle?: string;
  href?: string;
  action?: string;
  icon?: "globe" | "briefcase" | "users" | "bookmark" | "bell";
}) {
  return (
    <section className="relative overflow-hidden rounded-[30px] border border-white/10 bg-[#111216] px-6 py-14 text-center">
      <div className="pointer-events-none absolute inset-0 opacity-80">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_28%_18%,rgba(255,255,255,0.10),transparent_32%),radial-gradient(circle_at_78%_72%,rgba(255,255,255,0.055),transparent_30%),linear-gradient(135deg,rgba(255,255,255,0.05),rgba(255,255,255,0.014)_55%,rgba(0,0,0,0.24))]" />
        <div className="absolute left-1/2 top-1/2 h-48 w-48 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/[0.055]" />
        <div className="absolute left-[18%] top-[30%] h-16 w-40 rotate-[-8deg] rounded-2xl border border-white/[0.055] bg-white/[0.025]" />
        <div className="absolute right-[16%] bottom-[24%] h-16 w-44 rotate-[7deg] rounded-2xl border border-white/[0.045] bg-white/[0.02]" />
      </div>
      <div className="relative mx-auto max-w-md">
        <h2 className="text-xl font-semibold tracking-tight text-white/92">{title}</h2>
        {subtitle ? <p className="mt-2 text-sm leading-6 text-white/56">{subtitle}</p> : null}
        {href && action ? (
          <Link
            href={href}
            className="mt-7 inline-flex h-10 cursor-pointer items-center gap-2 rounded-full bg-white px-4 text-xs font-bold uppercase tracking-[0.12em] text-black transition-colors hover:bg-white/90"
          >
            <Icon name={icon} className="h-4 w-4" />
            {action}
          </Link>
        ) : null}
      </div>
    </section>
  );
}

