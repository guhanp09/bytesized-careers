"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ComponentProps, type ReactNode } from "react";
import { Icon } from "../Icons";
import { getAdminOverview } from "../../lib/backendClient";

type IconName = ComponentProps<typeof Icon>["name"];

/**
 * Admin panel shell: left-rail navigation (queues first, records second,
 * oversight last — docs/ADMIN_PANEL_PLAN.md §6), workload badges on the two
 * daily queues, and an environment strip outside production. Route access is
 * enforced server-side in app/admin/layout.tsx; the backend re-checks ADMIN on
 * every data call.
 */

type NavItem = {
  href: string;
  label: string;
  icon: IconName;
  badge?: "reports" | "verifications";
};

const NAV: NavItem[] = [
  { href: "/admin", label: "Overview", icon: "sparkles" },
  { href: "/admin/reports", label: "Reports", icon: "alert", badge: "reports" },
  { href: "/admin/verification", label: "Verification", icon: "check", badge: "verifications" },
  { href: "/admin/users", label: "Users", icon: "user-plus" },
  { href: "/admin/listings", label: "Listings", icon: "briefcase" },
  { href: "/admin/conversations", label: "Conversations", icon: "message-square-text" },
  { href: "/admin/platform", label: "Platform", icon: "bell" },
  { href: "/admin/compliance", label: "Compliance", icon: "file" },
  { href: "/admin/audit", label: "Audit log", icon: "notebook-text" },
];

export default function AdminShell({
  accessToken,
  environment,
  devToolsAllowed,
  children,
}: {
  accessToken: string;
  environment: string;
  devToolsAllowed: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [badges, setBadges] = useState<{ reports: number; verifications: number }>({
    reports: 0,
    verifications: 0,
  });

  // Workload badges are a courtesy signal; failures stay silent (each page
  // surfaces its own load errors).
  useEffect(() => {
    let cancelled = false;
    getAdminOverview(accessToken)
      .then((overview) => {
        if (cancelled) return;
        setBadges({ reports: overview.reports_open, verifications: overview.verifications_pending });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [accessToken, pathname]);

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col px-3 py-4 sm:px-5 lg:flex-row lg:gap-6 xl:px-8">
      <aside className="shrink-0 lg:w-56" data-testid="admin-nav">
        <div className="mb-4 px-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-subtle">CreatorJobs</p>
          <h1 className="mt-0.5 text-lg font-semibold text-white">Admin</h1>
        </div>
        {environment !== "production" ? (
          <p
            data-testid="admin-env-banner"
            className="mb-3 inline-flex items-center gap-1.5 rounded-lg border border-amber-200/25 bg-amber-200/[0.07] px-2.5 py-1.5 text-[10.5px] font-semibold text-amber-100/85"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-amber-300" aria-hidden />
            {environment} environment
          </p>
        ) : null}
        <nav className="flex flex-row flex-wrap gap-1 lg:flex-col" aria-label="Admin sections">
          {NAV.map((item) => {
            const active = item.href === "/admin" ? pathname === "/admin" : pathname.startsWith(item.href);
            const badge = item.badge ? badges[item.badge] : 0;
            return (
              <Link
                key={item.href}
                href={item.href}
                data-testid={`admin-nav-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
                aria-current={active ? "page" : undefined}
                className={[
                  "inline-flex h-9 items-center gap-2.5 rounded-xl px-3 text-[12.5px] font-semibold transition-colors",
                  active ? "bg-white text-black" : "text-white/60 hover:bg-white/[0.06] hover:text-white",
                ].join(" ")}
              >
                <Icon name={item.icon} className="h-3.5 w-3.5" />
                {item.label}
                {badge > 0 ? (
                  <span
                    className={[
                      "ml-auto inline-flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-semibold leading-none",
                      active ? "bg-black/15 text-black" : "bg-white/[0.1] text-white/75",
                    ].join(" ")}
                  >
                    {badge > 99 ? "99+" : badge}
                  </span>
                ) : null}
              </Link>
            );
          })}
          {devToolsAllowed ? (
            <div className="mt-2 border-t border-white/[0.06] pt-2 lg:mt-3 lg:pt-3">
              <Link
                href="/dev/emails"
                data-testid="admin-nav-dev-tools"
                className="inline-flex h-9 items-center gap-2.5 rounded-xl px-3 text-[12.5px] font-semibold text-muted transition-colors hover:bg-white/[0.06] hover:text-white"
              >
                <Icon name="menu" className="h-3.5 w-3.5" />
                Dev tools
                <span className="ml-auto rounded-full border border-white/[0.09] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] text-subtle">
                  Dev
                </span>
              </Link>
            </div>
          ) : null}
        </nav>
      </aside>
      <div className="mt-5 min-w-0 flex-1 lg:mt-0">{children}</div>
    </div>
  );
}
