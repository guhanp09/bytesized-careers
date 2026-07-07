"use client";

import { useState } from "react";
import {
  getAdminReportedConversation,
  hideAdminMessage,
  listAdminReports,
  resolveAdminReport,
  unhideAdminMessage,
  type AdminReportAction,
  type AdminReportedConversation,
  type AdminReportItem,
} from "../../lib/backendClient";
import {
  AdminEmpty,
  AdminError,
  AdminLoading,
  AdminSearch,
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
 * The moderation queue (docs/ADMIN_PANEL_PLAN.md §7.2, §10): risk-ordered
 * reports across every target type, a detail drawer with target context and
 * sibling-report signal, and the triage ladder — every action justified and
 * audited. Message reports unlock the Tier-2 reported-conversation view
 * (each view is itself audited).
 */

const PAGE = 25;

const STATUS_TABS = [
  { key: "open", label: "Open" },
  { key: "action_taken", label: "Action taken" },
  { key: "dismissed", label: "Dismissed" },
  { key: "", label: "All" },
] as const;

const TARGET_TABS = [
  { key: "", label: "All targets" },
  { key: "job", label: "Jobs" },
  { key: "talent_listing", label: "Talent" },
  { key: "profile", label: "Profiles" },
  { key: "message", label: "Messages" },
] as const;

const HIGH_RISK = new Set(["scam_or_fraud", "off_platform_payment", "impersonation", "harassment"]);

function priorityOf(report: AdminReportItem): "high" | "medium" | "normal" {
  if (HIGH_RISK.has(report.category)) return "high";
  if (report.category === "spam" || report.sibling_count > 0) return "medium";
  return "normal";
}

const PRIORITY_EDGE: Record<string, string> = {
  high: "border-l-2 border-l-rose-300/70",
  medium: "border-l-2 border-l-amber-300/60",
  normal: "border-l-2 border-l-transparent",
};

type ActionConfig = {
  action: AdminReportAction;
  label: string;
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  requireReason: boolean;
  placeholder?: string;
  /** Where the dialog text goes: the private audit note or the user-facing note. */
  reasonField: "admin_note" | "user_note";
  listingOnly?: boolean;
};

const ACTIONS: ActionConfig[] = [
  {
    action: "dismiss",
    label: "Dismiss",
    title: "Dismiss this report?",
    description: "No violation found. The report closes; nothing is sent to anyone.",
    confirmLabel: "Dismiss report",
    requireReason: false,
    reasonField: "admin_note",
  },
  {
    action: "no_action",
    label: "Resolve, no action",
    title: "Resolve without a platform action?",
    description: "Marks the report handled (e.g. resolved off-queue) without touching the target.",
    confirmLabel: "Mark resolved",
    requireReason: true,
    reasonField: "admin_note",
  },
  {
    action: "pause_listing",
    label: "Pause listing",
    title: "Pause this listing?",
    description: "Hidden from the marketplace; the owner keeps access and can be asked to fix it.",
    confirmLabel: "Pause listing",
    requireReason: true,
    reasonField: "admin_note",
    listingOnly: true,
  },
  {
    action: "hide_listing",
    label: "Hide listing",
    title: "Hide this listing?",
    description: "Soft-removes the listing from the marketplace (reversible from Listings).",
    confirmLabel: "Hide listing",
    destructive: true,
    requireReason: true,
    reasonField: "admin_note",
    listingOnly: true,
  },
  {
    action: "warn_user",
    label: "Warn user",
    title: "Send a warning notice",
    description: "The text below is delivered to the user as a moderation notice.",
    confirmLabel: "Send warning",
    requireReason: true,
    placeholder: "The message the user will receive…",
    reasonField: "user_note",
  },
  {
    action: "suspend_user",
    label: "Suspend user",
    title: "Suspend this account?",
    description: "Locks the account and hides all their public content until unsuspended.",
    confirmLabel: "Suspend account",
    destructive: true,
    requireReason: true,
    reasonField: "user_note",
  },
];

export default function AdminReportsClient({ accessToken }: { accessToken: string }) {
  const [statusFilter, setStatusFilter] = useState<string>("open");
  const [targetFilter, setTargetFilter] = useState<string>("");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<AdminReportItem | null>(null);
  const [pendingAction, setPendingAction] = useState<ActionConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [thread, setThread] = useState<AdminReportedConversation | null>(null);
  const [threadError, setThreadError] = useState(false);

  const { data, state, reload } = useAdminFetch(
    () =>
      listAdminReports(accessToken, {
        status: statusFilter || undefined,
        target_type: targetFilter || undefined,
        limit: PAGE,
        offset,
      }),
    [accessToken, statusFilter, targetFilter, offset]
  );

  const items = (data?.items ?? []).filter((item) => {
    const needle = search.trim().toLowerCase();
    if (!needle) return true;
    return [item.target_label, item.category, personLabel(item.reporter), personLabel(item.target_owner)]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(needle);
  });

  const openDrawer = (item: AdminReportItem) => {
    setSelected(item);
    setThread(null);
    setThreadError(false);
    setActionError(null);
  };

  const runAction = async (config: ActionConfig, reason: string) => {
    if (!selected) return;
    setBusy(true);
    setActionError(null);
    try {
      const updated = await resolveAdminReport(accessToken, selected.id, {
        action: config.action,
        admin_note: config.reasonField === "admin_note" ? reason || null : null,
        user_note: config.reasonField === "user_note" ? reason || null : null,
      });
      setSelected(updated);
      setPendingAction(null);
      reload();
    } catch {
      setActionError("The action failed — the backend rejected it or is unreachable.");
    } finally {
      setBusy(false);
    }
  };

  const loadThread = async () => {
    if (!selected) return;
    setThreadError(false);
    try {
      setThread(await getAdminReportedConversation(accessToken, selected.id));
    } catch {
      setThreadError(true);
    }
  };

  const toggleMessageHidden = async (messageId: string, hidden: boolean) => {
    if (!selected) return;
    setBusy(true);
    try {
      const payload = { reason: `Report ${selected.id} — ${selected.category}`, report_id: selected.id };
      if (hidden) await unhideAdminMessage(accessToken, messageId, payload);
      else await hideAdminMessage(accessToken, messageId, payload);
      await loadThread();
    } catch {
      setActionError("Couldn’t update the message.");
    } finally {
      setBusy(false);
    }
  };

  const availableActions = selected
    ? ACTIONS.filter((config) => {
        if (config.listingOnly && selected.target_type !== "job" && selected.target_type !== "talent_listing")
          return false;
        return true;
      })
    : [];

  return (
    <div className="space-y-3" data-testid="admin-reports">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {STATUS_TABS.map((tab) => (
            <FilterChip
              key={tab.label}
              testId={`admin-reports-status-${tab.key || "all"}`}
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
        <span className="hidden h-4 w-px bg-white/[0.08] sm:block" aria-hidden />
        <div className="flex flex-wrap items-center gap-1.5">
          {TARGET_TABS.map((tab) => (
            <FilterChip
              key={tab.label}
              active={targetFilter === tab.key}
              onClick={() => {
                setTargetFilter(tab.key);
                setOffset(0);
              }}
            >
              {tab.label}
            </FilterChip>
          ))}
        </div>
        <div className="ml-auto">
          <AdminSearch value={search} onChange={setSearch} placeholder="Filter this page…" testId="admin-reports-search" />
        </div>
      </div>

      {state === "loading" ? (
        <AdminLoading rows={6} />
      ) : state === "error" || !data ? (
        <AdminError onRetry={reload} />
      ) : items.length === 0 ? (
        <AdminEmpty
          title={statusFilter === "open" ? "Queue clear. Nothing waiting on you." : "No reports match."}
          hint={statusFilter === "open" ? "New reports land here oldest-first." : undefined}
        />
      ) : (
        <>
          <AdminTable
            testId="admin-reports-table"
            head={
              <>
                <Th>Target</Th>
                <Th>Reason</Th>
                <Th>Reporter</Th>
                <Th className="text-right">Also reported</Th>
                <Th>Age</Th>
                <Th>Status</Th>
              </>
            }
          >
            {items.map((item) => (
              <tr
                key={item.id}
                data-testid="admin-report-row"
                onClick={() => openDrawer(item)}
                className={`cursor-pointer transition-colors hover:bg-white/[0.035] ${PRIORITY_EDGE[priorityOf(item)]}`}
              >
                <Td className="max-w-[280px]">
                  <span className="block truncate font-medium text-white/88">
                    {item.target_label || `${item.target_type} · ${item.target_id.slice(0, 8)}…`}
                  </span>
                  <span className="mt-0.5 block truncate text-[10.5px] text-white/38">
                    {personLabel(item.target_owner)}
                  </span>
                </Td>
                <Td>
                  <TonePill tone={priorityOf(item) === "high" ? "danger" : priorityOf(item) === "medium" ? "warn" : "neutral"}>
                    {item.category.replaceAll("_", " ")}
                  </TonePill>
                </Td>
                <Td className="max-w-[160px] truncate">{item.reporter ? personLabel(item.reporter) : "Anonymous"}</Td>
                <Td className="text-right tabular-nums">{item.sibling_count > 0 ? `+${item.sibling_count}` : "—"}</Td>
                <Td className="whitespace-nowrap text-white/50">{formatAge(item.created_at)}</Td>
                <Td>
                  <TonePill tone={statusTone(item.status)}>{item.status.replaceAll("_", " ")}</TonePill>
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
        title={selected?.target_label || "Report"}
        subtitle={selected ? `${selected.target_type.replaceAll("_", " ")} · reported ${formatAge(selected.created_at)} ago` : undefined}
        testId="admin-report-drawer"
      >
        {selected ? (
          <div className="space-y-5">
            <section>
              <AdminSectionLabel>Report</AdminSectionLabel>
              <div className="mt-2 divide-y divide-white/[0.05]">
                <KV label="Reason">
                  <TonePill tone={priorityOf(selected) === "high" ? "danger" : "neutral"}>
                    {selected.category.replaceAll("_", " ")}
                  </TonePill>
                </KV>
                <KV label="Reporter">{selected.reporter ? personLabel(selected.reporter) : "Anonymous"}</KV>
                <KV label="Target owner">{personLabel(selected.target_owner)}</KV>
                <KV label="Target status">
                  <TonePill tone={statusTone(selected.target_status)}>{selected.target_status || "—"}</TonePill>
                </KV>
                <KV label="Other reports on this target">
                  {selected.sibling_count > 0 ? `${selected.sibling_count} more` : "None"}
                </KV>
                <KV label="Filed">{formatDateTime(selected.created_at)}</KV>
              </div>
              {selected.note ? (
                <p className="mt-3 rounded-xl border border-white/[0.07] bg-white/[0.03] px-3 py-2.5 text-[12px] leading-relaxed text-white/70">
                  “{selected.note}”
                </p>
              ) : null}
              {(selected.target_type === "job" || selected.target_type === "talent_listing") && (
                <a
                  href={selected.target_type === "job" ? `/jobs/${selected.target_id}` : `/talent/${selected.target_id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-white/65 underline-offset-2 hover:text-white hover:underline"
                >
                  View public page ↗
                </a>
              )}
            </section>

            {selected.target_type === "message" ? (
              <section>
                <AdminSectionLabel>Reported conversation</AdminSectionLabel>
                {thread === null ? (
                  <div className="mt-2">
                    <p className="text-[11.5px] leading-relaxed text-white/45">
                      Message content opens only through this report, and the view itself is written to
                      the audit log.
                    </p>
                    <button
                      type="button"
                      data-testid="admin-view-thread"
                      onClick={() => void loadThread()}
                      className="mt-2.5 inline-flex h-8 cursor-pointer items-center rounded-lg border border-white/15 bg-white/[0.04] px-3 text-[11px] font-semibold text-white/80 transition-colors hover:bg-white/[0.08]"
                    >
                      View reported thread
                    </button>
                    {threadError ? (
                      <p className="mt-2 text-[11px] text-rose-300/80">Couldn’t load the conversation.</p>
                    ) : null}
                  </div>
                ) : (
                  <div className="mt-2 space-y-2" data-testid="admin-thread">
                    {thread.messages.map((message) => {
                      const reported = message.id === thread.reported_message_id;
                      return (
                        <div
                          key={message.id}
                          className={[
                            "rounded-xl border px-3 py-2",
                            reported
                              ? "border-rose-300/35 bg-rose-300/[0.06]"
                              : "border-white/[0.06] bg-white/[0.025]",
                          ].join(" ")}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-[10.5px] font-semibold text-white/55">
                              {personLabel(message.sender)}
                              {reported ? <span className="ml-2 text-rose-200/85">reported</span> : null}
                              {message.hidden ? <span className="ml-2 text-white/35">hidden</span> : null}
                            </p>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void toggleMessageHidden(message.id, message.hidden)}
                              className="cursor-pointer text-[10.5px] font-semibold text-white/45 transition-colors hover:text-white disabled:opacity-40"
                            >
                              {message.hidden ? "Unhide" : "Hide"}
                            </button>
                          </div>
                          <p className={`mt-1 text-[12px] leading-relaxed ${message.hidden ? "text-white/30 line-through" : "text-white/78"}`}>
                            {message.body}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            ) : null}

            {selected.admin_note || selected.resolved_at ? (
              <section>
                <AdminSectionLabel>Resolution</AdminSectionLabel>
                <div className="mt-2 divide-y divide-white/[0.05]">
                  <KV label="Action">{selected.action || "—"}</KV>
                  <KV label="Resolved">{formatDateTime(selected.resolved_at)}</KV>
                </div>
                {selected.admin_note ? (
                  <p className="mt-2 rounded-xl bg-white/[0.03] px-3 py-2 text-[11.5px] text-white/60">
                    {selected.admin_note}
                  </p>
                ) : null}
              </section>
            ) : null}

            <section>
              <AdminSectionLabel>Actions</AdminSectionLabel>
              {actionError ? <p className="mt-2 text-[11px] text-rose-300/85">{actionError}</p> : null}
              <div className="mt-2 flex flex-wrap gap-1.5">
                {selected.status === "open" ? (
                  availableActions.map((config) => (
                    <button
                      key={config.action}
                      type="button"
                      data-testid={`admin-report-action-${config.action}`}
                      onClick={() => setPendingAction(config)}
                      className={[
                        "inline-flex h-8 cursor-pointer items-center rounded-lg border px-3 text-[11px] font-semibold transition-colors",
                        config.destructive
                          ? "border-rose-300/25 bg-rose-300/[0.06] text-rose-200/90 hover:border-rose-300/50"
                          : "border-white/15 bg-white/[0.04] text-white/80 hover:bg-white/[0.08]",
                      ].join(" ")}
                    >
                      {config.label}
                    </button>
                  ))
                ) : (
                  <button
                    type="button"
                    data-testid="admin-report-action-reopen"
                    onClick={() =>
                      setPendingAction({
                        action: "reopen",
                        label: "Reopen",
                        title: "Reopen this report?",
                        description: "Puts it back in the open queue.",
                        confirmLabel: "Reopen",
                        requireReason: false,
                        reasonField: "admin_note",
                      })
                    }
                    className="inline-flex h-8 cursor-pointer items-center rounded-lg border border-white/15 bg-white/[0.04] px-3 text-[11px] font-semibold text-white/80 transition-colors hover:bg-white/[0.08]"
                  >
                    Reopen
                  </button>
                )}
              </div>
            </section>
          </div>
        ) : null}
      </DetailDrawer>

      <ReasonDialog
        open={pendingAction !== null}
        title={pendingAction?.title ?? ""}
        description={pendingAction?.description}
        confirmLabel={pendingAction?.confirmLabel ?? "Confirm"}
        destructive={pendingAction?.destructive}
        requireReason={pendingAction?.requireReason ?? true}
        placeholder={pendingAction?.placeholder}
        busy={busy}
        error={actionError}
        onConfirm={(reason) => pendingAction && void runAction(pendingAction, reason)}
        onClose={() => setPendingAction(null)}
      />
    </div>
  );
}
