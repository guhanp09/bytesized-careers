import type { ReactNode } from "react";

/**
 * Shared editorial primitives for listing detail bodies (jobs + talent).
 *
 * No "use client" directive: these are pure presentational components, so they
 * render in either a server tree (talent page) or a client tree (job sections).
 */

/** Subtle, almost-flush surface so a listing body reads as an article, not a stack of heavy cards. */
export const LISTING_PANEL_CLASS =
  "rounded-3xl bg-white/[0.03] border border-white/[0.07] px-6 sm:px-9 shadow-[0_18px_60px_-40px_rgba(0,0,0,0.95)]";

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <h2 className="text-[11px] font-semibold uppercase tracking-[0.26em] text-white/40">{children}</h2>
  );
}

/**
 * Editorial label + readable body. Vertical padding lives here (not on the
 * panel) so `divide-y` on the parent draws an evenly spaced rule between
 * sections, and the first/last section keep symmetric breathing room.
 */
export function BodySection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="py-8">
      <SectionLabel>{title}</SectionLabel>
      <div className="mt-4 text-sm leading-relaxed text-white/80">{children}</div>
    </section>
  );
}

export function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="space-y-3.5">
      {items.map((item) => (
        <li key={item} className="flex gap-3.5">
          <span aria-hidden className="mt-[0.6em] h-1.5 w-1.5 shrink-0 rounded-full bg-white/30" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export function Pills({ items }: { items: string[] }) {
  return (
    <div className="flex flex-wrap gap-2.5">
      {items.map((item) => (
        <span
          key={item}
          className="rounded-full border border-white/[0.09] bg-white/[0.04] px-4 py-2 text-[13px] font-medium text-white/60"
        >
          {item}
        </span>
      ))}
    </div>
  );
}
