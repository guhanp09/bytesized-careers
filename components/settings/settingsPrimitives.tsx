"use client";

import Link from "next/link";
import React, { type ReactNode } from "react";

import { Icon } from "../Icons";

// Shared presentational primitives for the Settings surface. Extracted from
// SettingsClient so the page component stays focused on state + persistence.
// Everything here is stateless: rows report async progress through the
// `RowFeedback` value their parent passes down.

export type RowTone = "active" | "neutral" | "readonly" | "danger";
export type RowFeedback = { state: "saving" | "saved" | "error"; message?: string };

type IconName = React.ComponentProps<typeof Icon>["name"];

export function StatusPill({ label, tone = "neutral" }: { label: string; tone?: RowTone }) {
  return (
    <span
      className={[
        "inline-flex min-h-6 max-w-[220px] items-center justify-center rounded-full border px-2.5 text-[11px] font-semibold leading-5 sm:max-w-[300px]",
        tone === "active"
          ? "border-emerald-300/16 bg-emerald-300/[0.08] text-emerald-100"
          : tone === "danger"
            ? "border-rose-300/18 bg-rose-400/[0.07] text-rose-100"
            : tone === "readonly"
              ? "border-white/[0.09] bg-white/[0.04] text-white/48"
              : "border-white/[0.1] bg-white/[0.045] text-white/62",
      ].join(" ")}
    >
      <span className="truncate">{label}</span>
    </span>
  );
}

export function RowFeedbackBadge({ feedback }: { feedback?: RowFeedback }) {
  if (!feedback) return null;
  if (feedback.state === "saving") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-white/44">
        <span className="h-3 w-3 rounded-full border border-white/16 border-t-white/70 animate-spin" />
        Saving
      </span>
    );
  }
  if (feedback.state === "saved") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-100/76">
        <Icon name="check" className="h-3.5 w-3.5" />
        {feedback.message || "Saved"}
      </span>
    );
  }
  return (
    <span className="inline-flex max-w-[260px] items-center gap-1.5 text-[11px] font-semibold text-amber-100/86">
      <Icon name="alert" className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{feedback.message || "Could not save."}</span>
    </span>
  );
}

export function SettingsSection({
  id,
  title,
  description,
  icon,
  headerAction,
  children,
}: {
  id: string;
  title: string;
  description: string;
  icon?: IconName;
  headerAction?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      data-testid={`settings-section-${id}`}
      className="scroll-mt-24 rounded-2xl border border-white/[0.08] bg-white/[0.03]"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/[0.06] px-5 py-4">
        <div className="min-w-0">
          <h2 className="inline-flex items-center gap-2 text-base font-semibold tracking-tight text-white">
            {icon ? (
              <span aria-hidden="true" className="inline-flex shrink-0 text-white/55">
                <Icon name={icon} className="h-4 w-4" />
              </span>
            ) : null}
            <span>{title}</span>
          </h2>
          <p className="mt-1 max-w-3xl text-[13px] leading-6 text-white/45">{description}</p>
        </div>
        {headerAction ? <div className="shrink-0">{headerAction}</div> : null}
      </div>
      <div className="divide-y divide-white/[0.05]">{children}</div>
    </section>
  );
}

export function SettingRow({
  rowId,
  title,
  description,
  status,
  statusTone = "neutral",
  feedback,
  action,
  children,
  danger = false,
}: {
  rowId: string;
  title: string;
  description: string;
  status?: string;
  statusTone?: RowTone;
  feedback?: RowFeedback;
  action?: ReactNode;
  children?: ReactNode;
  danger?: boolean;
}) {
  return (
    <div data-testid={`settings-row-${rowId}`} className="px-5 py-4">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
        <div className="min-w-0 space-y-1">
          <h3 className={["text-sm font-semibold", danger ? "text-rose-100" : "text-white/86"].join(" ")}>
            {title}
          </h3>
          <p className="max-w-2xl text-sm leading-6 text-white/48">{description}</p>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2 sm:justify-end">
          <RowFeedbackBadge feedback={feedback} />
          {status ? <StatusPill label={status} tone={danger ? "danger" : statusTone} /> : null}
          {action}
        </div>
      </div>
      {children ? <div className="mt-4">{children}</div> : null}
    </div>
  );
}

/**
 * The shared ghost/danger pill used for every row action that is not an inline
 * editor toggle (Upload, Refresh, Mark all read, Copy link, Open, Sign out…).
 * Renders a Link when `href` is given, otherwise a button.
 */
export function RowActionButton({
  icon,
  children,
  onClick,
  href,
  disabled,
  tone = "ghost",
  external = false,
}: {
  icon?: IconName;
  children: ReactNode;
  onClick?: () => void;
  href?: string;
  disabled?: boolean;
  tone?: "ghost" | "danger";
  external?: boolean;
}) {
  const className = [
    "inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 disabled:cursor-not-allowed disabled:opacity-45",
    tone === "danger"
      ? "border-rose-300/20 bg-rose-400/[0.06] text-rose-100 hover:border-rose-300/35 hover:bg-rose-400/[0.12]"
      : "border-white/[0.1] bg-white/[0.035] text-white/66 hover:border-white/[0.18] hover:bg-white/[0.065] hover:text-white",
  ].join(" ");
  const inner = (
    <>
      {icon ? <Icon name={icon} className="h-3.5 w-3.5" /> : null}
      {children}
    </>
  );
  if (href) {
    return (
      <Link
        href={href}
        className={className}
        {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
      >
        {inner}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={className}>
      {inner}
    </button>
  );
}

export function EditButton({
  active,
  onClick,
  disabled,
  label = "Edit",
}: {
  active?: boolean;
  onClick: () => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-expanded={active}
      className={[
        "inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 disabled:cursor-not-allowed disabled:opacity-50",
        active
          ? "border-white/22 bg-white/[0.1] text-white"
          : "border-white/[0.1] bg-white/[0.035] text-white/66 hover:border-white/[0.18] hover:bg-white/[0.065] hover:text-white",
      ].join(" ")}
    >
      <Icon name="pencil" className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

export function InlinePanel({
  children,
  error,
  actions,
}: {
  children: ReactNode;
  error?: string | null;
  actions: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-white/[0.09] bg-black/20 p-4">
      {error ? (
        <p className="mb-3 rounded-xl border border-amber-200/18 bg-amber-200/[0.075] px-3 py-2 text-xs text-amber-50/84">
          {error}
        </p>
      ) : null}
      {children}
      <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">{actions}</div>
    </div>
  );
}

export function CancelButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="h-9 cursor-pointer rounded-xl border border-white/10 bg-white/[0.03] px-3 text-xs font-semibold text-white/62 transition-colors hover:bg-white/[0.07] hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
    >
      Cancel
    </button>
  );
}

export function SaveButton({ onClick, disabled, saving }: { onClick: () => void; disabled?: boolean; saving?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || saving}
      className="h-9 cursor-pointer rounded-xl bg-white px-4 text-xs font-semibold text-black transition-colors hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {saving ? "Saving..." : "Save"}
    </button>
  );
}

export function FieldLabel({ children }: { children: ReactNode }) {
  return <span className="text-xs font-semibold text-white/55">{children}</span>;
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  maxLength,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  maxLength?: number;
  type?: string;
}) {
  return (
    <label className="space-y-2">
      <FieldLabel>{label}</FieldLabel>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        className="h-10 w-full rounded-xl border border-white/10 bg-black/18 px-3 text-sm text-white outline-none transition-colors placeholder:text-white/28 focus:border-white/24"
      />
    </label>
  );
}

export function SelectField({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <label className="space-y-2">
      <FieldLabel>{label}</FieldLabel>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full cursor-pointer rounded-xl border border-white/10 bg-[#101116] px-3 text-sm text-white outline-none transition-colors focus:border-white/24"
      >
        {children}
      </select>
    </label>
  );
}

export function ToggleSwitch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      disabled={disabled}
      className={[
        "relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 disabled:cursor-not-allowed disabled:opacity-55",
        checked ? "border-white/24 bg-white text-black" : "border-white/12 bg-white/[0.055] text-white/50",
      ].join(" ")}
    >
      <span
        className={[
          "absolute h-5 w-5 rounded-full transition-transform",
          checked ? "translate-x-5 bg-black" : "translate-x-1 bg-white/58",
        ].join(" ")}
      />
    </button>
  );
}
