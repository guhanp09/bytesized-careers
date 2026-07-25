"use client";

/**
 * The Applications workspace navigation surface.
 *
 * Extracted from `ApplicationsWorkspace.tsx` so the controls that decide *what
 * you are looking at* can be read and changed without scrolling through the
 * ~5,400 lines that decide *how a conversation behaves*. Everything here is
 * presentational: the state lives in the workspace, which stays the coordinator.
 */

import { Icon } from "../Icons";
import { directionLabelsFor } from "../../lib/applicationPipeline";

export type WorkspaceMode = "talent" | "hiring";
export type WorkspaceFilter = "all" | "sent" | "received" | "archived";
export type WorkspaceView = "inbox" | "pipeline";
export type WorkspaceModeOption = { key: WorkspaceMode; label: string };

/**
 * Inbox scope filters. The direction scopes carry workflow names instead of
 * generic Sent/Received: within one mode each direction is one uniform kind,
 * so "Applicants"/"Outreach" (recruiter) and "Hiring requests"/"Applications"
 * (talent) say what the user is actually looking at. Received leads — it's
 * the side being managed.
 */
export function filterOptionsFor(
  mode: WorkspaceMode
): Array<{ key: WorkspaceFilter; label: string }> {
  const labels = directionLabelsFor(mode);
  return [
    { key: "all", label: "All" },
    { key: "received", label: labels.received },
    { key: "sent", label: labels.sent },
    { key: "archived", label: "Archived" },
  ];
}

export const DEFAULT_MODE_OPTIONS: WorkspaceModeOption[] = [
  { key: "talent", label: "Talent" },
  { key: "hiring", label: "Recruiter" },
];

export function FilterBar({
  mode,
  filter,
  counts,
  onSelect,
}: {
  mode: WorkspaceMode;
  filter: WorkspaceFilter;
  counts: Record<WorkspaceFilter, number>;
  onSelect: (key: WorkspaceFilter) => void;
}) {
  return (
    <div className="border-b border-line px-4">
      <div className="flex items-end gap-5 overflow-x-auto">
        {filterOptionsFor(mode).map((option) => {
          const isActive = filter === option.key;
          const count = counts[option.key];
          return (
            <button
              key={`applications-filter-${option.key}`}
              type="button"
              data-testid={`applications-filter-${option.key}`}
              aria-pressed={isActive}
              onClick={() => onSelect(option.key)}
              className={[
                "group/filter relative h-10 shrink-0 cursor-pointer whitespace-nowrap px-0.5 text-[13px] font-semibold transition-colors",
                isActive ? "text-white" : "text-muted hover:text-white/80",
              ].join(" ")}
            >
              {option.label}
              {count > 0 ? (
                <span className={`ml-1.5 text-[11px] font-medium ${isActive ? "text-white/55" : "text-subtle"}`}>
                  {count}
                </span>
              ) : null}
              <span
                className={[
                  "absolute inset-x-0 bottom-0 h-[2px] rounded-full transition-colors",
                  isActive ? "bg-white" : "bg-white/0 group-hover/filter:bg-white/20",
                ].join(" ")}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Persistent workspace header: Talent/Recruiter context + Inbox/Pipeline layout.
 * Rendered once above both views so the controls never move between them.
 */
export function WorkspaceControls({
  mode,
  modeOptions,
  onModeChange,
  view,
  onViewChange,
  ready,
}: {
  mode: WorkspaceMode;
  modeOptions: WorkspaceModeOption[];
  onModeChange?: (mode: WorkspaceMode) => void;
  view: WorkspaceView;
  onViewChange: (view: WorkspaceView) => void;
  ready: boolean;
}) {
  return (
    <div
      className="shrink-0 border-b border-line px-4 py-3"
      data-testid="applications-workspace-controls"
    >
      <div className="flex flex-wrap items-center gap-2.5">
        <div
          className="inline-flex shrink-0 items-center gap-1 rounded-xl border border-line bg-wash p-1"
          role="group"
          aria-label="Applications view"
        >
          {modeOptions.map((option) => {
            const isActive = mode === option.key;
            return (
              <button
                key={option.key}
                type="button"
                aria-pressed={isActive}
                disabled={!ready}
                onClick={() => onModeChange?.(option.key)}
                className={[
                  "h-8 cursor-pointer rounded-lg px-3.5 text-xs font-semibold transition-colors disabled:cursor-wait disabled:opacity-55",
                  isActive ? "bg-white text-black" : "text-white/60 hover:text-white",
                ].join(" ")}
              >
                {option.label}
              </button>
            );
          })}
        </div>

        {/* Inbox = conversation-first; Pipeline = stage-first management board. */}
        <div
          className="inline-flex shrink-0 items-center gap-1 rounded-xl border border-line bg-wash p-1"
          role="group"
          aria-label="Workspace layout"
        >
          {(
            [
              { key: "inbox", label: "Inbox", icon: "inbox" },
              { key: "pipeline", label: "Pipeline", icon: "layers" },
            ] as const
          ).map((option) => {
            const isActive = view === option.key;
            return (
              <button
                key={option.key}
                type="button"
                data-testid={`applications-view-${option.key}`}
                aria-pressed={isActive}
                disabled={!ready}
                onClick={() => onViewChange(option.key)}
                className={[
                  "inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition-colors disabled:cursor-wait disabled:opacity-55",
                  isActive ? "bg-white text-black" : "text-white/60 hover:text-white",
                ].join(" ")}
              >
                <Icon name={option.icon} className="h-3.5 w-3.5" />
                {option.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export type WorkQueueChip = { key: string; label: string; count: number };

/**
 * Work queues: recommendations layered over the ownership scope, so they sit
 * *under* the ownership filters rather than replacing them, and only appear
 * when they actually contain work — an empty queue advertising nothing would be
 * worse than no queue at all. Horizontally scrollable so a narrow screen never
 * wraps into a wall of tabs.
 */
export function WorkQueueSelector({
  chips,
  activeQueue,
  onSelect,
}: {
  chips: WorkQueueChip[];
  activeQueue: string | null;
  onSelect: (key: string | null) => void;
}) {
  return (
    /*
      Integrated with the list rather than pasted above it: one inset rail whose
      chips lift out of it when active, and a right-edge fade so a clipped chip
      reads as "more this way" instead of as a broken layout. `All` is always
      first, so leaving a queue is never a hunt for the escape.
    */
    <div className="relative shrink-0 px-3 pb-2 pt-2.5">
      <div
        className="surface-inset flex items-center gap-1 overflow-x-auto rounded-lg p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        data-testid="queue-selector"
        role="group"
        aria-label="Filter by what needs attention"
      >
        <button
          type="button"
          data-testid="queue-chip-all"
          aria-pressed={activeQueue === null}
          onClick={() => onSelect(null)}
          className={[
            "inline-flex h-7 shrink-0 cursor-pointer items-center rounded-md px-2.5 text-[11.5px] font-semibold transition-all",
            activeQueue === null
              ? "bg-elevated text-ink elev-1"
              : "text-muted hover:bg-wash hover:text-default",
          ].join(" ")}
        >
          All
        </button>
        {chips.map((chip) => {
          const isActive = activeQueue === chip.key;
          return (
            <button
              key={chip.key}
              type="button"
              data-testid={`queue-chip-${chip.key}`}
              aria-pressed={isActive}
              onClick={() => onSelect(isActive ? null : chip.key)}
              className={[
                "inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-[11.5px] font-medium transition-all",
                isActive
                  ? "bg-elevated font-semibold text-ink elev-1"
                  : "text-muted hover:bg-wash hover:text-default",
              ].join(" ")}
            >
              {chip.label}
              <span
                className={[
                  "rounded px-1 text-[10.5px] tabular-nums",
                  isActive ? "bg-wash-strong text-default" : "text-subtle",
                ].join(" ")}
              >
                {chip.count}
              </span>
            </button>
          );
        })}
      </div>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-2.5 right-3 w-8 rounded-r-lg bg-gradient-to-l from-shell to-transparent"
      />
    </div>
  );
}

/**
 * Dev/demo utility, deliberately out of the primary workflow: a quiet floating
 * chip in the workspace's bottom-right corner.
 */
export function SampleDataChip({
  demoMode,
  onToggleDemo,
}: {
  demoMode?: boolean;
  onToggleDemo?: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={demoMode}
      onClick={onToggleDemo}
      title="Preview the interface with sample data (development only)"
      className={[
        "hidden h-8 shrink-0 cursor-pointer items-center gap-2 rounded-full border px-3 text-[11px] font-semibold shadow-[0_14px_40px_-20px_rgba(0,0,0,0.9)] backdrop-blur transition-colors lg:inline-flex",
        demoMode
          ? "border-amber-200/30 bg-amber-200/[0.12] text-amber-100/90"
          : "border-line bg-[#131419]/90 text-muted hover:text-white/80",
      ].join(" ")}
    >
      <span
        className={["h-1.5 w-1.5 rounded-full", demoMode ? "bg-amber-300" : "bg-white/30"].join(" ")}
        aria-hidden="true"
      />
      Sample data
    </button>
  );
}
