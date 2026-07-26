"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Icon } from "../Icons";
import { InterviewCard, InterviewScheduler, type InterviewSubmission } from "./InterviewPanel";
import { consolidatedReminder, type ReminderSignals } from "../../lib/workReminders";
import { jobWorkloadSummaries, shouldShowJobSummaries } from "../../lib/jobWorkloadSummary";
import { caughtUpLine, emptyStateFor } from "../../lib/workspaceEmptyStates";
import {
  interviewFollowUpDue,
  interviewIsUpcoming,
  interviewNextStep,
  toInterview,
} from "../../lib/interviewScheduling";
import { MetaRow } from "../ui";
import FirstMessageSummary from "../first-message/FirstMessageSummary";
import PrivateNotesPanel from "./PrivateNotesPanel";
import { formatNoteTimestamp, type PrivateNote } from "../../lib/privateNotes";
import { purgeLegacyStorageKey, userStorageKey } from "../../lib/userScopedStorage";
import { usePortfolioDetailPopup } from "../profile/PortfolioDetailPopup";
import { formatListingTitle } from "../../lib/displayText";
import { useRealtimeMessaging, type RealtimeMessagingEvent } from "../../lib/realtimeMessaging";
import {
  buildUnreadByThread,
  formatBadgeCount,
  hasPendingLatestOutgoingReceipt,
  hasUnreadIncomingMessage,
  isMessagingClosedStatus,
  mapBackendMessage,
  reconcileMessageReceipt,
  shouldUseLiveApplicationsData,
  totalUnread,
  type ChatThreadMessage,
} from "../../lib/messaging";
import {
  filterStructuredPortfolioDuplicateAttachments,
  type FirstMessageAnswers,
  type RequirementContext,
} from "../../lib/firstMessageRequirements";
import {
  bulkUpdateApplicationStatus,
  bulkUpdateTalentInterestStatus,
  createApplicationPrivateNote,
  createTalentInterestPrivateNote,
  describeActionError,
  deleteApplicationPrivateNote,
  deleteTalentInterestPrivateNote,
  getActivitySummary,
  getApplicationConversation,
  getInterestConversation,
  getMyReviewWorkspace,
  isBackendAuthError,
  listApplicationPrivateNotes,
  cancelInterview,
  completeInterview,
  confirmInterview,
  listConversations,
  listInterviews,
  listLiveEngagements,
  proposeInterview,
  listTalentInterestPrivateNotes,
  markConversationRead,
  blockUser,
  listInteractionPreferences,
  markInteractionReviewStarted,
  setConversationSnooze,
  sendConversationMessage,
  setConversationQueueDismissed,
  setConversationStarred,
  setApplicationArchived,
  setTalentInterestArchived,
  communicateApplicationStatus,
  transitionApplicationStatus,
  transitionTalentInterestStatus,
  unblockUser,
  withdrawApplication,
  withdrawTalentInterest,
  type BackendJobApplication,
  BackendRequestError,
  type BackendConversation,
  type BackendMessage,
  type BackendEngagementSummary,
  type BackendInteractionPreference,
  type BackendInteractionPrivateNote,
  type BackendInterview,
  type BackendPortfolioItem,
  type BackendReviewOpportunity,
  type BackendTalentInterest,
} from "../../lib/backendClient";
import ConfirmDialog from "../ui/ConfirmDialog";
import {
  interactionKindLabel,
  interactionStatusFromBackend,
  interactionStatusLabel,
  isArchivedInteraction,
  mapActivityToOwnerInteractions,
  type InteractionKind,
  type InteractionStatus,
  type InteractionJobSnapshot,
  type InteractionTalentSnapshot,
  type OwnerInteraction,
} from "../../lib/ownerInteractions";
import {
  backendStatusOf,
  deriveWorkState,
  directionLabelsFor,
  nextBestActionFor,
  pipelineContextLabelOf,
  pipelineSummaryOf,
  stageNotifyPolicyOf,
  stageTargetsFor,
  validStageTargetsFor,
  type NextBestAction,
  type PipelineStage,
  type WorkSignals,
  type WorkState,
} from "../../lib/applicationPipeline";
import { workspaceFlagsFromEnv } from "../../lib/workspaceFlags";
import { intentsFor } from "../../lib/messageIntents";
import { AbsoluteTimeOnFocus, InteractionTime } from "./InteractionTime";
import { ClientContextSummary } from "./CreatorContext";
import { PaymentStateCard } from "./PaymentStateCard";
import { creatorViewOf } from "../../lib/creatorProjection";
import { groupThreadEntries } from "../../lib/systemEventGrouping";
import { pipelineStagesFor } from "../../lib/applicationPipeline";
import {
  NO_QUEUE_PREFERENCES,
  WORK_QUEUE_ORDER,
  deriveWorkQueue,
  type QueueSignals,
  type WorkQueueKey,
  type WorkQueuePreferences,
} from "../../lib/workQueues";
import {
  flagCohortLabel,
  trackWorkspaceEvent,
  type WorkspaceEventPayload,
} from "../../lib/workspaceAnalytics";
import CompactChatDock from "./CompactChatDock";
import {
  ApplicationsWorkspaceNavigation,
  DEFAULT_MODE_OPTIONS,
  InteractionScopeControl,
  SampleDataChip,
  type WorkspaceFilter,
  type WorkspaceMode,
  type WorkspaceModeOption,
  type WorkspaceView,
} from "./WorkspaceNavigation";
import PipelineBoard from "./PipelineBoard";
import EngagementStatusRow from "../reviews/EngagementStatusRow";
import ReviewDialog from "../reviews/ReviewDialog";

type PipelineDirection = "received" | "sent";
type LiveThread = {
  conversationId: string;
  messages: BackendMessage[];
  conversation?: BackendConversation;
  engagement?: BackendEngagementSummary | null;
  /** The arranged interview, if one exists. Both participants may read it. */
  interview?: BackendInterview | null;
};

const UNREAD_POLL_INTERVAL_MS = 5_000;
const CONVERSATION_POLL_INTERVAL_MS = 3_000;

type ApplicationsWorkspaceProps = {
  mode: WorkspaceMode;
  modeOptions?: WorkspaceModeOption[];
  onModeChange?: (mode: WorkspaceMode) => void;
  /** Prevent SSR controls from accepting clicks before saved state is restored. */
  controlsReady?: boolean;
  allowDemo?: boolean;
  demoMode?: boolean;
  onToggleDemo?: () => void;
  interactions?: OwnerInteraction[];
  backendAccessToken?: string;
  /** Backend user id of the signed-in account; scopes persisted client state. */
  backendUserId?: string;
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
  icon: "check" | "x" | "send" | "bookmark" | "clock";
  primary?: boolean;
  destructive?: boolean;
  flow: "instant" | "confirm" | "reply" | "notify" | "archive";
  backendStatus?: string;
  nextStatus?: InteractionStatus;
  eventLabel?: string;
  panelTitle?: string;
  confirmLabel?: string;
  allowNote?: boolean;
  archiveValue?: boolean;
  menuGroup?:
    | "Choose current stage"
    | "Manage privately"
    | "Share a decision"
    | "Thread"
    | "Relationship"
    // Personal organisation: quietens a recommendation, never the relationship.
    | "Just for you"
    | "Safety";
};

function EmptyModeState({
  mode,
  otherModeLabel,
  otherModeCount,
  otherModeUnread,
  onSwitchMode,
}: {
  mode: WorkspaceMode;
  otherModeLabel?: string;
  otherModeCount: number;
  otherModeUnread: number;
  onSwitchMode?: () => void;
}) {
  const isTalent = mode === "talent";
  const showOtherModeHint = Boolean(onSwitchMode && otherModeLabel && otherModeCount > 0);
  return (
    <div
      className="flex h-full min-h-[260px] items-center justify-center px-6 py-12"
      data-testid={`applications-empty-${mode}`}
    >
      <div className="max-w-md text-center">
        <p className="text-base font-semibold text-white/90">
          {isTalent ? "No applications yet." : "No hiring activity yet."}
        </p>
        <p className="mx-auto mt-2 text-sm leading-6 text-white/55">
          {isTalent
            ? "When you apply to jobs or receive hiring requests, they’ll appear here."
            : "Applications to your jobs and requests you send to talent will appear here."}
        </p>
        {showOtherModeHint ? (
          <div
            data-testid="inbox-other-mode-hint"
            className="mx-auto mt-5 flex flex-col items-center gap-2.5 rounded-2xl border border-line bg-raised px-4 py-3.5"
          >
            <p className="text-sm text-white/75">
              {otherModeUnread > 0 ? (
                <>
                  You have <span className="font-semibold text-white">{otherModeUnread} unread</span> in your{" "}
                  {otherModeLabel} conversations.
                </>
              ) : (
                <>
                  You have <span className="font-semibold text-white">{otherModeCount}</span>{" "}
                  {otherModeCount === 1 ? "conversation" : "conversations"} on your {otherModeLabel} side.
                </>
              )}
            </p>
            <button
              type="button"
              data-testid="inbox-other-mode-switch"
              onClick={onSwitchMode}
              className={PRIMARY_BUTTON_CLASSES}
            >
              Switch to {otherModeLabel}
            </button>
          </div>
        ) : null}
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
          <Link
            href={isTalent ? "/jobs" : "/post-job"}
            className={showOtherModeHint ? GHOST_BUTTON_CLASSES : PRIMARY_BUTTON_CLASSES}
          >
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

// Dedicated full-page workspace: the route wrapper already sits below the fixed
// global top bar, so the inbox owns the full remaining vertical canvas.
const WORKSPACE_HEIGHT_CLASSES = "h-full min-h-0";
const SECTION_LABEL_CLASSES = "text-[11px] font-semibold text-subtle";
const SURFACE = "border border-line bg-raised";
/** localStorage key for the last-open inbox conversation (restored on return). */
const SELECTED_STORAGE_KEY = "cj.applications.selected";
/** Per-user record of decision-surface dismissals. */
const DECISION_STRIP_DISMISS_KEY = "cj.applications.decisionDismissed";
/**
 * Bump when the triggering rules change so previously dismissed records are
 * offered the surface again under the new rules, rather than staying silent
 * forever on a decision that no longer means the same thing.
 */
const DECISION_STRIP_TRIGGER_VERSION = 1;
const GHOST_BUTTON_CLASSES =
  "inline-flex h-9 cursor-pointer items-center justify-center rounded-xl border border-line-mid bg-raised px-3.5 text-xs font-semibold text-white/80 transition-colors hover:bg-overlay";
const PRIMARY_BUTTON_CLASSES =
  "inline-flex h-9 cursor-pointer items-center justify-center rounded-xl bg-white px-3.5 text-xs font-semibold text-black transition-colors hover:bg-white/90";

function statusPillClasses(status: InteractionStatus): string {
  switch (status) {
    case "new":
      return "border-line-strong bg-overlay text-white/92";
    case "pending":
    case "viewed":
      return "border-line-mid bg-raised text-white/62";
    case "responded":
    case "shortlisted":
    case "accepted":
      return "border-emerald-200/30 bg-emerald-200/[0.08] text-emerald-100/90";
    case "hired":
      return "border-emerald-300/45 bg-emerald-300/[0.16] text-emerald-50";
    case "declined":
    case "withdrawn":
    case "closed":
      return "border-line bg-transparent text-subtle";
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
      className={`${sizeClasses} ${radius} relative inline-flex shrink-0 items-center justify-center overflow-hidden border border-line-mid bg-elevated text-[11px] font-semibold text-white/75`}
    >
      {avatarInitials(name)}
      {src ? <img src={src} alt="" className="absolute inset-0 h-full w-full object-cover" /> : null}
    </span>
  );
}

function firstNameOf(name: string): string {
  return name.split(/\s+/)[0] || name;
}

/**
 * The one line of the conversation worth previewing.
 *
 * The row used to show the opportunity title twice — once as the subtitle and
 * once inside the snippet slot — which is why every row read as two labels and
 * no content. This returns the actual last thing said.
 */
function rowSnippet(item: OwnerInteraction): string {
  const last = item.replies?.at(-1)?.body || item.response?.body || item.message;
  return (last || "").replace(/\s+/g, " ").trim();
}

/** The stage's dot, from the shared taxonomy rather than a local colour map. */
function statusDotClass(item: OwnerInteraction): string {
  const current = backendStatusOf(item);
  const stage = pipelineStagesFor(item.kind, item.direction).find(
    (entry: PipelineStage) => entry.key === current
  );
  return stage?.dot ?? "bg-white/40";
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
  const name = firstNameOf(item.counterpartyName);
  if (isArchivedInteraction(item) && !item.legacyArchiveResolutionRequired) {
    return [
      {
        key: "unarchive",
        label: "Unarchive",
        icon: "bookmark",
        flow: "archive",
        archiveValue: false,
        menuGroup: "Thread",
      },
    ];
  }
  const reply: HeaderAction = { key: "reply", label: `Reply to ${name}`, icon: "send", flow: "reply" };
  const currentStatus = backendStatusOf(item);

  if (item.kind === "application" && item.direction === "sent") {
    if (!["new", "reviewing", "shortlisted", "interviewing"].includes(currentStatus)) {
      return live ? [] : [reply];
    }
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
      menuGroup: "Relationship",
    };
    // Live threads already expose the persistent composer, so the overflow only
    // needs the sender-owned relationship action.
    if (live) return [withdraw];
    return [reply, withdraw];
  }
  if (item.direction === "received") {
    const actions = validStageTargetsFor(
      item.kind,
      currentStatus,
      item.participantBackendStatus,
      item.legacyArchiveResolutionRequired
    ).map<HeaderAction>((stage) => {
      const labels: Record<string, string> = {
        new: "Move to New",
        reviewing: "Move to Reviewing",
        shortlisted: "Shortlist privately",
        interviewing: "Move to Interviewing",
        hired: "Hire",
        rejected: "Not selected",
        accepted: "Accept request",
        declined: "Decline request",
        archived: "Archive",
      };
      const confirm = ["hired", "rejected", "accepted", "declined", "archived"].includes(stage.key);
      const destructive = ["rejected", "declined"].includes(stage.key);
      const panelTitles: Record<string, string> = {
        hired: "Hire this candidate?",
        rejected: "Mark this application as not selected?",
        accepted: "Accept this hiring request?",
        declined: "Decline this hiring request?",
        archived: "Archive this thread?",
      };
      const confirmLabels: Record<string, string> = {
        hired: "Confirm hire",
        rejected: "Confirm not selected",
        accepted: "Confirm acceptance",
        declined: "Confirm decline",
        archived: "Archive",
      };
      return {
        key: `stage-${stage.key}`,
        label: labels[stage.key] ?? `Move to ${stage.label}`,
        icon: destructive ? "x" : stage.key === "archived" ? "bookmark" : "check",
        primary: ["hired", "accepted"].includes(stage.key),
        destructive,
        flow: confirm ? "confirm" : "instant",
        backendStatus: stage.key,
        nextStatus: interactionStatusFromBackend(item.kind, item.direction, stage.key),
        eventLabel: `${stage.label} by you`,
        panelTitle: panelTitles[stage.key],
        confirmLabel: confirmLabels[stage.key],
        // A note is only offered where this action actually tells the other
        // side something. Hiring-request outcomes share the moment they are
        // recorded, so the confirmation is the only chance to explain them.
        // An application's "not selected" is private at this point — its note
        // belongs to the separate "share a decision" step, not here, or it
        // would be collected and then never sent.
        allowNote: live
          ? item.kind === "hiring_request" && destructive
          : destructive,
        menuGroup: item.legacyArchiveResolutionRequired
          ? "Choose current stage"
          : stage.notify?.automatic
            ? "Share a decision"
            : "Manage privately",
      };
    });
    actions.sort((left, right) => {
      const rank = (action: HeaderAction) => action.menuGroup === "Manage privately" ? 0 : 1;
      return rank(left) - rank(right);
    });
    if (
      !item.legacyArchiveResolutionRequired &&
      item.kind === "application" &&
      ["shortlisted", "rejected"].includes(currentStatus) &&
      item.participantBackendStatus !== currentStatus
    ) {
      actions.push({
        key: `notify-${currentStatus}`,
        label: `Share decision with ${name}`,
        icon: "send",
        flow: "notify",
        backendStatus: currentStatus,
        menuGroup: "Share a decision",
      });
    }
    if (!item.legacyArchiveResolutionRequired) {
      actions.push({
        key: "archive",
        label: "Archive",
        icon: "bookmark",
        flow: "archive",
        archiveValue: true,
        menuGroup: "Thread",
      });
    }
    if (!live) actions.push(reply);
    return actions;
  }
  if (!["new", "reviewing"].includes(currentStatus)) return live ? [] : [reply];
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
    menuGroup: "Relationship",
  };
  // Live threads already expose the persistent composer; keep the overflow for
  // the sender-owned withdrawal action.
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

type OverflowMenuItem = Pick<HeaderAction, "key" | "label" | "icon" | "primary" | "destructive" | "menuGroup"> & {
  onClick: () => void;
  disabled?: boolean;
};

function OverflowMenu({ items }: { items: OverflowMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="group/action relative inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-xl border border-line-mid bg-raised text-white/75 transition-colors hover:bg-overlay hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
      >
        <Icon name="menu" className="h-4 w-4" />
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+8px)] z-30 min-w-48 rounded-2xl border border-line-mid bg-[#111216] p-1.5 shadow-[0_24px_70px_-34px_rgba(0,0,0,1)]"
        >
          {items.length ? (
            items.map((item, index) => {
              const showGroup = item.menuGroup && item.menuGroup !== items[index - 1]?.menuGroup;
              return (
                <Fragment key={item.key}>
                  {showGroup ? (
                    <p className="px-2.5 pb-1 pt-2 text-[11px] font-semibold text-subtle">
                      {item.menuGroup}
                    </p>
                  ) : null}
                  <button
                    type="button"
                    role="menuitem"
                    disabled={item.disabled}
                onClick={() => {
                  if (item.disabled) return;
                  setOpen(false);
                  triggerRef.current?.focus();
                  item.onClick();
                }}
                    className={[
                      "flex h-9 w-full items-center gap-2 rounded-xl px-2.5 text-left text-xs font-semibold transition-colors",
                      item.disabled
                        ? "cursor-not-allowed text-disabled"
                        : item.primary
                        ? "text-white hover:bg-overlay"
                        : item.destructive
                          ? "text-rose-200/80 hover:bg-rose-300/10 hover:text-rose-100"
                          : "text-white/72 hover:bg-elevated hover:text-white",
                    ].join(" ")}
                  >
                    <Icon name={item.icon} className="h-3.5 w-3.5" />
                    <span>{item.label}</span>
                  </button>
                </Fragment>
              );
            })
          ) : (
            <p className="px-3 py-2 text-xs text-subtle">No actions available.</p>
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
  // The structured terms replace the raw budget string in place. The card
  // already owned the one rate line on this screen; making it the projection's
  // headline means the rate carries its unit without a second copy appearing
  // somewhere else.
  const { terms } = creatorViewOf({ job });
  const payIcon = terms.structure === "retainer" ? "briefcase" : "cash-stack";
  const displayTitle = formatListingTitle(job.title);
  const body = (
    <div className="relative">
      {href ? (
        <Icon
          name="external-link"
          className="absolute right-0 top-0 h-3.5 w-3.5 text-subtle opacity-0 transition-opacity group-hover:opacity-100"
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
        {/*
          Pay, then experience, then location — the card's documented anatomy,
          asserted by inboxTalentContextCard. Phase 3 replaced the raw budget
          string with the structured headline so the rate carries its unit; it
          also briefly added turnaround and trial rows here, which was scope
          creep against a deliberate design and is not reinstated. Turnaround
          already appears on the rows and cards via CreatorFitSummary.
        */}
        <MetaRow icon={payIcon} text={terms.headline} />
        {job.experience ? <MetaRow icon="cap" text={job.experience} /> : null}
        {job.location ? <MetaRow icon="pin" text={job.location} /> : null}
      </div>
    </div>
  );
  const cls = "block rounded-2xl border border-line bg-elevated p-4";
  return href ? (
    <Link
      href={href}
      className={`group ${cls} cursor-pointer transition-colors hover:border-line-strong hover:bg-overlay focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20`}
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
          className="absolute right-0 top-0 h-3.5 w-3.5 text-subtle opacity-0 transition-opacity group-hover:opacity-100"
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
  const cls = "block rounded-2xl border border-line bg-elevated p-4";
  return href ? (
    <Link
      href={href}
      className={`group ${cls} cursor-pointer transition-colors hover:border-line-strong hover:bg-overlay focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20`}
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
          const isLatest = index === item.timeline.length - 1 && !event.superseded;
          return (
            <li key={event.id} className="relative pb-3 pl-5 last:pb-0">
              <span
                className={[
                  "absolute left-0 top-[5px] h-1.5 w-1.5 rounded-full",
                  isLatest ? "bg-white/90" : "bg-white/40",
                ].join(" ")}
              />
              {!isLatest ? (
                <span className="absolute bottom-0 left-[2.5px] top-3.5 w-px bg-overlay" />
              ) : null}
              {/*
                A superseded private decision is struck rather than removed: it
                genuinely happened, and a manager may need to know it did, but
                presenting it level with the outcome that replaced it is how the
                timeline came to read "Interviewing → Not selected → Hired" as
                three simultaneous truths.
              */}
              <p
                className={[
                  "text-xs",
                  event.superseded
                    ? "text-subtle line-through decoration-white/25"
                    : isLatest
                      ? "text-default"
                      : "text-muted",
                ].join(" ")}
              >
                {event.label}
                {event.superseded ? (
                  <span className="ml-1.5 align-middle text-[10.5px] no-underline text-subtle">
                    superseded
                  </span>
                ) : null}
              </p>
              <InteractionTime value={event.occurredAt} className="mt-0.5 block text-[11px] text-subtle" />
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
      <Icon name="cash" className="h-4 w-4 shrink-0 text-subtle" />
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
  /** ISO instant. Formatted by <InteractionTime> at the point it is drawn. */
  createdAt?: string | null;
  readByRecipient?: boolean;
  /**
   * "status" renders as a centered platform update line; "screening" renders the
   * automated screening-question message natively from its structured snapshot.
   */
  kind?: "status" | "screening";
  /** Structured snapshot for the automated screening-question message. */
  screening?: ChatThreadMessage["screening"];
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
    createdAt: item.createdAt,
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
      createdAt: item.createdAt,
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
      createdAt: item.response.sentAt,
    });
  }
  (item.replies || []).forEach((reply, index) => {
    messages.push({
      id: `${item.id}-reply-${index}`,
      fromMe: reply.from === "You",
      senderName: reply.from,
      body: reply.body,
      createdAt: reply.sentAt,
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
/**
 * The one restrained "what does this need from me?" label on a row or card.
 *
 * Deliberately quiet: it is presentation over authoritative data and must never
 * read like a lifecycle status. Low-confidence states stay descriptive
 * ("Review latest message") instead of prescriptive, so the indicator never
 * claims more than the evidence supports. Colour is never the only signal — the
 * text carries the meaning on its own.
 */
/**
 * How each work state looks and reads.
 *
 * The icon is the point: "needs your reply" and "waiting on them" are opposite
 * facts that a reader should be able to tell apart without finishing the
 * sentence. Colour is never the only signal — every chip still carries its
 * words — but a consistent mark per state is what makes a list of forty
 * scannable instead of readable.
 */
const WORK_STATE_STYLE: Record<
  WorkState["key"],
  { icon: Parameters<typeof Icon>[0]["name"]; tone: string }
> = {
  needs_review: { icon: "eye", tone: "text-state-new" },
  decision_not_shared: { icon: "send", tone: "text-state-hold" },
  start_confirmation_pending: { icon: "circle-play", tone: "text-state-agreed" },
  interview_confirmation: { icon: "calendar-check", tone: "text-state-interview" },
  interview_follow_up: { icon: "calendar-clock", tone: "text-state-interview" },
  needs_reply: { icon: "send", tone: "text-state-review" },
  review_latest: { icon: "message-text", tone: "text-muted" },
};

function WorkStateChip({ state }: { state: WorkState }) {
  const style = WORK_STATE_STYLE[state.key];
  return (
    <span
      data-testid="work-state-chip"
      data-work-state={state.key}
      className={[
        // Fully rounded and borderless, so a state never reads as a control.
        "inline-flex shrink-0 items-center gap-1 rounded-full border-0 px-2 py-0.5 text-[10.5px] font-medium",
        state.highConfidence ? `bg-wash-strong ${style.tone}` : "bg-transparent text-muted",
      ].join(" ")}
    >
      <Icon name={style.icon} className="h-2.5 w-2.5 shrink-0" aria-hidden="true" />
      {state.label}
    </span>
  );
}

/**
 * The decision surface: the single place a manager picks what happens next.
 *
 * It serves two entry points so there is only ever one such surface to learn —
 * it opens automatically on the first deliberate open of an eligible record, and
 * on demand from the neutral "Choose next step" / "Record decision" actions.
 *
 * Rules it must honour (all covered by e2e):
 *  - it is rendered *above* the composer in normal flow, never over it, so
 *    messaging is always reachable;
 *  - it never takes focus, so typing is never interrupted;
 *  - dismissing it is free and remembered for that trigger;
 *  - it collapses after a meaningful action, but not merely because the
 *    composer gained focus.
 */
function DecisionStrip({
  item,
  targets,
  headline,
  onPick,
  onAskQuestion,
  onDismiss,
}: {
  item: OwnerInteraction;
  targets: PipelineStage[];
  headline: string;
  onPick: (stageKey: string) => void;
  onAskQuestion: () => void;
  onDismiss: () => void;
}) {
  return (
    <section
      data-testid="decision-strip"
      aria-label={`Next step for ${item.counterpartyName}`}
      className="ui-rise surface-elevated mb-2.5 rounded-2xl border border-line-mid px-3.5 py-3 elev-3"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="flex items-center gap-2 text-[12.5px] font-semibold text-ink">
          <Icon name="sparkles" className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden="true" />
          {headline}
        </p>
        <button
          type="button"
          data-testid="decision-strip-dismiss"
          onClick={onDismiss}
          aria-label="Dismiss next-step suggestions"
          className="-mr-1 -mt-0.5 inline-flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-lg text-white/60 transition-colors hover:bg-elevated hover:text-white"
        >
          <Icon name="x" className="h-3 w-3" />
        </button>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {targets.map((stage) => (
          <button
            key={stage.key}
            type="button"
            data-testid={`decision-strip-option-${stage.key}`}
            onClick={() => onPick(stage.key)}
            className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-line-mid bg-raised px-2.5 text-[11.5px] font-semibold text-default transition-all elev-1 hover:border-line-strong hover:bg-overlay hover:text-ink"
          >
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${stage.dot}`} aria-hidden="true" />
            {decisionActionLabel(item, stage.key, stage.label)}
          </button>
        ))}
        {/* Messaging is a first-class choice here, never a fallback. */}
        <button
          type="button"
          data-testid="decision-strip-ask"
          onClick={onAskQuestion}
          className="inline-flex h-8 cursor-pointer items-center rounded-lg px-2.5 text-[11.5px] font-medium text-muted transition-colors hover:bg-wash hover:text-ink"
        >
          Ask a question
        </button>
      </div>
    </section>
  );
}

/** Action-voice labels ("Invite to interview"), not state names ("Interviewing"). */
function decisionActionLabel(item: OwnerInteraction, stageKey: string, fallback: string): string {
  const name = firstNameOf(item.counterpartyName);
  const labels: Record<string, string> = {
    reviewing: "Start reviewing",
    shortlisted: "Keep in mind",
    interviewing: "Invite to interview",
    hired: `Hire ${name}`,
    rejected: "Not proceeding",
    accepted: "Accept request",
    declined: "Decline request",
    archived: "Archive",
    new: "Move to New",
  };
  return labels[stageKey] ?? fallback;
}

/**
 * A collapsed run of consecutive system events.
 *
 * The right-hand Timeline stays the complete authoritative history; this is a
 * summary in the thread, so human messages are not buried under platform
 * chrome. Native `<details>`/`<summary>`: it is keyboard-operable with Enter and
 * Space, carries expanded/collapsed semantics for free, and needs no state of
 * its own.
 */
function SystemEventGroup({
  summary,
  events,
}: {
  summary: string;
  events: ChatMessage[];
}) {
  return (
    <details data-testid="system-event-group" className="group flex justify-center px-2">
      <summary
        data-testid="system-event-summary"
        className="mx-auto inline-flex max-w-full cursor-pointer list-none items-center gap-2 rounded-full border border-line bg-wash px-3.5 py-1.5 text-[11.5px] leading-relaxed text-white/60 transition-colors hover:border-line-mid hover:text-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus [&::-webkit-details-marker]:hidden"
      >
        <Icon name="sparkles" className="h-3 w-3 shrink-0 text-subtle" aria-hidden="true" />
        <span className="min-w-0 truncate">{summary}</span>
        <Icon
          name="chevron-right"
          className="h-3 w-3 shrink-0 text-subtle transition-transform group-open:rotate-90"
          aria-hidden="true"
        />
      </summary>
      {/*
        The events themselves, in order. Not the whole Timeline — only this run,
        which is what the summary is standing in for.
      */}
      <ol className="mx-auto mt-2 max-w-[440px] space-y-1.5 rounded-xl border border-line bg-wash px-3.5 py-2.5">
        {events.map((event) => (
          <li key={event.id} className="flex items-baseline gap-2 text-[11.5px] text-muted">
            <span className="min-w-0 flex-1">{event.body}</span>
            <InteractionTime value={event.createdAt} className="shrink-0 text-[11px] text-subtle" />
          </li>
        ))}
      </ol>
    </details>
  );
}

export function StatusUpdateLine({ message }: { message: Pick<ChatMessage, "body" | "createdAt"> }) {
  return (
    <div data-testid="chat-status-update" className="flex justify-center px-2">
      <span className="inline-flex max-w-full items-center gap-2 rounded-full border border-line bg-wash px-3.5 py-1.5 text-[11.5px] leading-relaxed text-white/60">
        <Icon name="sparkles" className="h-3 w-3 shrink-0 text-subtle" />
        <span className="min-w-0">{message.body}</span>
        <InteractionTime value={message.createdAt} prefix="· " className="shrink-0 text-subtle" />
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
  errorMessage,
  note,
  onNoteChange,
  onSend,
  onDismiss,
  onFollowUp,
}: {
  items: OwnerInteraction[];
  stageKey: string;
  phase: "ask" | "sending" | "sent" | "error";
  liveMode: boolean;
  errorMessage?: string;
  note?: string;
  onNoteChange?: (next: string) => void;
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
          className="-mr-1 -mt-1 inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted transition-colors hover:bg-elevated hover:text-white"
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
              className="inline-flex h-8 cursor-pointer items-center rounded-lg border border-line-mid bg-raised px-3 text-[11px] font-semibold text-white/80 transition-colors hover:bg-overlay"
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
            className="mt-3 inline-flex max-w-full items-center gap-2 rounded-full border border-line bg-wash px-3 py-1.5 text-[11.5px] text-white/60"
          >
            <Icon name="sparkles" className="h-3 w-3 shrink-0 text-subtle" />
            <span className="min-w-0">{preview}</span>
          </p>
          {/*
            Live mode only: the note is persisted by the same request that
            shares the decision. In demo mode there is no such request, so
            offering the field would promise a delivery that cannot happen.
          */}
          {liveMode && onNoteChange ? (
            <textarea
              data-testid="stage-notify-note"
              value={note ?? ""}
              onChange={(event) => onNoteChange(event.target.value)}
              disabled={phase === "sending"}
              rows={2}
              maxLength={2000}
              placeholder={`Add a note for ${single ? firstNameOf(single.counterpartyName) : "them"} (optional)`}
              className="mt-2.5 w-full resize-none rounded-xl border border-line bg-raised px-3 py-2 text-[12px] text-white outline-none transition-colors placeholder:text-subtle focus:border-line-strong focus:bg-elevated disabled:opacity-50"
            />
          ) : null}
          {phase === "error" ? (
            <p className="mt-2 text-[11px] text-rose-300/80" data-testid="stage-notify-error">
              {errorMessage ?? "Couldn’t post the update — try again."}
            </p>
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
              className="inline-flex h-8 cursor-pointer items-center rounded-lg border border-line-mid bg-raised px-3 text-[11px] font-semibold text-white/70 transition-colors hover:bg-overlay hover:text-white"
            >
              Skip
            </button>
            <span className="text-[10.5px] text-subtle">
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
    : "border border-line bg-wash text-white/70 hover:bg-elevated";
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

function ScreeningQuestionsCard({ message }: { message: ChatMessage }) {
  const questions = message.screening?.questions ?? [];
  return (
    <div
      className={[
        "min-w-0 rounded-2xl rounded-bl-md border border-line bg-raised px-3.5 py-3",
        "shadow-[0_8px_24px_-20px_rgba(0,0,0,0.9)]",
      ].join(" ")}
    >
      <div className="flex items-center gap-1.5 text-[11.5px] font-semibold text-secondary">
        <Icon name="message-square-text" className="h-3.5 w-3.5 opacity-70" />
        <span>Screening questions</span>
      </div>
      <p className="mt-0.5 text-[11px] text-subtle">Sent automatically after the application</p>
      {questions.length ? (
        <ol className="mt-2.5 space-y-2">
          {questions.map((question, index) => (
            <li key={question.id || index} className="flex min-w-0 gap-2 text-[13px] leading-relaxed text-white/85">
              <span className="shrink-0 tabular-nums text-muted">{index + 1}.</span>
              <span className="min-w-0">
                <span className="whitespace-pre-line break-words">{question.prompt}</span>
                {question.required ? (
                  <span className="ml-1.5 align-middle text-[11px] font-medium text-state-interview">
                    Required
                  </span>
                ) : null}
                {question.response_guidance ? (
                  <span className="mt-0.5 block text-[11px] leading-relaxed text-muted">{question.response_guidance}</span>
                ) : null}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-2 whitespace-pre-line break-words text-[13px] leading-relaxed text-white/82">{message.body}</p>
      )}
      <p className="mt-2.5 text-[11px] text-subtle">Reply in this conversation with your answers.</p>
    </div>
  );
}

export function MessageBubble({
  message,
  counterpartyAvatarUrl,
  counterpartyHref,
  showSeen = false,
}: {
  message: ChatMessage;
  counterpartyAvatarUrl?: string | null;
  counterpartyHref?: string | null;
  /** Only the latest outgoing bubble displays a restrained receipt. */
  showSeen?: boolean;
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
        <p className="px-1 text-[11px] font-medium text-subtle">
          {message.senderName} <InteractionTime value={message.createdAt} prefix="· " />
        </p>
        {message.kind === "screening" ? (
          <ScreeningQuestionsCard message={message} />
        ) : message.body || message.rate || (message.attachments && message.attachments.length > 0) ? (
          <div
            className={[
              "min-w-0 px-3.5 py-2.5 text-[13px] leading-relaxed shadow-[0_8px_24px_-20px_rgba(0,0,0,0.9)]",
              me
                ? "rounded-2xl rounded-br-md bg-white/[0.13] text-white/92"
                : "rounded-2xl rounded-bl-md border border-line bg-raised text-white/82",
            ].join(" ")}
          >
            {message.body ? <p className="whitespace-pre-line break-words">{message.body}</p> : null}
            {message.rate ? (
              <p
                className={[
                  "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs",
                  message.body ? "mt-2.5" : "",
                  me ? "bg-black/20 text-white/82" : "border border-line bg-wash text-white/72",
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
        {showSeen ? <p className="px-1 text-[10.5px] font-medium text-subtle">Seen</p> : null}
        {portfolioPopup.popover}
      </div>
    </div>
  );
}

export default function ApplicationsWorkspace({
  mode,
  modeOptions = DEFAULT_MODE_OPTIONS,
  onModeChange,
  controlsReady = true,
  allowDemo = false,
  demoMode = false,
  onToggleDemo,
  interactions,
  backendAccessToken,
  backendUserId,
  forceMock = false,
  initialSelectedId = null,
  view: viewProp,
  onViewChange,
  pipelineDirection: pipelineDirectionProp,
  onPipelineDirectionChange,
  pipelineStage = null,
  onPipelineStageChange,
}: ApplicationsWorkspaceProps) {
  // Authenticated application data always comes from the real backend. Public
  // marketplace mock browsing must not hide a newly persisted private Inbox.
  // The explicit sample-data control remains the only way to opt into demo rows.
  const liveMode = shouldUseLiveApplicationsData(backendAccessToken, forceMock);
  const [items, setItems] = useState<OwnerInteraction[]>(() =>
    // Sample rows arrive as a prop, from the canonical scenario manifests. The
    // workspace holds no dataset of its own: it used to fall back to a
    // hand-written fixture, which is precisely the second corpus that drifted
    // out of step with the backend and that Phase 4 exists to remove. An empty
    // list here means the manifest has not arrived yet, and the caller remounts
    // on arrival.
    liveMode ? [] : interactions ?? []
  );
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error" | "auth">(liveMode ? "loading" : "ready");
  const [reloadNonce, setReloadNonce] = useState(0);
  // Real message threads loaded per interaction in live mode (keyed by record id ==
  // OwnerInteraction id). Demo mode keeps using the in-memory `replies` on the item.
  const [liveThreads, setLiveThreads] = useState<
    Record<string, LiveThread>
  >({});
  const [threadLoadErrors, setThreadLoadErrors] = useState<Record<string, boolean>>({});
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  // Unread message count per inbox thread (keyed by record id == OwnerInteraction id),
  // sourced from the real GET /me/conversations endpoint in live mode.
  const [unreadByThread, setUnreadByThread] = useState<Record<string, number>>({});
  /**
   * Interaction id → conversation id for *every* thread, not only the opened
   * ones. Queues and personal organisation are list-wide questions, so they
   * cannot depend on a record having been opened first.
   */
  const [conversationIdByThread, setConversationIdByThread] = useState<Record<string, string>>({});
  /**
   * Interaction id → epoch ms of the last message. The only real timestamp the
   * list has: `OwnerInteraction` carries humanised labels ("2 days ago"), which
   * cannot be compared against a threshold.
   */
  const [lastActivityByThread, setLastActivityByThread] = useState<Record<string, number>>({});
  const [typingByConversation, setTypingByConversation] = useState<
    Record<string, { senderUserId: string; expiresAt: number }>
  >({});
  const typingTimersRef = useRef<Record<string, number>>({});
  const readInFlightRef = useRef<Set<string>>(new Set());
  const [realtimeRefreshNonce, setRealtimeRefreshNonce] = useState(0);
  const handleThreadRead = useCallback((id: string) => {
    setUnreadByThread((prev) => {
      if (!prev[id]) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);
  const handleRealtimeEvent = useCallback((event: RealtimeMessagingEvent) => {
    if (event.type === "connected") {
      // A reconnect may have missed persisted events; the existing HTTP loaders
      // reconcile authoritative history without dropping the low-latency path.
      setRealtimeRefreshNonce((value) => value + 1);
      return;
    }
    if (event.type === "conversation.unread") {
      setUnreadByThread((previous) => {
        if (event.unread_count <= 0) {
          if (!previous[event.thread_id]) return previous;
          const next = { ...previous };
          delete next[event.thread_id];
          return next;
        }
        return { ...previous, [event.thread_id]: event.unread_count };
      });
      setLiveThreads((previous) => {
        const thread = previous[event.thread_id];
        if (!thread || thread.conversationId !== event.conversation_id || !thread.conversation) {
          return previous;
        }
        return {
          ...previous,
          [event.thread_id]: {
            ...thread,
            conversation: { ...thread.conversation, unread_count: event.unread_count },
          },
        };
      });
      return;
    }
    if (event.type === "message.created") {
      setLiveThreads((previous) => {
        const existing = previous[event.thread_id];
        if (!existing || existing.conversationId !== event.conversation_id) return previous;
        if (existing.messages.some((message) => message.id === event.message.id)) return previous;
        const message = reconcileMessageReceipt(
          event.message,
          existing.conversation?.counterparty_last_read_at
        );
        return {
          ...previous,
          [event.thread_id]: { ...existing, messages: [...existing.messages, message] },
        };
      });
      if (event.message.sender_user_id) {
        window.clearTimeout(typingTimersRef.current[event.conversation_id]);
        setTypingByConversation((previous) => {
          if (!previous[event.conversation_id]) return previous;
          const next = { ...previous };
          delete next[event.conversation_id];
          return next;
        });
      }
      return;
    }
    if (event.type === "conversation.read_progress") {
      setLiveThreads((previous) => {
        const next: Record<string, LiveThread> = {};
        let changed = false;
        for (const [threadId, thread] of Object.entries(previous)) {
          if (thread.conversationId !== event.conversation_id) {
            next[threadId] = thread;
            continue;
          }
          changed = true;
          const readAt = Date.parse(event.read_at);
          next[threadId] = {
            ...thread,
            conversation: thread.conversation
              ? { ...thread.conversation, counterparty_last_read_at: event.read_at }
              : thread.conversation,
            messages: thread.messages.map((message) => {
              const createdAt = message.created_at ? Date.parse(message.created_at) : Number.NaN;
              return message.from_me && Number.isFinite(createdAt) && createdAt <= readAt
                ? { ...message, read_by_recipient: true }
                : message;
            }),
          };
        }
        return changed ? next : previous;
      });
      return;
    }
    if (event.type === "conversation.typing") {
      window.clearTimeout(typingTimersRef.current[event.conversation_id]);
      if (!event.is_typing) {
        setTypingByConversation((previous) => {
          if (!previous[event.conversation_id]) return previous;
          const next = { ...previous };
          delete next[event.conversation_id];
          return next;
        });
        return;
      }
      const expiresAt = Date.now() + 6_500;
      setTypingByConversation((previous) => ({
        ...previous,
        [event.conversation_id]: { senderUserId: event.sender_user_id, expiresAt },
      }));
      typingTimersRef.current[event.conversation_id] = window.setTimeout(() => {
        setTypingByConversation((previous) => {
          if (!previous[event.conversation_id]) return previous;
          const next = { ...previous };
          delete next[event.conversation_id];
          return next;
        });
      }, 6_500);
      return;
    }
    if (event.type === "interaction.blocked") {
      setTypingByConversation({});
      setRealtimeRefreshNonce((value) => value + 1);
    }
  }, []);
  const {
    state: realtimeState,
    subscribeConversation,
    sendTyping,
  } = useRealtimeMessaging({
    enabled: liveMode,
    accessToken: backendAccessToken,
    backendUserId,
    onEvent: handleRealtimeEvent,
  });
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState(false);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);
  const actionFeedbackTimer = useRef<number | null>(null);
  const flashActionFeedback = useCallback((message: string) => {
    setActionFeedback(message);
    if (actionFeedbackTimer.current) window.clearTimeout(actionFeedbackTimer.current);
    actionFeedbackTimer.current = window.setTimeout(() => setActionFeedback(null), 3_200);
  }, []);
  useEffect(
    () => () => {
      if (actionFeedbackTimer.current) window.clearTimeout(actionFeedbackTimer.current);
    },
    []
  );
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
  const [selectionReady, setSelectionReady] = useState(Boolean(initialSelectedId));
  // Remember the open inbox conversation across navigation so returning lands back
  // on it (not the first thread / the list). A ?thread deep-link always wins. The
  // key is scoped to the signed-in backend user so a QA persona switch (or a
  // different account in the same browser) can never restore someone else's thread.
  const selectedStorageKey = userStorageKey(SELECTED_STORAGE_KEY, backendUserId);
  const selectionRestored = useRef(false);
  const skipFirstSelectionPersist = useRef(!initialSelectedId);
  useEffect(() => {
    if (selectionRestored.current) return;
    selectionRestored.current = true;
    purgeLegacyStorageKey(SELECTED_STORAGE_KEY);
    if (initialSelectedId) return;
    try {
      const saved = window.localStorage.getItem(selectedStorageKey);
      if (saved) {
        setSelectedId(saved);
        /*
          On a phone the list and the conversation are separate screens, so
          restoring a selection *and* opening it means tapping "Inbox" drops you
          into whichever conversation you last read — with no list, and Back as
          the only way out. The selection is still restored (returning to the
          desktop layout, or tapping the row, lands where you were); only the
          automatic descent into it is withheld. A ?thread deep-link is a
          deliberate request and still opens.
        */
        if (window.innerWidth >= 1024) setMobileDetailOpen(true);
      }
    } catch {
      // storage unavailable; nothing to restore
    }
    setSelectionReady(true);
    // Restore runs once against the mount-time deep-link snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (skipFirstSelectionPersist.current) {
      skipFirstSelectionPersist.current = false;
      return;
    }
    try {
      if (selectedId) window.localStorage.setItem(selectedStorageKey, selectedId);
      else window.localStorage.removeItem(selectedStorageKey);
    } catch {
      // storage unavailable; selection still works in-session
    }
  }, [selectedId, selectedStorageKey]);
  // A deep-link arriving while the workspace is already mounted (clicking a bell
  // notification from inside /applications does not remount the page) must still
  // open the exact conversation the notification references.
  const lastDeepLinkRef = useRef(initialSelectedId);
  useEffect(() => {
    if (!initialSelectedId || initialSelectedId === lastDeepLinkRef.current) {
      lastDeepLinkRef.current = initialSelectedId;
      return;
    }
    lastDeepLinkRef.current = initialSelectedId;
    setSelectedId(initialSelectedId);
    setMobileDetailOpen(true);
    setSelectionReady(true);
  }, [initialSelectedId]);
  const [pendingActionKey, setPendingActionKey] = useState<string | null>(null);
  const [statusMutationKey, setStatusMutationKey] = useState<string | null>(null);
  const [pendingNote, setPendingNote] = useState("");
  const [blockConfirmOpen, setBlockConfirmOpen] = useState(false);
  const [replyDraft, setReplyDraft] = useState("");
  const pendingSendRef = useRef<{ targetId: string; body: string; id: string } | null>(null);
  const conversationScrollRef = useRef<HTMLDivElement | null>(null);
  // Compact chat dock: bumped by card "Message" actions to open that thread.
  const [chatRequest, setChatRequest] = useState<{ id: string; nonce: number } | null>(null);
  // Optional shortlist sharing uses a prompt. Relationship outcomes are shared
  // automatically by the backend and never enter this prompt state.
  const [notifyPrompt, setNotifyPrompt] = useState<{
    itemIds: string[];
    stageKey: string;
    kind: InteractionKind;
    phase: "ask" | "sending" | "sent" | "error";
    /**
     * Replaces the generic retry copy when the failure has a specific,
     * non-transient cause the user needs stated plainly.
     */
    errorMessage?: string;
  } | null>(null);
  /** Optional explanation sent with an application decision when it is shared. */
  const [notifyNote, setNotifyNote] = useState("");
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
      .catch((error) => {
        if (cancelled) return;
        // Private application data must never silently turn into sample rows.
        // Sample data is an explicit mode (`?demo=1`) so actions cannot appear
        // live while writes are actually failing against the backend.
        setLoadState(isBackendAuthError(error) ? "auth" : "error");
      });
    return () => {
      cancelled = true;
    };
  }, [liveMode, backendAccessToken, reloadNonce, realtimeRefreshNonce]);

  // Keep unread badges current while another participant is messaging. This is
  // intentionally lightweight polling: it works on the current REST backend and
  // stops with the workspace, without pretending to provide a WebSocket channel.
  useEffect(() => {
    if (!liveMode || !backendAccessToken) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const refreshUnread = async () => {
      try {
        const conversations = await listConversations(backendAccessToken);
        if (!cancelled) {
          setUnreadByThread(buildUnreadByThread(conversations));
          setConversationIdByThread(
            Object.fromEntries(
              conversations.map((conversation) => [conversation.thread_id, conversation.id])
            )
          );
          setLastActivityByThread(
            Object.fromEntries(
              conversations
                .filter((conversation) => conversation.last_message_at)
                .map((conversation) => [
                  conversation.thread_id,
                  Date.parse(conversation.last_message_at as string),
                ])
                .filter(([, at]) => Number.isFinite(at))
            )
          );
        }
      } catch {
        // Unread badges are non-critical and recover on the next poll.
      } finally {
        if (!cancelled) {
          timer = setTimeout(
            refreshUnread,
            realtimeState === "connected" ? 15_000 : UNREAD_POLL_INTERVAL_MS
          );
        }
      }
    };

    void refreshUnread();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [liveMode, backendAccessToken, reloadNonce, realtimeRefreshNonce, realtimeState]);

  const modeItems = useMemo(() => items.filter((item) => item.mode === mode), [items, mode]);

  const visibleItems = useMemo(() => {
    if (filter === "sent") return modeItems.filter((item) => item.direction === "sent");
    if (filter === "received") return modeItems.filter((item) => item.direction === "received");
    if (filter === "archived") return modeItems.filter(isArchivedInteraction);
    return modeItems;
  }, [modeItems, filter]);

  // A saved selection may belong to the other mode/filter. Normalize it to a
  // visible row so the highlighted row, detail pane, and loaded conversation
  // always refer to the same record.
  useEffect(() => {
    if (loadState !== "ready" || !selectionReady) return;
    /*
      Nothing to normalise *to* while the list is empty — and clearing the
      selection here does not merely lose it for this render: the persist effect
      writes the cleared value straight back to storage, so a remembered
      conversation is destroyed rather than restored.

      Reachable whenever rows arrive after mount, which is every Mock load (the
      manifest is fetched) and any slow real one. It surfaced as "leaving and
      returning restores the open conversation" failing only under parallel
      load, which is how a race presents.
    */
    if (visibleItems.length === 0) return;
    if (selectedId && visibleItems.some((item) => item.id === selectedId)) return;
    const nextId = visibleItems[0]?.id ?? null;
    if (nextId !== selectedId) setSelectedId(nextId);
  }, [loadState, selectedId, selectionReady, visibleItems]);

  // Selection falls back to the first visible row so the detail pane is never
  // empty while the filtered list has items.
  const selected = useMemo(
    () => visibleItems.find((item) => item.id === selectedId) || visibleItems[0] || null,
    [visibleItems, selectedId]
  );
  const selectedItemId = selected?.id ?? null;
  const selectedKind = selected?.kind ?? null;
  const selectedConversationId = selectedItemId ? liveThreads[selectedItemId]?.conversationId ?? null : null;
  const selectedNeedsRead = selectedItemId
    ? hasUnreadIncomingMessage(
        liveThreads[selectedItemId]?.messages ?? [],
        liveThreads[selectedItemId]?.conversation?.viewer_last_read_at
      )
    : false;

  // Only the currently open thread subscribes to full message/typing/read events.
  // Inbox-wide unread updates still arrive through the same authenticated socket.
  useEffect(() => {
    if (!liveMode || !selectedConversationId) return;
    return subscribeConversation(selectedConversationId);
  }, [liveMode, selectedConversationId, subscribeConversation]);

  useEffect(() => {
    return () => {
      for (const timer of Object.values(typingTimersRef.current)) window.clearTimeout(timer);
      typingTimersRef.current = {};
    };
  }, []);

  // A low-latency message delivered into the currently visible thread has been
  // loaded by this user. Mark it read immediately rather than waiting for the
  // slower recovery poll, while keeping the backend endpoint authoritative.
  useEffect(() => {
    if (
      !liveMode ||
      !backendAccessToken ||
      !selectedItemId ||
      !selectedConversationId ||
      !selectedNeedsRead ||
      document.visibilityState !== "visible" ||
      readInFlightRef.current.has(selectedConversationId)
    ) {
      return;
    }
    let cancelled = false;
    readInFlightRef.current.add(selectedConversationId);
    void markConversationRead(backendAccessToken, selectedConversationId)
      .then((conversation) => {
        if (cancelled) return;
        setLiveThreads((previous) => {
          const thread = previous[selectedItemId];
          return thread
            ? { ...previous, [selectedItemId]: { ...thread, conversation } }
            : previous;
        });
        setUnreadByThread((previous) => {
          if (!previous[selectedItemId]) return previous;
          const next = { ...previous };
          delete next[selectedItemId];
          return next;
        });
      })
      .catch(() => {
        // A failed receipt update is harmless: HTTP polling retries with the
        // next selected-thread refresh and never fabricates a seen state.
      })
      .finally(() => {
        readInFlightRef.current.delete(selectedConversationId);
      });
    return () => {
      cancelled = true;
    };
  }, [
    backendAccessToken,
    liveMode,
    selectedConversationId,
    selectedNeedsRead,
    selectedItemId,
  ]);

  // Load and refresh the open thread. Polling keeps two active participants in
  // sync without a page reload; requests are sequential and pause while a send is
  // in flight so an older poll cannot overwrite the newly returned message.
  useEffect(() => {
    if (
      !liveMode ||
      !backendAccessToken ||
      !selectedItemId ||
      !selectedKind ||
      sending
    ) return;
    const recordId = selectedItemId;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const refreshConversation = async () => {
      let nextPollMs =
        realtimeState === "connected" ? 15_000 : CONVERSATION_POLL_INTERVAL_MS;
      try {
        const detail = await (selectedKind === "hiring_request"
          ? getInterestConversation(backendAccessToken, recordId)
          : getApplicationConversation(backendAccessToken, recordId));
        if (cancelled) return;
        if (hasPendingLatestOutgoingReceipt(detail.messages)) {
          nextPollMs = Math.min(nextPollMs, 2_500);
        }
        setLiveThreads((prev) => ({
          ...prev,
          [recordId]: {
            conversationId: detail.conversation.id,
            messages: detail.messages,
            conversation: detail.conversation,
            engagement: detail.engagement,
            interview: detail.interview ?? null,
          },
        }));
        setThreadLoadErrors((prev) => {
          if (!prev[recordId]) return prev;
          const next = { ...prev };
          delete next[recordId];
          return next;
        });
        if (detail.conversation.unread_count > 0 && document.visibilityState === "visible") {
          void markConversationRead(backendAccessToken, detail.conversation.id)
            .then((conversation) => {
              if (cancelled) return;
              setLiveThreads((previous) => {
                const thread = previous[recordId];
                return thread
                  ? { ...previous, [recordId]: { ...thread, conversation } }
                  : previous;
              });
            })
            .catch(() => {});
        }
        // Opening a thread clears its unread badge immediately.
        setUnreadByThread((prev) => {
          if (!prev[recordId]) return prev;
          const next = { ...prev };
          delete next[recordId];
          return next;
        });
      } catch {
        if (!cancelled) {
          setThreadLoadErrors((prev) => ({ ...prev, [recordId]: true }));
        }
      } finally {
        if (!cancelled) {
          timer = setTimeout(refreshConversation, nextPollMs);
        }
      }
    };

    void refreshConversation();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [
    liveMode,
    backendAccessToken,
    selectedItemId,
    selectedKind,
    reloadNonce,
    realtimeRefreshNonce,
    realtimeState,
    sending,
  ]);

  const latestPersistedMessageId = selectedItemId
    ? liveThreads[selectedItemId]?.messages.at(-1)?.id ?? null
    : null;
  useEffect(() => {
    const node = conversationScrollRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [selectedItemId, latestPersistedMessageId]);

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
    if (selectedConversationId) sendTyping(selectedConversationId, false);
    setPendingActionKey(null);
    setPendingNote("");
    setBlockConfirmOpen(false);
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
    setSendError(null);
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
    setActionPending(true);
    const kind: InteractionKind = moveItems[0].kind;
    const archiveMove = stageKey === "archived" || stageKey === "_unarchive";
    const nextArchived = stageKey === "archived";
    setActionError(null);
    const authoritativeVersions = new Map<string, number>();
    const authoritativeStatuses = new Map<string, string>();
    const authoritativeParticipantStatuses = new Map<string, string>();
    const authoritativeArchivedAt = new Map<string, string | null>();
    const authoritativeLegacyResolution = new Map<string, boolean>();
    let alreadyInState = false;
    if (liveMode && backendAccessToken) {
      try {
        const ids = moveItems.map((item) => item.id);
        if (archiveMove) {
          for (const item of moveItems) {
            if (item.kind === "application") {
              await setApplicationArchived(backendAccessToken, item.id, nextArchived);
            } else {
              await setTalentInterestArchived(backendAccessToken, item.id, nextArchived);
            }
          }
        } else if (moveItems.length === 1) {
          const item = moveItems[0];
          const idempotencyKey = window.crypto.randomUUID();
          if (kind === "application") {
            const response = await transitionApplicationStatus(
              backendAccessToken,
              item.id,
              stageKey as BackendJobApplication["status"],
              item.statusVersion ?? 1,
              idempotencyKey
            );
            authoritativeVersions.set(item.id, response.status_version);
            authoritativeStatuses.set(item.id, response.current_status);
            if (response.application) {
              authoritativeParticipantStatuses.set(item.id, response.application.participant_status);
              authoritativeArchivedAt.set(item.id, response.application.archived_at ?? null);
              authoritativeLegacyResolution.set(
                item.id,
                response.application.legacy_archive_resolution_required === true
              );
            }
            alreadyInState = response.outcome === "already_in_state";
          } else {
            const response = await transitionTalentInterestStatus(
              backendAccessToken,
              item.id,
              stageKey as BackendTalentInterest["status"],
              item.statusVersion ?? 1,
              idempotencyKey
            );
            authoritativeVersions.set(item.id, response.status_version);
            authoritativeStatuses.set(item.id, response.current_status);
            if (response.interest) {
              authoritativeParticipantStatuses.set(item.id, response.interest.participant_status);
              authoritativeArchivedAt.set(item.id, response.interest.archived_at ?? null);
              authoritativeLegacyResolution.set(
                item.id,
                response.interest.legacy_archive_resolution_required === true
              );
            }
            alreadyInState = response.outcome === "already_in_state";
          }
        } else if (kind === "application") {
          const updated = await bulkUpdateApplicationStatus(
            backendAccessToken,
            ids,
            stageKey as BackendJobApplication["status"]
          );
          updated.forEach((item) => {
            authoritativeVersions.set(item.id, item.status_version);
            authoritativeStatuses.set(item.id, item.status);
          });
        } else {
          const updated = await bulkUpdateTalentInterestStatus(
            backendAccessToken,
            ids,
            stageKey as BackendTalentInterest["status"]
          );
          updated.forEach((item) => {
            authoritativeVersions.set(item.id, item.status_version);
            authoritativeStatuses.set(item.id, item.status);
          });
        }
      } catch (error) {
        setActionPending(false);
        if (error instanceof BackendRequestError && error.status === 409) {
          setRealtimeRefreshNonce((value) => value + 1);
        }
        setActionError(
          describeActionError(
            error,
            moveItems.length > 1
              ? "Couldn’t move the selection. Refresh and try again."
              : "Couldn’t update the stage. Refresh and try again."
          )
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
              archivedAt: archiveMove
                ? nextArchived
                  ? new Date().toISOString()
                  : null
                : authoritativeArchivedAt.has(item.id)
                  ? authoritativeArchivedAt.get(item.id) ?? null
                  : item.legacyArchiveResolutionRequired
                    ? null
                    : item.archivedAt,
              status: interactionStatusFromBackend(
                item.kind,
                item.direction,
                authoritativeStatuses.get(item.id) ?? (archiveMove ? item.backendStatus ?? "new" : stageKey)
              ),
              backendStatus:
                authoritativeStatuses.get(item.id) ?? (archiveMove ? item.backendStatus : stageKey),
              statusVersion: authoritativeVersions.get(item.id) ?? item.statusVersion,
              participantBackendStatus:
                authoritativeParticipantStatuses.get(item.id) ?? item.participantBackendStatus,
              legacyArchiveResolutionRequired:
                authoritativeLegacyResolution.get(item.id) ??
                (item.legacyArchiveResolutionRequired && !archiveMove
                  ? false
                  : item.legacyArchiveResolutionRequired),
              updatedAt: new Date().toISOString(),
              unread: false,
              timeline: [
                ...item.timeline,
                {
                  id: `${item.id}-stage-${item.timeline.length}`,
                  label: archiveMove
                    ? nextArchived
                      ? "Archived by you"
                      : "Unarchived by you"
                    : `Moved to ${stageLabel} by you`,
                  occurredAt: new Date().toISOString(),
                },
              ],
            }
          : item
      )
    );
    // Optional shared stages ask first. Relationship outcomes are published by
    // the backend atomically; demo mode mirrors that trusted event locally so
    // the sample workspace never teaches a different workflow.
    const notifyPolicy = archiveMove ? null : stageNotifyPolicyOf(kind, stageKey);
    const counterparty = firstNameOf(moveItems[0]?.counterpartyName ?? "them");
    flashActionFeedback(
      alreadyInState
        ? stageKey === "hired"
          ? "Already hired"
          : stageKey === "accepted"
            ? "Already accepted"
            : "Already up to date"
        : archiveMove
          ? nextArchived
            ? "Archived"
            : "Unarchived"
          : notifyPolicy?.automatic
            ? `Shared with ${counterparty}`
            : notifyPolicy
              ? "Saved privately · Not yet shared"
              : "Saved privately"
    );
    setNotifyNote("");
    setNotifyPrompt(
      moveItems.length === 1 && notifyPolicy && !notifyPolicy.automatic
        ? { itemIds: moveItems.map((item) => item.id), stageKey, kind, phase: "ask" }
        : null
    );
    if (notifyPolicy?.automatic) {
      if (!liveMode) {
        const targetIds = new Set(moveItems.map((item) => item.id));
        setItems((prev) =>
          prev.map((item) =>
            targetIds.has(item.id)
              ? {
                  ...item,
                  replies: [
                    ...(item.replies || []),
                    {
                      from: "You",
                      body: notifyPolicy.notice({ contextLabel: pipelineContextLabelOf(item) }),
                      sentAt: new Date().toISOString(),
                      kind: "status" as const,
                    },
                  ],
                }
              : item
          )
        );
      }
      const single = moveItems.length === 1 ? moveItems[0] : null;
      if (single) {
        setChatRequest((prev) => ({ id: single.id, nonce: (prev?.nonce ?? 0) + 1 }));
      }
    }
    setActionPending(false);
  };

  /**
   * Post the platform status update into each moved item's chat thread — only
   * ever called from the prompt's explicit "Send update" action. Live mode
   * asks the backend to generate a trusted status event; demo mode appends locally.
   */
  const sendStatusUpdates = async (
    targets: OwnerInteraction[],
    stageKey: string,
    note?: string
  ) => {
    if (targets.length === 0) return;
    const firstTarget = targets[0];
    if (!firstTarget) return;
    const kind = firstTarget.kind;
    const policy = stageNotifyPolicyOf(kind, stageKey);
    if (!policy) return;
    const targetToOpen = targets.length === 1 ? firstTarget : null;
    setNotifyPrompt((prev) => (prev ? { ...prev, phase: "sending", errorMessage: undefined } : prev));
    try {
      if (liveMode && backendAccessToken) {
        // Only applications have a separate "share this decision later" step.
        // Hiring-request outcomes are shared by the backend at the moment of
        // transition, so there is no communication operation to replay here.
        // Anything else must be reported as unsent rather than counted as
        // shared — claiming success for a request we never made is worse than
        // refusing the action.
        const unsupported = targets.filter((target) => target.kind !== "application");
        if (unsupported.length > 0) {
          setNotifyPrompt((prev) =>
            prev
              ? {
                  ...prev,
                  phase: "error",
                  errorMessage:
                    "Hiring-request decisions are shared automatically when you make them, so there is nothing to send separately.",
                }
              : prev
          );
          return;
        }
        for (const target of targets) {
          const response = await communicateApplicationStatus(
            backendAccessToken,
            target.id,
            stageKey as BackendJobApplication["status"],
            target.statusVersion ?? 1,
            window.crypto.randomUUID(),
            // Persisted with the decision itself, so the applicant cannot be
            // told the outcome without the explanation that came with it.
            note?.trim() || undefined
          );
          setItems((current) =>
            current.map((item) =>
              item.id === target.id
                ? {
                    ...item,
                    participantBackendStatus: response.current_status,
                    statusVersion: response.status_version,
                  }
                : item
            )
          );
        }
        setRealtimeRefreshNonce((value) => value + 1);
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
                { from: "You", body: notice, sentAt: new Date().toISOString(), kind: "status" as const },
              ],
              timeline: [
                ...item.timeline,
                {
                  id: `${item.id}-notice-${item.timeline.length}`,
                  label: `Status update sent to ${firstNameOf(item.counterpartyName)}`,
                  occurredAt: new Date().toISOString(),
                },
              ],
            };
          })
        );
      }
      setNotifyPrompt((prev) => (prev ? { ...prev, phase: "sent" } : prev));
      flashActionFeedback(`Shared with ${firstNameOf(firstTarget.counterpartyName)}`);
      if (targetToOpen) {
        setChatRequest((prev) => ({ id: targetToOpen.id, nonce: (prev?.nonce ?? 0) + 1 }));
      }
    } catch {
      setNotifyPrompt((prev) => (prev ? { ...prev, phase: "error" } : prev));
    }
  };

  const selectedPrivateNotePersistence = useMemo(() => {
    if (!liveMode || !backendAccessToken || !selectedItemId || selected?.direction !== "received") {
      return null;
    }

    const interactionId = selectedItemId;
    const interactionKind = selectedKind;
    const toPrivateNote = (note: BackendInteractionPrivateNote): PrivateNote => ({
      id: note.id,
      body: note.body,
      createdAt: formatNoteTimestamp(new Date(note.created_at)),
      conversationId: interactionId,
    });
    const load = async () => {
      const notes =
        interactionKind === "application"
          ? await listApplicationPrivateNotes(backendAccessToken, interactionId)
          : await listTalentInterestPrivateNotes(backendAccessToken, interactionId);
      return notes.map(toPrivateNote);
    };

    return {
      load,
      create: async (body: string) => {
        const note =
          interactionKind === "application"
            ? await createApplicationPrivateNote(backendAccessToken, interactionId, body)
            : await createTalentInterestPrivateNote(backendAccessToken, interactionId, body);
        setItems((prev) =>
          prev.map((item) => (item.id === interactionId ? { ...item, managerNote: note.body } : item))
        );
        return toPrivateNote(note);
      },
      delete: async (noteId: string) => {
        if (interactionKind === "application") {
          await deleteApplicationPrivateNote(backendAccessToken, interactionId, noteId);
        } else {
          await deleteTalentInterestPrivateNote(backendAccessToken, interactionId, noteId);
        }
        const remaining = await load();
        setItems((prev) =>
          prev.map((item) =>
            item.id === interactionId ? { ...item, managerNote: remaining[0]?.body ?? null } : item
          )
        );
      },
    };
  }, [backendAccessToken, liveMode, selected?.direction, selectedItemId, selectedKind]);

  const persistDemoLatestNote = async (body: string | null) => {
    if (!selectedItemId) return;
    setItems((prev) =>
      prev.map((item) => (item.id === selectedItemId ? { ...item, managerNote: body } : item))
    );
  };

  const commitStatusLocally = (
    target: OwnerInteraction,
    action: HeaderAction,
    trimmedNote?: string,
    authoritative?: {
      status: string;
      version: number;
      participantStatus?: string;
      archivedAt?: string | null;
      legacyArchiveResolutionRequired?: boolean;
    }
  ) => {
    setItems((prev) =>
      prev.map((item) =>
        item.id === target.id
          ? {
              ...item,
              status: authoritative
                ? interactionStatusFromBackend(item.kind, item.direction, authoritative.status)
                : (action.nextStatus as InteractionStatus),
              backendStatus: authoritative?.status ?? action.backendStatus ?? item.backendStatus,
              statusVersion: authoritative?.version ?? item.statusVersion,
              participantBackendStatus:
                authoritative?.participantStatus ?? item.participantBackendStatus,
              archivedAt:
                authoritative && "archivedAt" in authoritative
                  ? authoritative.archivedAt
                  : target.legacyArchiveResolutionRequired
                    ? null
                    : item.archivedAt,
              legacyArchiveResolutionRequired:
                authoritative?.legacyArchiveResolutionRequired ??
                (target.legacyArchiveResolutionRequired ? false : item.legacyArchiveResolutionRequired),
              updatedAt: new Date().toISOString(),
              unread: false,
              replies: trimmedNote
                ? [...(item.replies || []), { from: "You", body: trimmedNote, sentAt: new Date().toISOString() }]
                : item.replies,
              timeline: [
                ...item.timeline,
                {
                  id: `${item.id}-${action.key}-${item.timeline.length}`,
                  label: action.eventLabel as string,
                  occurredAt: new Date().toISOString(),
                },
              ],
            }
          : item
      )
    );
    setPendingActionKey(null);
    setPendingNote("");
  };

  const applyStatusAction = async (target: OwnerInteraction, action: HeaderAction, note?: string) => {
    if (!action.nextStatus || !action.eventLabel || statusMutationKey) return;
    const trimmedNote = note?.trim();
    setActionError(null);

    if (liveMode && backendAccessToken) {
      // Map workspace actions to the real backend status vocabulary; commit
      // locally only after the backend confirms — no fake success states.
      // Withdraw is sender-initiated and uses its own endpoint (the status PATCH
      // is owner-only and would reject the sender).
      const backendStatus = action.backendStatus;
      setStatusMutationKey(action.key);
      setActionPending(true);
      try {
        let transitionOutcome: "transitioned" | "already_in_state" = "transitioned";
        if (action.key === "withdraw") {
          const record = target.kind === "application"
            ? await withdrawApplication(backendAccessToken, target.id)
            : await withdrawTalentInterest(backendAccessToken, target.id);
          // No note is collected for withdrawal, and appending one locally
          // would show the sender a message the backend never stored.
          commitStatusLocally(target, action, undefined, {
            status: record.status,
            version: record.status_version,
            participantStatus: record.participant_status,
            archivedAt: record.archived_at ?? null,
            legacyArchiveResolutionRequired:
              record.legacy_archive_resolution_required === true,
          });
        } else if (target.kind === "application") {
          const response = await transitionApplicationStatus(
            backendAccessToken,
            target.id,
            backendStatus as BackendJobApplication["status"],
            target.statusVersion ?? 1,
            window.crypto.randomUUID()
          );
          transitionOutcome = response.outcome;
          const record = response.application;
          // An application stage change is private, so it carries no note. Any
          // explanation is collected later, at the point it is actually shared.
          commitStatusLocally(target, action, undefined, {
            status: response.current_status,
            version: response.status_version,
            participantStatus: record?.participant_status,
            archivedAt: record?.archived_at ?? null,
            legacyArchiveResolutionRequired:
              record?.legacy_archive_resolution_required === true,
          });
        } else {
          const response = await transitionTalentInterestStatus(
            backendAccessToken,
            target.id,
            backendStatus as BackendTalentInterest["status"],
            target.statusVersion ?? 1,
            window.crypto.randomUUID(),
            // Committed by the backend in the same transaction as the decision,
            // so the recruiter can never receive one without the other.
            trimmedNote || undefined
          );
          transitionOutcome = response.outcome;
          const record = response.interest;
          commitStatusLocally(target, action, undefined, {
            status: response.current_status,
            version: response.status_version,
            participantStatus: record?.participant_status,
            archivedAt: record?.archived_at ?? null,
            legacyArchiveResolutionRequired:
              record?.legacy_archive_resolution_required === true,
          });
        }
        const notifyPolicy = backendStatus
          ? stageNotifyPolicyOf(target.kind, backendStatus)
          : null;
        if (notifyPolicy && !notifyPolicy.automatic) {
          setNotifyNote("");
          setNotifyPrompt({
            itemIds: [target.id],
            stageKey: backendStatus as string,
            kind: target.kind,
            phase: "ask",
          });
        }
        flashActionFeedback(
          transitionOutcome === "already_in_state"
            ? backendStatus === "hired"
              ? "Already hired"
              : backendStatus === "accepted"
                ? "Already accepted"
                : "Already up to date"
            : action.key === "withdraw" || notifyPolicy?.automatic
              ? `Shared with ${firstNameOf(target.counterpartyName)}`
              : notifyPolicy
                ? "Saved privately · Not yet shared"
                : "Saved privately"
        );
        setRealtimeRefreshNonce((value) => value + 1);
      } catch (error) {
        setActionError(
          describeActionError(
            error,
            action.key === "withdraw"
              ? "Couldn’t withdraw this request. Try again."
              : "Couldn’t update this status. Try again."
          )
        );
        setPendingActionKey(null);
        setPendingNote("");
        setReloadNonce((value) => value + 1);
      } finally {
        setActionPending(false);
        setStatusMutationKey(null);
      }
      return;
    }

    commitStatusLocally(target, action, trimmedNote);
  };

  const applyArchiveAction = async (target: OwnerInteraction, archived: boolean) => {
    if (statusMutationKey) return;
    setStatusMutationKey(archived ? "archive" : "unarchive");
    setActionPending(true);
    setActionError(null);
    try {
      if (liveMode && backendAccessToken) {
        const record = target.kind === "application"
          ? await setApplicationArchived(backendAccessToken, target.id, archived)
          : await setTalentInterestArchived(backendAccessToken, target.id, archived);
        setItems((current) =>
          current.map((item) =>
            item.id === target.id ? { ...item, archivedAt: record.archived_at ?? null } : item
          )
        );
      } else {
        setItems((current) =>
          current.map((item) =>
            item.id === target.id
              ? { ...item, archivedAt: archived ? new Date().toISOString() : null }
              : item
          )
        );
      }
      flashActionFeedback(archived ? "Archived" : "Unarchived");
      setPendingActionKey(null);
    } catch (error) {
      setActionError(
        describeActionError(
          error,
          archived ? "Couldn’t archive this thread." : "Couldn’t unarchive this thread."
        )
      );
    } finally {
      setActionPending(false);
      setStatusMutationKey(null);
    }
  };

  const handleSendReply = async (target: OwnerInteraction) => {
    const body = replyDraft.trim();
    if (!body || sending) return;
    // Sending is a meaningful action: it stops the time-to-action timer and
    // collapses the decision surface. Merely focusing the composer does not.
    trackWorkspaceEvent("workspace.message.sent", analyticsBase(target));
    noteMeaningfulAction(target, "message");

    // Live mode: persist a real message through the backend conversation.
    if (liveMode && backendAccessToken) {
      const thread = liveThreads[target.id];
      if (!thread) {
        setSendError("This thread is still loading. Try again in a moment.");
        return;
      }
      setSending(true);
      setSendError(null);
      const previousAttempt = pendingSendRef.current;
      const clientMessageId =
        previousAttempt?.targetId === target.id && previousAttempt.body === body
          ? previousAttempt.id
          : window.crypto.randomUUID();
      pendingSendRef.current = { targetId: target.id, body, id: clientMessageId };
      sendTyping(thread.conversationId, false);
      window.clearTimeout(typingTimersRef.current[thread.conversationId]);
      try {
        const message = await sendConversationMessage(
          backendAccessToken,
          thread.conversationId,
          body,
          clientMessageId,
          pendingIntent ?? undefined
        );
        // One intent applies to one message; the next send is plain again.
        setPendingIntent(null);
        setLiveThreads((prev) => {
          const current = prev[target.id];
          if (!current || current.messages.some((entry) => entry.id === message.id)) return prev;
          const reconciled = reconcileMessageReceipt(
            message,
            current.conversation?.counterparty_last_read_at
          );
          return {
            ...prev,
            [target.id]: { ...current, messages: [...current.messages, reconciled] },
          };
        });
        if (pendingSendRef.current?.id === clientMessageId) pendingSendRef.current = null;
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
              updatedAt: new Date().toISOString(),
              replies: [...(item.replies || []), { from: "You", body, sentAt: new Date().toISOString() }],
              timeline: [
                ...item.timeline,
                { id: `${item.id}-reply-${item.timeline.length}`, label: "Reply sent", occurredAt: new Date().toISOString() },
              ],
            }
          : item
      )
    );
  };

  const handleReplyDraftChange = (value: string) => {
    setReplyDraft(value);
    if (!liveMode || !selectedConversationId || !selectedActive) return;
    sendTyping(selectedConversationId, Boolean(value.trim()));
    window.clearTimeout(typingTimersRef.current[selectedConversationId]);
    if (value.trim()) {
      typingTimersRef.current[selectedConversationId] = window.setTimeout(() => {
        sendTyping(selectedConversationId, false);
      }, 1_250);
    }
  };

  /**
   * The optional intent attached to the next send. Null means an ordinary
   * freeform message — always the fastest path, and always available.
   */
  const [pendingIntent, setPendingIntent] = useState<string | null>(null);

  /* ---------------- Queue views ---------------- */

  /** Null means "no queue filter" — the ordinary full list. */
  const [activeQueue, setActiveQueue] = useState<WorkQueueKey | "starred" | "snoozed" | null>(null);

  /* ---------------- B1: durable per-user interaction preferences ---------------- */

  /**
   * The signed-in user's private organisation, keyed by conversation id.
   * Owner-scoped by construction: the endpoint only ever returns the caller's
   * own rows, so nothing here can describe the counterparty.
   */
  const [preferences, setPreferences] = useState<Record<string, BackendInteractionPreference>>({});

  useEffect(() => {
    if (!liveMode || !backendAccessToken) return;
    let cancelled = false;
    void (async () => {
      try {
        const rows = await listInteractionPreferences(backendAccessToken);
        if (cancelled) return;
        setPreferences(Object.fromEntries(rows.map((row) => [row.conversation_id, row])));
      } catch {
        // Personal organisation is an enhancement: failing to load it must never
        // stop someone reading or answering their messages.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [liveMode, backendAccessToken, reloadNonce]);

  /** Conversation id for an interaction, once its thread is known. */
  const conversationIdOf = useCallback(
    (item: OwnerInteraction): string | null =>
      liveThreads[item.id]?.conversationId ?? conversationIdByThread[item.id] ?? null,
    [liveThreads, conversationIdByThread]
  );

  const isStarred = useCallback(
    (item: OwnerInteraction): boolean => {
      const conversationId = conversationIdOf(item);
      return conversationId ? Boolean(preferences[conversationId]?.starred) : false;
    },
    [conversationIdOf, preferences]
  );

  /**
   * Star is private, reversible, and never touches lifecycle state, so it is
   * applied optimistically — and rolled back to the previous value if the write
   * fails, rather than leaving a star the server never accepted.
   */
  const toggleStar = useCallback(
    async (item: OwnerInteraction) => {
      const conversationId = conversationIdOf(item);
      if (!conversationId || !backendAccessToken) return;
      const previous = preferences[conversationId];
      const next = !previous?.starred;
      setPreferences((current) => ({
        ...current,
        [conversationId]: {
          ...(current[conversationId] ?? {
            conversation_id: conversationId,
            starred: false,
            queue_dismissed: false,
            decision_prompt_dismissed: false,
          }),
          starred: next,
        },
      }));
      try {
        const saved = await setConversationStarred(backendAccessToken, conversationId, next);
        setPreferences((current) => ({ ...current, [conversationId]: saved }));
      } catch {
        setPreferences((current) => {
          const restored = { ...current };
          if (previous) restored[conversationId] = previous;
          else delete restored[conversationId];
          return restored;
        });
        setActionError("Couldn\u2019t save that. Try again.");
      }
    },
    [conversationIdOf, backendAccessToken, preferences]
  );

  /**
   * Fulfils the seam B3 committed. Queue recommendations are hidden by a
   * dismissal or an unexpired snooze; neither changes any status.
   */
  const queuePreferences = useMemo<WorkQueuePreferences>(() => {
    if (!liveMode) return NO_QUEUE_PREFERENCES;
    const byInteraction = new Map<string, BackendInteractionPreference>();
    const record = (interactionId: string, conversationId: string | undefined) => {
      const row = conversationId ? preferences[conversationId] : undefined;
      if (row) byInteraction.set(interactionId, row);
    };
    // The list-wide map first, then anything an open thread knows more recently.
    for (const [id, conversationId] of Object.entries(conversationIdByThread)) record(id, conversationId);
    for (const [id, thread] of Object.entries(liveThreads)) record(id, thread?.conversationId);
    return {
      isDismissed: (interactionId) => Boolean(byInteraction.get(interactionId)?.queue_dismissed),
      snoozedUntil: (interactionId) => {
        const until = byInteraction.get(interactionId)?.snoozed_until;
        return until ? Date.parse(until) : null;
      },
    };
  }, [liveMode, liveThreads, conversationIdByThread, preferences]);

  /* ---------------- Phase C: interview coordination ---------------- */

  /**
   * Every interview the signed-in user takes part in, keyed by conversation.
   * Loaded list-wide because the follow-up queue is a question about the whole
   * inbox, not about whichever thread happens to be open.
   */
  const [interviews, setInterviews] = useState<Record<string, BackendInterview>>({});

  useEffect(() => {
    if (!liveMode || !backendAccessToken) return;
    let cancelled = false;
    void (async () => {
      try {
        const rows = await listInterviews(backendAccessToken);
        if (cancelled) return;
        setInterviews(Object.fromEntries(rows.map((row) => [row.conversation_id, row])));
      } catch {
        // Scheduling is an enhancement layered on the conversation; failing to
        // load it must never stop someone reading or answering their messages.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [liveMode, backendAccessToken, reloadNonce, realtimeRefreshNonce]);

  /**
   * Every live engagement, keyed by the record it came from.
   *
   * Phase A could only see the engagement of the *open* record, which left the
   * start-confirmation queue — the highest-priority one — permanently empty for
   * anything the user had not already clicked into. This is the list-wide read
   * that makes it real.
   */
  const [engagementsByRecord, setEngagementsByRecord] = useState<
    Record<string, BackendEngagementSummary>
  >({});

  useEffect(() => {
    if (!liveMode || !backendAccessToken) return;
    let cancelled = false;
    void (async () => {
      try {
        const rows = await listLiveEngagements(backendAccessToken);
        if (cancelled) return;
        setEngagementsByRecord(
          Object.fromEntries(rows.map((row) => [row.source_record_id, row]))
        );
      } catch {
        // The engagement row on the open record still works; only the list-wide
        // queue count degrades, and it recovers on the next load.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [liveMode, backendAccessToken, reloadNonce, realtimeRefreshNonce]);

  /** The engagement for an interaction, preferring the freshest source. */
  const engagementOf = useCallback(
    (item: OwnerInteraction): BackendEngagementSummary | null =>
      liveThreads[item.id]?.engagement ?? engagementsByRecord[item.id] ?? null,
    [liveThreads, engagementsByRecord]
  );

  /** The arrangement for an interaction, wherever its conversation id came from. */
  const interviewOf = useCallback(
    (item: OwnerInteraction): BackendInterview | null => {
      const conversationId = conversationIdOf(item);
      const fromThread = liveThreads[item.id]?.interview;
      if (fromThread !== undefined && fromThread !== null) return fromThread;
      return conversationId ? interviews[conversationId] ?? null : null;
    },
    [conversationIdOf, liveThreads, interviews]
  );

  /** Merge a server response into both caches so every surface agrees at once. */
  const rememberInterview = useCallback((interview: BackendInterview) => {
    setInterviews((current) => ({ ...current, [interview.conversation_id]: interview }));
    setLiveThreads((current) => {
      const next = { ...current };
      let changed = false;
      for (const [id, thread] of Object.entries(current)) {
        if (thread.conversationId !== interview.conversation_id) continue;
        next[id] = { ...thread, interview };
        changed = true;
      }
      return changed ? next : current;
    });
  }, []);

  /** Which interaction currently has the scheduling surface open. */
  const [schedulingFor, setSchedulingFor] = useState<string | null>(null);
  const [interviewBusy, setInterviewBusy] = useState(false);
  const [interviewError, setInterviewError] = useState<string | null>(null);

  /**
   * One wrapper for every interview mutation.
   *
   * Interviews are consequential and shared — the other person may block out
   * time — so nothing here is optimistic. The surface shows a pending state and
   * only the server's answer is ever rendered. A conflict is reported in the
   * words of the thing that changed rather than as a status code.
   */
  const runInterviewMutation = useCallback(
    async (
      item: OwnerInteraction,
      mutate: (accessToken: string, conversationId: string) => Promise<BackendInterview>,
      successMessage: string
    ) => {
      const conversationId = conversationIdOf(item);
      if (!conversationId || !backendAccessToken) return;
      setInterviewBusy(true);
      setInterviewError(null);
      try {
        const saved = await mutate(backendAccessToken, conversationId);
        rememberInterview(saved);
        setSchedulingFor(null);
        flashActionFeedback(successMessage);
        // The stage may have moved with it, so re-read the authoritative record
        // rather than inferring what the transition did.
        setReloadNonce((value) => value + 1);
      } catch (error) {
        const conflict =
          error instanceof BackendRequestError && (error.status === 409 || error.status === 422);
        setInterviewError(
          conflict
            ? "This interview changed somewhere else. Reopen it to see the current time."
            : "Couldn\u2019t save that. Try again."
        );
        if (conflict) setReloadNonce((value) => value + 1);
      } finally {
        setInterviewBusy(false);
      }
    },
    [conversationIdOf, backendAccessToken, rememberInterview, flashActionFeedback]
  );

  const submitInterview = useCallback(
    (item: OwnerInteraction, submission: InterviewSubmission) => {
      const current = interviewOf(item);
      // A completed or cancelled arrangement is replaced by a new round rather
      // than moved, so the version still guards it but the semantics differ.
      const expectedVersion = current ? current.version : 0;
      void runInterviewMutation(
        item,
        (accessToken, conversationId) =>
          proposeInterview(accessToken, conversationId, {
            ...submission,
            expectedVersion,
            applicationExpectedVersion: item.statusVersion ?? null,
            idempotencyKey: crypto.randomUUID(),
          }),
        current && current.status !== "cancelled" && current.status !== "completed"
          ? "New time sent"
          : "Invitation sent"
      );
    },
    [interviewOf, runInterviewMutation]
  );

  /* ---------------- Phase A: recommendation, work state, decision surface ---------------- */

  const flags = useMemo(() => workspaceFlagsFromEnv(), []);
  const cohort = useMemo(() => flagCohortLabel(flags), [flags]);

  /* ---------------- B2: deliberate-open instrumentation and Auto-Reviewing ---------------- */

  /** Records which interactions this session has already triggered for. */
  const autoReviewedRef = useRef<Set<string>>(new Set());
  /** Mirrors the selection so the dwell timer can re-check it when it fires. */
  const selectedItemIdRef = useRef<string | null>(null);
  useEffect(() => {
    selectedItemIdRef.current = selectedItemId;
  }, [selectedItemId]);

  /**
   * Reading an application *is* reviewing it, so a deliberate open records that
   * privately instead of asking the manager to state the obvious.
   *
   * Every condition here exists to keep "New" meaning *genuinely not looked at*:
   * the viewer must manage the record, it must still be authoritatively New, the
   * detail must have actually loaded, the document must be visible, and the same
   * interaction must still be selected once the dwell threshold elapses. A
   * prefetch, a hover, a background tab, or a keyboard pass-through never
   * satisfies all of them.
   *
   * Failure is deliberately silent: this is a convenience, and it must never
   * stand between someone and reading or answering their messages.
   */
  useEffect(() => {
    if (!flags.autoReviewing || !liveMode || !backendAccessToken) return;
    if (!selected || selected.direction !== "received") return;
    if (isArchivedInteraction(selected)) return;
    if (backendStatusOf(selected) !== "new") return;
    if (autoReviewedRef.current.has(selected.id)) return;
    // The detail must genuinely be loaded — an in-flight open is not a read.
    if (!liveThreads[selected.id]) return;
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;

    const interactionId = selected.id;
    const kind = selected.kind;
    const timer = window.setTimeout(() => {
      // Re-check at fire time: the user may have moved on, or hidden the tab,
      // during the dwell window.
      if (document.visibilityState !== "visible") return;
      if (selectedItemIdRef.current !== interactionId) return;
      if (autoReviewedRef.current.has(interactionId)) return;
      autoReviewedRef.current.add(interactionId);
      trackWorkspaceEvent("workspace.auto_reviewing.fired", {
        interactionKind: kind,
        direction: "received",
        stage: "new",
        durationMs: flags.autoReviewingDwellMs,
        flagCohort: cohort,
      });
      void (async () => {
        try {
          const result = await markInteractionReviewStarted(
            backendAccessToken,
            kind === "application" ? "application" : "hiring_request",
            interactionId
          );
          if (!result.changed) return;
          setItems((prev) =>
            prev.map((item) =>
              item.id === interactionId
                ? {
                    ...item,
                    status: interactionStatusFromBackend(item.kind, item.direction, result.current_status),
                    backendStatus: result.current_status,
                    statusVersion: result.status_version,
                  }
                : item
            )
          );
        } catch {
          // Quiet by design. Allow a later attempt rather than burning the
          // one-shot guard on a transient failure.
          autoReviewedRef.current.delete(interactionId);
          trackWorkspaceEvent("workspace.auto_reviewing.failed", {
            interactionKind: kind,
            flagCohort: cohort,
          });
        }
      })();
    }, flags.autoReviewingDwellMs);

    return () => window.clearTimeout(timer);
  }, [
    flags.autoReviewing,
    flags.autoReviewingDwellMs,
    liveMode,
    backendAccessToken,
    selected,
    liveThreads,
    cohort,
  ]);


  /**
   * Live evidence for the rule functions. `responseExpected` is intentionally
   * absent: nothing in Phase A can prove a message needs an answer, so the
   * derivation stays honest and never asserts "Needs your reply".
   */
  const signalsFor = useCallback(
    (item: OwnerInteraction): WorkSignals => ({
      unreadCount: liveMode ? unreadByThread[item.id] ?? 0 : item.unread ? 1 : 0,
      /**
       * Only an inbound message whose sender explicitly used an asking intent
       * justifies "Needs your reply". A message merely arriving does not, so
       * ambiguous traffic keeps the descriptive label instead.
       */
      responseExpected: (() => {
        const thread = liveMode ? liveThreads[item.id] : undefined;
        if (!thread) return undefined;
        const lastInbound = [...thread.messages]
          .reverse()
          .find((message) => !message.from_me && message.kind !== "status_update");
        return lastInbound ? Boolean(lastInbound.response_expected) : undefined;
      })(),
      engagementUnconfirmed: (() => {
        const status = liveMode ? engagementOf(item)?.status : undefined;
        return status ? ["ready_to_start", "start_pending"].includes(status) : undefined;
      })(),
      /**
       * An arranged interview still ahead of us. The date is the next event, so
       * the workspace stops asking for a decision about a meeting that has not
       * happened yet.
       */
      interviewScheduled: liveMode ? interviewIsUpcoming(toInterview(interviewOf(item))) : undefined,
      /**
       * Only the side that manages the arrangement is told to follow it up.
       * Recomputed locally rather than trusting the value fetched minutes ago,
       * using the same rule the server uses so the two cannot disagree.
       */
      interviewFollowUpDue: (() => {
        if (!liveMode) return undefined;
        const interview = interviewOf(item);
        if (!interview?.can_manage) return undefined;
        return interviewFollowUpDue(toInterview(interview));
      })(),
      /**
       * A proposed time this viewer has not answered. Only the *invited* side
       * sees it: the organiser is waiting for an answer, not owing one, and
       * telling both people to confirm would make the queue meaningless.
       */
      interviewAwaitingMyConfirmation: (() => {
        if (!liveMode) return undefined;
        const interview = interviewOf(item);
        if (!interview || interview.can_manage) return undefined;
        return (
          interview.status === "proposed" && interviewIsUpcoming(toInterview(interview))
        );
      })(),
    }),
    [liveMode, unreadByThread, liveThreads, interviewOf, engagementOf]
  );

  /** Signals for queue derivation — the same evidence the row labels use. */
  const queueSignalsFor = useCallback(
    (item: OwnerInteraction): QueueSignals => signalsFor(item),
    [signalsFor]
  );

  /** Live counts, so a queue never advertises work that is not there. */
  const queueCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of modeItems) {
      const key = deriveWorkQueue(item, queueSignalsFor(item), queuePreferences);
      if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
      if (isStarred(item)) counts.set("starred", (counts.get("starred") ?? 0) + 1);
      const until = queuePreferences.snoozedUntil(item.id);
      if (until !== null && until > Date.now()) {
        counts.set("snoozed", (counts.get("snoozed") ?? 0) + 1);
      }
    }
    return counts;
  }, [modeItems, queueSignalsFor, queuePreferences, isStarred]);

  /** Nothing outstanding anywhere — the honest "all caught up" signal. */
  const allCaughtUp = useMemo(
    () => WORK_QUEUE_ORDER.every((queue) => (queueCounts.get(queue.key) ?? 0) === 0),
    [queueCounts]
  );

  const DAY_MS = 24 * 60 * 60 * 1000;

  /** Queue evidence plus the two ages only reminders care about. */
  const reminderSignalsFor = useCallback(
    (item: OwnerInteraction): ReminderSignals => {
      const lastActivity = lastActivityByThread[item.id];
      const starredAt = (() => {
        const conversationId = conversationIdOf(item);
        const at = conversationId ? preferences[conversationId]?.starred_at : null;
        return at ? Date.parse(at) : Number.NaN;
      })();
      return {
        ...queueSignalsFor(item),
        ageDays: lastActivity ? Math.floor((Date.now() - lastActivity) / DAY_MS) : undefined,
        starredDays: Number.isFinite(starredAt)
          ? Math.floor((Date.now() - starredAt) / DAY_MS)
          : undefined,
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queueSignalsFor, lastActivityByThread, conversationIdOf, preferences]
  );

  /**
   * One quiet line, or nothing. Derived from the same queues the list uses, so
   * it can never mention work the list cannot show — and it disappears the
   * moment the work does, which is why it never needs to be dismissed.
   */
  const reminder = useMemo(
    () =>
      liveMode && flags.workState
        ? consolidatedReminder(modeItems, reminderSignalsFor, queuePreferences, isStarred)
        : null,
    [liveMode, flags.workState, modeItems, reminderSignalsFor, queuePreferences, isStarred]
  );

  /** Per-job workload, for someone hiring for more than one role at a time. */
  const jobSummaries = useMemo(
    () =>
      liveMode
        ? jobWorkloadSummaries(modeItems, queueSignalsFor, {
            preferences: queuePreferences,
            isStarred,
          })
        : [],
    [liveMode, modeItems, queueSignalsFor, queuePreferences, isStarred]
  );

  /** How many conversations are genuinely waiting on the other participant. */
  const waitingOnOthersCount = useMemo(
    () =>
      modeItems.filter(
        (item) => deriveWorkQueue(item, queueSignalsFor(item), queuePreferences) === "waiting_for_them"
      ).length,
    [modeItems, queueSignalsFor, queuePreferences]
  );

  const snoozedCount = useMemo(
    () =>
      modeItems.filter((item) => {
        const until = queuePreferences.snoozedUntil(item.id);
        return until !== null && until > Date.now();
      }).length,
    [modeItems, queuePreferences]
  );

  /**
   * Snooze quietens a *recommendation*, never the conversation: the thread stays
   * fully visible and actionable, and no status changes.
   */
  const applySnooze = useCallback(
    async (item: OwnerInteraction, until: Date | null) => {
      const conversationId = conversationIdOf(item);
      if (!conversationId || !backendAccessToken) return;
      try {
        const saved = await setConversationSnooze(
          backendAccessToken,
          conversationId,
          until ? until.toISOString() : null
        );
        setPreferences((current) => ({ ...current, [conversationId]: saved }));
        flashActionFeedback(until ? "Snoozed" : "Unsnoozed");
      } catch {
        setActionError("Couldn\u2019t save that. Try again.");
      }
    },
    [conversationIdOf, backendAccessToken, flashActionFeedback]
  );

  /** "No reply needed": corrects the recommendation, never the lifecycle. */
  const applyQueueDismissal = useCallback(
    async (item: OwnerInteraction, dismissed: boolean) => {
      const conversationId = conversationIdOf(item);
      if (!conversationId || !backendAccessToken) return;
      try {
        const saved = await setConversationQueueDismissed(
          backendAccessToken,
          conversationId,
          dismissed
        );
        setPreferences((current) => ({ ...current, [conversationId]: saved }));
        flashActionFeedback(dismissed ? "Marked as no reply needed" : "Back in your queue");
      } catch {
        setActionError("Couldn\u2019t save that. Try again.");
      }
    },
    [conversationIdOf, backendAccessToken, flashActionFeedback]
  );

  const selectedNextAction = useMemo(
    () => (selected && flags.nextAction ? nextBestActionFor(selected, signalsFor(selected)) : null),
    [selected, flags.nextAction, signalsFor]
  );

  const analyticsBase = useCallback(
    (item: OwnerInteraction): WorkspaceEventPayload => ({
      surface: "inbox",
      interactionKind: item.kind,
      direction: item.direction,
      stage: backendStatusOf(item),
      flagCohort: cohort,
    }),
    [cohort]
  );

  /**
   * The decision surface, opened either automatically on first deliberate open
   * or on demand from "Choose next step" / "Record decision". `reason` records
   * which trigger opened it so dismissal is remembered per trigger rather than
   * forever.
   */
  const [decisionSurface, setDecisionSurface] = useState<{
    itemId: string;
    reason: "first-open" | "requested";
  } | null>(null);
  /** Interactions whose auto-open has already been used or dismissed this session. */
  const decisionSeenRef = useRef<Set<string>>(new Set());
  const openedAtRef = useRef<{ id: string; at: number } | null>(null);
  /** Engagement controls, so "Confirm start" can bring them into view. */
  const engagementRef = useRef<HTMLDivElement | null>(null);

  const decisionDismissKey = userStorageKey(DECISION_STRIP_DISMISS_KEY, backendUserId);

  /** Persisted dismissals, user-scoped and schema-versioned. */
  const readDismissed = useCallback((): Record<string, number> => {
    try {
      const raw = window.localStorage.getItem(decisionDismissKey);
      if (!raw) return {};
      const parsed = JSON.parse(raw) as { v?: number; ids?: Record<string, number> };
      // A version bump retires old dismissals rather than honouring them forever.
      if (parsed?.v !== DECISION_STRIP_TRIGGER_VERSION) return {};
      return parsed.ids ?? {};
    } catch {
      return {};
    }
  }, [decisionDismissKey]);

  const rememberDismissed = useCallback(
    (itemId: string) => {
      try {
        const ids = { ...readDismissed(), [itemId]: Date.now() };
        window.localStorage.setItem(
          decisionDismissKey,
          JSON.stringify({ v: DECISION_STRIP_TRIGGER_VERSION, ids })
        );
      } catch {
        // Storage can be unavailable; the in-session ref still suppresses it.
      }
    },
    [decisionDismissKey, readDismissed]
  );

  /** Stage choices the surface offers, straight from the authoritative rules. */
  const decisionTargets = useMemo(() => {
    if (!selected) return [];
    return validStageTargetsFor(
      selected.kind,
      backendStatusOf(selected),
      selected.participantBackendStatus,
      selected.legacyArchiveResolutionRequired
    );
  }, [selected]);

  /**
   * Auto-open on the first deliberate open of a record that still needs a
   * decision. Only for the managing side, only when there is something to
   * choose, and never twice for the same record.
   */
  useEffect(() => {
    if (!flags.decisionStrip || !selected) return;
    if (selected.direction !== "received") return;
    if (isArchivedInteraction(selected) && !selected.legacyArchiveResolutionRequired) return;
    if (decisionTargets.length === 0) return;
    const stage = backendStatusOf(selected);
    if (!["new", "reviewing"].includes(stage) && !selected.legacyArchiveResolutionRequired) return;
    if (decisionSeenRef.current.has(selected.id)) return;
    if (readDismissed()[selected.id]) return;
    decisionSeenRef.current.add(selected.id);
    setDecisionSurface({ itemId: selected.id, reason: "first-open" });
    trackWorkspaceEvent("workspace.decision_strip.impression", analyticsBase(selected));
  }, [flags.decisionStrip, selected, decisionTargets.length, readDismissed, analyticsBase]);

  /** Time-to-action + abandonment instrumentation for the open record. */
  useEffect(() => {
    if (!selectedItemId) return;
    openedAtRef.current = { id: selectedItemId, at: Date.now() };
    const item = items.find((entry) => entry.id === selectedItemId);
    return () => {
      const opened = openedAtRef.current;
      if (opened && opened.id === selectedItemId && item) {
        trackWorkspaceEvent("workspace.interaction.abandoned", {
          ...analyticsBase(item),
          durationMs: Date.now() - opened.at,
        });
      }
    };
    // `items` is intentionally excluded: only a change of selection restarts the timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedItemId, analyticsBase]);

  /** A meaningful action happened — stop the timer and collapse the surface. */
  const noteMeaningfulAction = useCallback(
    (item: OwnerInteraction, actionKey: string) => {
      const opened = openedAtRef.current;
      if (opened && opened.id === item.id) {
        trackWorkspaceEvent("workspace.interaction.time_to_action", {
          ...analyticsBase(item),
          actionKey,
          durationMs: Date.now() - opened.at,
        });
        openedAtRef.current = null;
      }
      setDecisionSurface((current) => (current?.itemId === item.id ? null : current));
    },
    [analyticsBase]
  );

  /**
   * One dispatch path for every surface that can trigger a status action — the
   * overflow menu, the promoted primary button, and the decision surface — so
   * the three can never drift apart in behaviour or side effects.
   */
  const dispatchHeaderAction = (item: OwnerInteraction, action: HeaderAction) => {
      /*
        "Invite to interview" is the one stage move that needs specifics before
        it is worth sending. Routing it to the scheduling surface rather than the
        bare confirm dialog is what makes the invitation a real arrangement — and
        the surface still ends in the same authoritative transition, so there is
        no second path to the Interviewing stage.
      */
      if (liveMode && action.backendStatus === "interviewing" && item.kind === "application") {
        setInterviewError(null);
        setSchedulingFor(item.id);
        noteMeaningfulAction(item, action.key);
        return;
      }
      if (action.flow === "instant") {
        applyStatusAction(item, action);
        noteMeaningfulAction(item, action.key);
        return;
      }
      if (action.flow === "confirm") {
        setPendingActionKey(action.key);
        setPendingNote("");
        setActionError(null);
        return;
      }
      if (action.flow === "notify" && action.backendStatus) {
        setNotifyNote("");
        setNotifyPrompt({
          itemIds: [item.id],
          stageKey: action.backendStatus,
          kind: item.kind,
          phase: "ask",
        });
        noteMeaningfulAction(item, action.key);
        return;
      }
      if (action.flow === "archive") {
        void applyArchiveAction(item, action.archiveValue !== false);
        noteMeaningfulAction(item, action.key);
        return;
      }
    composerRef.current?.focus();
  };

  /**
   * Run the recommended action. Low-confidence recommendations open the decision
   * surface rather than committing anything, so the product never guesses an
   * outcome on the user's behalf.
   */
  const runNextAction = (item: OwnerInteraction, action: NextBestAction) => {
      trackWorkspaceEvent(
        action.key === "choose-next-step"
          ? "workspace.choose_next_step.activate"
          : "workspace.next_action.activate",
        { ...analyticsBase(item), actionKey: action.key, highConfidence: action.highConfidence }
      );
      switch (action.key) {
        case "reply":
          composerRef.current?.focus();
          return;
        case "choose-next-step":
        case "record-decision":
        case "resolve-legacy-stage":
          setDecisionSurface({ itemId: item.id, reason: "requested" });
          return;
        case "share-decision": {
          const share = headerActionsFor(item, liveMode).find((entry) => entry.flow === "notify");
          if (share) dispatchHeaderAction(item, share);
          return;
        }
        case "confirm-interview": {
          // The arrangement card owns the confirmation; bring it into view and
          // focus its control rather than duplicating a consequential action.
          document
            .querySelector("[data-testid='interview-card']")
            ?.scrollIntoView({ block: "center", behavior: "smooth" });
          document.querySelector<HTMLButtonElement>("[data-testid='interview-confirm']")?.focus();
          return;
        }
        case "confirm-start":
          // The engagement controls own this decision; bring them into view
          // rather than duplicating a consequential action.
        engagementRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
        return;
    }
  };


  if (liveMode && loadState === "loading") {
    return (
      <div
        className={`flex w-full items-center justify-center px-6 py-16 ${WORKSPACE_HEIGHT_CLASSES}`}
        data-testid="applications-workspace"
      >
        <p className="text-sm text-muted">Loading applications…</p>
      </div>
    );
  }

  if (liveMode && (loadState === "error" || loadState === "auth")) {
    return (
      <div
        className={`flex w-full items-center justify-center px-6 py-16 ${WORKSPACE_HEIGHT_CLASSES}`}
        data-testid="applications-workspace"
      >
        <div className="text-center">
          {loadState === "auth" ? (
            <>
              <p className="text-base font-semibold text-white/90">Your session has expired.</p>
              <p className="mx-auto mt-2 max-w-md text-sm text-white/55">
                Sign in again to load your applications and requests. Your saved data is safe.
              </p>
              <Link href="/auth?mode=login&next=/applications" className={`mt-5 inline-flex ${GHOST_BUTTON_CLASSES}`}>
                Sign in again
              </Link>
            </>
          ) : (
            <>
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
            </>
          )}
        </div>
      </div>
    );
  }

  // Keep the complete workspace shell mounted even when one account mode has no
  // records. Returning early here used to remove the mode/view controls and trap
  // dual-mode users on an inert-looking empty screen.
  const otherMode: WorkspaceMode = mode === "talent" ? "hiring" : "talent";
  const otherModeOption = modeOptions.find((option) => option.key === otherMode);
  const otherModeItems = items.filter((item) => item.mode === otherMode);
  const otherModeUnread =
    otherModeItems.reduce((count, item) => count + (unreadByThread[item.id] ?? 0), 0) ||
    otherModeItems.filter((item) => item.unread).length;

  const headerActions = selected ? headerActionsFor(selected, liveMode) : [];
  const pendingAction = headerActions.find(
    (action) => action.flow === "confirm" && action.key === pendingActionKey
  );
  const replyTemplates = selected ? quickReplyTemplates(selected) : [];
  // Accepted/hired interactions stay messageable while work is underway, even
  // though the pipeline groups them with completed outcomes.
  // In live mode the composer becomes active after the conversation loads; in
  // demo mode it appends locally.
  const liveThread = selected && liveMode ? liveThreads[selected.id] : undefined;
  const selectedInteractionBlocked = Boolean(liveThread?.conversation?.interaction_blocked);
  const selectedBlockedByMe = Boolean(liveThread?.conversation?.blocked_by_me);
  const selectedMessagingClosed = selected
    ? liveMode
      ? Boolean(liveThread?.conversation?.is_closed) || selectedInteractionBlocked
      : isMessagingClosedStatus(selected.status) || selectedInteractionBlocked
    : false;
  const selectedEngagement = liveThread?.engagement || null;
  /** The open record's arrangement, from whichever cache resolved it first. */
  const selectedInterview = selected && liveMode ? interviewOf(selected) : null;
  /**
   * The interview's own next step, when it has one. More specific than anything
   * the generic ladder can infer, and it is what the reader is looking at.
   *
   * A plain derivation rather than a memo: it sits below the loading early
   * returns, and the inputs are two field reads.
   */
  const interviewStep = liveMode ? interviewNextStep(toInterview(selectedInterview)) : null;
  const selectedActive = selected
    ? !selectedMessagingClosed && (!liveMode || Boolean(liveThread))
    : false;

  /**
   * The decision surface and the intent chips answer the same question, so only
   * one of them is ever on screen. The surface wins while it is open — it
   * already offers the decisions plus "Ask a question" — and the chips return
   * the moment it closes. Two stacked chip rows would just be clutter.
   */
  const decisionSurfaceOpen = Boolean(
    flags.decisionStrip && selected && decisionSurface?.itemId === selected.id && decisionTargets.length > 0
  );

  /** Intents worth offering here, filtered to transitions the backend allows. */
  const composerIntents =
    selected && liveMode
      ? intentsFor({
          direction: selected.direction,
          allowedStages: validStageTargetsFor(
            selected.kind,
            backendStatusOf(selected),
            selected.participantBackendStatus,
            selected.legacyArchiveResolutionRequired
          ).map((stage) => stage.key),
          messagingClosed: selectedMessagingClosed,
          stage: backendStatusOf(selected),
          engagementStatus: selectedEngagement?.status ?? null,
          // Only where the review flow is genuinely reachable.
          canReview: Boolean(
            selectedEngagement?.available_actions?.some(
              (action) => action === "write_review" || action === "edit_review"
            )
          ),
        })
      : [];

  const selectedConversationLoadFailed = selected
    ? Boolean(threadLoadErrors[selected.id]) && !liveThread
    : false;
  const liveMessages: ChatMessage[] =
    selected && liveMode && liveThread
      ? liveThread.messages.map((message) =>
          mapBackendMessage(message, selected.counterpartyName)
        )
      : [];
  const conversation = selected ? [...buildConversation(selected), ...liveMessages] : [];
  const latestOutgoingMessageId = [...conversation]
    .reverse()
    .find((message) => message.fromMe && message.kind !== "status")?.id;
  const typing = selectedConversationId ? typingByConversation[selectedConversationId] : null;
  const subtitle = selected ? subtitleFor(selected) : null;
  const forward = selected ? forwardLinkFor(selected) : null;
  const pipelineMenuItems: OverflowMenuItem[] = selected
    ? headerActions
        // Reply is handled by the always-visible composer, so it isn't duplicated here.
        .filter((action) => action.flow !== "reply")
        .map((action) => ({
        key: action.key,
        label: action.label,
        icon: action.icon,
        primary: action.primary,
        destructive: action.destructive,
        menuGroup: action.menuGroup,
        onClick: () => {
          trackWorkspaceEvent("workspace.overflow.use", {
            ...analyticsBase(selected),
            actionKey: action.key,
          });
          dispatchHeaderAction(selected, action);
        },
        disabled: Boolean(statusMutationKey),
        }))
    : [];
  const blockMenuItem: OverflowMenuItem[] =
    liveMode && backendAccessToken && selected?.counterpartyUserId
      ? [
          {
            key: selectedBlockedByMe ? "unblock-user" : "block-user",
            label: selectedBlockedByMe ? "Unblock user" : "Block user",
            icon: selectedBlockedByMe ? "check" : "x",
            destructive: !selectedBlockedByMe,
            menuGroup: "Safety",
            onClick: () => {
              if (selectedBlockedByMe) {
                void (async () => {
                  try {
                    await unblockUser(backendAccessToken, selected.counterpartyUserId as string);
                    setBlockConfirmOpen(false);
                    setRealtimeRefreshNonce((value) => value + 1);
                  } catch {
                    setActionError("Couldn’t unblock this user. Try again.");
                  }
                })();
                return;
              }
              setBlockConfirmOpen(true);
            },
          },
        ]
      : [];
  /**
   * Personal organisation lives in the overflow, not on the row: these quieten a
   * recommendation, they never change the relationship. Snooze durations are
   * coarse on purpose — a hiring decision does not need minute precision.
   */
  const preferenceMenuItems: OverflowMenuItem[] = selected && liveMode && conversationIdOf(selected)
    ? (() => {
        const conversationId = conversationIdOf(selected) as string;
        const preference = preferences[conversationId];
        const snoozedUntil = preference?.snoozed_until ? Date.parse(preference.snoozed_until) : null;
        const isSnoozed = snoozedUntil !== null && snoozedUntil > Date.now();
        const dismissed = Boolean(preference?.queue_dismissed);
        const at = (hours: number) => new Date(Date.now() + hours * 3_600_000);
        const items: OverflowMenuItem[] = [];

        if (isSnoozed) {
          items.push({
            key: "unsnooze",
            label: "Unsnooze",
            icon: "clock",
            menuGroup: "Just for you",
            onClick: () => void applySnooze(selected, null),
          });
        } else {
          items.push(
            {
              key: "snooze-later-today",
              label: "Snooze until later today",
              icon: "clock",
              menuGroup: "Just for you",
              onClick: () => void applySnooze(selected, at(4)),
            },
            {
              key: "snooze-tomorrow",
              label: "Snooze until tomorrow",
              icon: "clock",
              menuGroup: "Just for you",
              onClick: () => void applySnooze(selected, at(24)),
            },
            {
              key: "snooze-next-week",
              label: "Snooze for a week",
              icon: "clock",
              menuGroup: "Just for you",
              onClick: () => void applySnooze(selected, at(24 * 7)),
            }
          );
        }

        // Offered only when something is actually recommending a reply —
        // otherwise there is nothing to dismiss.
        const state = flags.workState ? deriveWorkState(selected, signalsFor(selected)) : null;
        const suggestsReply =
          state?.key === "needs_reply" || state?.key === "review_latest" || dismissed;
        if (suggestsReply) {
          items.push({
            key: "queue-dismissal",
            label: dismissed ? "Put back in my queue" : "No reply needed",
            icon: "check",
            menuGroup: "Just for you",
            onClick: () => void applyQueueDismissal(selected, !dismissed),
          });
        }
        return items;
      })()
    : [];

  const menuItems: OverflowMenuItem[] = [
    ...pipelineMenuItems,
    ...preferenceMenuItems,
    ...blockMenuItem,
  ];
  // The opening message carries the proposed rate inside its bubble; when there's
  // no opening message, surface the rate in the context card so it isn't lost.
  const hasOpeningMessage = selected
    ? Boolean(selected.message) || (selected.attachments?.length ?? 0) > 0
    : false;
  const contextCard = selected ? contextCardFor(selected) : null;
  /**
   * The creator view of the open record: its portfolio evidence, and the
   * structured commercial and client facts the job snapshot now carries.
   * Rendered only where there is something real to show.
   */
  const creatorView = selected ? creatorViewOf({ job: selected.job }) : null;
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
  /**
   * The list as rendered. The queue narrows what is shown but deliberately does
   * not feed selection normalisation — filtering your view should never throw
   * away the conversation you are reading.
   */
  /** Queues worth offering: those with work, plus the personal views. */
  const queueChips = ((): Array<{ key: string; label: string; count: number }> => {
    const chips: Array<{ key: string; label: string; count: number }> = [];
    const labels = new Map<string, string>();
    for (const queue of WORK_QUEUE_ORDER) {
      labels.set(queue.key, queue.label);
      const count = queueCounts.get(queue.key) ?? 0;
      if (count > 0) chips.push({ key: queue.key, label: queue.label, count });
    }
    for (const personal of ["starred", "snoozed"] as const) {
      const label = personal === "starred" ? "Saved" : "Snoozed";
      labels.set(personal, label);
      const count = queueCounts.get(personal) ?? 0;
      if (count > 0) chips.push({ key: personal, label, count });
    }
    /*
      One exception to "only offer queues that hold work": the queue the user is
      standing in. It can empty underneath them — unstar the last saved record
      and "Saved" has nothing left — and dropping it here would take the filter's
      name and its clear control off screen while the filter was still applied,
      leaving an empty list with no visible way out.
    */
    if (activeQueue && !chips.some((chip) => chip.key === activeQueue)) {
      chips.push({ key: activeQueue, label: labels.get(activeQueue) ?? "Queue", count: 0 });
    }
    return chips;
  })();

  const listItems = ((): OwnerInteraction[] => {
    if (!activeQueue) return visibleItems;
    if (activeQueue === "starred") return visibleItems.filter((item) => isStarred(item));
    if (activeQueue === "snoozed") {
      return visibleItems.filter((item) => {
        const until = queuePreferences.snoozedUntil(item.id);
        return until !== null && until > Date.now();
      });
    }
    return visibleItems.filter(
      (item) => deriveWorkQueue(item, queueSignalsFor(item), queuePreferences) === activeQueue
    );
  })();

  /**
   * Why the list is empty, when it is. Plain derivations: they sit below the
   * loading early returns and are a handful of comparisons.
   */
  const emptyState =
    listItems.length === 0
      ? emptyStateFor({
          mode,
          totalInMode: modeItems.length,
          filteredCount: visibleItems.length,
          visibleCount: listItems.length,
          filter,
          // The Inbox list has no search field of its own — the Pipeline owns
          // search — so this branch is structurally unreachable here. Passed
          // explicitly rather than omitted, so adding a search box later gets
          // the right empty state for free.
          searchTerm: "",
          activeQueue,
          allCaughtUp,
          snoozedCount,
        })
      : null;

  const caughtUp = caughtUpLine({
    mode,
    allCaughtUp,
    totalInMode: modeItems.length,
    waitingOnOthers: waitingOnOthersCount,
  });

  const notifyPromptItems = notifyPrompt
    ? notifyPrompt.itemIds
        .map((id) => items.find((item) => item.id === id))
        .filter((item): item is OwnerInteraction => Boolean(item))
    : [];

  /**
   * The Pipeline's layer 3, handed to the board so it renders inside the
   * board's own scope row rather than above it.
   *
   * Direction, stage focus, search and per-job filtering are one question —
   * "which records am I looking at" — and were split across three stacked bars.
   * The board already owned the last three; giving it the first collapses the
   * Pipeline to the same two bars the Inbox has.
   */
  const pipelineScopeLeading = (
    <>
      <div className="flex shrink-0 items-center gap-3" role="group" aria-label="Scope">
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
                "group/direction relative h-8 shrink-0 cursor-pointer whitespace-nowrap px-0.5 text-[13px] font-semibold transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
                isActive ? "text-ink" : "text-muted hover:text-default",
              ].join(" ")}
            >
              {option.label}
              {option.count > 0 ? (
                <span
                  className={[
                    "ml-1.5 text-[11px] font-medium tabular-nums",
                    isActive ? "text-secondary" : "text-subtle",
                  ].join(" ")}
                >
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
      </div>
      {/*
        Workload by job: a survey, and the Pipeline is the surveying lens — but
        a permanent row of cards pushed the board itself below the fold before
        anyone had asked the question. It keeps every capability, including the
        counts that route into a queue or a focused stage, behind one control
        that says how many jobs are in play.
      */}
      {shouldShowJobSummaries(jobSummaries) ? (
        <details className="group/workload relative shrink-0">
          <summary
            data-testid="job-summaries-toggle"
            className="inline-flex h-8 cursor-pointer list-none items-center gap-1.5 rounded-lg border border-line bg-raised px-2 text-[11.5px] font-semibold text-muted transition-colors hover:border-line-mid hover:text-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus [&::-webkit-details-marker]:hidden"
          >
            <Icon name="briefcase" className="h-3 w-3 shrink-0" aria-hidden="true" />
            <span className="hidden sm:inline">Workload by job</span>
            <span className="tabular-nums text-subtle">{jobSummaries.length}</span>
            <Icon
              name="chevron-right"
              className="h-3 w-3 shrink-0 transition-transform group-open/workload:rotate-90"
              aria-hidden="true"
            />
          </summary>
          <div
            data-testid="job-summaries"
            className="absolute left-0 top-[calc(100%+8px)] z-30 flex max-w-[min(92vw,760px)] gap-2.5 overflow-x-auto rounded-2xl border border-line-mid bg-overlay p-2.5 elev-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            role="group"
            aria-label="Workload by job"
          >
            {jobSummaries.map((summary) => (
              <div
                key={summary.jobKey}
                data-testid="job-summary"
                className="surface-raised min-w-[196px] shrink-0 rounded-xl border border-line px-3 py-2.5 elev-2"
              >
                <p className="truncate text-[12px] font-semibold text-ink" title={summary.title}>
                  {summary.title}
                </p>
                {/*
                  Two facts, ranked: how much is here, and how much of it is
                  yours. "Needs you" is the actionable half, so it carries the
                  weight and the attention hue; the total stays quiet.
                */}
                <p className="mt-1 flex items-baseline gap-1.5 text-[11px]">
                  <span className="tabular-nums text-muted">{summary.activeCount} active</span>
                  {summary.outstandingCount > 0 ? (
                    <>
                      <span aria-hidden="true" className="text-disabled">·</span>
                      <span className="font-semibold tabular-nums text-state-interview">
                        {summary.outstandingCount} need you
                      </span>
                    </>
                  ) : null}
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {summary.counts.map((entry) => (
                    <button
                      key={entry.key}
                      type="button"
                      data-testid={`job-summary-count-${entry.key}`}
                      onClick={() => {
                        if (entry.target.kind === "queue") {
                          setActiveQueue(entry.target.queue as typeof activeQueue);
                        } else if (entry.target.kind === "starred") {
                          setActiveQueue("starred");
                        } else {
                          // A stage is a Pipeline question; take the user there
                          // with the stage focused rather than approximating it
                          // with an inbox filter that means something else.
                          setActiveQueue(null);
                          onPipelineStageChange?.(entry.target.stage);
                          setView("pipeline");
                        }
                      }}
                      className="inline-flex h-6 cursor-pointer items-center gap-1 rounded-md bg-wash px-1.5 text-[10.5px] font-medium text-secondary transition-colors hover:bg-wash-strong hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                    >
                      {entry.label}
                      <span className="tabular-nums text-subtle">{entry.count}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </details>
      ) : null}
      {/* At-a-glance board readout: total · new arrivals · furthest active stage. */}
      {pipelineSummary ? (
        <p
          data-testid="pipeline-summary"
          className="hidden min-w-0 shrink truncate text-[11px] font-medium text-subtle lg:block"
        >
          {pipelineSummary}
        </p>
      ) : null}
    </>
  );

  return (
    // One stable shell for both views: the controls stay in the same top-left
    // location, and the Inbox conversation header aligns with that workspace row.
    <div className={`relative flex w-full flex-col ${WORKSPACE_HEIGHT_CLASSES}`} data-testid="applications-workspace">
      {view === "pipeline" ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <ApplicationsWorkspaceNavigation
            mode={mode}
            modeOptions={modeOptions}
            onModeChange={onModeChange}
            view={view}
            onViewChange={setView}
            ready={controlsReady}
          />
          {actionError ? (
            <p className="mx-4 mt-3 rounded-xl border border-amber-200/25 bg-amber-200/10 px-4 py-2.5 text-xs text-amber-100 sm:mx-6">
              {actionError}
            </p>
          ) : null}
          {actionPending ? (
            <p aria-live="polite" className="mx-4 mt-3 rounded-xl border border-line bg-raised px-4 py-2.5 text-xs text-white/65 sm:mx-6">
              Updating…
            </p>
          ) : null}
          {actionFeedback ? (
            <p className="mx-4 mt-3 rounded-xl border border-emerald-300/20 bg-emerald-300/[0.08] px-4 py-2.5 text-xs text-emerald-100 sm:mx-6">
              {actionFeedback}
            </p>
          ) : null}
          <div className="min-h-0 flex-1">
            <PipelineBoard
              key={`${mode}-${pipelineDirection}`}
              items={pipelineItems}
              kind={pipelineKind}
              direction={pipelineDirection}
              scopeLeading={pipelineScopeLeading}
              unreadByThread={unreadByThread}
              initialStage={pipelineStage}
              onStageFocusChange={onPipelineStageChange}
              onMessage={(item) =>
                setChatRequest((prev) => ({ id: item.id, nonce: (prev?.nonce ?? 0) + 1 }))
              }
              onMoveStage={handleMoveStage}
              // Both views read from the same functions, so they can never
              // disagree about what a record needs or what to do next.
              workStateFor={
                flags.workState ? (item) => deriveWorkState(item, signalsFor(item)) : undefined
              }
              nextActionFor={
                flags.nextAction ? (item) => nextBestActionFor(item, signalsFor(item)) : undefined
              }
              onNextAction={(item, action) => {
                trackWorkspaceEvent("workspace.next_action.activate", {
                  ...analyticsBase(item),
                  surface: "pipeline",
                  actionKey: action.key,
                  highConfidence: action.highConfidence,
                });
                if (action.key === "share-decision") {
                  const share = headerActionsFor(item, liveMode).find(
                    (entry) => entry.flow === "notify"
                  );
                  if (share) dispatchHeaderAction(item, share);
                  return;
                }
                // Reply and start-confirmation both continue in the conversation.
                setChatRequest((prev) => ({ id: item.id, nonce: (prev?.nonce ?? 0) + 1 }));
              }}
            />
          </div>
        </div>
      ) : (
      /*
        Three layers, not three identical panes. The list sits on `panel`, the
        conversation on `shell` with the canvas gradient behind it, and the cards
        inside each are `raised`. Tone does the separating; the hairline is only
        there to keep the edge crisp.
      */
      <div className="surface-canvas min-h-0 flex-1 lg:grid lg:grid-cols-[390px_minmax(0,1fr)]">
        <aside
          className={[
            "bg-shell border-line lg:flex lg:min-h-0 lg:flex-col lg:border-r",
            mobileDetailOpen ? "hidden lg:flex" : "block",
          ].join(" ")}
        >
          <ApplicationsWorkspaceNavigation
            mode={mode}
            modeOptions={modeOptions}
            onModeChange={onModeChange}
            view={view}
            onViewChange={setView}
            ready={controlsReady}
          />
          {/*
            Layer 3. Ownership tabs and the queue disclosure share this row;
            when there is no queue to offer, the row's trailing slot carries a
            readout instead — the unread total, or the caught-up line. Both used
            to be bars of their own, which spent two navigation levels on text
            nobody can click.
          */}
          <InteractionScopeControl
            mode={mode}
            filter={filter}
            counts={filterCounts}
            onSelect={selectFilter}
            queueChips={flags.workState ? queueChips : []}
            activeQueue={flags.workState ? activeQueue : null}
            onQueueSelect={
              flags.workState ? (key) => setActiveQueue(key as typeof activeQueue) : undefined
            }
            trailing={
              totalUnreadCount > 0 ? (
                <p
                  data-testid="inbox-unread-total"
                  className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-white/80" aria-hidden="true" />
                  {totalUnreadCount} unread
                </p>
              ) : flags.workState && listItems.length > 0 && caughtUp ? (
                <p data-testid="all-caught-up" className="shrink-0 truncate text-[11px] text-muted">
                  {caughtUp}
                </p>
              ) : null
            }
          />

          <div className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
            {/*
              One reminder at a time, and only when something has genuinely been
              sitting. It is a route, not a nag: activating it filters the list
              to exactly what it counted. There is no dismiss — the line
              disappears when the work does, which is the only honest way to
              close it.

              It rides at the top of the list rather than in a bar above it: a
              conditional nudge that shifts three navigation rows down whenever
              it appears is a worse cost than one that scrolls with the work it
              is pointing at.
            */}
            {reminder ? (
              <button
                type="button"
                data-testid="work-reminder"
                data-reminder-key={reminder.key}
                onClick={() => setActiveQueue(reminder.queue as typeof activeQueue)}
                className="group mx-3 mt-2.5 flex w-[calc(100%-1.5rem)] shrink-0 cursor-pointer items-center gap-2.5 rounded-lg border border-line bg-raised px-3 py-2 text-left text-[11.5px] text-secondary transition-colors hover:border-line-mid hover:bg-elevated hover:text-ink"
              >
                <Icon
                  name="clock"
                  className="h-3.5 w-3.5 shrink-0 text-state-interview"
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1 leading-snug">{reminder.text}</span>
                <span className="shrink-0 text-[11px] font-semibold text-muted transition-colors group-hover:text-ink">
                  Show
                </span>
              </button>
            ) : null}
            {listItems.length === 0 ? (
              <div
                data-testid="inbox-empty-state"
                data-empty-reason={emptyState?.reason ?? "unknown"}
                className="px-6 py-12 text-center"
              >
                <p className="text-[13px] font-medium text-white/85">
                  {emptyState?.title ?? "Nothing in this section yet."}
                </p>
                {emptyState?.body ? (
                  <p className="mx-auto mt-1.5 max-w-[320px] text-xs leading-relaxed text-white/60">
                    {emptyState.body}
                  </p>
                ) : null}
                {emptyState?.action ? (
                  emptyState.action.kind === "browse" ? (
                    <Link
                      href="/jobs"
                      data-testid="inbox-empty-action"
                      className="mt-4 inline-flex h-8 items-center rounded-lg border border-line-mid bg-raised px-3 text-[11.5px] font-semibold text-white/80 transition-colors hover:bg-overlay"
                    >
                      {emptyState.action.label}
                    </Link>
                  ) : (
                    <button
                      type="button"
                      data-testid="inbox-empty-action"
                      onClick={() => {
                        const kind = emptyState.action?.kind;
                        if (kind === "clear-queue") setActiveQueue(null);
                        else {
                          setActiveQueue(null);
                          selectFilter("all");
                        }
                      }}
                      className="mt-4 inline-flex h-8 cursor-pointer items-center rounded-lg border border-line-mid bg-raised px-3 text-[11.5px] font-semibold text-white/80 transition-colors hover:bg-overlay"
                    >
                      {emptyState.action.label}
                    </button>
                  )
                ) : null}
              </div>
            ) : (
              <div className="divide-y divide-white/[0.05]">
                {listItems.map((item) => {
                  const isSelected = item.id === selectedItemId;
                  // Real unread message count for this thread (live mode); demo data
                  // still drives the simple "new" dot via item.unread.
                  const messageUnread = liveMode ? unreadByThread[item.id] ?? 0 : 0;
                  const rowUnread = Boolean(item.unread) || messageUnread > 0;
                  const rowWorkState = flags.workState ? deriveWorkState(item, signalsFor(item)) : null;
                  const rowAction = flags.nextAction ? nextBestActionFor(item, signalsFor(item)) : null;
                  // Calm by default. A row earns a button only when it needs a
                  // well-evidenced action *and* is not the open row — the detail
                  // header already carries the action for that one, and showing
                  // both reads as duplication. Low-confidence suggestions never
                  // take row space at all; the work-state label is enough.
                  const showRowAction = Boolean(rowAction?.highConfidence) && !isSelected;
                  return (
                    <div key={item.id}>
                    <button
                      type="button"
                      data-testid="interaction-row"
                      // The record's own identifier. Lets a spec address one
                      // row by meaning — via the scenario index — instead of by
                      // a display name or a position, both of which move.
                      data-record-id={item.id}
                      aria-pressed={isSelected}
                      onClick={() => handleSelect(item.id)}
                      className={[
                        /*
                          The open row is a lit band, not a 1px rule. A 3px
                          accent edge, a leftward tonal wash, and a raised
                          background make the selection unmistakable at a glance
                          without brightening every other row to compete.
                        */
                        "group/time-owner relative flex w-full cursor-pointer items-start gap-3 px-4 py-3 text-left",
                        "transition-[background-color,box-shadow] duration-150",
                        isSelected
                          ? "surface-selected bg-raised"
                          : "hover:bg-wash",
                      ].join(" ")}
                    >
                      {isSelected ? (
                        <span
                          aria-hidden="true"
                          className="absolute inset-y-0 left-0 w-[3px] rounded-r-full bg-ink"
                        />
                      ) : null}
                      <span className="relative shrink-0">
                        <InteractionAvatar name={item.counterpartyName} src={item.counterpartyAvatarUrl} />
                        {/*
                          The direction of the relationship, as a mark on the
                          avatar rather than a line of backend vocabulary above
                          the person's name. The accessible name carries the
                          full phrase, so nothing is lost to a screen reader.
                        */}
                        <span
                          className="absolute -bottom-0.5 -right-0.5 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-elevated text-subtle ring-2 ring-shell"
                          title={interactionKindLabel(item)}
                        >
                          <span className="sr-only">{interactionKindLabel(item)}</span>
                          <Icon
                            name={item.direction === "received" ? "arrow-down-left" : "arrow-up-right"}
                            className="h-2 w-2"
                          />
                        </span>
                      </span>
                      <div className="min-w-0 flex-1">
                        {/* The person leads. Everything else is context for them. */}
                        <div className="flex items-baseline justify-between gap-2">
                          <span
                            className={[
                              "truncate text-[13.5px] leading-5",
                              rowUnread ? "font-semibold text-ink" : "font-medium text-default",
                            ].join(" ")}
                          >
                            {item.title}
                          </span>
                          <span className="flex shrink-0 items-center gap-1.5">
                            {isStarred(item) ? (
                              <span
                                data-testid="row-starred"
                                aria-label="Saved"
                                title="Saved"
                                className="inline-flex shrink-0 text-state-interview"
                              >
                                <Icon name="bookmark" className="h-3 w-3" />
                              </span>
                            ) : null}
                            {messageUnread > 0 ? (
                              <span
                                data-testid="inbox-unread-badge"
                                aria-label={`${messageUnread} unread message${messageUnread === 1 ? "" : "s"}`}
                                className="inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-ink px-1 text-[10px] font-semibold leading-none text-black"
                              >
                                {formatBadgeCount(messageUnread)}
                              </span>
                            ) : null}
                            {/* One fixed home for the timestamp, always last. */}
                            <InteractionTime value={item.updatedAt} className="text-[11px] tabular-nums text-subtle" />
                            {/* Same information a pointer gets from the tooltip. */}
                            <AbsoluteTimeOnFocus value={item.updatedAt} />
                          </span>
                        </div>
                        <p className="mt-0.5 truncate text-[12px] leading-4 text-muted">{rowSubtitle(item)}</p>
                        <div className="mt-1.5 flex items-center justify-between gap-2">
                          <span className="truncate text-[12px] leading-4 text-subtle">
                            {rowSnippet(item)}
                          </span>
                          {/*
                            Exactly one state indicator. When a row has a work
                            state, that is the more useful of the two — the
                            lifecycle stage stays available in the detail header
                            and on the Pipeline, so showing both here would just
                            be a badge cluster.
                          */}
                          {rowWorkState ? (
                            <WorkStateChip state={rowWorkState} />
                          ) : (
                            <StatusPill status={item.status} />
                          )}
                        </div>
                      </div>
                    </button>
                    {/*
                      Sibling, not a child: a button may not nest inside the row
                      button. Rendered in flow beneath the row content so it can
                      never overlap the timestamp. Desktop only — on mobile the
                      action lives in the opened conversation instead.
                    */}
                    {showRowAction && rowAction ? (
                      <div className="hidden justify-end px-4 pb-2.5 sm:flex">
                        <button
                          type="button"
                          data-testid="row-next-action"
                          data-action-key={rowAction.key}
                          onClick={() => {
                            handleSelect(item.id);
                            runNextAction(item, rowAction);
                          }}
                          className="inline-flex h-7 cursor-pointer items-center rounded-lg border border-line-mid bg-raised px-2.5 text-[11px] font-semibold text-white/85 transition-colors hover:bg-overlay"
                        >
                          {rowAction.label}
                        </button>
                      </div>
                    ) : null}
                    </div>
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
              <div className="bg-panel flex min-w-0 flex-col lg:min-h-0 lg:border-r lg:border-line">
                {/*
                  Header bar. Given its own tone and a hairline so it reads as
                  chrome the conversation scrolls *under*, rather than as the
                  first message in the thread.
                */}
                <div
                  className="bg-raised flex shrink-0 items-center justify-between gap-3 border-b border-line px-3 py-2.5 sm:px-5"
                  data-testid="applications-detail-header"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <button
                      type="button"
                      onClick={() => setMobileDetailOpen(false)}
                      aria-label="Back to applications"
                      className="-ml-1 inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-lg text-white/65 transition-colors hover:bg-elevated hover:text-white lg:hidden"
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
                        <span className="min-w-0">
                          <h1 className="truncate text-[15px] font-semibold leading-tight text-ink">
                            {subtitle.lead}
                          </h1>
                          <span className="flex items-center gap-1.5 text-[11.5px] leading-4">
                            <span className="truncate text-muted">{rowSubtitle(selected)}</span>
                            <span aria-hidden="true" className="text-disabled">·</span>
                            <span className="inline-flex shrink-0 items-center gap-1 font-medium text-secondary">
                              <span
                                aria-hidden="true"
                                className={`h-1.5 w-1.5 rounded-full ${statusDotClass(selected)}`}
                              />
                              {interactionStatusLabel(selected.status)}
                            </span>
                          </span>
                        </span>
                      </Link>
                    ) : (
                      <div className="flex min-w-0 items-center gap-2.5">
                        <InteractionAvatar
                          name={subtitle?.avatarName ?? selected.counterpartyName}
                          src={subtitle?.avatarSrc ?? selected.counterpartyAvatarUrl}
                          sizeClasses="h-9 w-9"
                        />
                        <span className="min-w-0">
                          <h1 className="truncate text-[15px] font-semibold leading-tight text-ink">
                            {subtitle?.lead ?? selected.counterpartyName}
                          </h1>
                          <span className="flex items-center gap-1.5 text-[11.5px] leading-4">
                            <span className="truncate text-muted">{rowSubtitle(selected)}</span>
                            <span aria-hidden="true" className="text-disabled">·</span>
                            <span className="inline-flex shrink-0 items-center gap-1 font-medium text-secondary">
                              <span
                                aria-hidden="true"
                                className={`h-1.5 w-1.5 rounded-full ${statusDotClass(selected)}`}
                              />
                              {interactionStatusLabel(selected.status)}
                            </span>
                          </span>
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2.5">
                    {/*
                      The recommended action, promoted out of the overflow menu.
                      Exactly one, so the header never presents competing
                      primaries; everything else stays under More.
                    */}
                    {/*
                      Personal organisation, so it stays quiet: an icon toggle
                      rather than a labelled button competing with the
                      recommended action. Never visible to the counterparty.
                    */}
                    {liveMode && conversationIdOf(selected) ? (
                      <button
                        type="button"
                        data-testid="star-toggle"
                        aria-pressed={isStarred(selected)}
                        aria-label={isStarred(selected) ? "Remove from saved" : "Save for later"}
                        title={isStarred(selected) ? "Saved" : "Save for later"}
                        onClick={() => void toggleStar(selected)}
                        className={[
                          "inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg transition-colors",
                          isStarred(selected)
                            ? "text-state-interview hover:bg-wash-strong"
                            : "text-subtle hover:bg-wash-strong hover:text-default",
                        ].join(" ")}
                      >
                        <Icon name={isStarred(selected) ? "bookmark" : "bookmark"} className="h-4 w-4" />
                      </button>
                    ) : null}
                    {/*
                      An arranged interview names its own next step, and that is
                      always more specific than the generic ladder can be. It
                      replaces the primary action rather than sitting beside it,
                      so there is still exactly one obvious thing to do.
                    */}
                    {interviewStep ? (
                      <button
                        type="button"
                        data-testid="next-action-primary"
                        data-action-key={`interview-${interviewStep.key}`}
                        disabled={interviewBusy || Boolean(statusMutationKey)}
                        onClick={() => {
                          if (interviewStep.key === "record-decision") {
                            setDecisionSurface({ itemId: selected.id, reason: "requested" });
                            return;
                          }
                          const scrollTarget = document.querySelector(
                            "[data-testid='interview-card']"
                          );
                          scrollTarget?.scrollIntoView({ block: "center", behavior: "smooth" });
                          const control = document.querySelector<HTMLButtonElement>(
                            interviewStep.key === "confirm"
                              ? "[data-testid='interview-confirm']"
                              : "[data-testid='interview-complete']"
                          );
                          control?.focus();
                        }}
                        className="surface-primary hidden h-8 cursor-pointer items-center rounded-lg px-3 text-[12px] font-semibold text-black transition-all elev-2 hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50 sm:inline-flex"
                      >
                        {interviewStep.label}
                      </button>
                    ) : selectedNextAction ? (
                      <button
                        type="button"
                        data-testid="next-action-primary"
                        data-action-key={selectedNextAction.key}
                        disabled={Boolean(statusMutationKey)}
                        onClick={() => runNextAction(selected, selectedNextAction)}
                        className={[
                          "hidden h-8 cursor-pointer items-center rounded-lg px-3 text-[12px] font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-50 sm:inline-flex",
                          selectedNextAction.highConfidence
                            ? "surface-primary text-black elev-2 hover:brightness-105"
                            : "border border-line-mid bg-raised text-default elev-1 hover:bg-elevated hover:text-ink",
                        ].join(" ")}
                      >
                        {selectedNextAction.label}
                      </button>
                    ) : null}
                    <OverflowMenu items={menuItems} />
                  </div>
                </div>

                <div
                  ref={conversationScrollRef}
                  className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto"
                >
                    <div className="mx-auto w-full max-w-[860px] px-4 py-6 sm:px-6">
                      {actionError ? (
                        <p className="mb-5 rounded-xl border border-amber-200/25 bg-amber-200/10 px-4 py-3 text-xs text-amber-100">
                          {actionError}
                        </p>
                      ) : null}
                      {actionPending ? (
                        <p aria-live="polite" className="mb-5 rounded-xl border border-line bg-raised px-4 py-3 text-xs text-white/65">
                          Updating…
                        </p>
                      ) : null}
                      {actionFeedback ? (
                        <p className="mb-5 rounded-xl border border-emerald-300/20 bg-emerald-300/[0.08] px-4 py-3 text-xs text-emerald-100">
                          {actionFeedback}
                        </p>
                      ) : null}
                      {/*
                        Interview coordination sits above the engagement row and
                        below the feedback lines: it is the most immediate thing
                        about this conversation while a meeting is arranged, and
                        it disappears entirely when there is nothing arranged.
                      */}
                      {liveMode && schedulingFor === selected.id ? (
                        <InterviewScheduler
                          interview={toInterview(selectedInterview)}
                          counterpartyName={firstNameOf(selected.counterpartyName)}
                          busy={interviewBusy}
                          error={interviewError}
                          onSubmit={(submission) => submitInterview(selected, submission)}
                          onClose={() => {
                            setSchedulingFor(null);
                            setInterviewError(null);
                          }}
                        />
                      ) : null}
                      {liveMode && selectedInterview && schedulingFor !== selected.id ? (
                        <InterviewCard
                          interview={toInterview(selectedInterview) as NonNullable<ReturnType<typeof toInterview>>}
                          counterpartyName={firstNameOf(selected.counterpartyName)}
                          busy={interviewBusy}
                          onReschedule={() => {
                            setInterviewError(null);
                            setSchedulingFor(selected.id);
                          }}
                          onConfirm={() =>
                            void runInterviewMutation(
                              selected,
                              (accessToken, conversationId) =>
                                confirmInterview(
                                  accessToken,
                                  conversationId,
                                  selectedInterview.version,
                                  crypto.randomUUID()
                                ),
                              "Interview confirmed"
                            )
                          }
                          onComplete={() =>
                            void runInterviewMutation(
                              selected,
                              (accessToken, conversationId) =>
                                completeInterview(
                                  accessToken,
                                  conversationId,
                                  selectedInterview.version,
                                  crypto.randomUUID()
                                ),
                              "Marked done \u2014 only you can see this"
                            )
                          }
                          onCancel={() =>
                            void runInterviewMutation(
                              selected,
                              (accessToken, conversationId) =>
                                cancelInterview(
                                  accessToken,
                                  conversationId,
                                  selectedInterview.version,
                                  crypto.randomUUID()
                                ),
                              "Interview cancelled"
                            )
                          }
                        />
                      ) : null}
                      {interviewError && schedulingFor !== selected.id ? (
                        <p
                          role="alert"
                          className="mb-5 rounded-xl border border-amber-200/25 bg-amber-200/10 px-4 py-3 text-xs text-amber-100"
                        >
                          {interviewError}
                        </p>
                      ) : null}
                      {selectedEngagement && backendAccessToken ? (
                        <div ref={engagementRef}>
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
                        </div>
                      ) : null}
                      {blockConfirmOpen && selected.counterpartyUserId && backendAccessToken ? (
                        <section className={`mb-6 rounded-xl ${SURFACE} p-4`} data-testid="block-user-confirmation">
                          <p className="text-sm font-semibold text-white/90">Block {selected.counterpartyName}?</p>
                          <p className="mt-1 text-xs leading-relaxed text-white/55">
                            You will keep this history, but neither of you can send new messages or start a new marketplace interaction.
                          </p>
                          <div className="mt-3 flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                void (async () => {
                                  try {
                                    await blockUser(backendAccessToken, selected.counterpartyUserId as string);
                                    setBlockConfirmOpen(false);
                                    setRealtimeRefreshNonce((value) => value + 1);
                                  } catch {
                                    setActionError("Couldn’t block this user. Try again.");
                                  }
                                })();
                              }}
                              className="inline-flex h-8 cursor-pointer items-center rounded-lg bg-rose-300/12 px-3 text-xs font-semibold text-rose-100 transition-colors hover:bg-rose-300/18"
                            >
                              Block user
                            </button>
                            <button
                              type="button"
                              onClick={() => setBlockConfirmOpen(false)}
                              className={GHOST_BUTTON_CLASSES}
                            >
                              Cancel
                            </button>
                          </div>
                        </section>
                      ) : null}
                      {conversation.length > 0 ? (
                        <div className="space-y-5">
                          {groupThreadEntries(conversation).map((entry) =>
                            entry.type === "system-group" ? (
                              <SystemEventGroup
                                key={entry.id}
                                summary={entry.summary}
                                events={entry.events}
                              />
                            ) : entry.message.kind === "status" ? (
                              <StatusUpdateLine key={entry.message.id} message={entry.message} />
                            ) : (
                              <MessageBubble
                                key={entry.message.id}
                                message={entry.message}
                                counterpartyAvatarUrl={selected.counterpartyAvatarUrl}
                                counterpartyHref={subtitle?.href ?? null}
                                showSeen={
                                  entry.message.id === latestOutgoingMessageId &&
                                  Boolean(entry.message.readByRecipient)
                                }
                              />
                            )
                          )}
                        </div>
                      ) : (
                        <div className="flex min-h-[220px] flex-col items-center justify-center rounded-2xl border border-dashed border-line bg-white/[0.012] px-6 py-12 text-center">
                          <p className="text-sm font-medium text-white/55">No messages yet.</p>
                          <p className="mx-auto mt-1 max-w-xs text-xs text-subtle">
                            {selectedActive
                              ? "Start the conversation with a quick reply below."
                              : "There aren’t any messages on this thread yet."}
                          </p>
                        </div>
                      )}
                      {typing ? (
                        <p data-testid="conversation-typing" className="mt-4 px-1 text-xs font-medium text-muted">
                          {firstNameOf(selected.counterpartyName)} is typing…
                        </p>
                      ) : null}
                    </div>
                  </div>

                  {/* Composer / resolution — pinned to the foot of the conversation */}
                  <div className="shrink-0 border-t border-line px-4 py-3 sm:px-6">
                    <div className="mx-auto w-full max-w-[860px]">
                      {/*
                        The decision surface sits in normal flow directly above
                        the composer: prominent, but structurally incapable of
                        covering it. It never receives focus on mount, so it
                        cannot interrupt typing.
                      */}
                      {flags.decisionStrip &&
                      decisionSurface?.itemId === selected.id &&
                      decisionTargets.length > 0 ? (
                        <DecisionStrip
                          item={selected}
                          targets={decisionTargets}
                          headline={
                            selected.legacyArchiveResolutionRequired
                              ? "Where does this belong now?"
                              : `What's next for ${firstNameOf(selected.counterpartyName)}?`
                          }
                          onPick={(stageKey) => {
                            const action = headerActions.find(
                              (entry) => entry.backendStatus === stageKey && entry.flow !== "reply"
                            );
                            trackWorkspaceEvent("workspace.decision_strip.action", {
                              ...analyticsBase(selected),
                              actionKey: action?.key ?? `stage-${stageKey}`,
                            });
                            if (action) dispatchHeaderAction(selected, action);
                            setDecisionSurface(null);
                          }}
                          onAskQuestion={() => {
                            trackWorkspaceEvent("workspace.decision_strip.bypass", analyticsBase(selected));
                            setDecisionSurface(null);
                            composerRef.current?.focus();
                          }}
                          onDismiss={() => {
                            trackWorkspaceEvent("workspace.decision_strip.dismiss", analyticsBase(selected));
                            rememberDismissed(selected.id);
                            setDecisionSurface(null);
                          }}
                        />
                      ) : null}
                      {selectedInteractionBlocked ? (
                        <div className="flex flex-col items-center gap-2 py-1 text-center sm:flex-row sm:justify-between sm:gap-3 sm:text-left">
                          <p className="text-xs text-muted">
                            {selectedBlockedByMe
                              ? `You blocked ${firstNameOf(selected.counterpartyName)}. This history remains available.`
                              : "This conversation is unavailable for new messages."}
                          </p>
                          {selectedBlockedByMe && selected.counterpartyUserId && backendAccessToken ? (
                            <button
                              type="button"
                              onClick={() => {
                                void (async () => {
                                  try {
                                    await unblockUser(backendAccessToken, selected.counterpartyUserId as string);
                                    setRealtimeRefreshNonce((value) => value + 1);
                                  } catch {
                                    setActionError("Couldn’t unblock this user. Try again.");
                                  }
                                })();
                              }}
                              className="inline-flex shrink-0 items-center text-xs font-medium text-white/75 transition-colors hover:text-white"
                            >
                              Unblock
                            </button>
                          ) : null}
                        </div>
                      ) : selectedMessagingClosed ? (
                        <div className="flex flex-col items-center gap-1.5 py-1 text-center sm:flex-row sm:justify-between sm:gap-3 sm:text-left">
                          <p className="text-xs text-muted">{resolutionLine(selected)}</p>
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
                          {/*
                            Optional accelerators. Typing and sending never
                            requires touching these: they only pre-fill an
                            editable draft (and record that the message asked
                            for something), or hand off to the existing
                            confirmed action for a consequential outcome. No
                            intent is ever required to send.
                          */}
                          {/*
                            Demo mode has no backend to record an intent on, so
                            it keeps the original quick-reply chips: same
                            affordance, no promise of persistence it cannot keep.
                          */}
                          {!liveMode && replyTemplates.length > 0 ? (
                            <div className="mb-2 flex flex-wrap gap-1.5">
                              {replyTemplates.map((template) => (
                                <button
                                  key={`${selected.id}-template-${template.label}`}
                                  type="button"
                                  onClick={() => {
                                    handleReplyDraftChange(
                                      replyDraft.trim()
                                        ? `${replyDraft.trimEnd()} ${template.text}`
                                        : template.text
                                    );
                                    composerRef.current?.focus();
                                  }}
                                  className="inline-flex h-7 cursor-pointer items-center rounded-full border border-line bg-transparent px-2.5 text-[11px] font-medium text-white/55 transition-colors hover:bg-raised hover:text-white/85"
                                >
                                  {template.label}
                                </button>
                              ))}
                            </div>
                          ) : null}
                          {/*
                            One chip row at a time. The decision surface and the
                            scheduling surface each already offer their own
                            choices; a third row underneath would read as three
                            competing menus for the same conversation.
                          */}
                          {composerIntents.length > 0 &&
                          !decisionSurfaceOpen &&
                          schedulingFor !== selected.id ? (
                            <div className="mb-2 flex flex-wrap gap-1.5" data-testid="composer-intents">
                              {composerIntents.map((intent) => {
                                const active = pendingIntent === intent.key;
                                return (
                                  <button
                                    key={`${selected.id}-intent-${intent.key}`}
                                    type="button"
                                    data-testid={`composer-intent-${intent.key}`}
                                    aria-pressed={intent.kind === "message" ? active : undefined}
                                    onClick={() => {
                                      /*
                                        The one engagement action offered, and
                                        only because this flow exists. It is
                                        wired here rather than left to fall
                                        through to the message branch, where it
                                        would have focused the composer and done
                                        nothing a reader could interpret.
                                      */
                                      if (intent.key === "leave_review") {
                                        if (selectedEngagement) {
                                          void openEngagementReview(selectedEngagement);
                                        }
                                        return;
                                      }
                                      if (intent.kind === "decision" && intent.stage) {
                                        // Outcomes go through the confirmed
                                        // transition flow, never a message body.
                                        const action = headerActions.find(
                                          (entry) =>
                                            entry.backendStatus === intent.stage &&
                                            entry.flow !== "reply"
                                        );
                                        if (action) dispatchHeaderAction(selected, action);
                                        return;
                                      }
                                      // Toggling off restores a plain freeform send.
                                      if (active) {
                                        setPendingIntent(null);
                                        composerRef.current?.focus();
                                        return;
                                      }
                                      setPendingIntent(intent.key);
                                      if (intent.template && !replyDraft.trim()) {
                                        handleReplyDraftChange(intent.template);
                                      }
                                      composerRef.current?.focus();
                                    }}
                                    className={[
                                      "inline-flex h-7 cursor-pointer items-center rounded-full border px-2.5 text-[11px] font-medium transition-colors",
                                      active
                                        ? "border-line-strong bg-overlay text-white"
                                        : "border-line bg-transparent text-white/70 hover:bg-raised hover:text-white",
                                    ].join(" ")}
                                  >
                                    {intent.label}
                                  </button>
                                );
                              })}
                            </div>
                          ) : null}
                          {/*
                            A surface, not an input dropped at the bottom. It is
                            raised off the thread, lifts and brightens its edge
                            on focus, and keeps the send key visually attached to
                            the field it belongs to.
                          */}
                          <div className="flex items-end gap-2 rounded-2xl border border-line bg-raised p-2 transition-all elev-2 focus-within:border-line-strong focus-within:elev-3">
                            <textarea
                              ref={composerRef}
                              value={replyDraft}
                              onChange={(event) => handleReplyDraftChange(event.target.value)}
                              maxLength={5000}
                              rows={1}
                              aria-label="Reply message"
                              placeholder={`Message ${firstNameOf(selected.counterpartyName)}…`}
                              className="max-h-32 min-h-[36px] flex-1 resize-none bg-transparent px-2 py-1.5 text-[13px] leading-relaxed text-white/85 placeholder:text-subtle focus:outline-none"
                            />
                            <button
                              type="button"
                              aria-label="Send"
                              onClick={() => void handleSendReply(selected)}
                              disabled={!replyDraft.trim() || sending}
                              className={
                                replyDraft.trim() && !sending
                                  ? "inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-xl bg-white text-black transition-colors hover:bg-white/90"
                                  : "inline-flex h-9 w-9 shrink-0 cursor-not-allowed items-center justify-center rounded-xl border border-line bg-wash text-subtle"
                              }
                            >
                              <Icon name="send" className="h-4 w-4" />
                            </button>
                          </div>
                          {sendError ? (
                            <p className="mt-1.5 text-[11px] text-rose-300/80">{sendError}</p>
                          ) : !liveMode ? (
                            <p className="mt-1.5 text-[11px] text-subtle">
                              Demo only — replies aren’t delivered yet.
                            </p>
                          ) : null}
                        </div>
                      ) : liveMode && selected && !selectedMessagingClosed ? (
                        <div className="flex items-center gap-2 py-1">
                          <Icon name="send" className="h-3.5 w-3.5 shrink-0 text-subtle" />
                          <p className="text-[11px] text-subtle">
                            {selectedConversationLoadFailed
                              ? "Couldn’t load this conversation. Retrying…"
                              : "Loading conversation…"}
                          </p>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 py-1">
                          <Icon name="send" className="h-3.5 w-3.5 shrink-0 text-subtle" />
                          <p className="text-[11px] text-subtle">
                            {selectedMessagingClosed
                              ? "This thread is closed to new messages."
                              : "Messaging will open up here once the thread is active."}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

              {/* Context + timeline rail. The context object is its own click target. */}
              <aside className="border-t border-line lg:min-h-0 lg:overflow-y-auto lg:border-t-0">
                  <div className="space-y-3 px-4 py-6 sm:px-6 lg:px-5">
                    {contextCard}
                    {/*
                      No portfolio section here. The application's own summary
                      already lists the work the applicant submitted, and adding
                      a second copy in the rail would have made the same
                      evidence appear twice on one screen. That surface now
                      renders the posters instead.
                    */}
                    {/*
                      Payment sits in the rail beside the arrangement, not in
                      the status column. It is a separate plane: no application
                      stage reads it, and it renders nothing at all unless a
                      record actually asserts a state.
                    */}
                    <PaymentStateCard
                      state={selectedEngagement?.payment_state}
                      updatedAt={selectedEngagement?.payment_state_updated_at}
                      note={selectedEngagement?.payment_note}
                    />
                    {/*
                      Who is hiring — not what it pays. The context card above
                      already carries the one rate line on this screen, and
                      repeating it here is how the same number ends up on screen
                      twice with two different treatments.
                    */}
                    {creatorView && creatorView.context.handle ? (
                      <section className={`rounded-2xl ${SURFACE} p-4`} data-testid="creator-commercial">
                        <p className={SECTION_LABEL_CLASSES}>Who you would work with</p>
                        <div className="mt-2">
                          <ClientContextSummary context={creatorView.context} />
                        </div>
                      </section>
                    ) : null}
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
                        storageOwnerId={backendUserId}
                        onSaveLatest={liveMode ? undefined : persistDemoLatestNote}
                        loadPersistedNotes={selectedPrivateNotePersistence?.load}
                        createPersistedNote={selectedPrivateNotePersistence?.create}
                        deletePersistedNote={selectedPrivateNotePersistence?.delete}
                      />
                    ) : null}
                    <section className={`rounded-2xl ${SURFACE} p-4`}>
                      <InteractionTimeline item={selected} />
                    </section>
                  </div>
              </aside>
            </div>
          ) : modeItems.length === 0 ? (
            <EmptyModeState
              mode={mode}
              otherModeLabel={otherModeOption?.label}
              otherModeCount={otherModeItems.length}
              otherModeUnread={otherModeUnread}
              onSwitchMode={onModeChange ? () => onModeChange(otherMode) : undefined}
            />
          ) : (
            <div className="hidden h-full items-center justify-center px-6 py-16 text-xs text-subtle lg:flex">
              Nothing to review in this section yet.
            </div>
          )}
        </section>
      </div>
      )}

      {/*
        Rendered outside the view switch on purpose. The prompt is the only way
        to complete an optional "share this decision" step, and both the Inbox
        and the Pipeline can start one — keeping it inside the Pipeline branch
        left the Inbox's own "Share decision with…" action inert.
      */}
      {notifyPrompt && notifyPromptItems.length > 0 ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-4 z-50 flex justify-center px-4">
          <StageNotifyPrompt
            items={notifyPromptItems}
            stageKey={notifyPrompt.stageKey}
            phase={notifyPrompt.phase}
            liveMode={liveMode}
            errorMessage={notifyPrompt.errorMessage}
            note={notifyNote}
            onNoteChange={setNotifyNote}
            onSend={() =>
              void sendStatusUpdates(notifyPromptItems, notifyPrompt.stageKey, notifyNote)
            }
            onDismiss={() => {
              setNotifyPrompt(null);
              setNotifyNote("");
            }}
            onFollowUp={(item) => {
              setNotifyPrompt(null);
              setNotifyNote("");
              setChatRequest((prev) => ({ id: item.id, nonce: (prev?.nonce ?? 0) + 1 }));
            }}
          />
        </div>
      ) : null}

      {/* Bottom-right floating utilities: dev sample-data chip beside the chat
          dock so the two never overlap (the dock stays right-anchored). */}
      <div className="absolute bottom-4 right-4 z-40 flex items-end gap-2">
        {allowDemo ? <SampleDataChip demoMode={demoMode} onToggleDemo={onToggleDemo} /> : null}
        <CompactChatDock
          items={modeItems}
          mode={mode}
          liveMode={liveMode}
          backendAccessToken={backendAccessToken}
          backendUserId={backendUserId}
          unreadByThread={unreadByThread}
          onThreadRead={handleThreadRead}
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
      <ConfirmDialog
        open={Boolean(selected && pendingAction)}
        title={pendingAction?.panelTitle ?? "Confirm status update"}
        body={
          pendingAction?.allowNote && selected ? (
            <textarea
              value={pendingNote}
              onChange={(event) => setPendingNote(event.target.value)}
              rows={3}
              // Matches the backend's own cap so the field can never submit
              // more than the server will store.
              maxLength={2000}
              data-testid="stage-confirm-note"
              placeholder={`Optional message to ${firstNameOf(selected.counterpartyName)}…`}
              className="mt-2 w-full resize-none rounded-lg border border-line bg-black/20 px-3 py-2.5 text-[13px] leading-relaxed text-white/85 placeholder:text-subtle focus:border-line-strong focus:outline-none"
            />
          ) : pendingAction?.backendStatus === "hired" ? (
            <p>This shares the decision and creates the work engagement.</p>
          ) : pendingAction?.backendStatus === "accepted" ? (
            <p>This shares your acceptance and creates the work engagement.</p>
          ) : null
        }
        confirmLabel={pendingAction?.confirmLabel ?? "Confirm"}
        destructive={Boolean(pendingAction?.destructive)}
        busy={Boolean(statusMutationKey)}
        onConfirm={() => {
          if (selected && pendingAction) void applyStatusAction(selected, pendingAction, pendingNote);
        }}
        onCancel={() => {
          if (statusMutationKey) return;
          setPendingActionKey(null);
          setPendingNote("");
        }}
      />
    </div>
  );
}
