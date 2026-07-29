"use client";

/**
 * The Applications workspace navigation surface.
 *
 * Extracted from `ApplicationsWorkspace.tsx` so the controls that decide *what
 * you are looking at* can be read and changed without scrolling through the
 * ~5,000 lines that decide *how a conversation behaves*. Everything here is
 * presentational: the state lives in the workspace, which stays the coordinator.
 *
 * Three layers, and only three:
 *
 *   1. identity  — who you are acting as        (WorkspacePersonaControl)
 *   2. view      — how you are looking at it    (WorkspaceViewSwitcher)
 *   3. scope     — which subset is on screen    (InteractionScopeControl)
 *
 * Layers 1 and 2 share one bar; layer 3 owns the next. Anything that is a
 * *readout* rather than a choice — caught-up lines, unread totals, per-job
 * workloads — hangs off layer 3 instead of claiming a bar of its own, because
 * a row the user cannot act on is not a navigation level.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  EMPTY_CLASSIFICATION_FILTER,
  countActiveFilters,
  describeFilter,
  type ClassificationFilter,
} from "../../lib/reviewClassification";
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

/** What each persona actually contains, said plainly rather than in one word. */
const PERSONA_DESCRIPTIONS: Record<WorkspaceMode, string> = {
  talent: "Jobs you applied to, and hiring requests sent to you",
  hiring: "People who applied to your jobs, and talent you contacted",
};

/**
 * One icon per persona, used in the trigger and in the menu.
 *
 * The two sides of this marketplace are the difference between "work I am
 * looking for" and "people I am hiring", and two words in the same weight made
 * that a reading task. A person for the creator's own side, a briefcase for the
 * hiring side — supporting the label rather than replacing it, and the only
 * icon on each row apart from the check.
 */
const PERSONA_ICONS: Record<WorkspaceMode, "user" | "briefcase"> = {
  talent: "user",
  hiring: "briefcase",
};

/**
 * Close on outside-pointer and Escape, returning focus to the trigger.
 *
 * Shared because both menus here must behave identically — a disclosure that
 * strands a keyboard user because only one of two implementations handled
 * Escape is the kind of inconsistency nobody finds until it has shipped.
 */
function useDismissable(
  open: boolean,
  close: () => void,
  rootRef: React.RefObject<HTMLElement | null>,
  triggerRef: React.RefObject<HTMLElement | null>
) {
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      close();
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, close, rootRef, triggerRef]);
}

/**
 * Arrow-key movement inside an open menu.
 *
 * `role="menu"` is a promise: it tells assistive technology that Up and Down
 * move between items and that focus starts inside. Announcing the role without
 * honouring it is worse than not announcing it, because a screen-reader user is
 * told to expect a control that then does not respond.
 *
 * Home and End are included because this menu is three groups deep — reaching
 * the last option by repeated Down is exactly the tax the grouping was meant to
 * remove.
 */
function useMenuKeyboard(open: boolean, menuRef: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const items = () =>
      Array.from(
        menuRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? []
      ).filter((node) => !node.hasAttribute("disabled"));

    // Focus starts on the checked item if there is one, so opening the menu
    // says where you already are rather than dropping you at the top.
    const frame = window.requestAnimationFrame(() => {
      const all = items();
      const checked = all.find((node) => node.getAttribute("aria-checked") === "true");
      (checked ?? all[0])?.focus();
    });

    const onKeyDown = (event: KeyboardEvent) => {
      const all = items();
      if (all.length === 0) return;
      const index = all.indexOf(document.activeElement as HTMLElement);
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        // Wrapping, because a menu with a top and a bottom you can fall off is
        // a menu you have to look at to use.
        const next = index < 0 ? 0 : (index + step + all.length) % all.length;
        all[next]?.focus();
      } else if (event.key === "Home") {
        event.preventDefault();
        all[0]?.focus();
      } else if (event.key === "End") {
        event.preventDefault();
        all[all.length - 1]?.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, menuRef]);
}

/**
 * Layer 1 — workspace identity.
 *
 * A menu, deliberately not a segmented control. The global header's
 * Jobs/Talent search scope *is* a two-option segmented control with an
 * inverted white pill, and this used to be styled identically while meaning
 * something entirely different: one narrows a search, the other changes which
 * side of the marketplace you are operating as. Two controls that look and
 * behave the same teach the user they mean the same kind of thing.
 *
 * So the difference is structural rather than chromatic: a disclosure that
 * names the current identity — "Working as Recruiter" — and explains what each
 * option contains cannot be mistaken for a filter, whatever colour either one
 * is painted.
 */
export function WorkspacePersonaControl({
  mode,
  modeOptions,
  onModeChange,
  ready,
}: {
  mode: WorkspaceMode;
  modeOptions: WorkspaceModeOption[];
  onModeChange?: (mode: WorkspaceMode) => void;
  ready: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  useDismissable(open, () => setOpen(false), rootRef, triggerRef);

  const activeLabel = modeOptions.find((option) => option.key === mode)?.label ?? mode;
  // Nothing to switch to means no control: a disclosure opening onto a single
  // already-active option would be inert.
  const switchable = modeOptions.length > 1 && Boolean(onModeChange);

  if (!switchable) {
    return (
      <p
        data-testid="workspace-persona"
        data-persona={mode}
        className="inline-flex h-9 shrink-0 items-center gap-1.5 px-1 text-[13px] font-semibold text-ink"
      >
        <span className="text-[11px] font-medium text-muted">Working as</span>
        {activeLabel}
      </p>
    );
  }

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        data-testid="workspace-persona"
        data-persona={mode}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Working as ${activeLabel}. Change workspace.`}
        disabled={!ready}
        onClick={() => setOpen((value) => !value)}
        className={[
          "inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-xl border px-2.5 text-[13px] font-semibold transition-colors disabled:cursor-wait disabled:opacity-55",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
          open
            ? "border-line-strong bg-elevated text-ink"
            : "border-line bg-raised text-ink hover:border-line-mid hover:bg-elevated",
        ].join(" ")}
      >
        <Icon name={PERSONA_ICONS[mode]} className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden="true" />
        <span className="hidden text-[11px] font-medium text-muted sm:inline">Working as</span>
        {activeLabel}
        <Icon
          name="chevron-right"
          className={[
            "h-3 w-3 shrink-0 text-muted transition-transform",
            open ? "-rotate-90" : "rotate-90",
          ].join(" ")}
          aria-hidden="true"
        />
      </button>
      {open ? (
        <div
          role="menu"
          data-testid="workspace-persona-menu"
          aria-label="Workspace"
          className="absolute left-0 top-[calc(100%+8px)] z-30 w-[268px] rounded-2xl border border-line-mid bg-overlay p-1.5 elev-4"
        >
          <p className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold text-subtle">Working as</p>
          {modeOptions.map((option) => {
            const isActive = option.key === mode;
            return (
              <button
                key={option.key}
                type="button"
                role="menuitemradio"
                aria-checked={isActive}
                data-testid={`workspace-persona-${option.key}`}
                onClick={() => {
                  setOpen(false);
                  triggerRef.current?.focus();
                  if (!isActive) onModeChange?.(option.key);
                }}
                className={[
                  "flex w-full cursor-pointer items-start gap-2 rounded-xl px-2.5 py-2 text-left transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
                  isActive ? "bg-elevated" : "hover:bg-elevated",
                ].join(" ")}
              >
                <Icon
                  name="check"
                  className={[
                    "mt-0.5 h-3.5 w-3.5 shrink-0",
                    isActive ? "text-ink" : "text-transparent",
                  ].join(" ")}
                  aria-hidden="true"
                />
                <Icon
                  name={PERSONA_ICONS[option.key]}
                  className={[
                    "mt-0.5 h-3.5 w-3.5 shrink-0",
                    isActive ? "text-ink" : "text-muted",
                  ].join(" ")}
                  aria-hidden="true"
                />
                <span className="min-w-0">
                  <span className="block text-[13px] font-semibold text-ink">{option.label}</span>
                  <span className="mt-0.5 block text-[11px] leading-4 text-muted">
                    {PERSONA_DESCRIPTIONS[option.key]}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Layer 2 — workspace view. Inbox = conversation-first; Pipeline = stage-first
 * management board.
 *
 * Segmented, because it genuinely *is* a two-option switch over one set of
 * records. Its active state is a raised surface rather than the inverted white
 * pill the search control uses, so the workspace no longer contains anything
 * that mimics the search scope.
 */
export function WorkspaceViewSwitcher({
  view,
  onViewChange,
  ready,
}: {
  view: WorkspaceView;
  onViewChange: (view: WorkspaceView) => void;
  ready: boolean;
}) {
  return (
    <div
      className="surface-inset inline-flex shrink-0 items-center gap-0.5 rounded-xl p-1"
      role="group"
      aria-label="Workspace view"
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
              "inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold transition-all disabled:cursor-wait disabled:opacity-55",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
              isActive ? "bg-elevated text-ink elev-1" : "text-muted hover:bg-wash hover:text-default",
            ].join(" ")}
          >
            <Icon name={option.icon} className="h-3.5 w-3.5" />
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Layers 1 and 2, in one bar.
 *
 * Sharing a row is deliberate. They answer different questions — "who am I
 * acting as" and "how am I looking at this" — but both are answered once and
 * rarely revisited, so a bar each spent permanent vertical space on decisions
 * nobody makes twice in a session.
 */
export function ApplicationsWorkspaceNavigation({
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
      className="bg-shell flex shrink-0 items-center gap-2 border-b border-line px-3 py-2"
      data-testid="applications-workspace-controls"
    >
      <WorkspacePersonaControl
        mode={mode}
        modeOptions={modeOptions}
        onModeChange={onModeChange}
        ready={ready}
      />
      {/*
        Both left-aligned, deliberately. Right-aligning the view switcher looked
        tidier but pinned it to the container's right edge — the 390px list rail
        in the Inbox, the full workspace in the Pipeline — so the control moved
        763px the moment you used it. A switch that teleports when pressed is
        worse than an uneven bar.
      */}
      <WorkspaceViewSwitcher view={view} onViewChange={onViewChange} ready={ready} />
    </div>
  );
}

export type WorkQueueChip = {
  key: string;
  label: string;
  count: number;
  /** What the category means, shown under its name so the criteria are stated. */
  description?: string;
};

/**
 * Layer 3, second axis — work queues.
 *
 * Queues are recommendations layered over the ownership scope, not a second
 * ownership scope, so they hang off the scope row as a disclosure rather than
 * occupying a row of their own. A closed menu costs one control and still
 * carries the number, which is the part that earns attention.
 *
 * When a queue is active it is named on the trigger and paired with its own
 * clear button, so returning to everything stays one click and needs no menu —
 * the rail this replaces made you find "All" among chips that scrolled.
 */
export type ClassificationSection = {
  key: "review" | "status" | "attention";
  label: string;
  /** What this section's numbers add up to, in words. */
  denominator: string;
  denominatorCount: number;
  options: Array<{ key: string; label: string; description: string; count: number }>;
};

/**
 * What am I looking at?
 *
 * This was one flat list — *Decision needed*, *New to review*, *Up to date* —
 * whose parts added up to the whole and still left the reader unsure. The
 * arithmetic was never the problem: those three names answer three different
 * questions, and flattened together they compete, so the list had to pick one
 * answer per record and silently drop the others.
 *
 * Three labelled sections, each a partition of a stated denominator. A record
 * has one answer in each, they combine to narrow, and the menu prints what each
 * section reconciles against — because a column of numbers with no denominator
 * is a column of numbers the reader has to take on faith.
 *
 * Starred sits below the sections rather than inside one: it is personal
 * organisation cutting across all three, not a fourth question about the record.
 */
export function WorkQueueSelector({
  sections,
  filter,
  total,
  starredCount,
  onChange,
}: {
  sections: ClassificationSection[];
  filter: ClassificationFilter;
  total: number;
  starredCount: number;
  onChange: (next: ClassificationFilter) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  useDismissable(open, () => setOpen(false), rootRef, triggerRef);
  useMenuKeyboard(open, menuRef);

  const active = describeFilter(filter);
  const activeCount = countActiveFilters(filter);
  if (sections.every((section) => section.options.length === 0) && activeCount === 0) return null;

  const shown = sections.reduce((sum, section) => {
    const selected = filter[section.key];
    if (!selected) return sum;
    return section.options.find((option) => option.key === selected)?.count ?? sum;
  }, total);

  return (
    <div ref={rootRef} className="relative flex shrink-0 items-center" data-testid="queue-selector">
      <button
        ref={triggerRef}
        type="button"
        data-testid="queue-selector-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={
          activeCount > 0
            ? `Showing ${active.join(", ")}. Change what you are looking at.`
            : `Filter what you are looking at. ${total} in view.`
        }
        onClick={() => setOpen((value) => !value)}
        className={[
          "inline-flex h-7 cursor-pointer items-center gap-1.5 border px-2 text-[11.5px] font-semibold transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
          /*
            The painted control is 28px, matching the density of the toolbar it
            sits in; the *target* is 44px, because a finger does not care what
            the row looks like. Extended vertically only — the neighbours here
            are horizontal, so growing sideways would steal their taps.
          */
          "relative before:absolute before:inset-x-0 before:-inset-y-2 before:content-['']",
          activeCount > 0
            ? "rounded-l-lg border-r-0 border-line-strong bg-elevated text-ink elev-1"
            : "rounded-lg border-line bg-raised text-muted hover:border-line-mid hover:text-default",
        ].join(" ")}
      >
        <Icon name="sliders-horizontal" className="h-3 w-3 shrink-0" aria-hidden="true" />
        {/*
          Named only while something is on, where the name says what is being
          hidden. Idle it is an offer, and spending 90px of a 390px rail
          advertising an offer pushed "Archived" off the end of the scope tabs.
          Two or more selections collapse to a count so the trigger cannot grow
          without limit.
        */}
        {activeCount === 1 ? <span className="max-w-[112px] truncate">{active[0]}</span> : null}
        {activeCount > 1 ? <span className="whitespace-nowrap">{activeCount} filters</span> : null}
        <span
          className={[
            "rounded px-1 text-[10.5px] tabular-nums",
            activeCount > 0 ? "bg-wash-strong text-default" : "text-subtle",
          ].join(" ")}
        >
          {activeCount > 0 ? shown : total}
        </span>
      </button>
      {activeCount > 0 ? (
        <button
          type="button"
          data-testid="queue-clear"
          aria-label="Show everything"
          onClick={() => onChange(EMPTY_CLASSIFICATION_FILTER)}
          className="relative inline-flex h-7 shrink-0 cursor-pointer items-center rounded-r-lg border border-line-strong bg-elevated pl-1 pr-1.5 text-ink transition-colors before:absolute before:inset-x-0 before:-inset-y-2 before:content-[''] elev-1 hover:bg-overlay focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        >
          <Icon name="close" className="h-3 w-3" aria-hidden="true" />
        </button>
      ) : null}
      {open ? (
        <div
          ref={menuRef}
          role="menu"
          data-testid="queue-selector-menu"
          aria-label="What you are looking at"
          className="absolute right-0 top-[calc(100%+6px)] z-30 max-h-[70vh] w-[320px] overflow-y-auto rounded-2xl border border-line-mid bg-overlay p-1.5 elev-4"
        >
          <button
            type="button"
            role="menuitemradio"
            aria-checked={activeCount === 0}
            data-testid="queue-chip-all"
            /*
              The denominator, in the DOM. Every section below reconciles
              against a stated number; a test that has to parse rendered text to
              check that is testing the formatter.
            */
            data-queue-key="all"
            data-queue-count={total}
            onClick={() => {
              setOpen(false);
              triggerRef.current?.focus();
              onChange(EMPTY_CLASSIFICATION_FILTER);
            }}
            className={[
              // 44px, like every other option below it. It was 32px: a single
              // line of text next to two-line options, and the one target in
              // the menu a finger could miss.
              "flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-xl px-2.5 py-1.5 text-left text-[12px] font-semibold transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
              activeCount === 0 ? "bg-elevated text-ink" : "text-secondary hover:bg-elevated hover:text-ink",
            ].join(" ")}
          >
            <Icon
              name="check"
              className={["h-3.5 w-3.5 shrink-0", activeCount === 0 ? "text-ink" : "text-transparent"].join(" ")}
              aria-hidden="true"
            />
            <span className="flex-1">Everything</span>
            <span className="shrink-0 text-[11px] tabular-nums text-subtle">{total}</span>
          </button>

          {sections.map((section) =>
            section.options.length === 0 ? null : (
              <div
                key={section.key}
                /*
                  A group, not a styled run. Sighted readers get the three
                  questions from the headings; without this a screen reader hears
                  nine radio buttons in one flat list and the structure the menu
                  exists to convey — that these answer *different* questions —
                  is the one thing that does not survive. The label carries the
                  denominator too, so "Opened, 12" is heard against what it
                  reconciles with rather than as a bare number.
                */
                role="group"
                aria-label={`${section.label}, of ${section.denominatorCount} ${section.denominator}`}
                className="mt-1.5"
                data-testid={`queue-plane-${section.key}`}
              >
                <p className="flex items-baseline justify-between gap-2 px-2.5 pb-1 pt-1" aria-hidden="true">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-subtle">
                    {section.label}
                  </span>
                  <span className="text-[10px] tabular-nums text-disabled">
                    of {section.denominatorCount} {section.denominator}
                  </span>
                </p>
                {section.options.map((option) => {
                  const isActive = filter[section.key] === option.key;
                  return (
                    <button
                      key={option.key}
                      type="button"
                      role="menuitemradio"
                      aria-checked={isActive}
                      data-testid={`queue-chip-${option.key}`}
                      data-queue-key={option.key}
                      data-queue-count={option.count}
                      data-plane={section.key}
                      onClick={() => {
                        setOpen(false);
                        triggerRef.current?.focus();
                        // Pressing the active option clears just that plane, so
                        // one control both applies and undoes.
                        onChange({ ...filter, [section.key]: isActive ? undefined : option.key });
                      }}
                      className={[
                        "flex w-full cursor-pointer items-start gap-2 rounded-xl px-2.5 py-1.5 text-left text-[12px] transition-colors",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
                        isActive
                          ? "bg-elevated font-semibold text-ink"
                          : "font-medium text-secondary hover:bg-elevated hover:text-ink",
                      ].join(" ")}
                    >
                      <Icon
                        name="check"
                        className={["h-3.5 w-3.5 shrink-0", isActive ? "text-ink" : "text-transparent"].join(" ")}
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{option.label}</span>
                        <span className="mt-0.5 block text-[10.5px] font-normal leading-snug text-muted">
                          {option.description}
                        </span>
                      </span>
                      <span className="shrink-0 text-[10.5px] tabular-nums text-subtle">{option.count}</span>
                    </button>
                  );
                })}
              </div>
            )
          )}

          {starredCount > 0 || filter.starred ? (
            <div
              role="group"
              aria-label="Personal organisation"
              className="mt-1.5 border-t border-line pt-1.5"
              data-testid="queue-plane-personal"
            >
              <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={Boolean(filter.starred)}
                data-testid="queue-chip-starred"
                data-queue-key="starred"
                data-queue-count={starredCount}
                data-plane="personal"
                onClick={() => {
                  setOpen(false);
                  triggerRef.current?.focus();
                  onChange({ ...filter, starred: filter.starred ? undefined : true });
                }}
                className={[
                  "flex w-full cursor-pointer items-start gap-2 rounded-xl px-2.5 py-1.5 text-left text-[12px] transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
                  filter.starred
                    ? "bg-elevated font-semibold text-ink"
                    : "font-medium text-secondary hover:bg-elevated hover:text-ink",
                ].join(" ")}
              >
                <Icon
                  name="check"
                  className={["h-3.5 w-3.5 shrink-0", filter.starred ? "text-ink" : "text-transparent"].join(" ")}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">Starred</span>
                  <span className="mt-0.5 block text-[10.5px] font-normal leading-snug text-muted">
                    Saved by you for a second look. Only you can see this, and it narrows whatever else is on.
                  </span>
                </span>
                <span className="shrink-0 text-[10.5px] tabular-nums text-subtle">{starredCount}</span>
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Layer 3 — content scope.
 *
 * One row carrying both scope axes: ownership (All / Applicants / Outreach /
 * Archived) as tabs, and attention (work queues) as the trailing disclosure.
 * They compose — a queue narrows whichever ownership scope is selected — so
 * collapsing them into one list of options would have deleted a real
 * capability, while stacking them as two rows of pills was the layer this
 * phase exists to remove.
 *
 * `trailing` carries whatever else the view needs beside the scope: a
 * caught-up line, a board readout, a workload disclosure. Readouts, not
 * choices — a choice belongs to one of the three layers or to the content.
 */
export function InteractionScopeControl({
  mode,
  filter,
  counts,
  onSelect,
  classificationSections = [],
  classificationFilter = EMPTY_CLASSIFICATION_FILTER,
  classificationTotal = 0,
  starredCount = 0,
  onClassificationChange,
  trailing,
}: {
  mode: WorkspaceMode;
  filter: WorkspaceFilter;
  counts: Record<WorkspaceFilter, number>;
  onSelect: (key: WorkspaceFilter) => void;
  classificationSections?: ClassificationSection[];
  classificationFilter?: ClassificationFilter;
  classificationTotal?: number;
  starredCount?: number;
  onClassificationChange?: (next: ClassificationFilter) => void;
  trailing?: ReactNode;
}) {
  const showQueues =
    Boolean(onClassificationChange) &&
    (classificationSections.some((section) => section.options.length > 0) ||
      countActiveFilters(classificationFilter) > 0);
  return (
    <div
      className="relative flex shrink-0 items-center gap-2 border-b border-line pl-4 pr-3"
      data-testid="interaction-scope"
    >
      {/*
        `scope-scroller` fades the right edge.

        The tabs scroll when they do not fit, with the scrollbar hidden — which
        left the last one sliced mid-word against a hard edge, reading as a
        clipped layout rather than as more to scroll. The fade says which it is.
      */}
      <div
        className="scope-scroller flex min-w-0 flex-1 items-end gap-3.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        role="group"
        aria-label="Scope"
      >
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
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
                isActive ? "text-ink" : "text-muted hover:text-default",
              ].join(" ")}
            >
              {option.label}
              {count > 0 ? (
                <span
                  className={[
                    "ml-1.5 text-[11px] font-medium tabular-nums",
                    isActive ? "text-secondary" : "text-subtle",
                  ].join(" ")}
                >
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
      {/*
        A clipped tab has to read as "more this way" rather than as a broken
        layout, so the strip fades into the control beside it instead of ending
        mid-letter. It sits behind the trailing control, never over it.
      */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute bottom-0 right-0 top-0 w-10 bg-gradient-to-l from-shell to-transparent"
      />
      {showQueues ? (
        <WorkQueueSelector
          sections={classificationSections}
          filter={classificationFilter}
          total={classificationTotal}
          starredCount={starredCount}
          onChange={(next) => onClassificationChange?.(next)}
        />
      ) : (
        trailing ?? null
      )}
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
