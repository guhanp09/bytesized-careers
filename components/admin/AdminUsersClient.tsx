"use client";

import { useState } from "react";
import {
  getAdminUserDetail,
  listAdminUsers,
  suspendAdminUser,
  unsuspendAdminUser,
  warnAdminUser,
  type AdminUserDetail,
  type AdminUserItem,
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
  ReasonDialog,
  statusTone,
  Td,
  Th,
  TonePill,
  useAdminFetch,
} from "./ui";

/**
 * User directory + safety actions (docs/ADMIN_PANEL_PLAN.md §7.4, §12):
 * search, activity/created signals, and the enforcement ladder — warn
 * (moderation notice), suspend/unsuspend (reason required, audited). No
 * impersonation, by design.
 */

const PAGE = 25;

type UserAction = "suspend" | "unsuspend" | "warn";

export default function AdminUsersClient({ accessToken }: { accessToken: string }) {
  const [query, setQuery] = useState("");
  const [committedQuery, setCommittedQuery] = useState("");
  const [scope, setScope] = useState<"all" | "suspended" | "unverified">("all");
  const [offset, setOffset] = useState(0);
  const [detail, setDetail] = useState<AdminUserDetail | null>(null);
  const [detailError, setDetailError] = useState(false);
  const [pendingAction, setPendingAction] = useState<UserAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data, state, reload } = useAdminFetch(
    () =>
      listAdminUsers(accessToken, {
        q: committedQuery || undefined,
        suspended: scope === "suspended" ? true : undefined,
        verified: scope === "unverified" ? false : undefined,
        limit: PAGE,
        offset,
      }),
    [accessToken, committedQuery, scope, offset]
  );

  const openDetail = async (user: AdminUserItem) => {
    setDetailError(false);
    setActionError(null);
    try {
      setDetail(await getAdminUserDetail(accessToken, user.id));
    } catch {
      setDetailError(true);
    }
  };

  const runAction = async (action: UserAction, reason: string) => {
    if (!detail) return;
    setBusy(true);
    setActionError(null);
    try {
      if (action === "suspend") await suspendAdminUser(accessToken, detail.user.id, reason);
      else if (action === "unsuspend") await unsuspendAdminUser(accessToken, detail.user.id, reason || null);
      else await warnAdminUser(accessToken, detail.user.id, { body: reason });
      setPendingAction(null);
      await openDetail(detail.user);
      reload();
    } catch {
      setActionError("The action failed — the backend rejected it or is unreachable.");
    } finally {
      setBusy(false);
    }
  };

  const items = data?.items ?? [];
  const user = detail?.user ?? null;

  return (
    <div className="space-y-3" data-testid="admin-users">
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setOffset(0);
          setCommittedQuery(query);
        }}
      >
        <AdminSearch value={query} onChange={setQuery} placeholder="Search email, username, name… ↵" testId="admin-users-search" />
        {(["all", "suspended", "unverified"] as const).map((key) => (
          <FilterChip
            key={key}
            testId={`admin-users-scope-${key}`}
            active={scope === key}
            onClick={() => {
              setScope(key);
              setOffset(0);
            }}
          >
            {key === "all" ? "All" : key === "suspended" ? "Suspended" : "Email unverified"}
          </FilterChip>
        ))}
      </form>

      {state === "loading" ? (
        <AdminLoading rows={6} />
      ) : state === "error" || !data ? (
        <AdminError onRetry={reload} />
      ) : items.length === 0 ? (
        <AdminEmpty title="No users match." hint="Try a different search or scope." />
      ) : (
        <>
          <AdminTable
            testId="admin-users-table"
            minWidth={880}
            head={
              <>
                <Th>User</Th>
                <Th>Email</Th>
                <Th className="text-right">Jobs</Th>
                <Th className="text-right">Listings</Th>
                <Th className="text-right">Applied</Th>
                <Th className="text-right">Reports</Th>
                <Th>Last active</Th>
                <Th>Joined</Th>
                <Th>State</Th>
              </>
            }
          >
            {items.map((item) => (
              <tr
                key={item.id}
                data-testid="admin-user-row"
                onClick={() => void openDetail(item)}
                className="cursor-pointer transition-colors hover:bg-white/[0.035]"
              >
                <Td className="max-w-[220px]">
                  <span className="block truncate font-medium text-white/88">
                    {item.display_name || item.username || "—"}
                  </span>
                  {item.username ? (
                    <span className="mt-0.5 block truncate text-[10.5px] text-subtle">@{item.username}</span>
                  ) : null}
                </Td>
                <Td className="max-w-[200px]">
                  <span className="flex items-center gap-1.5">
                    <span
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${item.email_verified ? "bg-emerald-300/80" : "bg-white/25"}`}
                      title={item.email_verified ? "Email verified" : "Email not verified"}
                      aria-hidden
                    />
                    <span className="truncate">{item.email}</span>
                  </span>
                </Td>
                <Td className="text-right tabular-nums">{item.jobs_count}</Td>
                <Td className="text-right tabular-nums">{item.talent_listings_count}</Td>
                <Td className="text-right tabular-nums">{item.applications_sent_count}</Td>
                <Td className="text-right tabular-nums">
                  {item.profile_reports_count > 0 ? (
                    <span className="text-amber-200/85">{item.profile_reports_count}</span>
                  ) : (
                    "—"
                  )}
                </Td>
                <Td className="whitespace-nowrap text-muted">{formatAge(item.last_active_at)}</Td>
                <Td className="whitespace-nowrap text-muted">{formatAge(item.created_at)}</Td>
                <Td>
                  {item.suspended_at ? (
                    <TonePill tone="danger">suspended</TonePill>
                  ) : item.account_type === "ADMIN" ? (
                    <TonePill tone="neutral">admin</TonePill>
                  ) : (
                    <TonePill tone="active">active</TonePill>
                  )}
                </Td>
              </tr>
            ))}
          </AdminTable>
          <Paginator total={data.total} limit={PAGE} offset={offset} onOffset={setOffset} />
        </>
      )}

      {detailError ? <p className="text-[11px] text-rose-300/85">Couldn’t load the user detail.</p> : null}

      <DetailDrawer
        open={detail !== null}
        onClose={() => setDetail(null)}
        title={user ? user.display_name || user.username || user.email : "User"}
        subtitle={user ? user.email : undefined}
        testId="admin-user-drawer"
      >
        {detail && user ? (
          <div className="space-y-5">
            <section>
              <AdminSectionLabel>Account</AdminSectionLabel>
              <div className="mt-2 divide-y divide-white/[0.05]">
                <KV label="State">
                  {user.suspended_at ? (
                    <TonePill tone="danger">suspended {formatAge(user.suspended_at)} ago</TonePill>
                  ) : (
                    <TonePill tone="active">active</TonePill>
                  )}
                </KV>
                <KV label="Email verified">{user.email_verified ? "Yes" : "No"}</KV>
                <KV label="Joined">{formatDateTime(user.created_at)}</KV>
                <KV label="Last active">{formatDateTime(user.last_active_at)}</KV>
                <KV label="Onboarding intent">{detail.onboarding_intent || "—"}</KV>
                <KV label="Jobs / listings">{user.jobs_count} / {user.talent_listings_count}</KV>
                <KV label="Applications sent / received">
                  {user.applications_sent_count} / {detail.applications_received_count}
                </KV>
                <KV label="Hiring requests sent">{detail.interests_sent_count}</KV>
                <KV label="Portfolio items">{detail.portfolio_items_count}</KV>
              </div>
              {user.suspension_reason ? (
                <p className="mt-2 rounded-xl border border-rose-300/20 bg-rose-300/[0.05] px-3 py-2 text-[11.5px] text-rose-100/80">
                  Suspension reason: {user.suspension_reason}
                </p>
              ) : null}
              {user.username ? (
                <a
                  href={`/u/${user.username}`}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-white/65 underline-offset-2 hover:text-white hover:underline"
                >
                  View public profile ↗
                </a>
              ) : null}
            </section>

            {detail.identities.length > 0 ? (
              <section>
                <AdminSectionLabel>Hiring identities</AdminSectionLabel>
                <div className="mt-2 space-y-1.5">
                  {detail.identities.map((identity) => (
                    <div
                      key={identity.id}
                      className="flex items-center justify-between gap-2 rounded-xl border border-white/[0.06] bg-white/[0.025] px-3 py-2"
                    >
                      <span className="min-w-0 truncate text-[12px] text-white/78">
                        {identity.display_name}
                        <span className="ml-1.5 text-[10.5px] text-subtle">{identity.platform}</span>
                      </span>
                      <TonePill tone={statusTone(identity.verification_status)}>
                        {identity.verification_status.toLowerCase()}
                      </TonePill>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            {detail.reports_about.length > 0 ? (
              <section>
                <AdminSectionLabel>Reports about this user</AdminSectionLabel>
                <div className="mt-2 space-y-1.5">
                  {detail.reports_about.map((report) => (
                    <div
                      key={report.id}
                      className="flex items-center justify-between gap-2 rounded-xl border border-white/[0.06] bg-white/[0.025] px-3 py-2"
                    >
                      <span className="min-w-0 truncate text-[11.5px] text-white/70">
                        {report.target_label || report.target_type} · {report.category.replaceAll("_", " ")}
                      </span>
                      <TonePill tone={statusTone(report.status)}>{report.status.replaceAll("_", " ")}</TonePill>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            {detail.recent_audit.length > 0 ? (
              <section>
                <AdminSectionLabel>Moderation history</AdminSectionLabel>
                <div className="mt-2 space-y-1.5">
                  {detail.recent_audit.map((entry) => (
                    <div key={entry.id} className="rounded-xl border border-white/[0.06] bg-white/[0.025] px-3 py-2">
                      <div className="flex items-center justify-between gap-2 text-[11px]">
                        <span className="font-semibold text-white/70">{entry.action}</span>
                        <span className="text-subtle">{formatDateTime(entry.created_at)}</span>
                      </div>
                      {entry.justification ? (
                        <p className="mt-0.5 text-[11px] text-muted">{entry.justification}</p>
                      ) : null}
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            <section>
              <AdminSectionLabel>Actions</AdminSectionLabel>
              {actionError ? <p className="mt-2 text-[11px] text-rose-300/85">{actionError}</p> : null}
              <div className="mt-2 flex flex-wrap gap-1.5">
                <button
                  type="button"
                  data-testid="admin-user-warn"
                  onClick={() => setPendingAction("warn")}
                  className="inline-flex h-8 cursor-pointer items-center rounded-lg border border-white/15 bg-white/[0.04] px-3 text-[11px] font-semibold text-white/80 transition-colors hover:bg-white/[0.08]"
                >
                  Warn
                </button>
                {user.suspended_at ? (
                  <button
                    type="button"
                    data-testid="admin-user-unsuspend"
                    onClick={() => setPendingAction("unsuspend")}
                    className="inline-flex h-8 cursor-pointer items-center rounded-lg border border-white/15 bg-white/[0.04] px-3 text-[11px] font-semibold text-white/80 transition-colors hover:bg-white/[0.08]"
                  >
                    Unsuspend
                  </button>
                ) : user.account_type !== "ADMIN" ? (
                  <button
                    type="button"
                    data-testid="admin-user-suspend"
                    onClick={() => setPendingAction("suspend")}
                    className="inline-flex h-8 cursor-pointer items-center rounded-lg border border-rose-300/25 bg-rose-300/[0.06] px-3 text-[11px] font-semibold text-rose-200/90 transition-colors hover:border-rose-300/50"
                  >
                    Suspend
                  </button>
                ) : null}
              </div>
              <p className="mt-2 text-[10.5px] leading-relaxed text-subtle">
                Warnings deliver a moderation notice. Suspension locks the account and hides all public
                content; it is reversible. There is no impersonation — use the read-only facts above.
              </p>
            </section>
          </div>
        ) : null}
      </DetailDrawer>

      <ReasonDialog
        open={pendingAction !== null}
        title={
          pendingAction === "suspend"
            ? "Suspend this account?"
            : pendingAction === "unsuspend"
              ? "Unsuspend this account?"
              : "Send a warning notice"
        }
        description={
          pendingAction === "suspend"
            ? "The account is locked and its public content hidden until unsuspended."
            : pendingAction === "unsuspend"
              ? "Restores sign-in and public content."
              : "The text below is delivered to the user as a moderation notice."
        }
        confirmLabel={
          pendingAction === "suspend" ? "Suspend" : pendingAction === "unsuspend" ? "Unsuspend" : "Send warning"
        }
        destructive={pendingAction === "suspend"}
        requireReason={pendingAction !== "unsuspend"}
        placeholder={pendingAction === "warn" ? "The message the user will receive…" : undefined}
        busy={busy}
        error={actionError}
        onConfirm={(reason) => pendingAction && void runAction(pendingAction, reason)}
        onClose={() => setPendingAction(null)}
      />
    </div>
  );
}
