"use client";

import { Fragment, useState } from "react";
import { getAdminAuditLog } from "../../lib/backendClient";
import {
  AdminEmpty,
  AdminError,
  AdminLoading,
  AdminTable,
  FilterChip,
  formatDateTime,
  Paginator,
  personLabel,
  Td,
  Th,
  useAdminFetch,
} from "./ui";

/**
 * The audit log (docs/ADMIN_PANEL_PLAN.md §15): append-only, filterable,
 * read-only forever. Rows expand to show the before/after diff and the
 * justification recorded with the action.
 */

const PAGE = 30;

const TARGET_FILTERS = ["", "report", "user", "job", "talent_listing", "hiring_identity", "message", "review", "conversation", "entitlement"] as const;

export default function AdminAuditClient({ accessToken }: { accessToken: string }) {
  const [targetType, setTargetType] = useState<string>("");
  const [offset, setOffset] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data, state, reload } = useAdminFetch(
    () => getAdminAuditLog(accessToken, { target_type: targetType || undefined, limit: PAGE, offset }),
    [accessToken, targetType, offset]
  );

  const items = data?.items ?? [];

  return (
    <div className="space-y-3" data-testid="admin-audit">
      <div className="flex flex-wrap items-center gap-1.5">
        {TARGET_FILTERS.map((filter) => (
          <FilterChip
            key={filter || "all"}
            active={targetType === filter}
            onClick={() => {
              setTargetType(filter);
              setOffset(0);
            }}
          >
            {filter ? filter.replaceAll("_", " ") : "All"}
          </FilterChip>
        ))}
      </div>

      {state === "loading" ? (
        <AdminLoading rows={7} />
      ) : state === "error" || !data ? (
        <AdminError onRetry={reload} />
      ) : items.length === 0 ? (
        <AdminEmpty
          title="No audit entries yet."
          hint="Every admin action lands here — suspensions, listing state changes, report resolutions, verification decisions, reported-conversation views."
        />
      ) : (
        <>
          <AdminTable
            testId="admin-audit-table"
            head={
              <>
                <Th>When</Th>
                <Th>Actor</Th>
                <Th>Action</Th>
                <Th>Target</Th>
                <Th>Justification</Th>
              </>
            }
          >
            {items.map((entry) => (
              <Fragment key={entry.id}>
                <tr
                  data-testid="admin-audit-row"
                  onClick={() => setExpanded((value) => (value === entry.id ? null : entry.id))}
                  className="cursor-pointer transition-colors hover:bg-white/[0.03]"
                >
                  <Td className="whitespace-nowrap text-muted">{formatDateTime(entry.created_at)}</Td>
                  <Td className="max-w-[150px] truncate">{personLabel(entry.actor)}</Td>
                  <Td className="whitespace-nowrap font-medium text-white/85">{entry.action}</Td>
                  <Td className="max-w-[260px] truncate text-white/60">
                    {entry.target_label || `${entry.target_type} · ${entry.target_id.slice(0, 8)}…`}
                  </Td>
                  <Td className="max-w-[260px] truncate text-muted">{entry.justification || "—"}</Td>
                </tr>
                {expanded === entry.id && (entry.before_json || entry.after_json || entry.justification) ? (
                  <tr className="bg-white/[0.015]">
                    <td colSpan={5} className="px-3 py-3">
                      <div className="grid gap-3 text-[11px] sm:grid-cols-2">
                        {entry.before_json ? (
                          <div>
                            <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-subtle">Before</p>
                            <pre className="overflow-x-auto rounded-lg bg-black/30 p-2.5 text-[10.5px] leading-relaxed text-white/60">
                              {JSON.stringify(entry.before_json, null, 2)}
                            </pre>
                          </div>
                        ) : null}
                        {entry.after_json ? (
                          <div>
                            <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-subtle">After</p>
                            <pre className="overflow-x-auto rounded-lg bg-black/30 p-2.5 text-[10.5px] leading-relaxed text-white/60">
                              {JSON.stringify(entry.after_json, null, 2)}
                            </pre>
                          </div>
                        ) : null}
                        {entry.justification ? (
                          <p className="text-white/55 sm:col-span-2">“{entry.justification}”</p>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            ))}
          </AdminTable>
          <Paginator total={data.total} limit={PAGE} offset={offset} onOffset={setOffset} />
        </>
      )}
    </div>
  );
}
