"use client";

import { useState } from "react";
import {
  decideAdminHiringIdentity,
  listAdminHiringIdentities,
  type AdminIdentityItem,
} from "../../lib/backendClient";
import {
  AdminEmpty,
  AdminError,
  AdminLoading,
  AdminSectionLabel,
  AdminTable,
  DetailDrawer,
  FilterChip,
  formatAge,
  formatDateTime,
  KV,
  Paginator,
  personLabel,
  ReasonDialog,
  statusTone,
  Td,
  Th,
  TonePill,
  useAdminFetch,
} from "./ui";

/**
 * Hiring-identity review queue (docs/ADMIN_PANEL_PLAN.md §7.3, §11): evidence
 * inspection → approve / reject / revoke, with reasons recorded and the
 * verified badge on the identity's jobs re-derived by the backend on every
 * decision.
 */

const PAGE = 25;

const STATUS_TABS = [
  { key: "PENDING", label: "Pending" },
  { key: "UNVERIFIED", label: "Unverified" },
  { key: "VERIFIED", label: "Verified" },
  { key: "REJECTED", label: "Rejected" },
  { key: "all", label: "All" },
] as const;

type Decision = "approve" | "reject" | "revoke";

const DECISIONS: Record<
  Decision,
  { title: string; description: string; confirmLabel: string; destructive?: boolean; requireReason: boolean }
> = {
  approve: {
    title: "Approve this identity?",
    description:
      "Marks it VERIFIED via manual review and applies the verified badge to its jobs.",
    confirmLabel: "Approve",
    requireReason: false,
  },
  reject: {
    title: "Reject this verification?",
    description: "The reason is shown to the owner on their identity card; they can resubmit.",
    confirmLabel: "Reject",
    destructive: true,
    requireReason: true,
  },
  revoke: {
    title: "Revoke this verification?",
    description: "Removes VERIFIED and strips the badge from every job posted under this identity.",
    confirmLabel: "Revoke",
    destructive: true,
    requireReason: true,
  },
};

export default function AdminVerificationClient({ accessToken }: { accessToken: string }) {
  const [statusFilter, setStatusFilter] = useState<string>("PENDING");
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<AdminIdentityItem | null>(null);
  const [pendingDecision, setPendingDecision] = useState<Decision | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data, state, reload } = useAdminFetch(
    () => listAdminHiringIdentities(accessToken, { status: statusFilter, limit: PAGE, offset }),
    [accessToken, statusFilter, offset]
  );

  const decide = async (decision: Decision, reason: string) => {
    if (!selected) return;
    setBusy(true);
    setActionError(null);
    try {
      const updated = await decideAdminHiringIdentity(accessToken, selected.id, {
        decision,
        reason: reason || null,
      });
      setSelected(updated);
      setPendingDecision(null);
      reload();
    } catch {
      setActionError("Decision failed — the backend rejected it or is unreachable.");
    } finally {
      setBusy(false);
    }
  };

  const items = data?.items ?? [];

  return (
    <div className="space-y-3" data-testid="admin-verification">
      <div className="flex flex-wrap items-center gap-1.5">
        {STATUS_TABS.map((tab) => (
          <FilterChip
            key={tab.key}
            testId={`admin-verification-status-${tab.key.toLowerCase()}`}
            active={statusFilter === tab.key}
            onClick={() => {
              setStatusFilter(tab.key);
              setOffset(0);
            }}
          >
            {tab.label}
          </FilterChip>
        ))}
      </div>

      {state === "loading" ? (
        <AdminLoading rows={5} />
      ) : state === "error" || !data ? (
        <AdminError onRetry={reload} />
      ) : items.length === 0 ? (
        <AdminEmpty
          title={statusFilter === "PENDING" ? "No verifications waiting." : "Nothing here."}
          hint={
            statusFilter === "PENDING"
              ? "Identities land here when self-service verification needs a human decision."
              : undefined
          }
        />
      ) : (
        <>
          <AdminTable
            testId="admin-verification-table"
            head={
              <>
                <Th>Identity</Th>
                <Th>Owner</Th>
                <Th>Method</Th>
                <Th className="text-right">Attempts</Th>
                <Th className="text-right">Jobs</Th>
                <Th>Waiting</Th>
                <Th>Status</Th>
              </>
            }
          >
            {items.map((item) => (
              <tr
                key={item.id}
                data-testid="admin-identity-row"
                onClick={() => {
                  setSelected(item);
                  setActionError(null);
                }}
                className="cursor-pointer transition-colors hover:bg-white/[0.035]"
              >
                <Td className="max-w-[260px]">
                  <span className="block truncate font-medium text-white/88">{item.display_name}</span>
                  <span className="mt-0.5 block truncate text-[10.5px] text-subtle">
                    {item.platform} · {item.type === "AGENCY_REPRESENTED_CHANNEL" ? "agency-represented" : "individual"}
                  </span>
                </Td>
                <Td className="max-w-[170px] truncate">{personLabel(item.owner)}</Td>
                <Td className="whitespace-nowrap text-white/55">{item.verification_method.replaceAll("_", " ").toLowerCase()}</Td>
                <Td className="text-right tabular-nums">{item.verification_attempt_count}</Td>
                <Td className="text-right tabular-nums">{item.jobs_count}</Td>
                <Td className="whitespace-nowrap text-muted">{formatAge(item.created_at)}</Td>
                <Td>
                  <TonePill tone={statusTone(item.verification_status)}>{item.verification_status.toLowerCase()}</TonePill>
                </Td>
              </tr>
            ))}
          </AdminTable>
          <Paginator total={data.total} limit={PAGE} offset={offset} onOffset={setOffset} />
        </>
      )}

      <DetailDrawer
        open={selected !== null}
        onClose={() => setSelected(null)}
        title={selected?.display_name ?? "Identity"}
        subtitle={selected ? `${selected.platform} · ${personLabel(selected.owner)}` : undefined}
        testId="admin-identity-drawer"
      >
        {selected ? (
          <div className="space-y-5">
            <section>
              <AdminSectionLabel>Evidence</AdminSectionLabel>
              <div className="mt-2 divide-y divide-white/[0.05]">
                <KV label="Status">
                  <TonePill tone={statusTone(selected.verification_status)}>
                    {selected.verification_status.toLowerCase()}
                  </TonePill>
                </KV>
                <KV label="Method">{selected.verification_method.replaceAll("_", " ").toLowerCase()}</KV>
                <KV label="Handle">{selected.handle || "—"}</KV>
                <KV label="Attempts">{selected.verification_attempt_count}</KV>
                <KV label="Created">{formatDateTime(selected.created_at)}</KV>
                <KV label="Verified at">{formatDateTime(selected.verified_at)}</KV>
                <KV label="Jobs under this identity">{selected.jobs_count}</KV>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {selected.url ? (
                  <a
                    href={selected.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-white/65 underline-offset-2 hover:text-white hover:underline"
                  >
                    Channel / page ↗
                  </a>
                ) : null}
                {selected.proof_url ? (
                  <a
                    href={selected.proof_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-white/65 underline-offset-2 hover:text-white hover:underline"
                  >
                    Submitted proof ↗
                  </a>
                ) : null}
              </div>
              <p className="mt-2 text-[10.5px] text-subtle">External links — open with care.</p>
              {selected.verification_last_error ? (
                <p className="mt-2 rounded-xl border border-amber-200/20 bg-amber-200/[0.05] px-3 py-2 text-[11.5px] text-amber-100/80">
                  Last error / reason: {selected.verification_last_error}
                </p>
              ) : null}
            </section>

            <section>
              <AdminSectionLabel>Decision</AdminSectionLabel>
              {actionError ? <p className="mt-2 text-[11px] text-rose-300/85">{actionError}</p> : null}
              <div className="mt-2 flex flex-wrap gap-1.5">
                {selected.verification_status !== "VERIFIED" ? (
                  <>
                    <button
                      type="button"
                      data-testid="admin-identity-approve"
                      onClick={() => setPendingDecision("approve")}
                      className="inline-flex h-8 cursor-pointer items-center rounded-lg bg-white px-3 text-[11px] font-semibold text-black transition-colors hover:bg-white/90"
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      data-testid="admin-identity-reject"
                      onClick={() => setPendingDecision("reject")}
                      className="inline-flex h-8 cursor-pointer items-center rounded-lg border border-rose-300/25 bg-rose-300/[0.06] px-3 text-[11px] font-semibold text-rose-200/90 transition-colors hover:border-rose-300/50"
                    >
                      Reject
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    data-testid="admin-identity-revoke"
                    onClick={() => setPendingDecision("revoke")}
                    className="inline-flex h-8 cursor-pointer items-center rounded-lg border border-rose-300/25 bg-rose-300/[0.06] px-3 text-[11px] font-semibold text-rose-200/90 transition-colors hover:border-rose-300/50"
                  >
                    Revoke verification
                  </button>
                )}
              </div>
            </section>
          </div>
        ) : null}
      </DetailDrawer>

      <ReasonDialog
        open={pendingDecision !== null}
        title={pendingDecision ? DECISIONS[pendingDecision].title : ""}
        description={pendingDecision ? DECISIONS[pendingDecision].description : undefined}
        confirmLabel={pendingDecision ? DECISIONS[pendingDecision].confirmLabel : "Confirm"}
        destructive={pendingDecision ? DECISIONS[pendingDecision].destructive : false}
        requireReason={pendingDecision ? DECISIONS[pendingDecision].requireReason : false}
        busy={busy}
        error={actionError}
        onConfirm={(reason) => pendingDecision && void decide(pendingDecision, reason)}
        onClose={() => setPendingDecision(null)}
      />
    </div>
  );
}
