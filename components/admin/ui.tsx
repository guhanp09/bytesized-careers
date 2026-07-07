"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "../Icons";

/**
 * Admin panel primitives (docs/ADMIN_PANEL_PLAN.md §16): the dense-but-calm
 * kit the public product deliberately doesn't have — data table, right-hand
 * detail drawer, filter chips, paginator, and the audited-action dialog with
 * a required justification. Dark, rounded-2xl, quieter radii than the public
 * marketplace surfaces.
 */

// ---- formatting -----------------------------------------------------------

const DATE_TIME = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatDateTime(iso?: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : DATE_TIME.format(date);
}

export function formatAge(iso?: string | null): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const minutes = Math.floor((Date.now() - then) / 60000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  return `${Math.floor(days / 30)}mo`;
}

export function personLabel(person?: { display_name?: string | null; username?: string | null; email?: string | null } | null): string {
  if (!person) return "—";
  return person.display_name || person.username || person.email || "—";
}

// ---- tones ----------------------------------------------------------------

export type PillTone = "neutral" | "active" | "warn" | "danger" | "dim";

const PILL_TONES: Record<PillTone, string> = {
  neutral: "border-white/[0.12] bg-white/[0.05] text-white/70",
  active: "border-emerald-200/30 bg-emerald-200/[0.08] text-emerald-100/90",
  warn: "border-amber-200/30 bg-amber-200/[0.08] text-amber-100/90",
  danger: "border-rose-300/30 bg-rose-300/[0.08] text-rose-200/90",
  dim: "border-white/[0.07] bg-transparent text-white/40",
};

export function TonePill({ tone = "neutral", children }: { tone?: PillTone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10.5px] font-semibold ${PILL_TONES[tone]}`}
    >
      {children}
    </span>
  );
}

/** Shared status → tone mapping across listings, reports, identities. */
export function statusTone(status?: string | null): PillTone {
  switch ((status || "").toLowerCase()) {
    case "published":
    case "active":
    case "verified":
    case "open":
    case "visible":
      return "active";
    case "paused":
    case "pending":
    case "reviewing":
      return "warn";
    case "hidden":
    case "rejected":
    case "suspended":
    case "revoked":
      return "danger";
    case "draft":
    case "closed":
    case "archived":
    case "dismissed":
    case "unverified":
      return "dim";
    default:
      return "neutral";
  }
}

// ---- layout blocks ----------------------------------------------------------

export function AdminCard({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-white/[0.07] bg-white/[0.03] ${className}`}>
      {children}
    </section>
  );
}

export function AdminSectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-white/45">{children}</p>
  );
}

export function KV({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="shrink-0 text-[11px] text-white/40">{label}</span>
      <span className="min-w-0 text-right text-[12px] text-white/80">{children}</span>
    </div>
  );
}

// ---- toolbar pieces ---------------------------------------------------------

export function FilterChip({
  active,
  onClick,
  children,
  testId,
}: {
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-pressed={active}
      onClick={onClick}
      className={[
        "inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-semibold transition-colors",
        active
          ? "border-white/30 bg-white/[0.09] text-white"
          : "border-white/[0.09] bg-transparent text-white/55 hover:border-white/20 hover:text-white/85",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

export function AdminSearch({
  value,
  onChange,
  placeholder,
  testId,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  testId?: string;
}) {
  return (
    <div className="relative w-48 sm:w-64">
      <Icon
        name="search"
        className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/35"
      />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        data-testid={testId}
        placeholder={placeholder}
        className="h-8 w-full rounded-lg border border-white/[0.1] bg-white/[0.03] pl-8 pr-3 text-xs text-white/85 placeholder:text-white/35 transition-colors focus:border-white/25 focus:outline-none"
      />
    </div>
  );
}

export function Paginator({
  total,
  limit,
  offset,
  onOffset,
}: {
  total: number;
  limit: number;
  offset: number;
  onOffset: (offset: number) => void;
}) {
  if (total <= limit) return null;
  const from = offset + 1;
  const to = Math.min(offset + limit, total);
  return (
    <div className="flex items-center justify-end gap-2 px-1 pt-3 text-[11px] text-white/45">
      <span>
        {from}–{to} of {total}
      </span>
      <button
        type="button"
        disabled={offset === 0}
        onClick={() => onOffset(Math.max(0, offset - limit))}
        className="inline-flex h-7 cursor-pointer items-center rounded-lg border border-white/[0.1] px-2.5 font-semibold text-white/60 transition-colors hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
      >
        Prev
      </button>
      <button
        type="button"
        disabled={to >= total}
        onClick={() => onOffset(offset + limit)}
        className="inline-flex h-7 cursor-pointer items-center rounded-lg border border-white/[0.1] px-2.5 font-semibold text-white/60 transition-colors hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
      >
        Next
      </button>
    </div>
  );
}

// ---- table ------------------------------------------------------------------

export function AdminTable({
  head,
  children,
  minWidth = 760,
  testId,
}: {
  head: ReactNode;
  children: ReactNode;
  minWidth?: number;
  testId?: string;
}) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-white/[0.07] bg-white/[0.02]">
      <table data-testid={testId} className="w-full border-collapse text-left" style={{ minWidth }}>
        <thead>
          <tr className="border-b border-white/[0.07]">{head}</tr>
        </thead>
        <tbody className="divide-y divide-white/[0.045]">{children}</tbody>
      </table>
    </div>
  );
}

export function Th({ children, className = "" }: { children?: ReactNode; className?: string }) {
  return (
    <th
      className={`px-3 py-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/40 ${className}`}
    >
      {children}
    </th>
  );
}

export function Td({ children, className = "" }: { children?: ReactNode; className?: string }) {
  return <td className={`px-3 py-2.5 align-middle text-[12px] text-white/75 ${className}`}>{children}</td>;
}

// ---- states -----------------------------------------------------------------

export function AdminLoading({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-hidden data-testid="admin-loading">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="h-11 animate-pulse rounded-xl border border-white/[0.05] bg-white/[0.03]" />
      ))}
    </div>
  );
}

export function AdminEmpty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div
      data-testid="admin-empty"
      className="flex min-h-[160px] flex-col items-center justify-center rounded-2xl border border-dashed border-white/[0.1] bg-white/[0.012] px-6 py-10 text-center"
    >
      <p className="text-sm font-medium text-white/55">{title}</p>
      {hint ? <p className="mx-auto mt-1 max-w-sm text-xs text-white/38">{hint}</p> : null}
    </div>
  );
}

export function AdminError({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      data-testid="admin-error"
      className="flex min-h-[160px] flex-col items-center justify-center rounded-2xl border border-amber-200/20 bg-amber-200/[0.04] px-6 py-10 text-center"
    >
      <p className="text-sm font-medium text-amber-100/85">Couldn’t load this from the backend.</p>
      <p className="mx-auto mt-1 max-w-sm text-xs text-white/40">
        The admin panel needs the CreatorJobs backend running and an ADMIN account.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-4 inline-flex h-8 cursor-pointer items-center rounded-lg border border-white/15 bg-white/[0.04] px-3 text-[11px] font-semibold text-white/80 transition-colors hover:bg-white/[0.08]"
      >
        Retry
      </button>
    </div>
  );
}

/** Standardized load/error/reload for admin data fetches. */
export function useAdminFetch<T>(fetcher: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [nonce, setNonce] = useState(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    fetcherRef
      .current()
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setState("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setState("error");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);
  return { data, state, reload };
}

// ---- drawer -----------------------------------------------------------------

export function DetailDrawer({
  open,
  onClose,
  title,
  subtitle,
  children,
  testId,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  testId?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[80]" role="dialog" aria-modal="true" aria-label={title}>
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/55 backdrop-blur-[2px]"
      />
      <aside
        data-testid={testId}
        className="absolute bottom-0 right-0 top-0 flex w-[min(460px,100vw)] flex-col border-l border-white/[0.1] bg-[#101014] shadow-[-24px_0_80px_-30px_rgba(0,0,0,1)]"
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-white/[0.07] px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-[15px] font-semibold text-white">{title}</h2>
            {subtitle ? <div className="mt-0.5 text-[11px] text-white/45">{subtitle}</div> : null}
          </div>
          <button
            type="button"
            data-testid="admin-drawer-close"
            onClick={onClose}
            aria-label="Close details"
            className="-mr-1 inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-white/55 transition-colors hover:bg-white/[0.07] hover:text-white"
          >
            <Icon name="x" className="h-4 w-4" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </aside>
    </div>
  );
}

// ---- audited action dialog ---------------------------------------------------

type ReasonDialogProps = {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel: string;
  destructive?: boolean;
  placeholder?: string;
  requireReason?: boolean;
  busy?: boolean;
  error?: string | null;
  onConfirm: (reason: string) => void;
  onClose: () => void;
};

/** The audited-action confirm. Form state lives in the body component, which
 * unmounts when closed — every open starts clean without effect-driven resets. */
export function ReasonDialog(props: ReasonDialogProps) {
  if (!props.open) return null;
  return <ReasonDialogBody {...props} />;
}

function ReasonDialogBody({
  title,
  description,
  confirmLabel,
  destructive,
  placeholder = "Why? Recorded in the audit log…",
  requireReason = true,
  busy,
  error,
  onConfirm,
  onClose,
}: ReasonDialogProps) {
  const [reason, setReason] = useState("");
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const ready = !requireReason || reason.trim().length >= 3;
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center px-4" role="dialog" aria-modal="true">
      <button type="button" aria-label="Cancel" onClick={onClose} className="absolute inset-0 cursor-default bg-black/65 backdrop-blur-sm" />
      <div
        data-testid="admin-reason-dialog"
        className="relative w-full max-w-sm rounded-2xl border border-white/[0.1] bg-[#15151b] p-5 shadow-[0_32px_90px_-30px_rgba(0,0,0,1)]"
      >
        <h3 className="text-sm font-semibold text-white">{title}</h3>
        {description ? <p className="mt-1.5 text-xs leading-relaxed text-white/55">{description}</p> : null}
        <textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          rows={3}
          maxLength={3000}
          data-testid="admin-reason-input"
          placeholder={placeholder}
          className="mt-3 w-full resize-none rounded-lg border border-white/[0.1] bg-black/25 px-3 py-2.5 text-[12.5px] leading-relaxed text-white/85 placeholder:text-white/35 transition-colors focus:border-white/25 focus:outline-none"
        />
        {error ? <p className="mt-2 text-[11px] text-rose-300/85">{error}</p> : null}
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 cursor-pointer items-center rounded-lg border border-white/15 bg-white/[0.04] px-3 text-[11px] font-semibold text-white/75 transition-colors hover:bg-white/[0.08]"
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="admin-reason-confirm"
            disabled={!ready || busy}
            onClick={() => onConfirm(reason.trim())}
            className={[
              "inline-flex h-8 cursor-pointer items-center rounded-lg px-3 text-[11px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45",
              destructive
                ? "bg-rose-300/90 text-black hover:bg-rose-300"
                : "bg-white text-black hover:bg-white/90",
            ].join(" ")}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- planned module ----------------------------------------------------------

export function PlannedModule({
  title,
  description,
  dependencies,
}: {
  title: string;
  description: string;
  dependencies: string[];
}) {
  return (
    <AdminCard className="p-5" >
      <div data-testid="admin-planned" className="flex items-start gap-3">
        <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-white/[0.09] bg-white/[0.03] text-white/40">
          <Icon name="clock" className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-[13px] font-semibold text-white/80">{title}</h3>
            <TonePill tone="dim">Planned</TonePill>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-white/48">{description}</p>
          <p className="mt-2 text-[10.5px] uppercase tracking-[0.12em] text-white/30">
            Needs: {dependencies.join(" · ")}
          </p>
        </div>
      </div>
    </AdminCard>
  );
}
