"use client";

import React from "react";
import { createPortal } from "react-dom";

import type { BackendRole } from "../../lib/backendClient";
import { formatStartFilterLabel } from "../../lib/format";
import {
  COMPENSATION_UNITS,
  ENGAGEMENT_TYPES,
  compensationUnitLabel,
  engagementLabel,
  type CompensationUnit,
  type EngagementType,
} from "../../lib/jobContract";
import type { JobDiscoveryState } from "../../lib/jobDiscovery";
import { sentenceCaseJobValue, uniqueJobText } from "../../lib/jobPresentation";
import { JOB_START_TIME_VALUES } from "../../lib/jobFilterOptions";
import { Icon } from "../Icons";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function ChoiceGroup({
  label,
  values,
  selected,
  labelFor = sentenceCaseJobValue,
  onChange,
}: {
  label: string;
  values: readonly string[];
  selected: string[];
  labelFor?: (value: string) => string;
  onChange: (next: string[]) => void;
}) {
  const selectedKeys = new Set(selected.map((value) => value.toLocaleLowerCase()));
  return (
    <fieldset className="min-w-0">
      <legend className="text-[10px] font-semibold uppercase tracking-[0.18em] text-subtle">{label}</legend>
      <div className="mt-2.5 flex min-w-0 flex-wrap gap-2">
        {values.map((value) => {
          const active = selectedKeys.has(value.toLocaleLowerCase());
          return (
            <button
              key={value}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(active ? selected.filter((item) => item.toLocaleLowerCase() !== value.toLocaleLowerCase()) : [...selected, value])}
              className={[
                "max-w-full cursor-pointer break-words rounded-xl border px-3 py-2 text-left text-xs font-semibold transition-colors",
                active
                  ? "border-white bg-white text-black"
                  : "border-white/10 bg-white/[0.045] text-white/68 hover:border-white/20 hover:bg-white/[0.08] hover:text-white",
              ].join(" ")}
            >
              {labelFor(value)}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

export default function JobFiltersDrawer({
  open,
  initialState,
  roles,
  platforms,
  formats,
  onApply,
  onClose,
}: {
  open: boolean;
  initialState: JobDiscoveryState;
  roles: BackendRole[];
  platforms: string[];
  formats: string[];
  onApply: (state: JobDiscoveryState) => void;
  onClose: () => void;
}) {
  const [mounted, setMounted] = React.useState(false);
  const [draft, setDraft] = React.useState(initialState);
  const panelRef = React.useRef<HTMLElement | null>(null);
  const titleId = React.useId();

  React.useEffect(() => setMounted(true), []);
  React.useEffect(() => {
    if (open) setDraft(initialState);
  }, [initialState, open]);
  React.useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const timer = window.setTimeout(() => panelRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)?.focus(), 30);
    return () => {
      window.clearTimeout(timer);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus?.();
    };
  }, [open]);

  const set = <K extends keyof JobDiscoveryState>(key: K, value: JobDiscoveryState[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const clear = () =>
    setDraft(
      Object.fromEntries(Object.keys(initialState).map((key) => [key, []])) as unknown as JobDiscoveryState,
    );

  const roleOptions = roles.filter((role) => Boolean(role.slug));
  const selectedRole = draft.role[0] || "";
  const selectedRoleIsMissing = Boolean(
    selectedRole && !roleOptions.some((role) => role.slug?.toLocaleLowerCase() === selectedRole.toLocaleLowerCase()),
  );
  const platformOptions = uniqueJobText([...platforms, ...draft.platform]);
  const formatOptions = uniqueJobText([...formats, ...draft.format]);

  if (!mounted || !open) return null;

  return createPortal(
    <div className="fixed inset-y-0 left-20 right-0 z-[70] bg-black/65 backdrop-blur-sm" role="presentation">
      <button type="button" aria-label="Close job filters" className="absolute inset-0 cursor-default" onClick={onClose} />
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            onClose();
            return;
          }
          if (event.key !== "Tab") return;
          const focusables = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) || []);
          if (!focusables.length) return;
          const first = focusables[0];
          const last = focusables[focusables.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
        className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col overflow-hidden border-l border-white/10 bg-[#15161a] shadow-[-24px_0_80px_-40px_rgba(0,0,0,1)]"
      >
        <header className="flex items-start justify-between gap-3 border-b border-white/[0.07] px-4 py-4 sm:px-5">
          <div className="min-w-0">
            <h2 id={titleId} className="text-lg font-semibold tracking-tight text-white">Filter jobs</h2>
            <p className="mt-1 text-xs leading-relaxed text-muted">Structured filters stay in the URL so this view can be shared.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-white/65 hover:bg-white/[0.08] hover:text-white">
            <Icon name="x" className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-4 py-5 sm:px-5">
          <label className="block min-w-0">
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-subtle">Primary role</span>
            <select
              value={draft.role[0] || ""}
              onChange={(event) => {
                set("role", event.target.value ? [event.target.value] : []);
                if (event.target.value) set("filter", []);
              }}
              className="mt-2.5 h-11 w-full cursor-pointer rounded-xl border border-white/10 bg-white/[0.055] px-3 text-sm text-white outline-none focus:border-white/25"
            >
              <option value="" className="bg-[#15161a]">All creator roles</option>
              {selectedRoleIsMissing ? (
                <option value={selectedRole} className="bg-[#15161a]">Selected role ({selectedRole})</option>
              ) : null}
              {roleOptions.map((role) => (
                <option key={role.id} value={role.slug || ""} className="bg-[#15161a]">{role.name}</option>
              ))}
            </select>
          </label>

          <ChoiceGroup label="Platform" values={platformOptions} selected={draft.platform} onChange={(next) => set("platform", next)} />
          <ChoiceGroup label="Content format" values={formatOptions} selected={draft.format} onChange={(next) => set("format", next)} />
          <ChoiceGroup label="Work mode" values={["remote", "hybrid", "onsite"]} selected={draft.workMode} onChange={(next) => set("workMode", next)} />
          <ChoiceGroup
            label="Engagement"
            values={ENGAGEMENT_TYPES}
            selected={draft.engagement}
            labelFor={(value) => engagementLabel(value as EngagementType)}
            onChange={(next) => set("engagement", next)}
          />
          <ChoiceGroup
            label="Compensation basis"
            values={COMPENSATION_UNITS}
            selected={draft.compensationUnit}
            labelFor={(value) => compensationUnitLabel(value as CompensationUnit)}
            onChange={(next) => set("compensationUnit", next)}
          />
          <label className="block min-w-0">
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-subtle">Location</span>
            <input
              value={draft.location[0] || ""}
              onChange={(event) => set("location", event.target.value.trimStart() ? [event.target.value] : [])}
              placeholder="City, region, or country"
              className="mt-2.5 h-11 w-full rounded-xl border border-white/10 bg-white/[0.055] px-3 text-sm text-white outline-none placeholder:text-subtle focus:border-white/25"
            />
          </label>

          <label className="block min-w-0">
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-subtle">Start timeframe</span>
            <select
              value={draft.start_timeframe[0] || ""}
              onChange={(event) => set("start_timeframe", event.target.value ? [event.target.value] : [])}
              className="mt-2.5 h-11 w-full cursor-pointer rounded-xl border border-white/10 bg-white/[0.055] px-3 text-sm text-white outline-none focus:border-white/25"
            >
              <option value="" className="bg-[#15161a]">Any start timeframe</option>
              {JOB_START_TIME_VALUES.map((value) => (
                <option key={value} value={value} className="bg-[#15161a]">
                  {formatStartFilterLabel(value)}
                </option>
              ))}
            </select>
          </label>
        </div>

        <footer className="flex items-center gap-3 border-t border-white/[0.07] px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-5">
          <button type="button" onClick={clear} className="inline-flex h-11 flex-1 cursor-pointer items-center justify-center rounded-xl border border-white/12 bg-white/[0.04] text-sm font-semibold text-white/75 hover:bg-white/[0.08] hover:text-white">
            Clear
          </button>
          <button type="button" onClick={() => onApply({ ...draft, location: uniqueJobText(draft.location) })} className="inline-flex h-11 flex-[1.35] cursor-pointer items-center justify-center rounded-xl bg-white px-4 text-sm font-semibold text-black hover:bg-white/90">
            Show jobs
          </button>
        </footer>
      </aside>
    </div>,
    document.body,
  );
}
