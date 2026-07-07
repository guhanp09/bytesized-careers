"use client";

import Link from "next/link";
import { getAdminOverview } from "../../lib/backendClient";
import {
  AdminCard,
  AdminError,
  AdminLoading,
  AdminSectionLabel,
  TonePill,
  useAdminFetch,
} from "./ui";

/**
 * Operational overview (docs/ADMIN_PANEL_PLAN.md §7.1): the action-queue strip
 * the operator clears daily, current marketplace shape, and system posture.
 * Deliberately no trend charts or vanity metrics.
 */
export default function AdminOverviewClient({ accessToken }: { accessToken: string }) {
  const { data, state, reload } = useAdminFetch(() => getAdminOverview(accessToken), [accessToken]);

  if (state === "loading") return <AdminLoading rows={6} />;
  if (state === "error" || !data) return <AdminError onRetry={reload} />;

  const queue = [
    { label: "Open reports", value: data.reports_open, href: "/admin/reports", urgent: data.reports_open > 0 },
    {
      label: "Pending verification",
      value: data.verifications_pending,
      href: "/admin/verification",
      urgent: data.verifications_pending > 0,
    },
    { label: "New users · 7d", value: data.users_new_7d, href: "/admin/users" },
    {
      label: "New applications · 7d",
      value: data.applications_new_7d,
      href: "/admin/conversations",
    },
  ];

  return (
    <div className="space-y-4" data-testid="admin-overview">
      {/* Action queue: what needs a human today. */}
      <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
        {queue.map((entry) => (
          <Link
            key={entry.label}
            href={entry.href}
            data-testid="admin-queue-tile"
            className={[
              "group rounded-2xl border p-4 transition-colors",
              entry.urgent
                ? "border-amber-200/25 bg-amber-200/[0.05] hover:border-amber-200/45"
                : "border-white/[0.07] bg-white/[0.03] hover:border-white/[0.18]",
            ].join(" ")}
          >
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-white/45">
              {entry.label}
            </p>
            <p className="mt-1.5 text-2xl font-semibold tabular-nums text-white">{entry.value}</p>
          </Link>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <AdminCard className="p-4">
          <AdminSectionLabel>Marketplace shape</AdminSectionLabel>
          <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5 text-[12px]">
            <p className="text-white/45">Users</p>
            <p className="text-right tabular-nums text-white/85">
              {data.users_total}
              {data.users_suspended > 0 ? (
                <span className="ml-2 text-rose-200/75">{data.users_suspended} suspended</span>
              ) : null}
            </p>
            <p className="text-white/45">Jobs (live / drafts / paused)</p>
            <p className="text-right tabular-nums text-white/85">
              {data.jobs_by_status.published ?? 0} / {data.jobs_by_status.draft ?? 0} /{" "}
              {data.jobs_by_status.paused ?? 0}
            </p>
            <p className="text-white/45">Talent listings (live / drafts)</p>
            <p className="text-right tabular-nums text-white/85">
              {data.talent_by_status.published ?? 0} / {data.talent_by_status.draft ?? 0}
            </p>
            <p className="text-white/45">Hidden by moderation</p>
            <p className="text-right tabular-nums text-white/85">
              {data.jobs_deleted + data.talent_deleted}
            </p>
            <p className="text-white/45">Applications (total · 7d)</p>
            <p className="text-right tabular-nums text-white/85">
              {data.applications_total} · {data.applications_new_7d}
            </p>
            <p className="text-white/45">Hiring requests (total · 7d)</p>
            <p className="text-right tabular-nums text-white/85">
              {data.interests_total} · {data.interests_new_7d}
            </p>
            <p className="text-white/45">Messages</p>
            <p className="text-right tabular-nums text-white/85">{data.messages_total}</p>
            <p className="text-white/45">Active entitlements</p>
            <p className="text-right tabular-nums text-white/85">{data.entitlements_active}</p>
          </div>
        </AdminCard>

        <AdminCard className="p-4">
          <AdminSectionLabel>System</AdminSectionLabel>
          <div className="mt-3 space-y-2.5 text-[12px]">
            <div className="flex items-center justify-between">
              <span className="text-white/45">Environment</span>
              <TonePill tone={data.env === "production" ? "active" : "warn"}>{data.env}</TonePill>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-white/45">Email mode</span>
              <TonePill tone="neutral">{data.email_mode}</TonePill>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-white/45">Email delivery</span>
              <TonePill tone={data.email_delivery_enabled ? "active" : "dim"}>
                {data.email_delivery_enabled ? "enabled" : "mocked"}
              </TonePill>
            </div>
            <p className="pt-1 text-[11px] leading-relaxed text-white/38">
              Notification emails queue to the outbox and are mocked until a domain + provider are
              configured. Inspect them under Platform.
            </p>
          </div>
        </AdminCard>
      </div>
    </div>
  );
}
