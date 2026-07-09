"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  isSubfilterActive,
  subfilterHref,
  subfiltersForRoute,
  type SeoFilterRoute,
} from "../lib/seoFilterRoutes";

/**
 * Row-2 contextual subfilters. Appears only on a curated SEO route that anchors a
 * role; shows the role-relevant refinements grouped by dimension. A chip with a
 * curated combo route navigates there (self-canonical); otherwise it toggles a
 * `?<dimension>=` param on the current path (noindex, strictly filtered). Modelled
 * apart from Row-1 role chips — never a role, never a dimension dump.
 */
export default function SubfilterRow({ seoRoute }: { seoRoute?: SeoFilterRoute | null }) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const subfilters = subfiltersForRoute(seoRoute);
  if (!seoRoute || subfilters.length === 0) return null;

  // A stable snapshot of the current query for active-state + toggle-href.
  const currentParams = new URLSearchParams(searchParams.toString());

  return (
    <div
      data-testid="subfilter-row"
      className="border-t border-white/[0.06] px-3 py-1.5 sm:px-4"
    >
      <div className="min-w-0 overflow-x-auto">
        <div className="flex w-max items-center gap-1.5">
          {subfilters.map((chip, index) => {
            const previous = subfilters[index - 1];
            const showGroupLabel = !previous || previous.group !== chip.group;
            const active = isSubfilterActive(seoRoute, chip, currentParams);
            const href = subfilterHref(seoRoute, chip, active, pathname, currentParams);
            return (
              <span key={`${chip.group}-${chip.value}`} className="inline-flex items-center gap-1.5">
                {showGroupLabel ? (
                  <span className="shrink-0 pl-1.5 pr-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/30">
                    {chip.group}
                  </span>
                ) : null}
                <Link
                  href={href}
                  scroll={false}
                  data-testid="subfilter-chip"
                  aria-pressed={active}
                  className={[
                    "cursor-pointer whitespace-nowrap rounded-lg px-2.5 py-1 text-[13px] transition-colors",
                    active ? "bg-white text-black" : "bg-white/[0.07] text-white/85 hover:bg-white/[0.12]",
                  ].join(" ")}
                >
                  {chip.label}
                </Link>
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}
