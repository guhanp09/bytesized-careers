"use client";

import { useState } from "react";
import {
  listAdminJobs,
  listAdminTalentListings,
  setAdminJobState,
  setAdminTalentListingState,
  type AdminJobItem,
  type AdminListingStateAction,
  type AdminTalentListingItem,
} from "../../lib/backendClient";
import {
  AdminEmpty,
  AdminError,
  AdminLoading,
  AdminSearch,
  AdminTable,
  FilterChip,
  formatAge,
  Paginator,
  personLabel,
  PlannedModule,
  ReasonDialog,
  statusTone,
  Td,
  Th,
  TonePill,
  useAdminFetch,
} from "./ui";

/**
 * Listings moderation (docs/ADMIN_PANEL_PLAN.md §7.5): jobs and talent
 * listings with lifecycle state actions (pause / unpause / hide / unhide /
 * close), each requiring a reason and writing an audit entry. The Profiles &
 * Portfolio tab is an honest Planned state — admin portfolio endpoints don't
 * exist yet.
 */

const PAGE = 25;

const STATUS_TABS = ["", "published", "draft", "paused", "closed", "archived"] as const;

const STATE_ACTIONS: Array<{
  action: AdminListingStateAction;
  label: string;
  destructive?: boolean;
  when: (item: { status: string; deleted_at?: string | null }) => boolean;
}> = [
  { action: "pause", label: "Pause", when: (item) => !item.deleted_at && item.status === "published" },
  { action: "unpause", label: "Unpause", when: (item) => !item.deleted_at && item.status === "paused" },
  { action: "close", label: "Close", when: (item) => !item.deleted_at && item.status !== "closed" },
  { action: "hide", label: "Hide", destructive: true, when: (item) => !item.deleted_at },
  { action: "unhide", label: "Unhide", when: (item) => Boolean(item.deleted_at) },
];

type Tab = "jobs" | "talent" | "profiles";

export default function AdminListingsClient({ accessToken }: { accessToken: string }) {
  const [tab, setTab] = useState<Tab>("jobs");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [query, setQuery] = useState("");
  const [committedQuery, setCommittedQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [pending, setPending] = useState<{
    kind: "job" | "talent";
    id: string;
    title: string;
    action: AdminListingStateAction;
    destructive?: boolean;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const jobs = useAdminFetch(
    () =>
      tab === "jobs"
        ? listAdminJobs(accessToken, {
            q: committedQuery || undefined,
            status: statusFilter || undefined,
            include_deleted: includeDeleted || undefined,
            limit: PAGE,
            offset,
          })
        : Promise.resolve(null),
    [accessToken, tab, committedQuery, statusFilter, includeDeleted, offset]
  );
  const talent = useAdminFetch(
    () =>
      tab === "talent"
        ? listAdminTalentListings(accessToken, {
            q: committedQuery || undefined,
            status: statusFilter || undefined,
            include_deleted: includeDeleted || undefined,
            limit: PAGE,
            offset,
          })
        : Promise.resolve(null),
    [accessToken, tab, committedQuery, statusFilter, includeDeleted, offset]
  );

  const active = tab === "jobs" ? jobs : talent;

  const runState = async (reason: string) => {
    if (!pending) return;
    setBusy(true);
    setActionError(null);
    try {
      if (pending.kind === "job") await setAdminJobState(accessToken, pending.id, pending.action, reason);
      else await setAdminTalentListingState(accessToken, pending.id, pending.action, reason);
      setPending(null);
      (pending.kind === "job" ? jobs : talent).reload();
    } catch {
      setActionError("The action failed — the backend rejected it or is unreachable.");
    } finally {
      setBusy(false);
    }
  };

  const stateButtons = (kind: "job" | "talent", item: AdminJobItem | AdminTalentListingItem) => (
    <div className="flex flex-wrap justify-end gap-1" data-no-row-click>
      {STATE_ACTIONS.filter((entry) => entry.when(item)).map((entry) => (
        <button
          key={entry.action}
          type="button"
          data-testid={`admin-listing-${entry.action}`}
          onClick={(event) => {
            event.stopPropagation();
            setActionError(null);
            setPending({ kind, id: item.id, title: item.title, action: entry.action, destructive: entry.destructive });
          }}
          className={[
            "inline-flex h-6.5 cursor-pointer items-center rounded-md border px-2 py-1 text-[10.5px] font-semibold transition-colors",
            entry.destructive
              ? "border-rose-300/25 bg-rose-300/[0.05] text-rose-200/85 hover:border-rose-300/50"
              : "border-white/[0.1] bg-white/[0.03] text-white/65 hover:border-white/25 hover:text-white",
          ].join(" ")}
        >
          {entry.label}
        </button>
      ))}
    </div>
  );

  return (
    <div className="space-y-3" data-testid="admin-listings">
      <div className="flex flex-wrap items-center gap-1.5">
        {(
          [
            { key: "jobs", label: "Jobs" },
            { key: "talent", label: "Talent listings" },
            { key: "profiles", label: "Profiles & portfolio" },
          ] as const
        ).map((entry) => (
          <FilterChip
            key={entry.key}
            testId={`admin-listings-tab-${entry.key}`}
            active={tab === entry.key}
            onClick={() => {
              setTab(entry.key);
              setOffset(0);
            }}
          >
            {entry.label}
          </FilterChip>
        ))}
      </div>

      {tab === "profiles" ? (
        <div className="space-y-3">
          <PlannedModule
            title="Portfolio & profile moderation"
            description="Hide a portfolio item, remove a project, or flag profile content from here. Until the admin portfolio endpoints exist, use Users → View public profile for review, and Reports for profile-level action."
            dependencies={["admin portfolio endpoints", "profile flag model"]}
          />
        </div>
      ) : (
        <>
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              setOffset(0);
              setCommittedQuery(query);
            }}
          >
            <AdminSearch value={query} onChange={setQuery} placeholder="Search title… ↵" testId="admin-listings-search" />
            {STATUS_TABS.map((status) => (
              <FilterChip
                key={status || "all"}
                active={statusFilter === status}
                onClick={() => {
                  setStatusFilter(status);
                  setOffset(0);
                }}
              >
                {status || "All"}
              </FilterChip>
            ))}
            <FilterChip active={includeDeleted} onClick={() => setIncludeDeleted((value) => !value)} testId="admin-listings-hidden-toggle">
              Include hidden
            </FilterChip>
          </form>

          {active.state === "loading" ? (
            <AdminLoading rows={6} />
          ) : active.state === "error" ? (
            <AdminError onRetry={active.reload} />
          ) : !active.data || active.data.items.length === 0 ? (
            <AdminEmpty title="No listings match." />
          ) : tab === "jobs" ? (
            <>
              <AdminTable
                testId="admin-jobs-table"
                minWidth={880}
                head={
                  <>
                    <Th>Job</Th>
                    <Th>Owner</Th>
                    <Th className="text-right">Applications</Th>
                    <Th className="text-right">Reports</Th>
                    <Th>Posted</Th>
                    <Th>Status</Th>
                    <Th className="text-right">Actions</Th>
                  </>
                }
              >
                {(active.data.items as AdminJobItem[]).map((item) => (
                  <tr key={item.id} data-testid="admin-job-row" className="transition-colors hover:bg-white/[0.03]">
                    <Td className="max-w-[280px]">
                      <a
                        href={`/jobs/${item.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="block truncate font-medium text-white/88 underline-offset-2 hover:underline"
                      >
                        {item.title}
                      </a>
                      <span className="mt-0.5 block truncate text-[10.5px] text-subtle">
                        {item.channel_name || item.category || "—"}
                        {item.is_verified ? <span className="ml-1.5 text-emerald-200/80">verified</span> : null}
                      </span>
                    </Td>
                    <Td className="max-w-[170px] truncate">{personLabel(item.owner)}</Td>
                    <Td className="text-right tabular-nums">{item.applications_count}</Td>
                    <Td className="text-right tabular-nums">
                      {item.reports_count > 0 ? <span className="text-amber-200/85">{item.reports_count}</span> : "—"}
                    </Td>
                    <Td className="whitespace-nowrap text-muted">{formatAge(item.created_at)}</Td>
                    <Td>
                      <TonePill tone={statusTone(item.deleted_at ? "hidden" : item.status)}>
                        {item.deleted_at ? "hidden" : item.status}
                      </TonePill>
                    </Td>
                    <Td>{stateButtons("job", item)}</Td>
                  </tr>
                ))}
              </AdminTable>
              <Paginator total={active.data.total} limit={PAGE} offset={offset} onOffset={setOffset} />
            </>
          ) : (
            <>
              <AdminTable
                testId="admin-talent-table"
                minWidth={880}
                head={
                  <>
                    <Th>Listing</Th>
                    <Th>Owner</Th>
                    <Th className="text-right">Requests</Th>
                    <Th className="text-right">Reports</Th>
                    <Th>Posted</Th>
                    <Th>Status</Th>
                    <Th className="text-right">Actions</Th>
                  </>
                }
              >
                {(active.data.items as AdminTalentListingItem[]).map((item) => (
                  <tr key={item.id} data-testid="admin-talent-row" className="transition-colors hover:bg-white/[0.03]">
                    <Td className="max-w-[280px]">
                      <a
                        href={`/talent/${item.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="block truncate font-medium text-white/88 underline-offset-2 hover:underline"
                      >
                        {item.title}
                      </a>
                      <span className="mt-0.5 block truncate text-[10.5px] text-subtle">
                        {item.primary_role || "—"}
                      </span>
                    </Td>
                    <Td className="max-w-[170px] truncate">{personLabel(item.owner)}</Td>
                    <Td className="text-right tabular-nums">{item.interests_count}</Td>
                    <Td className="text-right tabular-nums">
                      {item.reports_count > 0 ? <span className="text-amber-200/85">{item.reports_count}</span> : "—"}
                    </Td>
                    <Td className="whitespace-nowrap text-muted">{formatAge(item.created_at)}</Td>
                    <Td>
                      <TonePill tone={statusTone(item.deleted_at ? "hidden" : item.status)}>
                        {item.deleted_at ? "hidden" : item.status}
                      </TonePill>
                    </Td>
                    <Td>{stateButtons("talent", item)}</Td>
                  </tr>
                ))}
              </AdminTable>
              <Paginator total={active.data.total} limit={PAGE} offset={offset} onOffset={setOffset} />
            </>
          )}
        </>
      )}

      <ReasonDialog
        open={pending !== null}
        title={pending ? `${pending.action[0].toUpperCase() + pending.action.slice(1)} “${pending.title}”?` : ""}
        description={
          pending?.action === "hide"
            ? "Soft-removes the listing from the marketplace (reversible with Unhide)."
            : pending?.action === "unhide"
              ? "Restores it as paused — the owner re-publishes when ready."
              : undefined
        }
        confirmLabel={pending ? pending.action[0].toUpperCase() + pending.action.slice(1) : "Confirm"}
        destructive={pending?.destructive}
        requireReason
        busy={busy}
        error={actionError}
        onConfirm={(reason) => void runState(reason)}
        onClose={() => setPending(null)}
      />
    </div>
  );
}
