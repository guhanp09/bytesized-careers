"use client";

import { useState } from "react";
import {
  getAdminEmailOutbox,
  getAdminNotificationRegistry,
  listAdminEntitlements,
  revokeAdminEntitlement,
  sendAdminNotices,
} from "../../lib/backendClient";
import {
  AdminCard,
  AdminEmpty,
  AdminError,
  AdminLoading,
  AdminSectionLabel,
  AdminTable,
  FilterChip,
  formatDateTime,
  Paginator,
  ReasonDialog,
  statusTone,
  Td,
  Th,
  TonePill,
  useAdminFetch,
} from "./ui";

/**
 * Platform section (docs/ADMIN_PANEL_PLAN.md §7.7): send platform notices
 * through the real notification pipeline, manage launch-free entitlements,
 * and inspect the notification registry + mocked email outbox.
 */

const PAGE = 25;

type Tab = "notices" | "entitlements" | "registry" | "outbox";

export default function AdminPlatformClient({ accessToken }: { accessToken: string }) {
  const [tab, setTab] = useState<Tab>("notices");
  const [offset, setOffset] = useState(0);

  // Notice composer state.
  const [userIds, setUserIds] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);

  const [revokeTarget, setRevokeTarget] = useState<{ id: string; kind: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  const entitlements = useAdminFetch(
    () => (tab === "entitlements" ? listAdminEntitlements(accessToken, { limit: PAGE, offset }) : Promise.resolve(null)),
    [accessToken, tab, offset]
  );
  const registry = useAdminFetch(
    () => (tab === "registry" ? getAdminNotificationRegistry(accessToken) : Promise.resolve(null)),
    [accessToken, tab]
  );
  const outbox = useAdminFetch(
    () => (tab === "outbox" ? getAdminEmailOutbox(accessToken, { limit: 100 }) : Promise.resolve(null)),
    [accessToken, tab]
  );

  const submitNotice = async () => {
    const ids = userIds
      .split(/[\s,]+/)
      .map((value) => value.trim())
      .filter(Boolean);
    if (ids.length === 0 || !title.trim() || !body.trim()) return;
    setSending(true);
    setSendError(null);
    setSendResult(null);
    try {
      const result = await sendAdminNotices(accessToken, { user_ids: ids, title: title.trim(), body: body.trim() });
      setSendResult(`Delivered to ${result.delivered} user${result.delivered === 1 ? "" : "s"}.`);
      setUserIds("");
      setTitle("");
      setBody("");
    } catch {
      setSendError("Couldn’t send — check the user ids and try again.");
    } finally {
      setSending(false);
    }
  };

  const revoke = async (reason: string) => {
    if (!revokeTarget) return;
    setBusy(true);
    setRevokeError(null);
    try {
      await revokeAdminEntitlement(accessToken, revokeTarget.id, reason);
      setRevokeTarget(null);
      entitlements.reload();
    } catch {
      setRevokeError("Revoke failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3" data-testid="admin-platform">
      <div className="flex flex-wrap items-center gap-1.5">
        {(
          [
            { key: "notices", label: "Notices" },
            { key: "entitlements", label: "Entitlements" },
            { key: "registry", label: "Notification registry" },
            { key: "outbox", label: "Email outbox" },
          ] as const
        ).map((entry) => (
          <FilterChip
            key={entry.key}
            testId={`admin-platform-tab-${entry.key}`}
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

      {tab === "notices" ? (
        <AdminCard className="max-w-xl p-4" >
          <AdminSectionLabel>Send a platform notice</AdminSectionLabel>
          <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted">
            Delivers an in-app notification through the <code className="text-white/60">platform_notice</code>{" "}
            event (support follow-ups, policy notices). Copy user ids from the Users directory. Every send
            is audited.
          </p>
          <div className="mt-3 space-y-2.5" data-testid="admin-notice-form">
            <textarea
              value={userIds}
              onChange={(event) => setUserIds(event.target.value)}
              rows={2}
              placeholder="User ids (comma or newline separated, max 100)"
              className="w-full resize-none rounded-lg border border-white/[0.1] bg-black/25 px-3 py-2.5 text-[12px] text-white/85 placeholder:text-subtle focus:border-white/25 focus:outline-none"
            />
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Title"
              className="h-9 w-full rounded-lg border border-white/[0.1] bg-black/25 px-3 text-[12.5px] text-white/85 placeholder:text-subtle focus:border-white/25 focus:outline-none"
            />
            <textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              rows={3}
              placeholder="Message body"
              className="w-full resize-none rounded-lg border border-white/[0.1] bg-black/25 px-3 py-2.5 text-[12.5px] leading-relaxed text-white/85 placeholder:text-subtle focus:border-white/25 focus:outline-none"
            />
            <div className="flex items-center justify-between gap-2">
              {sendError ? (
                <p className="text-[11px] text-rose-300/85">{sendError}</p>
              ) : sendResult ? (
                <p className="text-[11px] text-emerald-200/85">{sendResult}</p>
              ) : (
                <span />
              )}
              <button
                type="button"
                data-testid="admin-notice-send"
                disabled={sending || !userIds.trim() || !title.trim() || !body.trim()}
                onClick={() => void submitNotice()}
                className="inline-flex h-8 cursor-pointer items-center rounded-lg bg-white px-3.5 text-[11px] font-semibold text-black transition-colors hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-45"
              >
                {sending ? "Sending…" : "Send notice"}
              </button>
            </div>
          </div>
        </AdminCard>
      ) : null}

      {tab === "entitlements" ? (
        entitlements.state === "loading" ? (
          <AdminLoading rows={5} />
        ) : entitlements.state === "error" ? (
          <AdminError onRetry={entitlements.reload} />
        ) : !entitlements.data || entitlements.data.items.length === 0 ? (
          <AdminEmpty title="No entitlements yet." hint="Launch-free checkout grants land here." />
        ) : (
          <>
            <AdminTable
              testId="admin-entitlements-table"
              head={
                <>
                  <Th>Kind</Th>
                  <Th>User</Th>
                  <Th>Source</Th>
                  <Th>Granted</Th>
                  <Th>Status</Th>
                  <Th className="text-right">Actions</Th>
                </>
              }
            >
              {entitlements.data.items.map((item) => (
                <tr key={item.id} className="transition-colors hover:bg-white/[0.03]">
                  <Td className="font-medium text-white/85">{item.kind.replaceAll("_", " ")}</Td>
                  <Td className="max-w-[220px] truncate text-white/55">{item.user_id}</Td>
                  <Td className="text-white/55">{item.source.replaceAll("_", " ")}</Td>
                  <Td className="whitespace-nowrap text-muted">{formatDateTime(item.created_at)}</Td>
                  <Td>
                    <TonePill tone={statusTone(item.status)}>{item.status}</TonePill>
                  </Td>
                  <Td className="text-right">
                    {item.status === "active" ? (
                      <button
                        type="button"
                        onClick={() => setRevokeTarget({ id: item.id, kind: item.kind })}
                        className="inline-flex cursor-pointer items-center rounded-md border border-rose-300/25 bg-rose-300/[0.05] px-2 py-1 text-[10.5px] font-semibold text-rose-200/85 transition-colors hover:border-rose-300/50"
                      >
                        Revoke
                      </button>
                    ) : null}
                  </Td>
                </tr>
              ))}
            </AdminTable>
            <Paginator total={entitlements.data.total} limit={PAGE} offset={offset} onOffset={setOffset} />
          </>
        )
      ) : null}

      {tab === "registry" ? (
        registry.state === "loading" ? (
          <AdminLoading rows={5} />
        ) : registry.state === "error" ? (
          <AdminError onRetry={registry.reload} />
        ) : !registry.data ? null : (
          <AdminTable
            testId="admin-registry-table"
            head={
              <>
                <Th>Event</Th>
                <Th>Recipient</Th>
                <Th>Priority</Th>
                <Th>Channels</Th>
                <Th>Wired</Th>
              </>
            }
          >
            {registry.data.map((event) => (
              <tr key={event.key} className="transition-colors hover:bg-white/[0.03]">
                <Td className="whitespace-nowrap font-medium text-white/85">{event.key}</Td>
                <Td className="max-w-[240px] truncate text-white/55">{event.recipient}</Td>
                <Td>
                  <TonePill tone={event.priority === "high" ? "warn" : "neutral"}>{event.priority}</TonePill>
                </Td>
                <Td className="text-white/55">{event.default_channels.join(" + ") || "—"}</Td>
                <Td>{event.wired ? <TonePill tone="active">yes</TonePill> : <TonePill tone="dim">no</TonePill>}</Td>
              </tr>
            ))}
          </AdminTable>
        )
      ) : null}

      {tab === "outbox" ? (
        outbox.state === "loading" ? (
          <AdminLoading rows={5} />
        ) : outbox.state === "error" ? (
          <AdminError onRetry={outbox.reload} />
        ) : !outbox.data || outbox.data.length === 0 ? (
          <AdminEmpty
            title="Email outbox is empty."
            hint="Notification emails queue here (status `mocked` until real delivery is enabled)."
          />
        ) : (
          <AdminTable
            testId="admin-outbox-table"
            head={
              <>
                <Th>To</Th>
                <Th>Event</Th>
                <Th>Subject</Th>
                <Th>Queued</Th>
                <Th>Status</Th>
              </>
            }
          >
            {outbox.data.map((item) => (
              <tr key={item.id} className="transition-colors hover:bg-white/[0.03]">
                <Td className="max-w-[200px] truncate">{item.to_email}</Td>
                <Td className="whitespace-nowrap text-white/55">{item.event_key}</Td>
                <Td className="max-w-[260px] truncate text-white/70">{item.subject}</Td>
                <Td className="whitespace-nowrap text-muted">{formatDateTime(item.created_at)}</Td>
                <Td>
                  <TonePill tone={item.status === "sent" ? "active" : item.status === "failed" ? "danger" : "dim"}>
                    {item.status}
                  </TonePill>
                </Td>
              </tr>
            ))}
          </AdminTable>
        )
      ) : null}

      <ReasonDialog
        open={revokeTarget !== null}
        title={`Revoke this ${revokeTarget?.kind.replaceAll("_", " ") ?? ""} entitlement?`}
        confirmLabel="Revoke"
        destructive
        requireReason
        busy={busy}
        error={revokeError}
        onConfirm={(reason) => void revoke(reason)}
        onClose={() => setRevokeTarget(null)}
      />
    </div>
  );
}
