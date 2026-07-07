"use client";

import { useState } from "react";
import {
  getAdminAbuseSignals,
  listAdminApplications,
  listAdminTalentInterests,
} from "../../lib/backendClient";
import {
  AdminCard,
  AdminEmpty,
  AdminError,
  AdminLoading,
  AdminSectionLabel,
  AdminTable,
  FilterChip,
  formatAge,
  Paginator,
  personLabel,
  Td,
  Th,
  TonePill,
  useAdminFetch,
} from "./ui";

/**
 * Conversations — Tier-1 metadata only (docs/ADMIN_PANEL_PLAN.md §7.6):
 * application and hiring-request records (parties, context, status, timing)
 * and volume-outlier signals. Message content is never browsable here — it
 * opens only through a message report in the Reports queue, where the view
 * itself is audited.
 */

const PAGE = 25;

type Tab = "applications" | "requests" | "signals";

export default function AdminConversationsClient({ accessToken }: { accessToken: string }) {
  const [tab, setTab] = useState<Tab>("applications");
  const [days, setDays] = useState<number | undefined>(undefined);
  const [offset, setOffset] = useState(0);

  const applications = useAdminFetch(
    () =>
      tab === "applications"
        ? listAdminApplications(accessToken, { days, limit: PAGE, offset })
        : Promise.resolve(null),
    [accessToken, tab, days, offset]
  );
  const interests = useAdminFetch(
    () =>
      tab === "requests"
        ? listAdminTalentInterests(accessToken, { days, limit: PAGE, offset })
        : Promise.resolve(null),
    [accessToken, tab, days, offset]
  );
  const signals = useAdminFetch(
    () => (tab === "signals" ? getAdminAbuseSignals(accessToken, 7) : Promise.resolve(null)),
    [accessToken, tab]
  );

  return (
    <div className="space-y-3" data-testid="admin-conversations">
      <div className="flex flex-wrap items-center gap-1.5">
        {(
          [
            { key: "applications", label: "Applications" },
            { key: "requests", label: "Hiring requests" },
            { key: "signals", label: "Volume signals" },
          ] as const
        ).map((entry) => (
          <FilterChip
            key={entry.key}
            testId={`admin-conversations-tab-${entry.key}`}
            active={tab === entry.key}
            onClick={() => {
              setTab(entry.key);
              setOffset(0);
            }}
          >
            {entry.label}
          </FilterChip>
        ))}
        {tab !== "signals" ? (
          <>
            <span className="hidden h-4 w-px bg-white/[0.08] sm:block" aria-hidden />
            {[undefined, 7, 30].map((window) => (
              <FilterChip
                key={window ?? "all"}
                active={days === window}
                onClick={() => {
                  setDays(window);
                  setOffset(0);
                }}
              >
                {window ? `Last ${window}d` : "All time"}
              </FilterChip>
            ))}
          </>
        ) : null}
      </div>

      <p className="text-[11px] leading-relaxed text-white/38">
        Metadata only — who, what, when, and status. Message content opens exclusively through a
        message report in <span className="text-white/60">Reports</span>, and every such view is
        written to the audit log.
      </p>

      {tab === "applications" ? (
        applications.state === "loading" ? (
          <AdminLoading rows={6} />
        ) : applications.state === "error" ? (
          <AdminError onRetry={applications.reload} />
        ) : !applications.data || applications.data.items.length === 0 ? (
          <AdminEmpty title="No applications in this window." />
        ) : (
          <>
            <AdminTable
              testId="admin-applications-table"
              head={
                <>
                  <Th>Job</Th>
                  <Th>Applicant</Th>
                  <Th>Job owner</Th>
                  <Th>Status</Th>
                  <Th>Created</Th>
                  <Th>Updated</Th>
                </>
              }
            >
              {applications.data.items.map((item) => (
                <tr key={item.id} data-testid="admin-application-row" className="transition-colors hover:bg-white/[0.03]">
                  <Td className="max-w-[260px] truncate font-medium text-white/85">{item.job_title || "—"}</Td>
                  <Td className="max-w-[180px] truncate">{personLabel(item.applicant)}</Td>
                  <Td className="max-w-[180px] truncate">{personLabel(item.owner)}</Td>
                  <Td>
                    <TonePill tone="neutral">{item.status}</TonePill>
                  </Td>
                  <Td className="whitespace-nowrap text-white/50">{formatAge(item.created_at)}</Td>
                  <Td className="whitespace-nowrap text-white/50">{formatAge(item.updated_at)}</Td>
                </tr>
              ))}
            </AdminTable>
            <Paginator total={applications.data.total} limit={PAGE} offset={offset} onOffset={setOffset} />
          </>
        )
      ) : null}

      {tab === "requests" ? (
        interests.state === "loading" ? (
          <AdminLoading rows={6} />
        ) : interests.state === "error" ? (
          <AdminError onRetry={interests.reload} />
        ) : !interests.data || interests.data.items.length === 0 ? (
          <AdminEmpty title="No hiring requests in this window." />
        ) : (
          <>
            <AdminTable
              testId="admin-interests-table"
              head={
                <>
                  <Th>Listing</Th>
                  <Th>Recruiter</Th>
                  <Th>Talent</Th>
                  <Th>Status</Th>
                  <Th>Created</Th>
                  <Th>Updated</Th>
                </>
              }
            >
              {interests.data.items.map((item) => (
                <tr key={item.id} data-testid="admin-interest-row" className="transition-colors hover:bg-white/[0.03]">
                  <Td className="max-w-[260px] truncate font-medium text-white/85">{item.listing_title || "—"}</Td>
                  <Td className="max-w-[180px] truncate">{personLabel(item.recruiter)}</Td>
                  <Td className="max-w-[180px] truncate">{personLabel(item.owner)}</Td>
                  <Td>
                    <TonePill tone="neutral">{item.status}</TonePill>
                  </Td>
                  <Td className="whitespace-nowrap text-white/50">{formatAge(item.created_at)}</Td>
                  <Td className="whitespace-nowrap text-white/50">{formatAge(item.updated_at)}</Td>
                </tr>
              ))}
            </AdminTable>
            <Paginator total={interests.data.total} limit={PAGE} offset={offset} onOffset={setOffset} />
          </>
        )
      ) : null}

      {tab === "signals" ? (
        signals.state === "loading" ? (
          <AdminLoading rows={4} />
        ) : signals.state === "error" ? (
          <AdminError onRetry={signals.reload} />
        ) : !signals.data ? (
          <AdminEmpty title="No signal data." />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2" data-testid="admin-signals">
            <AdminCard className="p-4">
              <AdminSectionLabel>Most hiring requests sent · 7d</AdminSectionLabel>
              <div className="mt-2.5 space-y-1.5">
                {signals.data.top_interest_senders.length === 0 ? (
                  <p className="text-[11.5px] text-white/38">No outreach in the window.</p>
                ) : (
                  signals.data.top_interest_senders.map((row) => (
                    <div key={row.user.id} className="flex items-center justify-between gap-2 text-[12px]">
                      <span className="min-w-0 truncate text-white/75">{personLabel(row.user)}</span>
                      <span className="tabular-nums text-white/50">{row.count}</span>
                    </div>
                  ))
                )}
              </div>
            </AdminCard>
            <AdminCard className="p-4">
              <AdminSectionLabel>Most applications sent · 7d</AdminSectionLabel>
              <div className="mt-2.5 space-y-1.5">
                {signals.data.top_applicants.length === 0 ? (
                  <p className="text-[11.5px] text-white/38">No applications in the window.</p>
                ) : (
                  signals.data.top_applicants.map((row) => (
                    <div key={row.user.id} className="flex items-center justify-between gap-2 text-[12px]">
                      <span className="min-w-0 truncate text-white/75">{personLabel(row.user)}</span>
                      <span className="tabular-nums text-white/50">{row.count}</span>
                    </div>
                  ))
                )}
              </div>
            </AdminCard>
            <p className="text-[10.5px] leading-relaxed text-white/32 lg:col-span-2">
              Volume is a review signal, not a verdict — cross-check high senders in Users before acting.
            </p>
          </div>
        )
      ) : null}
    </div>
  );
}
