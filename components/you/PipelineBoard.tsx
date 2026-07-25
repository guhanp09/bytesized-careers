"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../Icons";
import { InteractionTime } from "./InteractionTime";
import ConfirmDialog from "../ui/ConfirmDialog";
import {
  backendStatusOf,
  bulkStageTargetsFor,
  groupByStage,
  pipelineCardFacts,
  pipelineContextLabelOf,
  pipelineContextOptions,
  pipelineFirstMessageLines,
  pipelinePortfolioCountOf,
  pipelineProfileHrefOf,
  pipelineSearchMatch,
  pipelineSnippetOf,
  pipelineStagesFor,
  validStageTargetsFor,
  type NextBestAction,
  type PipelineFirstMessageLine,
  type PipelineStage,
  type WorkState,
} from "../../lib/applicationPipeline";
import type { InteractionDirection, InteractionKind, OwnerInteraction } from "../../lib/ownerInteractions";

/**
 * Pipeline view of the applications workspace: the same interactions the inbox
 * shows, presented as a stage-grouped management board with rich, draggable
 * candidate cards, multi-select, and bulk actions.
 *
 * The board is presentation-only — the parent owns the data and commits stage
 * moves (backend in live mode, local state in demo mode).
 */

/**
 * Stage moves that must never commit straight from a drag or a menu click.
 * This list is kept in step with the inbox's own confirm set in
 * `headerActionsFor` so the same decision costs the same deliberation on both
 * surfaces — a board drag is easier to trigger by accident than a menu item,
 * not harder.
 *
 * "archived" is deliberately absent: it is reversible, private, and carries no
 * participant-visible consequence, so the board treats it as an ordinary move.
 */
const CONFIRMED_STAGE_MOVES = ["hired", "accepted", "declined", "rejected"];

/**
 * Confirm copy per consequential stage, told honestly for one record or many —
 * a board selection can carry several people into the same outcome, and the
 * dialog has to say so before it commits.
 *
 * "rejected" is the one optional-shared outcome here: the move itself only
 * records a private stage, and the workspace asks separately whether to tell
 * the applicant, so the body must not imply the decision has already been sent.
 */
const STAGE_CONFIRM_COPY: Record<
  string,
  { title: (count: number) => string; body: (count: number) => string; confirmLabel: string }
> = {
  hired: {
    title: (count) => (count > 1 ? `Hire ${count} candidates?` : "Hire this candidate?"),
    body: () => "This shares the decision and creates the work engagement.",
    confirmLabel: "Confirm hire",
  },
  accepted: {
    title: (count) =>
      count > 1 ? `Accept ${count} hiring requests?` : "Accept this hiring request?",
    body: () => "This shares your acceptance and creates the work engagement.",
    confirmLabel: "Confirm acceptance",
  },
  declined: {
    title: (count) =>
      count > 1 ? `Decline ${count} hiring requests?` : "Decline this hiring request?",
    body: () => "This decision is shared with the recruiter.",
    confirmLabel: "Confirm decline",
  },
  rejected: {
    title: (count) =>
      count > 1
        ? `Mark ${count} applications as not selected?`
        : "Mark this application as not selected?",
    body: (count) =>
      count > 1
        ? "This is saved privately. Nobody is told unless you choose to share it."
        : "This is saved privately. You choose separately whether to tell the applicant.",
    confirmLabel: "Confirm not selected",
  },
};

type PipelineBoardProps = {
  items: OwnerInteraction[];
  kind: InteractionKind;
  direction: InteractionDirection;
  /** Unread message counts per thread (live mode), surfaced on the cards. */
  unreadByThread?: Record<string, number>;
  /** Stage focus to open with (e.g. from a ?stage= deep link). */
  initialStage?: string | null;
  /** Reports funnel focus changes so the page can keep the URL shareable. */
  onStageFocusChange?: (stage: string | null) => void;
  /** Open the compact chat dock on this thread (also the card's primary click). */
  onMessage: (item: OwnerInteraction) => void;
  /** Move one or many items to a backend stage. Resolves when committed. */
  onMoveStage: (items: OwnerInteraction[], stageKey: string) => Promise<void>;
  /**
   * Derived work state, supplied by the workspace so both views read from the
   * same function. Omitted when the flag is off.
   */
  workStateFor?: (item: OwnerInteraction) => WorkState | null;
  /** Recommended action, from the same shared ladder the Inbox uses. */
  nextActionFor?: (item: OwnerInteraction) => NextBestAction | null;
  /**
   * Run a recommended action. Only called for actions the board should own —
   * decision-type recommendations are served by the card's own stage menu, so
   * the board never grows a second, competing decision surface.
   */
  onNextAction?: (item: OwnerInteraction, action: NextBestAction) => void;
};

/** Recommendations the board dispatches itself; the rest belong to the stage menu. */
const BOARD_DISPATCHABLE_ACTIONS = new Set(["reply", "share-decision", "confirm-start"]);

function avatarInitials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function RowAvatar({ name, src }: { name: string; src?: string | null }) {
  return (
    <span className="relative inline-flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border border-line-mid bg-elevated text-[11px] font-semibold text-white/75">
      {avatarInitials(name)}
      {src ? <img src={src} alt="" className="absolute inset-0 h-full w-full object-cover" /> : null}
    </span>
  );
}

function stageMenuGroupLabel(stage: PipelineStage): string {
  return stage.notify?.automatic ? "Share a decision" : "Manage privately";
}

/** Compact "move to stage" menu. Used per-card and in the bulk bar. */
function StageMenu({
  targets,
  currentKey,
  triggerLabel,
  triggerTestId,
  optionTestPrefix,
  disabled,
  align = "right",
  drop = "down",
  onSelect,
}: {
  targets: PipelineStage[];
  currentKey?: string | null;
  triggerLabel: string;
  triggerTestId?: string;
  optionTestPrefix: string;
  disabled?: boolean;
  align?: "left" | "right";
  /** Cards drop down (clear of the sticky toolbar); the bottom bulk bar drops up. */
  drop?: "up" | "down";
  onSelect: (stageKey: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative" data-no-drag>
      <button
        ref={triggerRef}
        type="button"
        data-testid={triggerTestId}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
        className="inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-line bg-wash px-2.5 text-[11px] font-semibold text-white/70 transition-colors hover:border-line-strong hover:text-white disabled:cursor-not-allowed disabled:opacity-45"
      >
        {triggerLabel}
        <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open ? (
        <div
          role="menu"
          className={[
            "absolute z-40 min-w-44 rounded-xl border border-line-mid bg-[#111216] p-1.5 shadow-[0_24px_70px_-34px_rgba(0,0,0,1)]",
            drop === "up" ? "bottom-[calc(100%+6px)]" : "top-[calc(100%+6px)]",
            align === "right" ? "right-0" : "left-0",
          ].join(" ")}
        >
          {[...targets]
            .sort((left, right) => Number(Boolean(left.notify?.automatic)) - Number(Boolean(right.notify?.automatic)))
            .map((stage, index, orderedTargets) => {
            const isCurrent = stage.key === currentKey;
            const groupLabel = stageMenuGroupLabel(stage);
            const previousStage = index > 0 ? orderedTargets[index - 1] : null;
            const previousGroupLabel = previousStage ? stageMenuGroupLabel(previousStage) : null;
            return (
              <Fragment key={stage.key}>
                {groupLabel !== previousGroupLabel ? (
                  <p
                    data-testid={`pipeline-stage-menu-group-${groupLabel.toLowerCase().replace(/\s+/g, "-")}`}
                    className={[
                      "px-2.5 pb-1 pt-2 text-[9px] font-semibold uppercase tracking-[0.16em]",
                      stage.notify ? "text-muted" : "text-subtle",
                    ].join(" ")}
                  >
                    {groupLabel}
                  </p>
                ) : null}
                <button
                  type="button"
                  role="menuitem"
                  data-testid={`${optionTestPrefix}-${stage.key}`}
                  disabled={isCurrent}
                  onClick={(event) => {
                    event.stopPropagation();
                    setOpen(false);
                    triggerRef.current?.focus();
                    onSelect(stage.key);
                  }}
                  className={[
                    "flex h-8 w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-left text-xs font-semibold transition-colors",
                    isCurrent
                      ? "cursor-default text-subtle"
                      : stage.key === "rejected" || stage.key === "declined"
                        ? "text-rose-200/80 hover:bg-rose-300/10 hover:text-rose-100"
                        : "text-white/75 hover:bg-elevated hover:text-white",
                  ].join(" ")}
                >
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${stage.dot}`} aria-hidden />
                  {stage.label}
                  {isCurrent ? <span className="ml-auto text-[10px] font-medium text-subtle">Current</span> : null}
                </button>
              </Fragment>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The card's first-message affordance. Visible: the applicant's snippet (their
 * optional written note or fit note) when present, otherwise a muted "First
 * message" label — so the affordance exists even though, in the newer model, the
 * written message is optional. On hover/focus a tooltip reveals the full first
 * message: the written note (if any) plus the listing owner's structured
 * requirements as the applicant answered them (rate, portfolio, turnaround…).
 */
function FirstMessagePreview({
  itemId,
  teaser,
  message,
  lines,
}: {
  itemId: string;
  teaser: string | null;
  message: string | null;
  lines: PipelineFirstMessageLine[];
}) {
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const [preview, setPreview] = useState<{ left: number; top: number; width: number } | null>(null);
  const previewId = `pipeline-snippet-preview-${itemId}`;

  const closePreview = () => setPreview(null);
  const openPreviewNearPoint = (clientX: number, clientY: number) => {
    if (typeof window === "undefined") return;
    const viewportPadding = 8;
    const offset = 10;
    const width = Math.min(320, window.innerWidth - viewportPadding * 2);
    // Estimate height from the message (wrapped) plus one row per requirement.
    const messageRows = message ? Math.min(4, Math.max(1, Math.ceil(message.length / 44))) : 0;
    const estimatedHeight = Math.min(
      300,
      22 /* header */ + messageRows * 15 + (message ? 8 : 0) + lines.length * 20 + 20 /* padding */
    );
    const clamp = (value: number, min: number, max: number) => Math.min(Math.max(min, value), max);
    const hasRightSpace = clientX + offset + width <= window.innerWidth - viewportPadding;
    const hasBottomSpace = clientY + offset + estimatedHeight <= window.innerHeight - viewportPadding;
    const left = hasRightSpace ? clientX + offset : clientX - width - offset;
    const top = hasBottomSpace ? clientY + offset : clientY - estimatedHeight - offset;
    const nextPreview = {
      left: clamp(left, viewportPadding, Math.max(viewportPadding, window.innerWidth - width - viewportPadding)),
      top: clamp(top, viewportPadding, Math.max(viewportPadding, window.innerHeight - estimatedHeight - viewportPadding)),
      width,
    };

    setPreview((current) =>
      current &&
      Math.abs(current.left - nextPreview.left) < 0.5 &&
      Math.abs(current.top - nextPreview.top) < 0.5 &&
      current.width === nextPreview.width
        ? current
        : nextPreview
    );
  };

  const openPreviewFromMouse = (event: MouseEvent<HTMLSpanElement>) => {
    openPreviewNearPoint(event.clientX, event.clientY);
  };

  const openPreviewFromFocus = () => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    openPreviewNearPoint(rect.left + Math.min(rect.width / 2, 48), rect.top + rect.height / 2);
  };

  useEffect(() => {
    if (!preview) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPreview(null);
    };
    const onResize = () => setPreview(null);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
    };
  }, [preview]);

  return (
    <>
      <span
        ref={triggerRef}
        data-no-drag
        data-testid="pipeline-snippet-trigger"
        tabIndex={0}
        aria-describedby={preview ? previewId : undefined}
        onMouseEnter={openPreviewFromMouse}
        onMouseMove={openPreviewFromMouse}
        onMouseLeave={closePreview}
        onFocus={openPreviewFromFocus}
        onBlur={closePreview}
        className={
          teaser
            ? "line-clamp-2 w-full text-[11.5px] leading-relaxed text-muted transition-colors hover:text-white/66 focus:outline-none focus-visible:text-white/70"
            : // Full-width, slightly taller target so hovering anywhere on the row
              // reveals the requirements — a bare w-fit label was too small to hit.
              "flex w-full items-center gap-1 py-0.5 text-[11px] font-medium text-subtle transition-colors hover:text-white/65 focus:outline-none focus-visible:text-white/70"
        }
      >
        {teaser ?? (
          <>
            <Icon name="message-square-text" className="h-3 w-3 shrink-0 opacity-70" />
            First message
          </>
        )}
      </span>
      {preview && typeof document !== "undefined"
        ? createPortal(
            <div
              id={previewId}
              role="tooltip"
              data-testid="pipeline-snippet-preview"
              className="pointer-events-none fixed z-[9999] rounded-lg border border-line-mid bg-[#12131a]/95 px-2.5 py-2 text-[11px] leading-snug text-white/90 shadow-[0_14px_30px_-14px_rgba(0,0,0,0.95)] backdrop-blur-sm"
              style={{ left: preview.left, top: preview.top, width: preview.width }}
            >
              <p className="text-[9.5px] font-semibold uppercase tracking-[0.12em] text-subtle">First message</p>
              {message ? (
                <p className="mt-1 line-clamp-2 italic text-secondary">“{message}”</p>
              ) : null}
              {lines.length ? (
                <div className={`space-y-1 ${message ? "mt-2 border-t border-line pt-2" : "mt-1.5"}`}>
                  {lines.map((line) => (
                    <div key={`${line.label}-${line.value}`} className="flex items-start gap-1.5">
                      <Icon name={line.icon} className="mt-[1px] h-3 w-3 shrink-0 text-subtle" />
                      <span className="shrink-0 text-muted">{line.label}</span>
                      <span className="min-w-0 flex-1 line-clamp-2 text-right font-medium text-white/85">{line.value}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>,
            document.body
          )
        : null}
    </>
  );
}

export default function PipelineBoard({
  items,
  kind,
  direction,
  unreadByThread,
  initialStage = null,
  onStageFocusChange,
  onMessage,
  onMoveStage,
  workStateFor,
  nextActionFor,
  onNextAction,
}: PipelineBoardProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [search, setSearch] = useState("");
  const [contextFilter, setContextFilter] = useState<string>("all");
  const stages = useMemo(() => pipelineStagesFor(kind, direction), [kind, direction]);
  // Focused stage from the funnel strip (null = all stages). A deep-linked
  // stage applies only when it exists in this board's vocabulary.
  const [stageFilter, setStageFilterState] = useState<string | null>(() =>
    initialStage && stages.some((stage) => stage.key === initialStage) ? initialStage : null
  );
  const setStageFilter = (value: string | null | ((prev: string | null) => string | null)) => {
    const next = typeof value === "function" ? value(stageFilter) : value;
    if (next !== stageFilter) onStageFocusChange?.(next);
    setStageFilterState(next);
  };
  const [busy, setBusy] = useState(false);
  const [pendingMove, setPendingMove] = useState<{
    items: OwnerInteraction[];
    stageKey: string;
  } | null>(null);
  // Native HTML5 drag state: the card being dragged and the hovered drop target.
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropStage, setDropStage] = useState<string | null>(null);
  const safeBulkTargets = useMemo(() => bulkStageTargetsFor(kind), [kind]);
  const unarchiveTarget = useMemo<PipelineStage>(
    () => ({ key: "_unarchive", label: "Unarchive", dot: "bg-white/35" }),
    []
  );
  const manageable = direction === "received";

  const contextOptions = useMemo(() => pipelineContextOptions(items), [items]);

  const filteredItems = useMemo(
    () =>
      items.filter(
        (item) =>
          pipelineSearchMatch(item, search) &&
          (contextFilter === "all" || pipelineContextLabelOf(item) === contextFilter)
      ),
    [items, search, contextFilter]
  );

  const grouped = useMemo(() => groupByStage(filteredItems, stages), [filteredItems, stages]);

  // Selection survives stage moves but never references filtered-out rows.
  const visibleSelectedIds = useMemo(() => {
    const visible = new Set(filteredItems.map((item) => item.id));
    return [...selectedIds].filter((id) => visible.has(id));
  }, [selectedIds, filteredItems]);
  const selectedItems = useMemo(
    () => filteredItems.filter((item) => visibleSelectedIds.includes(item.id)),
    [filteredItems, visibleSelectedIds]
  );

  // Dragging a card that is part of the current selection moves the whole selection.
  const draggedItems = useMemo(() => {
    if (!dragId) return [];
    if (visibleSelectedIds.includes(dragId) && selectedItems.length > 1) return selectedItems;
    const single = filteredItems.find((item) => item.id === dragId);
    return single ? [single] : [];
  }, [dragId, visibleSelectedIds, selectedItems, filteredItems]);

  const isValidDropStage = (stageKey: string) =>
    draggedItems.length > 0 &&
    !(draggedItems.length > 1 && draggedItems.some((item) => item.legacyArchiveResolutionRequired)) &&
    (draggedItems.length === 1 || safeBulkTargets.some((stage) => stage.key === stageKey)) &&
    draggedItems.every((item) => {
      const current = backendStatusOf(item);
      if (stageKey === "archived") return current !== "archived";
      if (stageKey === "_unarchive") {
        return current === "archived" && !item.legacyArchiveResolutionRequired;
      }
      return validStageTargetsFor(
        kind,
        current,
        item.participantBackendStatus,
        item.legacyArchiveResolutionRequired
      ).some(
        (stage) => stage.key === stageKey
      );
    });

  const bulkTargets = useMemo(
    () =>
      safeBulkTargets.filter((stage) =>
        selectedItems.length > 0 &&
        selectedItems.every((item) => !item.legacyArchiveResolutionRequired) &&
        selectedItems.every((item) =>
          stage.key === "archived"
            ? backendStatusOf(item) !== "archived"
            : validStageTargetsFor(
                kind,
                backendStatusOf(item),
                item.participantBackendStatus
              ).some(
                (candidate) => candidate.key === stage.key
              )
        )
      ),
    [kind, selectedItems, safeBulkTargets]
  );

  const toggleRow = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleGroup = (groupItems: OwnerInteraction[]) => {
    const ids = groupItems.map((item) => item.id);
    const allSelected = ids.length > 0 && ids.every((id) => selectedIds.has(id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (allSelected) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  };

  const moveStage = async (moveItems: OwnerInteraction[], stageKey: string): Promise<boolean> => {
    if (!moveItems.length || busy) return false;
    setBusy(true);
    try {
      await onMoveStage(moveItems, stageKey);
      setSelectedIds((prev) => {
        const moved = new Set(moveItems.map((item) => item.id));
        return new Set([...prev].filter((id) => !moved.has(id)));
      });
      return true;
    } catch {
      // The parent surfaces the failure banner; keeping the selection lets the
      // user retry the same move without re-picking rows.
      return false;
    } finally {
      setBusy(false);
    }
  };

  const requestStageMove = (moveItems: OwnerInteraction[], stageKey: string) => {
    if (CONFIRMED_STAGE_MOVES.includes(stageKey)) {
      setPendingMove({ items: moveItems, stageKey });
      return;
    }
    void moveStage(moveItems, stageKey);
  };

  const handleCardDragStart = (event: DragEvent<HTMLDivElement>, item: OwnerInteraction) => {
    // Interactive children (checkbox, links, menus, message) never start a drag.
    if ((event.target as HTMLElement).closest("[data-no-drag]")) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.setData("text/plain", item.id);
    event.dataTransfer.effectAllowed = "move";
    setDragId(item.id);
  };

  const endDrag = () => {
    setDragId(null);
    setDropStage(null);
  };

  const handleDropOn = (event: DragEvent, stageKey: string) => {
    event.preventDefault();
    const toMove = draggedItems.filter((item) => backendStatusOf(item) !== stageKey);
    endDrag();
    if (toMove.length > 0 && isValidDropStage(stageKey)) {
      requestStageMove(toMove, stageKey);
    }
  };

  const dropHandlers = (stageKey: string) =>
    manageable
      ? {
          onDragOver: (event: DragEvent) => {
            if (!isValidDropStage(stageKey)) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            setDropStage(stageKey);
          },
          onDragLeave: () => {
            setDropStage((prev) => (prev === stageKey ? null : prev));
          },
          onDrop: (event: DragEvent) => handleDropOn(event, stageKey),
        }
      : {};

  // The board keeps every stage visible so the workflow reads as a complete
  // funnel. Empty stages stay intentionally compact instead of disappearing.
  const sectionStages = stageFilter
    ? stages.filter((stage) => stage.key === stageFilter)
    : stages;

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="pipeline-board">
      {/* Toolbar: funnel strip (stage chips w/ counts, also drop targets) + search + context filter */}
      <div className="shrink-0 border-b border-line px-4 py-3 sm:px-6">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5" role="group" aria-label="Pipeline stages">
            {stages.map((stage, index) => {
              const count = grouped.get(stage.key)?.length ?? 0;
              const isActive = stageFilter === stage.key;
              const dragValid = dragId !== null && isValidDropStage(stage.key);
              const dragHover = dragValid && dropStage === stage.key;
              // Closed/terminal stages sit past a quiet divider and read softer,
              // so the funnel's active steps carry the visual weight.
              const startsTerminal = Boolean(stage.terminal) && !stages[index - 1]?.terminal;
              return (
                <span key={stage.key} className="inline-flex items-center gap-1.5">
                  {startsTerminal ? (
                    <span className="mx-1 h-4 w-px shrink-0 bg-overlay" aria-hidden />
                  ) : null}
                  <button
                    type="button"
                    data-testid={`pipeline-stage-chip-${stage.key}`}
                    aria-pressed={isActive}
                    title={isActive ? "Show all stages" : `Focus on ${stage.label}`}
                    onClick={() => setStageFilter((prev) => (prev === stage.key ? null : stage.key))}
                    {...dropHandlers(stage.key)}
                    className={[
                      "inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-semibold transition-all",
                      dragHover
                        ? "scale-105 border-white/60 bg-white/[0.14] text-white"
                        : dragValid
                          ? "border-line-strong bg-raised text-white/85"
                          : isActive
                            ? "border-line-strong bg-overlay text-white"
                            : count > 0
                              ? stage.terminal
                                ? "border-line bg-transparent text-subtle hover:border-line-mid hover:text-white/70"
                                : "border-line bg-transparent text-white/60 hover:border-line-strong hover:text-white/90"
                              : "border-line bg-transparent text-subtle hover:text-muted",
                    ].join(" ")}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${count > 0 || isActive || dragValid ? stage.dot : "bg-white/20"}`}
                      aria-hidden
                    />
                    {stage.label}
                    <span className={isActive || dragHover ? "text-white/70" : "text-subtle"}>{count}</span>
                  </button>
                </span>
              );
            })}
          </div>
          <div className="ml-auto flex min-w-0 items-center gap-2">
            <div className="relative w-40 sm:w-52">
              <Icon name="search" className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-subtle" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                data-testid="pipeline-search"
                placeholder={kind === "application" && direction === "received" ? "Search applicants or jobs…" : "Search…"}
                className="h-8 w-full rounded-lg border border-line bg-wash pl-8 pr-3 text-xs text-white/85 placeholder:text-subtle transition-colors focus:border-line-strong focus:outline-none"
              />
            </div>
            {contextOptions.length > 1 ? (
              <select
                value={contextFilter}
                onChange={(event) => setContextFilter(event.target.value)}
                data-testid="pipeline-context-filter"
                aria-label={kind === "application" ? "Filter by job" : "Filter by listing"}
                className="h-8 max-w-[200px] cursor-pointer truncate rounded-lg border border-line bg-wash px-2.5 text-xs font-medium text-white/70 transition-colors focus:border-line-strong focus:outline-none [&>option]:bg-[#111216]"
              >
                <option value="all">{kind === "application" && direction === "received" ? "All jobs" : "All contexts"}</option>
                {contextOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
        </div>
      </div>

      {/* Stage sections: candidate cards in a responsive grid per stage */}
      <div className="relative min-h-0 flex-1 overflow-y-auto">
        <div className="space-y-4 px-4 py-5 pb-24 sm:px-6">
          {filteredItems.length === 0 ? (
            <div className="flex min-h-[200px] flex-col items-center justify-center rounded-2xl border border-dashed border-line bg-white/[0.012] px-6 py-10 text-center">
              <p className="text-sm font-medium text-white/55">Nothing matches here.</p>
              <p className="mx-auto mt-1 max-w-xs text-xs text-subtle">
                {search || contextFilter !== "all"
                  ? "Try clearing the search or filter."
                  : "New activity will land in this pipeline."}
              </p>
            </div>
          ) : (
            sectionStages.map((stage, index) => {
              const groupItems = grouped.get(stage.key) ?? [];
              const allSelected = groupItems.length > 0 && groupItems.every((item) => selectedIds.has(item.id));
              const dragValid = dragId !== null && isValidDropStage(stage.key);
              const dragHover = dragValid && dropStage === stage.key;
              const isTerminal = Boolean(stage.terminal);
              // Closed stages sit under one quiet divider so finished work never
              // competes with the active funnel. Hidden while a single stage is focused.
              const startsClosedGroup =
                isTerminal && !stageFilter && !sectionStages[index - 1]?.terminal;
              return (
                <Fragment key={stage.key}>
                {startsClosedGroup ? (
                  <div data-testid="pipeline-closed-divider" className="flex items-center gap-3 px-1 pt-2">
                    <span className="h-px flex-1 bg-line" aria-hidden />
                    <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-subtle">
                      Closed
                    </span>
                    <span className="h-px flex-1 bg-raised" aria-hidden />
                  </div>
                ) : null}
                <section
                  data-testid={`pipeline-group-${stage.key}`}
                  {...dropHandlers(stage.key)}
                  className={[
                    /*
                      A section is a place, so it gets a surface. The stage's own
                      hue appears once, as a 2px edge along the top — enough to
                      tell columns apart while scanning, far short of painting
                      the whole group a colour. Terminal groups stay flat: they
                      are history, not work.
                    */
                    "relative overflow-hidden rounded-2xl border transition-colors",
                    groupItems.length === 0 ? "p-3 sm:p-3" : "p-3.5 sm:p-4",
                    dragHover
                      ? "border-line-strong bg-elevated"
                      : dragValid
                        ? "border-line-mid bg-raised"
                        : isTerminal
                          ? "border-line bg-transparent"
                          : "border-line bg-shell",
                  ].join(" ")}
                >
                  {!isTerminal ? (
                    <span
                      aria-hidden="true"
                      className={`absolute inset-x-0 top-0 h-[2px] ${stage.dot} opacity-45`}
                    />
                  ) : null}
                  <header className="flex items-center gap-2.5 px-0.5">
                    {manageable ? (
                      <input
                        type="checkbox"
                        aria-label={`Select all in ${stage.label}`}
                        checked={allSelected}
                        disabled={groupItems.length === 0}
                        onChange={() => toggleGroup(groupItems)}
                        className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-white disabled:cursor-not-allowed disabled:opacity-30"
                      />
                    ) : null}
                    <span
                      className={`h-2 w-2 shrink-0 rounded-full ${stage.dot} ${isTerminal ? "opacity-60" : ""}`}
                      aria-hidden
                    />
                    {/* A section heading reads at a size people read. Its rank
                        comes from weight and the stage dot beside it, not from
                        letter-spacing that makes it harder to take in. */}
                    <h3
                      className={[
                        "text-[12.5px] font-semibold",
                        isTerminal ? "text-muted" : "text-ink",
                      ].join(" ")}
                    >
                      {stage.label}
                    </h3>
                    <span
                      className={[
                        "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1.5 text-[10.5px] font-semibold tabular-nums",
                        isTerminal ? "text-subtle" : "bg-wash-strong text-secondary",
                      ].join(" ")}
                    >
                      {groupItems.length}
                    </span>
                    {dragHover ? (
                      <span className="ml-auto text-[11px] font-semibold text-white/70">
                        Drop to move {draggedItems.length > 1 ? `${draggedItems.length} cards` : ""} here
                      </span>
                    ) : null}
                  </header>
                  {groupItems.length === 0 ? (
                    <p className="mt-2 px-0.5 text-[11px] text-subtle">
                      No one in {stage.label.toLowerCase()} yet.
                    </p>
                  ) : (
                    <div className="mt-3 grid gap-2.5 [grid-template-columns:repeat(auto-fill,minmax(260px,1fr))]">
                      {groupItems.map((item) => {
                        const checked = selectedIds.has(item.id);
                        const context = pipelineContextLabelOf(item);
                        const currentKey = backendStatusOf(item);
                        const profileHref = pipelineProfileHrefOf(item);
                        const facts = pipelineCardFacts(item);
                        const portfolioCount = pipelinePortfolioCountOf(item);
                        const snippet = pipelineSnippetOf(item);
                        const firstMessageLines = pipelineFirstMessageLines(item);
                        // The free-text note is only the "first message" on legacy
                        // interactions with no structured requirements; otherwise the
                        // requirements are the first message (matching the inbox).
                        const legacyMessage = firstMessageLines.length ? null : item.message?.trim() || null;
                        const isDragging = dragId === item.id || (dragId !== null && draggedItems.some((entry) => entry.id === item.id));
                        const name = direction === "received" ? item.counterpartyName : item.title;
                        return (
                          <div
                            key={item.id}
                            data-testid="pipeline-row"
                            /*
                              Not `role="button"`. The card contains a profile
                              link, a checkbox, a stage menu and a Message
                              button, and a button containing buttons is both an
                              axe `nested-interactive` failure and genuinely
                              ambiguous to a screen reader. The click handler
                              stays for pointer convenience; the labelled
                              Message button is the keyboard and AT path, which
                              is also the honest description of what it does.
                            */
                            draggable={manageable}
                            onDragStart={(event) => handleCardDragStart(event, item)}
                            onDragEnd={endDrag}
                            onClick={() => onMessage(item)}
                            className={[
                              "group relative flex flex-col gap-2 overflow-hidden rounded-xl border p-3 text-left",
                              "transition-[transform,box-shadow,background-color,border-color] duration-150",
                              manageable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
                              isDragging
                                ? "scale-[0.98] border-line-strong bg-elevated opacity-40"
                                : checked
                                  ? "border-line-strong surface-elevated elev-3"
                                  : "border-line surface-raised elev-2 hover:-translate-y-0.5 hover:border-line-mid hover:elev-3",
                            ].join(" ")}
                          >
                            <div className="flex items-start gap-2.5">
                              <RowAvatar name={item.counterpartyName} src={item.counterpartyAvatarUrl} />
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5">
                                  {item.unread ? (
                                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-white/90" aria-hidden />
                                  ) : null}
                                  {profileHref ? (
                                    <Link
                                      href={profileHref}
                                      target="_blank"
                                      rel="noreferrer"
                                      data-testid="pipeline-profile-link"
                                      data-no-drag
                                      onClick={(event) => event.stopPropagation()}
                                      title={`Open ${name}'s profile`}
                                      className="truncate text-[13px] font-semibold text-ink underline-offset-2 transition-colors hover:underline hover:decoration-line-strong"
                                    >
                                      {name}
                                    </Link>
                                  ) : (
                                    <span className="truncate text-[13px] font-semibold text-ink">{name}</span>
                                  )}
                                </div>
                                {context ? (
                                  <p className="mt-0.5 truncate text-[11px] text-muted">{context}</p>
                                ) : null}
                              </div>
                              {manageable ? (
                                <input
                                  type="checkbox"
                                  data-testid="pipeline-row-checkbox"
                                  data-no-drag
                                  aria-label={`Select ${item.counterpartyName}`}
                                  checked={checked}
                                  onClick={(event) => event.stopPropagation()}
                                  onChange={() => toggleRow(item.id)}
                                  className="mt-0.5 h-3.5 w-3.5 shrink-0 cursor-pointer accent-white"
                                />
                              ) : null}
                            </div>

                            {/*
                              Parity with the Inbox: the same derivation and the
                              same ladder. Decision-type recommendations are not
                              rendered here — this card already carries a stage
                              menu, and two decision surfaces would compete.
                            */}
                            {(() => {
                              const workState = workStateFor?.(item) ?? null;
                              const action = nextActionFor?.(item) ?? null;
                              const dispatchable =
                                action && BOARD_DISPATCHABLE_ACTIONS.has(action.key) ? action : null;
                              if (!workState && !dispatchable) return null;
                              return (
                                <div className="flex flex-wrap items-center gap-1.5">
                                  {workState ? (
                                    <span
                                      data-testid="pipeline-work-state"
                                      data-work-state={workState.key}
                                      className={[
                                        // No border, no hover, full-round: a
                                        // label, not something to press.
                                        "inline-flex items-center gap-1 rounded-full border-0 px-2 py-0.5 text-[10.5px] font-medium",
                                        workState.highConfidence
                                          ? "bg-wash-strong text-default"
                                          : "text-muted",
                                      ].join(" ")}
                                    >
                                      {workState.highConfidence ? (
                                        <span
                                          className="h-1 w-1 shrink-0 rounded-full bg-current"
                                          aria-hidden="true"
                                        />
                                      ) : null}
                                      {workState.label}
                                    </span>
                                  ) : null}
                                  {dispatchable ? (
                                    <button
                                      type="button"
                                      data-no-drag
                                      data-testid="pipeline-next-action"
                                      data-action-key={dispatchable.key}
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        onNextAction?.(item, dispatchable);
                                      }}
                                      className="inline-flex h-6 cursor-pointer items-center rounded-md border border-line-mid bg-overlay px-2 text-[10.5px] font-semibold text-default transition-colors hover:border-line-strong hover:text-ink"
                                    >
                                      {dispatchable.label}
                                    </button>
                                  ) : null}
                                </div>
                              );
                            })()}

                            {facts.length > 0 || portfolioCount > 0 ? (
                              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10.5px] text-muted">
                                {facts.map((fact, factIndex) => (
                                  <span
                                    key={fact.text}
                                    data-testid="pipeline-fact"
                                    className="inline-flex min-w-0 max-w-full items-center gap-1"
                                  >
                                    {factIndex > 0 ? (
                                      <span aria-hidden="true" className="mr-1 text-disabled">·</span>
                                    ) : null}
                                    <Icon
                                      name={fact.icon}
                                      className="h-3 w-3 shrink-0 text-subtle"
                                      aria-hidden="true"
                                    />
                                    <span className="truncate">{fact.text}</span>
                                  </span>
                                ))}
                                {portfolioCount > 0 ? (
                                  <span className="inline-flex items-center gap-1">
                                    {facts.length > 0 ? (
                                      <span aria-hidden="true" className="mr-1 text-disabled">·</span>
                                    ) : null}
                                    <Icon
                                      name="images"
                                      className="h-3 w-3 shrink-0 text-subtle"
                                      aria-hidden="true"
                                    />
                                    {portfolioCount} portfolio
                                  </span>
                                ) : null}
                              </div>
                            ) : null}

                            {snippet || firstMessageLines.length ? (
                              <FirstMessagePreview
                                itemId={item.id}
                                teaser={snippet}
                                message={legacyMessage}
                                lines={firstMessageLines}
                              />
                            ) : null}

                            {item.managerNote ? (
                              <p
                                data-testid="pipeline-note-indicator"
                                title={item.managerNote}
                                className="flex min-w-0 items-center gap-1.5 rounded-md bg-state-interview-fill px-1.5 py-1 text-[11px] text-state-interview"
                              >
                                <Icon name="notebook-text" className="h-3 w-3 shrink-0" aria-hidden="true" />
                                <span className="truncate">{item.managerNote}</span>
                              </p>
                            ) : null}

                            <div className="mt-auto flex items-center justify-between gap-2 border-t border-line pt-2">
                              <InteractionTime value={item.updatedAt} className="shrink-0 text-[11px] text-subtle" />
                              <div className="flex items-center gap-1.5" data-no-drag>
                                {(() => {
                                  // Messaging is the frequent action, so it's the card's
                                  // prominent labelled CTA (and the whole-card click).
                                  // Unread replies are a decision signal: emphasise it.
                                  const messageUnread = unreadByThread?.[item.id] ?? 0;
                                  return (
                                    <button
                                      type="button"
                                      data-testid="pipeline-message"
                                      aria-label={
                                        messageUnread > 0
                                          ? `Message ${item.counterpartyName} (${messageUnread} unread)`
                                          : `Message ${item.counterpartyName}`
                                      }
                                      title={`Message ${item.counterpartyName}`}
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        onMessage(item);
                                      }}
                                      className={[
                                        "inline-flex h-7 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg px-2.5 text-[11.5px] font-semibold transition-colors",
                                        messageUnread > 0
                                          ? "surface-primary text-black elev-1 hover:brightness-105"
                                          : "border border-line-mid bg-overlay text-default hover:border-line-strong hover:text-ink",
                                      ].join(" ")}
                                    >
                                      <Icon name="message-square-text" className="h-3.5 w-3.5" />
                                      Message
                                      {messageUnread > 0 ? (
                                        <span
                                          data-testid="pipeline-message-unread"
                                          className="inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-black/15 px-1 text-[10px] font-bold leading-none"
                                        >
                                          {messageUnread > 9 ? "9+" : messageUnread}
                                        </span>
                                      ) : null}
                                    </button>
                                  );
                                })()}
                                {manageable ? (
                                  <StageMenu
                                    targets={
                                      currentKey === "archived"
                                        ? item.legacyArchiveResolutionRequired
                                          ? validStageTargetsFor(
                                              kind,
                                              currentKey,
                                              item.participantBackendStatus,
                                              true
                                            )
                                          : [unarchiveTarget]
                                        : [
                                            ...validStageTargetsFor(
                                              kind,
                                              currentKey,
                                              item.participantBackendStatus,
                                              item.legacyArchiveResolutionRequired
                                            ),
                                            ...(
                                              item.legacyArchiveResolutionRequired
                                                ? []
                                                : stages.filter((entry) => entry.key === "archived")
                                            ),
                                          ]
                                    }
                                    currentKey={item.legacyArchiveResolutionRequired ? null : currentKey}
                                    triggerLabel={
                                      item.legacyArchiveResolutionRequired
                                        ? "Choose current stage"
                                        : stages.find((entry) => entry.key === currentKey)?.label ?? stage.label
                                    }
                                    triggerTestId="pipeline-stage-menu"
                                    optionTestPrefix="pipeline-stage-option"
                                    disabled={busy}
                                    onSelect={(stageKey) => requestStageMove([item], stageKey)}
                                  />
                                ) : null}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>
                </Fragment>
              );
            })
          )}
        </div>

        {/* Bulk action bar — floats over the board while a selection is active */}
        {manageable && selectedItems.length > 0 ? (
          <div className="pointer-events-none sticky bottom-4 z-30 flex justify-center px-4">
            <div
              data-testid="bulk-action-bar"
              className="pointer-events-auto flex items-center gap-3 rounded-2xl border border-white/14 bg-[#131419]/95 py-2 pl-4 pr-2 shadow-[0_24px_70px_-30px_rgba(0,0,0,1)] backdrop-blur-xl"
            >
              <p className="text-xs font-semibold text-white/85">
                {selectedItems.length} selected
              </p>
              <span className="h-4 w-px bg-white/12" aria-hidden />
              <StageMenu
                targets={bulkTargets}
                triggerLabel={busy ? "Moving…" : "Move to"}
                triggerTestId="bulk-move-trigger"
                optionTestPrefix="bulk-move"
                disabled={busy}
                drop="up"
                onSelect={(stageKey) => requestStageMove(selectedItems, stageKey)}
              />
              <button
                type="button"
                data-testid="bulk-clear"
                onClick={() => setSelectedIds(new Set())}
                className="inline-flex h-7 cursor-pointer items-center rounded-lg px-2 text-[11px] font-semibold text-white/55 transition-colors hover:text-white"
              >
                Clear
              </button>
            </div>
          </div>
        ) : null}
      </div>
      <ConfirmDialog
        open={Boolean(pendingMove)}
        title={
          STAGE_CONFIRM_COPY[pendingMove?.stageKey ?? ""]?.title(pendingMove?.items.length ?? 1) ??
          "Confirm this change?"
        }
        body={STAGE_CONFIRM_COPY[pendingMove?.stageKey ?? ""]?.body(pendingMove?.items.length ?? 1) ?? ""}
        confirmLabel={STAGE_CONFIRM_COPY[pendingMove?.stageKey ?? ""]?.confirmLabel ?? "Confirm"}
        destructive={["declined", "rejected"].includes(pendingMove?.stageKey ?? "")}
        busy={busy}
        onConfirm={() => {
          if (!pendingMove) return;
          const next = pendingMove;
          void moveStage(next.items, next.stageKey).then((succeeded) => {
            if (succeeded) setPendingMove(null);
          });
        }}
        onCancel={() => {
          if (!busy) setPendingMove(null);
        }}
      />
    </div>
  );
}
