"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Icon } from "../Icons";
import { MetaRow } from "../ui";
import FirstMessageSummary from "../first-message/FirstMessageSummary";
import PrivateNotesPanel from "./PrivateNotesPanel";
import type { PrivateNote } from "../../lib/privateNotes";
import { usePortfolioDetailPopup } from "../profile/PortfolioDetailPopup";
import { formatListingTitle } from "../../lib/displayText";
import { buildUnreadByThread, formatBadgeCount, mapBackendMessage, totalUnread } from "../../lib/messaging";
import {
  filterStructuredPortfolioDuplicateAttachments,
  type FirstMessageAnswers,
  type RequirementContext,
} from "../../lib/firstMessageRequirements";
import {
  bulkUpdateApplicationStatus,
  bulkUpdateTalentInterestStatus,
  canUseLocalMockFallback,
  getActivitySummary,
  getApplicationConversation,
  getInterestConversation,
  getMyReviewWorkspace,
  isLocalMocksEnabled,
  listConversations,
  markConversationRead,
  sendConversationMessage,
  updateApplicationManagerNote,
  updateApplicationStatus,
  updateTalentInterestManagerNote,
  updateTalentInterestStatus,
  withdrawApplication,
  withdrawTalentInterest,
  type BackendJobApplication,
  type BackendMessage,
  type BackendEngagementSummary,
  type BackendPortfolioItem,
  type BackendReviewOpportunity,
  type BackendTalentInterest,
} from "../../lib/backendClient";
import {
  MOCK_OWNER_INTERACTIONS,
  interactionKindLabel,
  interactionStatusFromBackend,
  interactionStatusLabel,
  isArchivedInteraction,
  mapActivityToOwnerInteractions,
  relativeTimeLabel,
  type InteractionKind,
  type InteractionStatus,
  type InteractionJobSnapshot,
  type InteractionTalentSnapshot,
  type OwnerInteraction,
} from "../../lib/ownerInteractions";
import {
  directionLabelsFor,
  pipelineContextLabelOf,
  pipelineSummaryOf,
  stageNotifyPolicyOf,
  stageTargetsFor,
} from "../../lib/applicationPipeline";
import CompactChatDock from "./CompactChatDock";
import PipelineBoard from "./PipelineBoard";
import EngagementStatusRow from "../reviews/EngagementStatusRow";
import ReviewDialog from "../reviews/ReviewDialog";

type WorkspaceMode = "talent" | "hiring";
type WorkspaceFilter = "all" | "sent" | "received" | "archived";
type WorkspaceView = "inbox" | "pipeline";
type PipelineDirection = "received" | "sent";
type WorkspaceModeOption = { key: WorkspaceMode; label: string };

type ApplicationsWorkspaceProps = {
  mode: WorkspaceMode;
  modeOptions?: WorkspaceModeOption[];
  onModeChange?: (mode: WorkspaceMode) => void;
  allowDemo?: boolean;
  demoMode?: boolean;
  onToggleDemo?: () => void;
  interactions?: OwnerInteraction[];
  backendAccessToken?: string;
  /** Force the demo dataset even when a backend token is present (preview only). */
  forceMock?: boolean;
  /** Thread to open on mount, e.g. from an "Open conversation" deep-link. */
  initialSelectedId?: string | null;
  /** Controlled Inbox/Pipeline layout (falls back to internal state when omitted). */
  view?: WorkspaceView;
  onViewChange?: (view: WorkspaceView) => void;
  /** Controlled pipeline direction (falls back to internal state when omitted). */
  pipelineDirection?: PipelineDirection;
  onPipelineDirectionChange?: (direction: PipelineDirection) => void;
  /** Stage focus for the pipeline funnel, e.g. from a ?stage= deep link. */
  pipelineStage?: string | null;
  onPipelineStageChange?: (stage: string | null) => void;
};

type HeaderAction = {
  key: string;
  label: string;
  icon: "check" | "x" | "send" | "bookmark";
  primary?: boolean;
  destructive?: boolean;
  flow: "instant" | "confirm" | "reply";
  nextStatus?: InteractionStatus;
  eventLabel?: string;
  panelTitle?: string;
  confirmLabel?: string;
  allowNote?: boolean;
};

/**
 * Inbox scope filters. The direction scopes carry workflow names instead of
 * generic Sent/Received: within one mode each direction is one uniform kind,
 * so "Applicants"/"Outreach" (recruiter) and "Hiring requests"/"Applications"
 * (talent) say what the user is actually looking at. Received leads — it's
 * the side being managed.
 */
function filterOptionsFor(mode: WorkspaceMode): Array<{ key: WorkspaceFilter; label: string }> {
  const labels = directionLabelsFor(mode);
  return [
    { key: "all", label: "All" },
    { key: "received", label: labels.received },
    { key: "sent", label: labels.sent },
    { key: "archived", label: "Archived" },
  ];
}
const DEFAULT_MODE_OPTIONS: WorkspaceModeOption[] = [
  { key: "talent", label: "Talent" },
  { key: "hiring", label: "Recruiter" },
];

function FilterBar({
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
    <div className="border-b border-white/[0.06] px-4">
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
                isActive ? "text-white" : "text-white/50 hover:text-white/80",
              ].join(" ")}
            >
              {option.label}
              {count > 0 ? (
                <span className={`ml-1.5 text-[11px] font-medium ${isActive ? "text-white/55" : "text-white/32"}`}>
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
function WorkspaceControls({
  mode,
  modeOptions,
  onModeChange,
  view,
  onViewChange,
}: {
  mode: WorkspaceMode;
  modeOptions: WorkspaceModeOption[];
  onModeChange?: (mode: WorkspaceMode) => void;
  view: WorkspaceView;
  onViewChange: (view: WorkspaceView) => void;
}) {
  return (
    <div
      className="shrink-0 border-b border-white/[0.06] px-4 py-3"
      data-testid="applications-workspace-controls"
    >
      <div className="flex flex-wrap items-center gap-2.5">
        <div
          className="inline-flex shrink-0 items-center gap-1 rounded-xl border border-white/[0.1] bg-white/[0.03] p-1"
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
                onClick={() => onModeChange?.(option.key)}
                className={[
                  "h-8 cursor-pointer rounded-lg px-3.5 text-xs font-semibold transition-colors",
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
          className="inline-flex shrink-0 items-center gap-1 rounded-xl border border-white/[0.1] bg-white/[0.03] p-1"
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
                onClick={() => onViewChange(option.key)}
                className={[
                  "inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition-colors",
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

/**
 * Dev/demo utility, deliberately out of the primary workflow: a quiet floating
 * chip in the workspace's bottom-right corner.
 */
function SampleDataChip({ demoMode, onToggleDemo }: { demoMode?: boolean; onToggleDemo?: () => void }) {
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
          : "border-white/[0.1] bg-[#131419]/90 text-white/45 hover:text-white/80",
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

// Dedicated full-page workspace: the route wrapper already sits below the fixed
// global top bar, so the inbox owns the full remaining vertical canvas.
const WORKSPACE_HEIGHT_CLASSES = "h-full min-h-0";
const SECTION_LABEL_CLASSES = "text-[11px] font-semibold text-white/40";
const SURFACE = "border border-white/[0.08] bg-white/[0.035]";
/** localStorage key for the last-open inbox conversation (restored on return). */
const SELECTED_STORAGE_KEY = "cj.applications.selected";
const GHOST_BUTTON_CLASSES =
  "inline-flex h-9 cursor-pointer items-center justify-center rounded-xl border border-white/15 bg-white/[0.04] px-3.5 text-xs font-semibold text-white/80 transition-colors hover:bg-white/[0.08]";
const PRIMARY_BUTTON_CLASSES =
  "inline-flex h-9 cursor-pointer items-center justify-center rounded-xl bg-white px-3.5 text-xs font-semibold text-black transition-colors hover:bg-white/90";

function statusPillClasses(status: InteractionStatus): string {
  switch (status) {
    case "new":
      return "border-white/25 bg-white/[0.1] text-white/92";
    case "pending":
    case "viewed":
      return "border-white/[0.12] bg-white/[0.045] text-white/62";
    case "responded":
    case "shortlisted":
    case "accepted":
      return "border-emerald-200/30 bg-emerald-200/[0.08] text-emerald-100/90";
    case "hired":
      return "border-emerald-300/45 bg-emerald-300/[0.16] text-emerald-50";
    case "declined":
    case "withdrawn":
    case "closed":
      return "border-white/[0.08] bg-transparent text-white/42";
  }
}

function StatusPill({ status, size = "sm" }: { status: InteractionStatus; size?: "sm" | "md" }) {
  return (
    <span
      className={[
        "inline-flex shrink-0 items-center rounded-full border font-semibold transition-colors duration-300 ease-out",
        size === "sm" ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-[11px]",
        statusPillClasses(status),
      ].join(" ")}
    >
      {interactionStatusLabel(status)}
    </span>
  );
}

function avatarInitials(name: string): string {
  const parts = name
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function InteractionAvatar({
  name,
  src,
  shape = "circle",
  sizeClasses = "h-9 w-9",
}: {
  name: string;
  src?: string | null;
  shape?: "circle" | "rounded";
  sizeClasses?: string;
}) {
  const radius = shape === "circle" ? "rounded-full" : "rounded-lg";
  // Initials stay painted underneath so a failed image load degrades cleanly.
  return (
    <span
      className={`${sizeClasses} ${radius} relative inline-flex shrink-0 items-center justify-center overflow-hidden border border-white/15 bg-white/[0.06] text-[11px] font-semibold text-white/75`}
    >
      {avatarInitials(name)}
      {src ? <img src={src} alt="" className="absolute inset-0 h-full w-full object-cover" /> : null}
    </span>
  );
}

function firstNameOf(name: string): string {
  return name.split(/\s+/)[0] || name;
}

function rowSubtitle(item: OwnerInteraction): string {
  if (item.kind === "application" && item.direction === "received") {
    return item.job?.title || item.counterpartyName;
  }
  if (item.contextLabel && item.title === item.counterpartyName) {
    return item.contextLabel;
  }
  return item.counterpartyName;
}

function headerActionsFor(item: OwnerInteraction, live: boolean): HeaderAction[] {
  if (isArchivedInteraction(item)) return [];
  const name = firstNameOf(item.counterpartyName);
  const reply: HeaderAction = { key: "reply", label: `Reply to ${name}`, icon: "send", flow: "reply" };

  if (item.kind === "application" && item.direction === "sent") {
    const withdraw: HeaderAction = {
      key: "withdraw",
      label: "Withdraw application",
      icon: "x",
      destructive: true,
      flow: "confirm",
      nextStatus: "withdrawn",
      eventLabel: "Application withdrawn by you",
      panelTitle: "Withdraw this application?",
      confirmLabel: "Confirm withdraw",
    };
    // Withdraw is backed by a real applicant-side endpoint. Reply stays demo-only
    // in live mode (no messaging backend) — showing it would fake functionality.
    if (live) return [withdraw];
    return [reply, withdraw];
  }
  if (item.kind === "hiring_request" && item.direction === "received") {
    const actions: HeaderAction[] = [
      {
        key: "accept",
        label: "Accept request",
        icon: "check",
        primary: true,
        flow: "instant",
        nextStatus: "accepted",
        eventLabel: "Accepted by you",
      },
      {
        key: "decline",
        label: "Decline",
        icon: "x",
        destructive: true,
        flow: "confirm",
        nextStatus: "declined",
        eventLabel: "Declined by you",
        panelTitle: "Decline this request?",
        confirmLabel: "Confirm decline",
        allowNote: !live,
      },
    ];
    if (!live) actions.push(reply);
    return actions;
  }
  if (item.kind === "application" && item.direction === "received") {
    const actions: HeaderAction[] = [
      {
        key: "hire",
        label: "Hire",
        icon: "check",
        primary: true,
        flow: "confirm",
        nextStatus: "hired",
        eventLabel: "Hired by you",
        panelTitle: "Hire this candidate?",
        confirmLabel: "Confirm hire",
        allowNote: !live,
      },
    ];
    if (item.status !== "shortlisted") {
      actions.push({
        key: "shortlist",
        label: "Shortlist",
        icon: "bookmark",
        flow: "instant",
        nextStatus: "shortlisted",
        eventLabel: "Shortlisted by you",
      });
    }
    actions.push({
      key: "decline",
      label: "Decline",
      icon: "x",
      destructive: true,
      flow: "confirm",
      nextStatus: "declined",
      eventLabel: "Declined by you",
      panelTitle: "Decline this application?",
      confirmLabel: "Confirm decline",
      allowNote: !live,
    });
    if (!live) actions.push(reply);
    return actions;
  }
  const withdrawRequest: HeaderAction = {
    key: "withdraw",
    label: "Withdraw request",
    icon: "x",
    destructive: true,
    flow: "confirm",
    nextStatus: "withdrawn",
    eventLabel: "Request withdrawn by you",
    panelTitle: "Withdraw this request?",
    confirmLabel: "Confirm withdraw",
  };
  // Withdraw is backed by a real sender-side endpoint; reply stays demo-only in live mode.
  if (live) return [withdrawRequest];
  return [reply, withdrawRequest];
}

function quickReplyTemplates(item: OwnerInteraction): Array<{ label: string; text: string }> {
  if (item.kind === "application" && item.direction === "received") {
    return [
      { label: "Ask for portfolio", text: "Could you share one or two work samples closest to this brief?" },
      { label: "Ask availability", text: "What does your availability look like over the next two weeks?" },
      { label: "Discuss budget", text: "What rate are you expecting for this scope?" },
    ];
  }
  if (item.kind === "hiring_request" && item.direction === "received") {
    return [
      { label: "Share availability", text: "Here's my availability for the coming weeks:" },
      { label: "Ask about scope", text: "Could you share more detail on the scope and timeline?" },
      { label: "Discuss rate", text: "Happy to discuss the rate — here's what this scope usually runs:" },
    ];
  }
  return [];
}

type OverflowMenuItem = Pick<HeaderAction, "key" | "label" | "icon" | "primary" | "destructive"> & {
  onClick: () => void;
};

function OverflowMenu({ items }: { items: OverflowMenuItem[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="group/action relative inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-xl border border-white/[0.12] bg-white/[0.04] text-white/75 transition-colors hover:bg-white/[0.09] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
      >
        <Icon name="menu" className="h-4 w-4" />
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+8px)] z-30 min-w-48 rounded-2xl border border-white/12 bg-[#111216] p-1.5 shadow-[0_24px_70px_-34px_rgba(0,0,0,1)]"
        >
          {items.length ? (
            items.map((item) => (
              <button
                key={item.key}
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  item.onClick();
                }}
                className={[
                  "flex h-9 w-full cursor-pointer items-center gap-2 rounded-xl px-2.5 text-left text-xs font-semibold transition-colors",
                  item.primary
                    ? "text-white hover:bg-white/[0.09]"
                    : item.destructive
                      ? "text-rose-200/80 hover:bg-rose-300/10 hover:text-rose-100"
                      : "text-white/72 hover:bg-white/[0.07] hover:text-white",
                ].join(" ")}
              >
                <Icon name={item.icon} className="h-3.5 w-3.5" />
                <span>{item.label}</span>
              </button>
            ))
          ) : (
            <p className="px-3 py-2 text-xs text-white/40">No actions available.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Compact job card for the context rail — the essential top of the marketplace
 * JobCard (channel identity → job title → pay / experience / location), no tags.
 * The whole card opens the job detail page when a route exists.
 */
function CompactJobCard({ job }: { job: InteractionJobSnapshot }) {
  const href = job.jobId ? `/jobs/${encodeURIComponent(job.jobId)}` : null;
  const payIcon = job.budget.toLowerCase().includes("per month") ? "briefcase" : "cash-stack";
  const displayTitle = formatListingTitle(job.title);
  const body = (
    <div className="relative">
      {href ? (
        <Icon
          name="external-link"
          className="absolute right-0 top-0 h-3.5 w-3.5 text-white/30 opacity-0 transition-opacity group-hover:opacity-100"
        />
      ) : null}
      <div className="flex items-center gap-2.5">
        <InteractionAvatar
          name={job.channelName || displayTitle}
          src={job.channelLogoUrl}
          shape="rounded"
          sizeClasses="h-9 w-9"
        />
        <span className="min-w-0 truncate pr-5 text-xs font-medium text-white/60">
          {job.channelName || "Hiring team"}
        </span>
      </div>
      <h3 className="mt-2.5 text-sm font-semibold leading-snug text-white">{displayTitle}</h3>
      <div className="mt-2.5 space-y-1.5">
        <MetaRow icon={payIcon} text={job.budget} />
        {job.experience ? <MetaRow icon="cap" text={job.experience} /> : null}
        {job.location ? <MetaRow icon="pin" text={job.location} /> : null}
      </div>
    </div>
  );
  const cls = "block rounded-2xl border border-white/10 bg-white/[0.06] p-4";
  return href ? (
    <Link
      href={href}
      className={`group ${cls} cursor-pointer transition-colors hover:border-white/20 hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20`}
    >
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/**
 * Compact talent card for the context rail — the talent mirror of {@link CompactJobCard}.
 * Renders the same shape of information in the same order: identity → listing title →
 * rate / experience (numeric years) / location, with no bio, tags, portfolio block, or
 * availability status. The whole card opens the talent's listing/profile when a route exists.
 */
function CompactTalentCard({ talent }: { talent: InteractionTalentSnapshot }) {
  const href = talent.profileSlug ? `/u/${talent.profileSlug}?view=talent` : null;
  // Mirror the job card's pay row exactly: monthly retainers read better with the briefcase.
  const rate = talent.rate?.trim() || null;
  const payIcon = rate && rate.toLowerCase().includes("per month") ? "briefcase" : "cash-stack";
  // Numeric-year language only (e.g. "2–4 years"); never a level label like "Senior".
  const experience = talent.experience?.trim() || null;
  // For the viewer's own listing, repeating their name is noise — genericise the
  // identity to "Your listing" and seed the avatar from the headline instead.
  const identity = talent.isOwnListing ? "Your listing" : talent.name;
  const avatarSeed = talent.isOwnListing ? talent.headline : talent.name;
  const body = (
    <div className="relative">
      {href ? (
        <Icon
          name="external-link"
          className="absolute right-0 top-0 h-3.5 w-3.5 text-white/30 opacity-0 transition-opacity group-hover:opacity-100"
        />
      ) : null}
      <div className="flex items-center gap-2.5">
        <InteractionAvatar name={avatarSeed} src={talent.avatarUrl} sizeClasses="h-9 w-9" />
        <span className="min-w-0 truncate pr-5 text-xs font-medium text-white/60">{identity}</span>
      </div>
      <h3 className="mt-2.5 line-clamp-2 text-sm font-semibold leading-snug text-white">{talent.headline}</h3>
      <div className="mt-2.5 space-y-1.5">
        {rate ? <MetaRow icon={payIcon} text={rate} truncate /> : null}
        {experience ? <MetaRow icon="cap" text={experience} truncate /> : null}
        {talent.location ? <MetaRow icon="pin" text={talent.location} truncate /> : null}
      </div>
    </div>
  );
  const cls = "block rounded-2xl border border-white/10 bg-white/[0.06] p-4";
  return href ? (
    <Link
      href={href}
      className={`group ${cls} cursor-pointer transition-colors hover:border-white/20 hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20`}
    >
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

function InteractionTimeline({ item }: { item: OwnerInteraction }) {
  return (
    <section>
      <h3 className={SECTION_LABEL_CLASSES}>Timeline</h3>
      <ol className="mt-2.5">
        {item.timeline.map((event, index) => {
          const isLatest = index === item.timeline.length - 1;
          return (
            <li key={event.id} className="relative pb-3 pl-5 last:pb-0">
              <span
                className={[
                  "absolute left-0 top-[5px] h-1.5 w-1.5 rounded-full",
                  isLatest ? "bg-white/90" : "bg-white/40",
                ].join(" ")}
              />
              {!isLatest ? (
                <span className="absolute bottom-0 left-[2.5px] top-3.5 w-px bg-white/[0.09]" />
              ) : null}
              <p className={`text-xs ${isLatest ? "text-white/82" : "text-white/62"}`}>{event.label}</p>
              <p className="mt-0.5 text-[11px] text-white/40">{event.at}</p>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/**
 * The single context object the conversation is about. The header already shows
 * the counterparty, so this represents the *thing*: the job for applications, the
 * talent for sent requests, the recruiter/role for received requests.
 */
function contextCardFor(item: OwnerInteraction): ReactNode {
  if (item.kind === "application" && item.job) {
    return <CompactJobCard job={item.job} />;
  }
  if (item.kind === "hiring_request" && item.talent) {
    // Both directions resolve to the talent listing the conversation is about:
    // the recruited talent (sent) or the viewer's own listing (received).
    return <CompactTalentCard talent={item.talent} />;
  }
  return null;
}

function ProposalCard({ terms }: { terms: string }) {
  return (
    <div className={`inline-flex max-w-full items-center gap-2 rounded-xl ${SURFACE} px-3 py-2 text-sm text-white/74`}>
      <Icon name="cash" className="h-4 w-4 shrink-0 text-white/42" />
      <span className="min-w-0 break-words">{terms}</span>
    </div>
  );
}

function resolutionLine(item: OwnerInteraction): string {
  switch (item.status) {
    case "accepted":
      return "This request has been accepted.";
    case "hired":
      return "This application has moved to hired.";
    case "declined":
      return item.direction === "sent" ? "This was declined." : "You declined this.";
    case "withdrawn":
      return item.direction === "sent" ? "You withdrew this." : "This was withdrawn.";
    case "closed":
      return "This thread is closed.";
    default:
      return "This thread is archived.";
  }
}

function forwardLinkFor(item: OwnerInteraction): { href: string; browseLabel: string } | null {
  if (item.mode === "talent") {
    return item.kind === "application"
      ? { href: "/jobs", browseLabel: "Browse more jobs" }
      : { href: "/post-talent", browseLabel: "Update talent listing" };
  }
  return item.kind === "application"
    ? { href: "/post-job", browseLabel: "Post another job" }
    : { href: "/talent", browseLabel: "Browse more talent" };
}

function subtitleFor(item: OwnerInteraction): {
  lead: string;
  avatarName: string;
  avatarSrc?: string | null;
  href?: string | null;
} {
  const talentHref = item.talent?.profileSlug ? `/u/${item.talent.profileSlug}?view=talent` : null;
  const recruiterHref = item.recruiter?.profileSlug ? `/u/${item.recruiter.profileSlug}?view=hiring` : null;
  const channelHref = item.job?.channelProfileSlug ? `/u/${item.job.channelProfileSlug}?view=hiring` : null;
  const href = item.kind === "hiring_request" ? recruiterHref || talentHref : talentHref || channelHref;
  return {
    lead: item.counterpartyName,
    avatarName: item.counterpartyName,
    avatarSrc: item.counterpartyAvatarUrl,
    href,
  };
}

// ---- Conversation (chat) ----

export type ChatMessage = {
  id: string;
  fromMe: boolean;
  senderName: string;
  body: string;
  atLabel: string;
  /** "status" renders as a centered platform update line instead of a bubble. */
  kind?: "status";
  rate?: string | null;
  attachments?: OwnerInteraction["attachments"];
  firstMessageAnswers?: FirstMessageAnswers | null;
  firstMessageContext?: RequirementContext;
};

/**
 * Seed notes for the private-notes stack: any mock `privateNotes` (newest first),
 * otherwise the single `managerNote` as one earlier note. Used only until the user
 * saves locally, after which the localStorage stack takes over.
 */
function seedNotesForInteraction(item: OwnerInteraction): PrivateNote[] {
  if (item.privateNotes?.length) {
    return item.privateNotes.map((note) => ({ ...note, conversationId: item.id }));
  }
  const managerNote = item.managerNote?.trim();
  if (managerNote) {
    return [{ id: `${item.id}-seed-note`, body: managerNote, createdAt: "Earlier", conversationId: item.id }];
  }
  return [];
}

/**
 * Flattens an interaction's opening message, the counterparty's response, and any
 * follow-up replies into a single chat thread. The opening message carries the
 * proposed rate + work samples so they read as part of the conversation.
 */
export function buildConversation(item: OwnerInteraction): ChatMessage[] {
  const messages: ChatMessage[] = [];
  // An application carries job-context answers; a hiring request carries talent-context.
  const context: RequirementContext = item.kind === "application" ? "job" : "talent";
  const rawAnswers =
    item.firstMessageAnswers && Object.keys(item.firstMessageAnswers).length
      ? item.firstMessageAnswers
      : null;
  messages.push({
    id: `${item.id}-event`,
    fromMe: false,
    senderName: "CreatorJobs",
    body: openingEventLine(item),
    atLabel: item.createdAtLabel,
    kind: "status",
  });

  const answers = rawAnswers;
  const visibleAttachments = filterStructuredPortfolioDuplicateAttachments(item.attachments, answers);
  const openingBody = answers ? "" : item.message || "";
  const rate = answers ? null : item.proposedTerms || null;
  const hasOpening = Boolean(openingBody.trim()) || visibleAttachments.length > 0 || Boolean(answers) || Boolean(rate);
  if (hasOpening) {
    const openingFromMe = item.direction === "sent";
    messages.push({
      id: `${item.id}-opening`,
      fromMe: openingFromMe,
      senderName: openingFromMe ? "You" : item.counterpartyName,
      body: openingBody,
      atLabel: item.createdAtLabel,
      rate,
      attachments: visibleAttachments.length ? visibleAttachments : undefined,
      firstMessageAnswers: answers,
      firstMessageContext: context,
    });
  }
  if (item.response) {
    messages.push({
      id: `${item.id}-response`,
      fromMe: item.response.from === "You",
      senderName: item.response.from,
      body: item.response.body,
      atLabel: item.response.atLabel,
    });
  }
  (item.replies || []).forEach((reply, index) => {
    messages.push({
      id: `${item.id}-reply-${index}`,
      fromMe: reply.from === "You",
      senderName: reply.from,
      body: reply.body,
      atLabel: reply.atLabel,
      kind: reply.kind,
    });
  });
  return messages;
}

function openingEventLine(item: OwnerInteraction): string {
  const contextLabel = pipelineContextLabelOf(item);
  const suffix = contextLabel ? ` for ${contextLabel}` : "";
  if (item.kind === "application") {
    return item.direction === "sent"
      ? `You applied${suffix}.`
      : `${item.counterpartyName} applied${suffix}.`;
  }
  return item.direction === "sent"
    ? `You sent a hiring request${suffix}.`
    : `${item.counterpartyName} sent a hiring request${suffix}.`;
}

/**
 * A platform-generated update in the thread (e.g. a confirmed pipeline stage
 * change). Centered and chip-shaped so it reads as the product speaking —
 * clearly apart from either side's bubbles — without an "automated" label.
 */
export function StatusUpdateLine({ message }: { message: Pick<ChatMessage, "body" | "atLabel"> }) {
  return (
    <div data-testid="chat-status-update" className="flex justify-center px-2">
      <span className="inline-flex max-w-full items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.025] px-3.5 py-1.5 text-[11.5px] leading-relaxed text-white/60">
        <Icon name="sparkles" className="h-3 w-3 shrink-0 text-white/40" />
        <span className="min-w-0">{message.body}</span>
        <span className="shrink-0 text-white/30">· {message.atLabel}</span>
      </span>
    </div>
  );
}

/**
 * Post-move confirmation: the stage is already committed (internal tracking);
 * this asks the one human question left — inform the other side or not. The
 * preview shows the exact platform line that would land in the thread, and a
 * confirmed send offers an optional personal follow-up without leaving the
 * pipeline. Dismissing (Skip, ×, Escape) sends nothing.
 */
function StageNotifyPrompt({
  items,
  stageKey,
  phase,
  liveMode,
  onSend,
  onDismiss,
  onFollowUp,
}: {
  items: OwnerInteraction[];
  stageKey: string;
  phase: "ask" | "sending" | "sent" | "error";
  liveMode: boolean;
  onSend: () => void;
  onDismiss: () => void;
  onFollowUp: (item: OwnerInteraction) => void;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDismiss();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onDismiss]);

  if (items.length === 0) return null;
  const kind = items[0].kind;
  const stage = stageTargetsFor(kind).find((entry) => entry.key === stageKey);
  const policy = stage?.notify;
  if (!stage || !policy) return null;
  const single = items.length === 1 ? items[0] : null;
  const who = single ? single.counterpartyName : `${items.length} people`;
  const preview = policy.notice({ contextLabel: pipelineContextLabelOf(items[0]) });

  return (
    <div
      data-testid="stage-notify-prompt"
      className="ui-crossfade pointer-events-auto w-[min(430px,calc(100vw-2rem))] rounded-2xl border border-white/14 bg-[#131419]/95 p-4 shadow-[0_24px_70px_-30px_rgba(0,0,0,1)] backdrop-blur-xl"
    >
      <div className="flex items-start gap-2.5">
        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${stage.dot}`} aria-hidden />
        <p className="min-w-0 flex-1 text-[13px] leading-snug text-white/85">
          <span className="font-semibold text-white">{who}</span> moved to {stage.label}.
        </p>
        <button
          type="button"
          data-testid="stage-notify-close"
          onClick={onDismiss}
          aria-label="Dismiss without notifying"
          className="-mr-1 -mt-1 inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-lg text-white/45 transition-colors hover:bg-white/[0.07] hover:text-white"
        >
          <Icon name="x" className="h-3.5 w-3.5" />
        </button>
      </div>

      {phase === "sent" ? (
        <div className="mt-3">
          <p className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-200/85">
            <Icon name="check" className="h-3.5 w-3.5" />
            Update posted to the {items.length === 1 ? "thread" : "threads"}.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {single ? (
              <button
                type="button"
                data-testid="stage-notify-followup"
                onClick={() => onFollowUp(single)}
                className="inline-flex h-8 cursor-pointer items-center rounded-lg bg-white px-3 text-[11px] font-semibold text-black transition-colors hover:bg-white/90"
              >
                Add a personal message
              </button>
            ) : null}
            <button
              type="button"
              data-testid="stage-notify-done"
              onClick={onDismiss}
              className="inline-flex h-8 cursor-pointer items-center rounded-lg border border-white/15 bg-white/[0.04] px-3 text-[11px] font-semibold text-white/80 transition-colors hover:bg-white/[0.08]"
            >
              Done
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* The exact line the other side would see — no surprises. */}
          <p
            data-testid="stage-notify-preview"
            className="mt-3 inline-flex max-w-full items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.025] px-3 py-1.5 text-[11.5px] text-white/60"
          >
            <Icon name="sparkles" className="h-3 w-3 shrink-0 text-white/40" />
            <span className="min-w-0">{preview}</span>
          </p>
          {phase === "error" ? (
            <p className="mt-2 text-[11px] text-rose-300/80">Couldn’t post the update — try again.</p>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              data-testid="stage-notify-send"
              disabled={phase === "sending"}
              onClick={onSend}
              className="inline-flex h-8 cursor-pointer items-center rounded-lg bg-white px-3 text-[11px] font-semibold text-black transition-colors hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {phase === "sending"
                ? "Sending…"
                : single
                  ? `Let ${firstNameOf(single.counterpartyName)} know`
                  : `Let ${items.length} people know`}
            </button>
            <button
              type="button"
              data-testid="stage-notify-skip"
              onClick={onDismiss}
              className="inline-flex h-8 cursor-pointer items-center rounded-lg border border-white/15 bg-white/[0.04] px-3 text-[11px] font-semibold text-white/70 transition-colors hover:bg-white/[0.08] hover:text-white"
            >
              Skip
            </button>
            <span className="text-[10.5px] text-white/32">
              {liveMode ? "Posts in the chat thread." : "Demo only — posts into the demo thread."}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

function portfolioItemFromAttachment(label: string, url?: string | null): BackendPortfolioItem {
  return {
    id: url || label,
    user_id: "first-message",
    title: label,
    source_type: "other",
    source_url: url || null,
    links: url ? [url] : [],
    tags: [],
    tools: [],
    status: "past",
    is_public: true,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

function AttachmentChip({
  label,
  url,
  onMe,
  onOpenPortfolio,
}: {
  label: string;
  url?: string | null;
  onMe: boolean;
  onOpenPortfolio?: (label: string, url: string | null | undefined, target: HTMLElement, point: { x: number; y: number }) => void;
}) {
  const base =
    "inline-flex max-w-full items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition-colors";
  const tone = onMe
    ? "bg-black/20 text-white/80 hover:bg-black/30"
    : "border border-white/[0.1] bg-white/[0.03] text-white/70 hover:bg-white/[0.06]";
  const inner = (
    <>
      <Icon name="file" className="h-3.5 w-3.5 shrink-0 opacity-70" />
      <span className="truncate">{label}</span>
      {url ? <Icon name="external-link" className="h-3 w-3 shrink-0 opacity-50" /> : null}
    </>
  );
  return url && onOpenPortfolio ? (
    <button
      type="button"
      onClick={(event) =>
        onOpenPortfolio(label, url, event.currentTarget, { x: event.clientX, y: event.clientY })
      }
      className={`${base} ${tone} cursor-pointer text-left`}
    >
      {inner}
    </button>
  ) : url ? (
    <a href={url} target="_blank" rel="noreferrer" className={`${base} ${tone} cursor-pointer`}>
      {inner}
    </a>
  ) : (
    <span className={`${base} ${tone}`}>{inner}</span>
  );
}

export function MessageBubble({
  message,
  counterpartyAvatarUrl,
  counterpartyHref,
}: {
  message: ChatMessage;
  counterpartyAvatarUrl?: string | null;
  counterpartyHref?: string | null;
}) {
  const me = message.fromMe;
  const portfolioPopup = usePortfolioDetailPopup(`applications-message-portfolio-${message.id}`);
  const openPortfolioAttachment = (
    label: string,
    url: string | null | undefined,
    target: HTMLElement,
    point: { x: number; y: number }
  ) => {
    portfolioPopup.open(portfolioItemFromAttachment(label, url), target, point);
  };
  const avatar = (
    <InteractionAvatar
      name={message.senderName}
      src={me ? null : counterpartyAvatarUrl}
      sizeClasses="h-7 w-7"
    />
  );
  return (
    <div
      data-testid="chat-message"
      data-from={me ? "me" : "other"}
      className={["flex items-end gap-2", me ? "flex-row-reverse" : "flex-row"].join(" ")}
    >
      {!me && counterpartyHref ? (
        <Link href={counterpartyHref} aria-label={`Open ${message.senderName}`} className="rounded-full focus:outline-none focus:ring-2 focus:ring-white/15">
          {avatar}
        </Link>
      ) : (
        avatar
      )}
      <div className={["flex max-w-[82%] min-w-0 flex-col gap-1", me ? "items-end" : "items-start"].join(" ")}>
        <p className="px-1 text-[11px] font-medium text-white/40">
          {message.senderName} · {message.atLabel}
        </p>
        {message.body || message.rate || (message.attachments && message.attachments.length > 0) ? (
          <div
            className={[
              "min-w-0 px-3.5 py-2.5 text-[13px] leading-relaxed shadow-[0_8px_24px_-20px_rgba(0,0,0,0.9)]",
              me
                ? "rounded-2xl rounded-br-md bg-white/[0.13] text-white/92"
                : "rounded-2xl rounded-bl-md border border-white/[0.07] bg-white/[0.035] text-white/82",
            ].join(" ")}
          >
            {message.body ? <p className="whitespace-pre-line break-words">{message.body}</p> : null}
            {message.rate ? (
              <p
                className={[
                  "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs",
                  message.body ? "mt-2.5" : "",
                  me ? "bg-black/20 text-white/82" : "border border-white/[0.09] bg-white/[0.03] text-white/72",
                ].join(" ")}
              >
                <Icon name="cash" className="h-3.5 w-3.5 opacity-70" />
                {message.rate}
              </p>
            ) : null}
            {message.attachments && message.attachments.length > 0 ? (
              <div className={["flex flex-col items-start gap-1.5", message.body || message.rate ? "mt-2.5" : ""].join(" ")}>
                {message.attachments.map((attachment) => (
                  <AttachmentChip
                    key={`${message.id}-att-${attachment.label}`}
                    label={attachment.label}
                    url={attachment.url}
                    onMe={me}
                    onOpenPortfolio={openPortfolioAttachment}
                  />
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        {message.firstMessageAnswers && message.firstMessageContext ? (
          <FirstMessageSummary
            context={message.firstMessageContext}
            answers={message.firstMessageAnswers}
            className="w-full"
          />
        ) : null}
        {portfolioPopup.popover}
      </div>
    </div>
  );
}

export default function ApplicationsWorkspace({
  mode,
  modeOptions = DEFAULT_MODE_OPTIONS,
  onModeChange,
  allowDemo = false,
  demoMode = false,
  onToggleDemo,
  interactions,
  backendAccessToken,
  forceMock = false,
  initialSelectedId = null,
  view: viewProp,
  onViewChange,
  pipelineDirection: pipelineDirectionProp,
  onPipelineDirectionChange,
  pipelineStage = null,
  onPipelineStageChange,
}: ApplicationsWorkspaceProps) {
  // Live mode: authenticated against the real backend (local-mocks env always
  // stays in demo mode, matching the rest of the app's data strategy). The
  // demo override (?demo=1) flips back to the mock dataset for UI preview.
  const liveMode = Boolean(backendAccessToken) && !isLocalMocksEnabled() && !forceMock;
  const [items, setItems] = useState<OwnerInteraction[]>(() =>
    liveMode ? [] : interactions ?? MOCK_OWNER_INTERACTIONS
  );
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">(liveMode ? "loading" : "ready");
  const [reloadNonce, setReloadNonce] = useState(0);
  // Real message threads loaded per interaction in live mode (keyed by record id ==
  // OwnerInteraction id). Demo mode keeps using the in-memory `replies` on the item.
  const [liveThreads, setLiveThreads] = useState<
    Record<string, { conversationId: string; messages: BackendMessage[]; engagement?: BackendEngagementSummary | null }>
  >({});
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  // Unread message count per inbox thread (keyed by record id == OwnerInteraction id),
  // sourced from the real GET /me/conversations endpoint in live mode.
  const [unreadByThread, setUnreadByThread] = useState<Record<string, number>>({});
  const [actionError, setActionError] = useState<string | null>(null);
  const [reviewOpportunity, setReviewOpportunity] = useState<BackendReviewOpportunity | null>(null);
  const [filter, setFilter] = useState<WorkspaceFilter>("all");
  // View + direction are controlled by the page (persistence, deep links) when
  // the props are provided; otherwise the workspace owns them locally.
  const [internalView, setInternalView] = useState<WorkspaceView>("inbox");
  const [internalDirection, setInternalDirection] = useState<PipelineDirection>("received");
  const view = viewProp ?? internalView;
  const pipelineDirection = pipelineDirectionProp ?? internalDirection;
  const setView = (next: WorkspaceView) => {
    // A pending notify prompt belongs to the board it was raised on.
    setNotifyPrompt(null);
    if (onViewChange) onViewChange(next);
    else setInternalView(next);
  };
  const setPipelineDirection = (next: PipelineDirection) => {
    setNotifyPrompt(null);
    if (onPipelineDirectionChange) onPipelineDirectionChange(next);
    else setInternalDirection(next);
  };
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(Boolean(initialSelectedId));
  // Remember the open inbox conversation across navigation so returning lands back
  // on it (not the first thread / the list). A ?thread deep-link always wins.
  const selectionRestored = useRef(false);
  const skipFirstSelectionPersist = useRef(!initialSelectedId);
  useEffect(() => {
    if (selectionRestored.current) return;
    selectionRestored.current = true;
    if (initialSelectedId) return;
    try {
      const saved = window.localStorage.getItem(SELECTED_STORAGE_KEY);
      if (saved) {
        setSelectedId(saved);
        setMobileDetailOpen(true);
      }
    } catch {
      // storage unavailable; nothing to restore
    }
    // Restore runs once against the mount-time deep-link snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (skipFirstSelectionPersist.current) {
      skipFirstSelectionPersist.current = false;
      return;
    }
    try {
      if (selectedId) window.localStorage.setItem(SELECTED_STORAGE_KEY, selectedId);
      else window.localStorage.removeItem(SELECTED_STORAGE_KEY);
    } catch {
      // storage unavailable; selection still works in-session
    }
  }, [selectedId]);
  const [pendingActionKey, setPendingActionKey] = useState<string | null>(null);
  const [pendingNote, setPendingNote] = useState("");
  const [replyDraft, setReplyDraft] = useState("");
  // Compact chat dock: bumped by card "Message" actions to open that thread.
  const [chatRequest, setChatRequest] = useState<{ id: string; nonce: number } | null>(null);
  // After a move into an externally meaningful stage, ask whether to inform the
  // other side with a platform status update. Nothing sends without consent.
  const [notifyPrompt, setNotifyPrompt] = useState<{
    itemIds: string[];
    stageKey: string;
    kind: InteractionKind;
    phase: "ask" | "sending" | "sent" | "error";
  } | null>(null);
  // Private manager note editor state for the selected received item.
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!liveMode || !backendAccessToken) return;
    let cancelled = false;
    getActivitySummary(backendAccessToken)
      .then((summary) => {
        if (cancelled) return;
        setItems(mapActivityToOwnerInteractions(summary));
        setLoadState("ready");
      })
      .catch(() => {
        if (cancelled) return;
        if (allowDemo || canUseLocalMockFallback()) {
          setItems(interactions ?? MOCK_OWNER_INTERACTIONS);
          setLoadState("ready");
          return;
        }
        setLoadState("error");
      });
    // Unread badges are non-critical: fetch independently so a failure here never
    // disturbs the main inbox list or its demo fallback.
    listConversations(backendAccessToken)
      .then((conversations) => {
        if (cancelled) return;
        setUnreadByThread(buildUnreadByThread(conversations));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [liveMode, backendAccessToken, allowDemo, interactions, reloadNonce]);

  const modeItems = useMemo(() => items.filter((item) => item.mode === mode), [items, mode]);

  const visibleItems = useMemo(() => {
    if (filter === "sent") return modeItems.filter((item) => item.direction === "sent");
    if (filter === "received") return modeItems.filter((item) => item.direction === "received");
    if (filter === "archived") return modeItems.filter(isArchivedInteraction);
    return modeItems;
  }, [modeItems, filter]);

  // Selection falls back to the first visible row so the detail pane is never
  // empty while the filtered list has items.
  const selected = useMemo(
    () => visibleItems.find((item) => item.id === selectedId) || visibleItems[0] || null,
    [visibleItems, selectedId]
  );
  const selectedItemId = selected?.id ?? null;
  const selectedKind = selected?.kind ?? null;

  // Load the real conversation for the open thread (live mode only) and mark it read.
  // The record id == OwnerInteraction id; the kind decides which endpoint to call.
  useEffect(() => {
    if (!liveMode || !backendAccessToken || !selectedItemId || !selectedKind) return;
    const recordId = selectedItemId;
    let cancelled = false;
    setSendError(null);
    const loader =
      selectedKind === "hiring_request"
        ? getInterestConversation(backendAccessToken, recordId)
        : getApplicationConversation(backendAccessToken, recordId);
    loader
      .then((detail) => {
        if (cancelled) return;
        setLiveThreads((prev) => ({
          ...prev,
          [recordId]: {
            conversationId: detail.conversation.id,
            messages: detail.messages,
            engagement: detail.engagement,
          },
        }));
        if (detail.conversation.unread_count > 0) {
          void markConversationRead(backendAccessToken, detail.conversation.id).catch(() => {});
        }
        // Opening a thread clears its unread badge immediately.
        setUnreadByThread((prev) => {
          if (!prev[recordId]) return prev;
          const next = { ...prev };
          delete next[recordId];
          return next;
        });
      })
      .catch(() => {
        // Leaving the thread without a loaded conversation simply keeps the composer
        // disabled; the opening message (application detail) still renders.
      });
    return () => {
      cancelled = true;
    };
  }, [liveMode, backendAccessToken, selectedItemId, selectedKind, reloadNonce]);

  const filterCounts = useMemo(
    () => ({
      all: modeItems.length,
      sent: modeItems.filter((item) => item.direction === "sent").length,
      received: modeItems.filter((item) => item.direction === "received").length,
      archived: modeItems.filter(isArchivedInteraction).length,
    }),
    [modeItems]
  );

  const resetComposition = () => {
    setPendingActionKey(null);
    setPendingNote("");
    setReplyDraft("");
    setActionError(null);
  };

  const selectFilter = (key: WorkspaceFilter) => {
    setFilter(key);
    setMobileDetailOpen(false);
    resetComposition();
  };

  const handleSelect = (id: string) => {
    setSelectedId(id);
    setMobileDetailOpen(true);
    resetComposition();
    setItems((prev) =>
      prev.map((item) => (item.id === id && item.unread ? { ...item, unread: false } : item))
    );
  };

  /**
   * Move one or many received items to a pipeline stage (backend vocabulary).
   * Live mode persists through the bulk endpoint first — a thrown error keeps
   * the board's selection so the user can retry; demo mode commits locally.
   */
  const handleMoveStage = async (moveItems: OwnerInteraction[], stageKey: string) => {
    if (moveItems.length === 0) return;
    const kind: InteractionKind = moveItems[0].kind;
    setActionError(null);
    if (liveMode && backendAccessToken) {
      try {
        const ids = moveItems.map((item) => item.id);
        if (kind === "application") {
          await bulkUpdateApplicationStatus(backendAccessToken, ids, stageKey as BackendJobApplication["status"]);
        } else {
          await bulkUpdateTalentInterestStatus(backendAccessToken, ids, stageKey as BackendTalentInterest["status"]);
        }
      } catch (error) {
        setActionError(
          moveItems.length > 1
            ? "Couldn't move the selection — the backend is unreachable. Try again."
            : "Couldn't update the stage — the backend is unreachable. Try again."
        );
        throw error;
      }
    }
    const stageLabel = stageTargetsFor(kind).find((stage) => stage.key === stageKey)?.label ?? stageKey;
    const movedIds = new Set(moveItems.map((item) => item.id));
    setItems((prev) =>
      prev.map((item) =>
        movedIds.has(item.id)
          ? {
              ...item,
              status: interactionStatusFromBackend(item.kind, item.direction, stageKey),
              backendStatus: stageKey,
              updatedAtLabel: "Just now",
              unread: false,
              timeline: [
                ...item.timeline,
                {
                  id: `${item.id}-stage-${item.timeline.length}`,
                  label: `Moved to ${stageLabel} by you`,
                  at: "Just now",
                },
              ],
            }
          : item
      )
    );
    // Externally meaningful stages ask whether to inform the other side;
    // internal-only stages (reviewing, archived) simply clear any open prompt.
    setNotifyPrompt(
      stageNotifyPolicyOf(kind, stageKey)
        ? { itemIds: moveItems.map((item) => item.id), stageKey, kind, phase: "ask" }
        : null
    );
  };

  /**
   * Post the platform status update into each moved item's chat thread — only
   * ever called from the prompt's explicit "Send update" action. Live mode
   * persists a real kind="status_update" message; demo mode appends locally.
   */
  const sendStatusUpdates = async (targets: OwnerInteraction[], stageKey: string) => {
    if (targets.length === 0) return;
    const firstTarget = targets[0];
    if (!firstTarget) return;
    const kind = firstTarget.kind;
    const policy = stageNotifyPolicyOf(kind, stageKey);
    if (!policy) return;
    const targetToOpen = targets.length === 1 ? firstTarget : null;
    setNotifyPrompt((prev) => (prev ? { ...prev, phase: "sending" } : prev));
    try {
      if (liveMode && backendAccessToken) {
        for (const target of targets) {
          const notice = policy.notice({ contextLabel: pipelineContextLabelOf(target) });
          const cached = liveThreads[target.id];
          let conversationId = cached?.conversationId;
          if (!conversationId) {
            const detail =
              target.kind === "hiring_request"
                ? await getInterestConversation(backendAccessToken, target.id)
                : await getApplicationConversation(backendAccessToken, target.id);
            conversationId = detail.conversation.id;
            setLiveThreads((prev) => ({
              ...prev,
              [target.id]: { conversationId: detail.conversation.id, messages: detail.messages },
            }));
          }
          const message = await sendConversationMessage(
            backendAccessToken,
            conversationId,
            notice,
            "status_update"
          );
          setLiveThreads((prev) => {
            const thread = prev[target.id];
            if (!thread) return prev;
            return { ...prev, [target.id]: { ...thread, messages: [...thread.messages, message] } };
          });
        }
      } else {
        const targetIds = new Set(targets.map((target) => target.id));
        setItems((prev) =>
          prev.map((item) => {
            if (!targetIds.has(item.id)) return item;
            const notice = policy.notice({ contextLabel: pipelineContextLabelOf(item) });
            return {
              ...item,
              replies: [
                ...(item.replies || []),
                { from: "You", body: notice, atLabel: "Just now", kind: "status" as const },
              ],
              timeline: [
                ...item.timeline,
                {
                  id: `${item.id}-notice-${item.timeline.length}`,
                  label: `Status update sent to ${firstNameOf(item.counterpartyName)}`,
                  at: "Just now",
                },
              ],
            };
          })
        );
      }
      setNotifyPrompt((prev) => (prev ? { ...prev, phase: "sent" } : prev));
      if (targetToOpen) {
        setChatRequest((prev) => ({ id: targetToOpen.id, nonce: (prev?.nonce ?? 0) + 1 }));
      }
    } catch {
      setNotifyPrompt((prev) => (prev ? { ...prev, phase: "error" } : prev));
    }
  };

  /**
   * Persist the latest private note on a received item. The rich note stack is
   * local (see PrivateNotesPanel); this keeps the single-note backend field — and
   * the pipeline note indicator that reads `managerNote` — in sync with the newest
   * note. Throws on backend failure so the panel can keep the note locally.
   */
  const persistLatestNote = async (target: OwnerInteraction, body: string | null) => {
    if (liveMode && backendAccessToken) {
      if (target.kind === "application") {
        await updateApplicationManagerNote(backendAccessToken, target.id, body);
      } else {
        await updateTalentInterestManagerNote(backendAccessToken, target.id, body);
      }
    }
    setItems((prev) => prev.map((item) => (item.id === target.id ? { ...item, managerNote: body } : item)));
  };

  const commitStatusLocally = (target: OwnerInteraction, action: HeaderAction, trimmedNote?: string) => {
    setItems((prev) =>
      prev.map((item) =>
        item.id === target.id
          ? {
              ...item,
              status: action.nextStatus as InteractionStatus,
              updatedAtLabel: "Just now",
              unread: false,
              replies: trimmedNote
                ? [...(item.replies || []), { from: "You", body: trimmedNote, atLabel: "Just now" }]
                : item.replies,
              timeline: [
                ...item.timeline,
                {
                  id: `${item.id}-${action.key}-${item.timeline.length}`,
                  label: action.eventLabel as string,
                  at: "Just now",
                },
              ],
            }
          : item
      )
    );
    setPendingActionKey(null);
    setPendingNote("");
  };

  const applyStatusAction = (target: OwnerInteraction, action: HeaderAction, note?: string) => {
    if (!action.nextStatus || !action.eventLabel) return;
    const trimmedNote = note?.trim();
    setActionError(null);

    if (liveMode && backendAccessToken) {
      // Map workspace actions to the real backend status vocabulary; commit
      // locally only after the backend confirms — no fake success states.
      // Withdraw is sender-initiated and uses its own endpoint (the status PATCH
      // is owner-only and would reject the sender).
      const applicationStatus =
        action.key === "shortlist" ? "shortlisted" : action.key === "hire" ? "hired" : "rejected";
      const request =
        action.key === "withdraw"
          ? target.kind === "application"
            ? withdrawApplication(backendAccessToken, target.id)
            : withdrawTalentInterest(backendAccessToken, target.id)
          : target.kind === "application"
            ? updateApplicationStatus(backendAccessToken, target.id, applicationStatus)
            : updateTalentInterestStatus(
                backendAccessToken,
                target.id,
                action.key === "accept" ? "contacted" : "declined"
              );
      request
        .then(() => commitStatusLocally(target, action))
        .catch(() => {
          setActionError(
            action.key === "withdraw"
              ? "Couldn't withdraw — the backend is unreachable. Try again."
              : "Couldn't update the status — the backend is unreachable. Try again."
          );
          setPendingActionKey(null);
          setPendingNote("");
        });
      return;
    }

    commitStatusLocally(target, action, trimmedNote);
  };

  const handleSendReply = async (target: OwnerInteraction) => {
    const body = replyDraft.trim();
    if (!body) return;

    // Live mode: persist a real message through the backend conversation.
    if (liveMode && backendAccessToken) {
      const thread = liveThreads[target.id];
      if (!thread) {
        setSendError("This thread is still loading. Try again in a moment.");
        return;
      }
      setSending(true);
      setSendError(null);
      try {
        const message = await sendConversationMessage(backendAccessToken, thread.conversationId, body);
        setLiveThreads((prev) => ({
          ...prev,
          [target.id]: { ...thread, messages: [...thread.messages, message] },
        }));
        setReplyDraft("");
      } catch {
        setSendError("Message could not be sent. Please try again.");
      } finally {
        setSending(false);
      }
      return;
    }

    // Demo mode: append to the in-memory thread (no backend).
    appendDemoReply(target.id, body);
    setReplyDraft("");
  };

  /** Demo-mode reply persistence, shared by the inbox composer and the chat dock. */
  const appendDemoReply = (id: string, body: string) => {
    setItems((prev) =>
      prev.map((item) =>
        item.id === id
          ? {
              ...item,
              updatedAtLabel: "Just now",
              replies: [...(item.replies || []), { from: "You", body, atLabel: "Just now" }],
              timeline: [
                ...item.timeline,
                { id: `${item.id}-reply-${item.timeline.length}`, label: "Reply sent", at: "Just now" },
              ],
            }
          : item
      )
    );
  };

  if (liveMode && loadState === "loading") {
    return (
      <div
        className={`flex w-full items-center justify-center px-6 py-16 ${WORKSPACE_HEIGHT_CLASSES}`}
        data-testid="applications-workspace"
      >
        <p className="text-sm text-white/45">Loading applications…</p>
      </div>
    );
  }

  if (liveMode && loadState === "error") {
    return (
      <div
        className={`flex w-full items-center justify-center px-6 py-16 ${WORKSPACE_HEIGHT_CLASSES}`}
        data-testid="applications-workspace"
      >
        <div className="text-center">
          <p className="text-base font-semibold text-white/90">Couldn’t load applications.</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-white/55">
            The backend is unreachable right now. Your applications and requests are safe — try again in a moment.
          </p>
          <button
            type="button"
            onClick={() => {
              setLoadState("loading");
              setReloadNonce((nonce) => nonce + 1);
            }}
            className={`mt-5 ${GHOST_BUTTON_CLASSES}`}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (modeItems.length === 0) {
    const isTalent = mode === "talent";
    return (
      <div
        className={`flex w-full items-center justify-center px-6 py-16 ${WORKSPACE_HEIGHT_CLASSES}`}
        data-testid="applications-workspace"
      >
        <div className="text-center">
          <p className="text-base font-semibold text-white/90">
            {isTalent ? "No applications yet." : "No hiring activity yet."}
          </p>
          <p className="mx-auto mt-2 max-w-md text-sm text-white/55">
            {isTalent
              ? "When you apply to jobs or receive hiring requests, they’ll appear here."
              : "Applications to your jobs and requests you send to talent will appear here."}
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
            <Link href={isTalent ? "/jobs" : "/post-job"} className={PRIMARY_BUTTON_CLASSES}>
              {isTalent ? "Browse jobs" : "Post a job"}
            </Link>
            <Link href={isTalent ? "/post-talent" : "/talent"} className={GHOST_BUTTON_CLASSES}>
              {isTalent ? "Create talent listing" : "Browse talent"}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const headerActions = selected ? headerActionsFor(selected, liveMode) : [];
  const pendingAction = headerActions.find(
    (action) => action.flow === "confirm" && action.key === pendingActionKey
  );
  const replyTemplates = selected ? quickReplyTemplates(selected) : [];
  // The reply composer is demo-only: there is no messaging backend yet, so in
  // live mode it is shown disabled rather than pretending to deliver.
  const selectedArchived = selected ? isArchivedInteraction(selected) : false;
  // The composer is active for any open, non-archived thread. In live mode it sends
  // real messages once the conversation has loaded; in demo mode it appends locally.
  const liveThread = selected && liveMode ? liveThreads[selected.id] : undefined;
  const selectedEngagement = liveThread?.engagement || null;
  const selectedActive = selected ? !selectedArchived && (!liveMode || Boolean(liveThread)) : false;
  const liveMessages: ChatMessage[] =
    selected && liveMode && liveThread
      ? liveThread.messages.map((message) =>
          mapBackendMessage(message, selected.counterpartyName, relativeTimeLabel)
        )
      : [];
  const conversation = selected ? [...buildConversation(selected), ...liveMessages] : [];
  const subtitle = selected ? subtitleFor(selected) : null;
  const forward = selected ? forwardLinkFor(selected) : null;
  const menuItems: OverflowMenuItem[] = selected
    ? headerActions
        // Reply is handled by the always-visible composer, so it isn't duplicated here.
        .filter((action) => action.flow !== "reply")
        .map((action) => ({
        key: action.key,
        label: action.label,
        icon: action.icon,
        primary: action.primary,
        destructive: action.destructive,
        onClick: () => {
          if (action.flow === "instant") {
            applyStatusAction(selected, action);
            return;
          }
          if (action.flow === "confirm") {
            setPendingActionKey(action.key);
            setPendingNote("");
            setActionError(null);
            return;
          }
          composerRef.current?.focus();
        },
      }))
    : [];
  // The opening message carries the proposed rate inside its bubble; when there's
  // no opening message, surface the rate in the context card so it isn't lost.
  const hasOpeningMessage = selected
    ? Boolean(selected.message) || (selected.attachments?.length ?? 0) > 0
    : false;
  const contextCard = selected ? contextCardFor(selected) : null;
  const showProposalInRail = Boolean(selected?.proposedTerms) && !hasOpeningMessage;
  const totalUnreadCount = liveMode ? totalUnread(unreadByThread) : 0;
  const openEngagementReview = async (engagement: BackendEngagementSummary) => {
    if (!backendAccessToken) return;
    setActionError(null);
    try {
      const workspace = await getMyReviewWorkspace(backendAccessToken, mode);
      const opportunity = [...workspace.opportunities, ...workspace.written].find(
        (item) => item.engagement.id === engagement.id
      );
      if (!opportunity) throw new Error("This feedback opportunity is no longer available.");
      setReviewOpportunity(opportunity);
    } catch (reviewError) {
      setActionError(reviewError instanceof Error ? reviewError.message : "Couldn’t open feedback.");
    }
  };

  // ---- Pipeline view: full-width, stage-first management board ------------
  // Within one mode+direction the interaction kind is uniform, so each board
  // manages exactly one status vocabulary.
  const pipelineKind: InteractionKind =
    pipelineDirection === "received"
      ? mode === "hiring"
        ? "application"
        : "hiring_request"
      : mode === "hiring"
        ? "hiring_request"
        : "application";
  const pipelineItems = modeItems.filter((item) => item.direction === pipelineDirection);
  const directionLabels = directionLabelsFor(mode);
  const pipelineSummary = pipelineSummaryOf(pipelineItems, pipelineKind, pipelineDirection, mode);
  const notifyPromptItems = notifyPrompt
    ? notifyPrompt.itemIds
        .map((id) => items.find((item) => item.id === id))
        .filter((item): item is OwnerInteraction => Boolean(item))
    : [];

  return (
    // One stable shell for both views: the controls stay in the same top-left
    // location, and the Inbox conversation header aligns with that workspace row.
    <div className={`relative flex w-full flex-col ${WORKSPACE_HEIGHT_CLASSES}`} data-testid="applications-workspace">
      {view === "pipeline" ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <WorkspaceControls
            mode={mode}
            modeOptions={modeOptions}
            onModeChange={onModeChange}
            view={view}
            onViewChange={setView}
          />
          <div className="shrink-0 border-b border-white/[0.06] px-4 sm:px-6">
            <div className="flex items-end gap-5">
              {(
                [
                  { key: "received", label: directionLabels.received, count: filterCounts.received },
                  { key: "sent", label: directionLabels.sent, count: filterCounts.sent },
                ] as const
              ).map((option) => {
                const isActive = pipelineDirection === option.key;
                return (
                  <button
                    key={option.key}
                    type="button"
                    data-testid={`pipeline-direction-${option.key}`}
                    aria-pressed={isActive}
                    onClick={() => setPipelineDirection(option.key)}
                    className={[
                      "group/direction relative h-10 shrink-0 cursor-pointer whitespace-nowrap px-0.5 text-[13px] font-semibold transition-colors",
                      isActive ? "text-white" : "text-white/50 hover:text-white/80",
                    ].join(" ")}
                  >
                    {option.label}
                    {option.count > 0 ? (
                      <span className={`ml-1.5 text-[11px] font-medium ${isActive ? "text-white/55" : "text-white/32"}`}>
                        {option.count}
                      </span>
                    ) : null}
                    <span
                      className={[
                        "absolute inset-x-0 bottom-0 h-[2px] rounded-full transition-colors",
                        isActive ? "bg-white" : "bg-white/0 group-hover/direction:bg-white/20",
                      ].join(" ")}
                    />
                  </button>
                );
              })}
              {/* At-a-glance board readout: total · new arrivals · furthest active stage. */}
              {pipelineSummary ? (
                <p
                  data-testid="pipeline-summary"
                  className="ml-auto hidden min-w-0 self-center truncate pl-3 text-[11px] font-medium text-white/40 md:block"
                >
                  {pipelineSummary}
                </p>
              ) : null}
            </div>
          </div>
          {actionError ? (
            <p className="mx-4 mt-3 rounded-xl border border-amber-200/25 bg-amber-200/10 px-4 py-2.5 text-xs text-amber-100 sm:mx-6">
              {actionError}
            </p>
          ) : null}
          <div className="min-h-0 flex-1">
            <PipelineBoard
              key={`${mode}-${pipelineDirection}`}
              items={pipelineItems}
              kind={pipelineKind}
              direction={pipelineDirection}
              unreadByThread={unreadByThread}
              initialStage={pipelineStage}
              onStageFocusChange={onPipelineStageChange}
              onMessage={(item) =>
                setChatRequest((prev) => ({ id: item.id, nonce: (prev?.nonce ?? 0) + 1 }))
              }
              onMoveStage={handleMoveStage}
            />
          </div>
          {notifyPrompt && notifyPromptItems.length > 0 ? (
            <div className="pointer-events-none absolute inset-x-0 bottom-4 z-50 flex justify-center px-4">
              <StageNotifyPrompt
                items={notifyPromptItems}
                stageKey={notifyPrompt.stageKey}
                phase={notifyPrompt.phase}
                liveMode={liveMode}
                onSend={() => void sendStatusUpdates(notifyPromptItems, notifyPrompt.stageKey)}
                onDismiss={() => setNotifyPrompt(null)}
                onFollowUp={(item) => {
                  setNotifyPrompt(null);
                  setChatRequest((prev) => ({ id: item.id, nonce: (prev?.nonce ?? 0) + 1 }));
                }}
              />
            </div>
          ) : null}
        </div>
      ) : (
      <div className="min-h-0 flex-1 lg:grid lg:grid-cols-[390px_minmax(0,1fr)]">
        <aside
          className={[
            "border-white/[0.06] lg:flex lg:min-h-0 lg:flex-col lg:border-r",
            mobileDetailOpen ? "hidden lg:flex" : "block",
          ].join(" ")}
        >
          <WorkspaceControls
            mode={mode}
            modeOptions={modeOptions}
            onModeChange={onModeChange}
            view={view}
            onViewChange={setView}
          />
          <FilterBar mode={mode} filter={filter} counts={filterCounts} onSelect={selectFilter} />
          {totalUnreadCount > 0 ? (
            <div
              data-testid="inbox-unread-total"
              className="flex items-center gap-1.5 px-4 pb-1.5 pt-0.5 text-[11px] text-white/45"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-white/80" aria-hidden="true" />
              {totalUnreadCount} unread message{totalUnreadCount === 1 ? "" : "s"}
            </div>
          ) : null}

          <div className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
            {visibleItems.length === 0 ? (
              <div className="px-4 py-12 text-center text-xs text-white/45">Nothing here yet.</div>
            ) : (
              <div className="divide-y divide-white/[0.05]">
                {visibleItems.map((item) => {
                  const isSelected = item.id === selectedItemId;
                  // Real unread message count for this thread (live mode); demo data
                  // still drives the simple "new" dot via item.unread.
                  const messageUnread = liveMode ? unreadByThread[item.id] ?? 0 : 0;
                  const rowUnread = Boolean(item.unread) || messageUnread > 0;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      data-testid="interaction-row"
                      aria-pressed={isSelected}
                      onClick={() => handleSelect(item.id)}
                      className={[
                        "flex w-full cursor-pointer items-start gap-3 border-l-2 px-4 py-3.5 text-left transition-colors",
                        isSelected
                          ? "border-l-white/85 bg-white/[0.055]"
                          : "border-l-transparent hover:bg-white/[0.035]",
                      ].join(" ")}
                    >
                      <InteractionAvatar name={item.counterpartyName} src={item.counterpartyAvatarUrl} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-[11px] font-medium text-white/42">
                            {interactionKindLabel(item)}
                          </span>
                          <div className="flex shrink-0 items-center gap-1.5">
                            {messageUnread > 0 ? (
                              <span
                                data-testid="inbox-unread-badge"
                                aria-label={`${messageUnread} unread message${messageUnread === 1 ? "" : "s"}`}
                                className="inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-white px-1 text-[10px] font-semibold leading-none text-black"
                              >
                                {formatBadgeCount(messageUnread)}
                              </span>
                            ) : null}
                            <span className="text-[11px] text-white/38">{item.updatedAtLabel}</span>
                          </div>
                        </div>
                        <div className="mt-0.5 flex items-center gap-2">
                          {rowUnread ? (
                            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-white/90" aria-hidden="true" />
                          ) : null}
                          <span
                            className={[
                              "truncate text-sm",
                              rowUnread ? "font-semibold text-white" : "font-medium text-white/85",
                            ].join(" ")}
                          >
                            {item.title}
                          </span>
                        </div>
                        <div className="mt-1 flex items-center justify-between gap-2">
                          <span className="truncate text-xs text-white/52">{rowSubtitle(item)}</span>
                          <StatusPill status={item.status} />
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </aside>

        <section
          className={[
            "lg:flex lg:min-h-0 lg:flex-col",
            mobileDetailOpen ? "block" : "hidden lg:flex",
          ].join(" ")}
        >
          {selected ? (
            <div
              key={selected.id}
              className="ui-crossfade lg:grid lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_clamp(300px,26vw,360px)]"
              data-testid="applications-detail"
            >
              {/* Conversation column — the focus */}
              <div className="flex min-w-0 flex-col lg:min-h-0 lg:border-r lg:border-white/[0.06]">
                {/* Header bar: subject + counterparty · status · overflow */}
                <div
                  className="flex shrink-0 items-center justify-between gap-3 border-b border-white/[0.06] px-3 py-3 sm:px-5"
                  data-testid="applications-detail-header"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <button
                      type="button"
                      onClick={() => setMobileDetailOpen(false)}
                      aria-label="Back to applications"
                      className="-ml-1 inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-lg text-white/65 transition-colors hover:bg-white/[0.06] hover:text-white lg:hidden"
                    >
                      <span aria-hidden="true">←</span>
                    </button>
                    {/* Header answers "who am I talking to?" — the counterparty, not the job title. */}
                    {subtitle?.href ? (
                      <Link
                        href={subtitle.href}
                        className="group flex min-w-0 items-center gap-2.5 transition-opacity hover:opacity-90"
                      >
                        <InteractionAvatar name={subtitle.avatarName} src={subtitle.avatarSrc} sizeClasses="h-9 w-9" />
                        <h1 className="truncate text-[15px] font-semibold leading-tight text-white sm:text-base">
                          {subtitle.lead}
                        </h1>
                      </Link>
                    ) : (
                      <div className="flex min-w-0 items-center gap-2.5">
                        <InteractionAvatar
                          name={subtitle?.avatarName ?? selected.counterpartyName}
                          src={subtitle?.avatarSrc ?? selected.counterpartyAvatarUrl}
                          sizeClasses="h-9 w-9"
                        />
                        <h1 className="truncate text-[15px] font-semibold leading-tight text-white sm:text-base">
                          {subtitle?.lead ?? selected.counterpartyName}
                        </h1>
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2.5">
                    <StatusPill status={selected.status} size="md" />
                    <OverflowMenu items={menuItems} />
                  </div>
                </div>

                <div className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
                    <div className="mx-auto w-full max-w-[860px] px-4 py-6 sm:px-6">
                      {actionError ? (
                        <p className="mb-5 rounded-xl border border-amber-200/25 bg-amber-200/10 px-4 py-3 text-xs text-amber-100">
                          {actionError}
                        </p>
                      ) : null}
                      {selectedEngagement && backendAccessToken ? (
                        <EngagementStatusRow
                          engagement={selectedEngagement}
                          accessToken={backendAccessToken}
                          onChange={(engagement) => {
                            setLiveThreads((current) => {
                              const thread = current[selected.id];
                              if (!thread) return current;
                              return { ...current, [selected.id]: { ...thread, engagement } };
                            });
                            setReloadNonce((value) => value + 1);
                          }}
                          onReview={() => void openEngagementReview(selectedEngagement)}
                        />
                      ) : null}
                      {pendingAction ? (
                        <section className={`mb-6 rounded-xl ${SURFACE} p-4`}>
                          <p className="text-sm font-semibold text-white/90">{pendingAction.panelTitle}</p>
                          {pendingAction.allowNote ? (
                            <textarea
                              value={pendingNote}
                              onChange={(event) => setPendingNote(event.target.value)}
                              rows={2}
                              placeholder={`Optional message to ${firstNameOf(selected.counterpartyName)}…`}
                              className="mt-3 w-full resize-none rounded-lg border border-white/[0.1] bg-black/20 px-3 py-2.5 text-[13px] leading-relaxed text-white/85 placeholder:text-white/35 focus:border-white/25 focus:outline-none"
                            />
                          ) : null}
                          <div className="mt-3 flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => applyStatusAction(selected, pendingAction, pendingNote)}
                              className={PRIMARY_BUTTON_CLASSES}
                            >
                              {pendingAction.confirmLabel}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setPendingActionKey(null);
                                setPendingNote("");
                              }}
                              className={GHOST_BUTTON_CLASSES}
                            >
                              Cancel
                            </button>
                          </div>
                        </section>
                      ) : null}

                      {conversation.length > 0 ? (
                        <div className="space-y-5">
                          {conversation.map((message) =>
                            message.kind === "status" ? (
                              <StatusUpdateLine key={message.id} message={message} />
                            ) : (
                              <MessageBubble
                                key={message.id}
                                message={message}
                                counterpartyAvatarUrl={selected.counterpartyAvatarUrl}
                                counterpartyHref={subtitle?.href ?? null}
                              />
                            )
                          )}
                        </div>
                      ) : (
                        <div className="flex min-h-[220px] flex-col items-center justify-center rounded-2xl border border-dashed border-white/[0.1] bg-white/[0.012] px-6 py-12 text-center">
                          <p className="text-sm font-medium text-white/55">No messages yet.</p>
                          <p className="mx-auto mt-1 max-w-xs text-xs text-white/40">
                            {selectedActive
                              ? "Start the conversation with a quick reply below."
                              : "There aren’t any messages on this thread yet."}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Composer / resolution — pinned to the foot of the conversation */}
                  <div className="shrink-0 border-t border-white/[0.06] px-4 py-3 sm:px-6">
                    <div className="mx-auto w-full max-w-[860px]">
                      {selectedArchived ? (
                        <div className="flex flex-col items-center gap-1.5 py-1 text-center sm:flex-row sm:justify-between sm:gap-3 sm:text-left">
                          <p className="text-xs text-white/50">{resolutionLine(selected)}</p>
                          {forward ? (
                            <Link
                              href={forward.href}
                              className="inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-white/70 transition-colors hover:text-white"
                            >
                              {forward.browseLabel}
                              <Icon name="external-link" className="h-3.5 w-3.5" />
                            </Link>
                          ) : null}
                        </div>
                      ) : selectedActive ? (
                        <div>
                          {replyTemplates.length > 0 ? (
                            <div className="mb-2 flex flex-wrap gap-1.5">
                              {replyTemplates.map((template) => (
                                <button
                                  key={`${selected.id}-template-${template.label}`}
                                  type="button"
                                  onClick={() => {
                                    setReplyDraft((prev) =>
                                      prev.trim() ? `${prev.trimEnd()} ${template.text}` : template.text
                                    );
                                    composerRef.current?.focus();
                                  }}
                                  className="inline-flex h-7 cursor-pointer items-center rounded-full border border-white/[0.08] bg-transparent px-2.5 text-[11px] font-medium text-white/55 transition-colors hover:bg-white/[0.05] hover:text-white/85"
                                >
                                  {template.label}
                                </button>
                              ))}
                            </div>
                          ) : null}
                          <div className="flex items-end gap-2 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-2 transition-colors focus-within:border-white/25">
                            <textarea
                              ref={composerRef}
                              value={replyDraft}
                              onChange={(event) => setReplyDraft(event.target.value)}
                              rows={1}
                              aria-label="Reply message"
                              placeholder={`Message ${firstNameOf(selected.counterpartyName)}…`}
                              className="max-h-32 min-h-[36px] flex-1 resize-none bg-transparent px-2 py-1.5 text-[13px] leading-relaxed text-white/85 placeholder:text-white/35 focus:outline-none"
                            />
                            <button
                              type="button"
                              aria-label="Send"
                              onClick={() => void handleSendReply(selected)}
                              disabled={!replyDraft.trim() || sending}
                              className={
                                replyDraft.trim() && !sending
                                  ? "inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-xl bg-white text-black transition-colors hover:bg-white/90"
                                  : "inline-flex h-9 w-9 shrink-0 cursor-not-allowed items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.02] text-white/30"
                              }
                            >
                              <Icon name="send" className="h-4 w-4" />
                            </button>
                          </div>
                          {sendError ? (
                            <p className="mt-1.5 text-[11px] text-rose-300/80">{sendError}</p>
                          ) : !liveMode ? (
                            <p className="mt-1.5 text-[11px] text-white/35">
                              Demo only — replies aren’t delivered yet.
                            </p>
                          ) : null}
                        </div>
                      ) : liveMode && selected && !selectedArchived ? (
                        <div className="flex items-center gap-2 py-1">
                          <Icon name="send" className="h-3.5 w-3.5 shrink-0 text-white/30" />
                          <p className="text-[11px] text-white/40">Loading conversation…</p>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 py-1">
                          <Icon name="send" className="h-3.5 w-3.5 shrink-0 text-white/30" />
                          <p className="text-[11px] text-white/40">
                            {selectedArchived
                              ? "This thread is closed to new messages."
                              : "Messaging will open up here once the thread is active."}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

              {/* Context + timeline rail. The context object is its own click target. */}
              <aside className="border-t border-white/[0.06] lg:min-h-0 lg:overflow-y-auto lg:border-t-0">
                  <div className="space-y-3 px-4 py-6 sm:px-6 lg:px-5">
                    {contextCard}
                    {showProposalInRail && selected.proposedTerms ? (
                      <section className={`rounded-2xl ${SURFACE} p-4`}>
                        <p className={SECTION_LABEL_CLASSES}>
                          {selected.direction === "sent" ? "Proposed rate" : "Offered rate"}
                        </p>
                        <div className="mt-2">
                          <ProposalCard terms={selected.proposedTerms} />
                        </div>
                      </section>
                    ) : null}
                    {selected.direction === "received" ? (
                      <PrivateNotesPanel
                        key={selected.id}
                        conversationId={selected.id}
                        counterpartyName={selected.counterpartyName}
                        seedNotes={seedNotesForInteraction(selected)}
                        onSaveLatest={(body) => persistLatestNote(selected, body)}
                      />
                    ) : null}
                    <section className={`rounded-2xl ${SURFACE} p-4`}>
                      <InteractionTimeline item={selected} />
                    </section>
                  </div>
              </aside>
            </div>
          ) : (
            <div className="hidden h-full items-center justify-center px-6 py-16 text-xs text-white/40 lg:flex">
              Nothing to review here yet.
            </div>
          )}
        </section>
      </div>
      )}

      {/* Bottom-right floating utilities: dev sample-data chip beside the chat
          dock so the two never overlap (the dock stays right-anchored). */}
      <div className="absolute bottom-4 right-4 z-40 flex items-end gap-2">
        {allowDemo ? <SampleDataChip demoMode={demoMode} onToggleDemo={onToggleDemo} /> : null}
        <CompactChatDock
          items={modeItems}
          mode={mode}
          liveMode={liveMode}
          backendAccessToken={backendAccessToken}
          unreadByThread={unreadByThread}
          openRequest={chatRequest}
          onDemoReply={appendDemoReply}
          onOpenInInbox={(id) => {
            setView("inbox");
            handleSelect(id);
          }}
        />
      </div>
      {backendAccessToken ? (
        <ReviewDialog
          open={Boolean(reviewOpportunity)}
          opportunity={reviewOpportunity}
          accessToken={backendAccessToken}
          onClose={() => setReviewOpportunity(null)}
          onSaved={(review) => {
            if (!reviewOpportunity || !selected) return;
            const reviewState = review.status === "submitted" ? "submitted" : "published";
            setLiveThreads((current) => {
              const thread = current[selected.id];
              if (!thread?.engagement) return current;
              return {
                ...current,
                [selected.id]: {
                  ...thread,
                  engagement: {
                    ...thread.engagement,
                    review_state: reviewState,
                    available_actions: review.status === "submitted" && review.editable ? ["edit_review"] : [],
                  },
                },
              };
            });
          }}
        />
      ) : null}
    </div>
  );
}
