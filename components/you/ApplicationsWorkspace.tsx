"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Icon } from "../Icons";
import { MetaRow, TagPill } from "../ui";
import {
  canUseLocalMockFallback,
  getActivitySummary,
  isLocalMocksEnabled,
  updateApplicationStatus,
  updateTalentInterestStatus,
} from "../../lib/backendClient";
import {
  MOCK_OWNER_INTERACTIONS,
  interactionKindLabel,
  interactionStatusLabel,
  isArchivedInteraction,
  mapActivityToOwnerInteractions,
  type InteractionStatus,
  type InteractionJobSnapshot,
  type InteractionRecruiterSnapshot,
  type InteractionTalentSnapshot,
  type OwnerInteraction,
} from "../../lib/ownerInteractions";

type WorkspaceMode = "talent" | "hiring";
type WorkspaceFilter = "all" | "sent" | "received" | "archived";
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

const FILTER_OPTIONS: Array<{ key: WorkspaceFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "sent", label: "Sent" },
  { key: "received", label: "Received" },
  { key: "archived", label: "Archived" },
];
const DEFAULT_MODE_OPTIONS: WorkspaceModeOption[] = [
  { key: "talent", label: "Talent" },
  { key: "hiring", label: "Recruiter" },
];

function FilterBar({
  filter,
  counts,
  onSelect,
}: {
  filter: WorkspaceFilter;
  counts: Record<WorkspaceFilter, number>;
  onSelect: (key: WorkspaceFilter) => void;
}) {
  return (
    <div className="border-b border-white/[0.06] px-4">
      <div className="flex items-end gap-5 overflow-x-auto">
        {FILTER_OPTIONS.map((option) => {
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

function WorkspaceControls({
  mode,
  modeOptions,
  onModeChange,
  allowDemo,
  demoMode,
  onToggleDemo,
}: {
  mode: WorkspaceMode;
  modeOptions: WorkspaceModeOption[];
  onModeChange?: (mode: WorkspaceMode) => void;
  allowDemo?: boolean;
  demoMode?: boolean;
  onToggleDemo?: () => void;
}) {
  return (
    <div className="border-b border-white/[0.06] px-4 py-3">
      <div className="flex items-center justify-between gap-3">
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

        {allowDemo ? (
          <button
            type="button"
            aria-pressed={demoMode}
            onClick={onToggleDemo}
            title="Preview the interface with sample data (development only)"
            className={[
              "inline-flex h-8 shrink-0 cursor-pointer items-center gap-2 rounded-xl border px-3 text-[11px] font-semibold transition-colors",
              demoMode
                ? "border-amber-200/30 bg-amber-200/[0.1] text-amber-100/90"
                : "border-white/[0.1] bg-white/[0.03] text-white/60 hover:text-white",
            ].join(" ")}
          >
            <span
              className={["h-1.5 w-1.5 rounded-full", demoMode ? "bg-amber-300" : "bg-white/30"].join(" ")}
              aria-hidden="true"
            />
            Sample data
          </button>
        ) : null}
      </div>
    </div>
  );
}

// Dedicated full-page workspace: the route wrapper already sits below the fixed
// global top bar, so the inbox owns the full remaining vertical canvas.
const WORKSPACE_HEIGHT_CLASSES = "h-full min-h-0";
const SECTION_LABEL_CLASSES = "text-[11px] font-semibold text-white/40";
const SURFACE = "border border-white/[0.08] bg-white/[0.035]";
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

function InteractionAvatar({
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
    // Live mode: the backend has no applicant-side withdraw endpoint and no
    // messaging — showing those actions would fake functionality.
    if (live) return [];
    return [
      reply,
      {
        key: "withdraw",
        label: "Withdraw application",
        icon: "x",
        destructive: true,
        flow: "confirm",
        nextStatus: "withdrawn",
        eventLabel: "Application withdrawn by you",
        panelTitle: "Withdraw this application?",
        confirmLabel: "Confirm withdraw",
      },
    ];
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
  if (live) return [];
  return [
    reply,
    {
      key: "withdraw",
      label: "Withdraw request",
      icon: "x",
      destructive: true,
      flow: "confirm",
      nextStatus: "withdrawn",
      eventLabel: "Request withdrawn by you",
      panelTitle: "Withdraw this request?",
      confirmLabel: "Confirm withdraw",
    },
  ];
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
 * A context snapshot card. When it represents a navigable entity (a profile) the
 * whole card is the link — no separate "View X" button, no label — with a hover +
 * focus affordance and a quiet ↗ on hover. Otherwise it renders as a plain card.
 */
function ContextCard({ href, children }: { href?: string | null; children: ReactNode }) {
  const body = (
    <div className="relative">
      {href ? (
        <Icon
          name="external-link"
          className="absolute right-0 top-0 h-3.5 w-3.5 text-white/30 opacity-0 transition-opacity group-hover:opacity-100"
        />
      ) : null}
      {children}
    </div>
  );
  const cls = `block rounded-2xl ${SURFACE} p-4`;
  return href ? (
    <Link
      href={href}
      className={`group ${cls} cursor-pointer transition-colors hover:border-white/[0.14] hover:bg-white/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20`}
    >
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
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
          name={job.channelName || job.title}
          src={job.channelLogoUrl}
          shape="rounded"
          sizeClasses="h-9 w-9"
        />
        <span className="min-w-0 truncate pr-5 text-xs font-medium text-white/60">
          {job.channelName || "Hiring team"}
        </span>
      </div>
      <h3 className="mt-2.5 text-sm font-semibold leading-snug text-white">{job.title}</h3>
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

function TalentSnapshotSection({
  talent,
  showTitle = true,
}: {
  talent: InteractionTalentSnapshot;
  /** When false, the name lives in the detail header, so the card leads with the headline. */
  showTitle?: boolean;
}) {
  const href = talent.profileSlug ? `/u/${talent.profileSlug}?view=talent` : null;
  return (
    <ContextCard href={href}>
      <div className="mt-3 flex items-start gap-3.5">
        <InteractionAvatar name={talent.name} src={talent.avatarUrl} sizeClasses="h-11 w-11" />
        <div className="min-w-0 flex-1">
          {showTitle ? <p className="text-sm font-semibold text-white/92">{talent.name}</p> : null}
          {talent.headline ? (
            <p
              className={
                showTitle ? "mt-0.5 text-xs text-white/60" : "text-sm font-semibold text-white/90"
              }
            >
              {talent.headline}
            </p>
          ) : null}
          {talent.location || talent.availability ? (
            <p className="mt-1 text-xs text-white/45">
              {[talent.location, talent.availability].filter(Boolean).join(" · ")}
            </p>
          ) : null}
        </div>
      </div>
      {talent.bio ? <p className="mt-3 text-[13px] leading-relaxed text-white/65">{talent.bio}</p> : null}
      {talent.experienceNote ? <p className="mt-1.5 text-xs text-white/50">{talent.experienceNote}</p> : null}
      {talent.tools.length > 0 || talent.niches.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {talent.tools.map((tool) => (
            <TagPill key={`${talent.name}-tool-${tool}`}>{tool}</TagPill>
          ))}
          {talent.niches.map((niche) => (
            <TagPill key={`${talent.name}-niche-${niche}`} className="text-white/55">
              {niche}
            </TagPill>
          ))}
        </div>
      ) : null}
      {talent.portfolioHighlights.length > 0 ? (
        <div className="mt-3.5 space-y-2.5 border-l border-white/[0.1] pl-3.5">
          {talent.portfolioHighlights.map((highlight) => (
            <div key={`${talent.name}-highlight-${highlight.title}`}>
              <p className="text-xs font-semibold text-white/82">{highlight.title}</p>
              <p className="mt-0.5 text-[11px] text-white/48">{highlight.detail}</p>
            </div>
          ))}
        </div>
      ) : null}
    </ContextCard>
  );
}

function RecruiterSnapshotSection({
  recruiter,
  sourceListingTitle,
}: {
  recruiter: InteractionRecruiterSnapshot;
  sourceListingTitle?: string | null;
}) {
  const audienceLine = [recruiter.audienceLabel, recruiter.platform].filter(Boolean).join(" · ");
  const href = recruiter.profileSlug ? `/u/${recruiter.profileSlug}?view=hiring` : null;
  return (
    <ContextCard href={href}>
      <div className="mt-3 flex items-start gap-3.5">
        <InteractionAvatar name={recruiter.name} src={recruiter.avatarUrl} shape="rounded" sizeClasses="h-10 w-10" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-white/92">{recruiter.name}</p>
          {audienceLine ? <p className="mt-0.5 text-xs text-white/55">{audienceLine}</p> : null}
          {recruiter.hiringFor ? (
            <p className="mt-1 text-xs text-white/45">Hiring for {recruiter.hiringFor}</p>
          ) : null}
        </div>
      </div>
      {sourceListingTitle ? (
        <p className="mt-3 text-xs text-white/50">
          Sent for your listing · <span className="text-white/70">{sourceListingTitle}</span>
        </p>
      ) : null}
    </ContextCard>
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
  if (item.kind === "hiring_request" && item.direction === "sent" && item.talent) {
    return <TalentSnapshotSection talent={item.talent} showTitle={false} />;
  }
  if (item.kind === "hiring_request" && item.direction === "received" && item.recruiter) {
    return <RecruiterSnapshotSection recruiter={item.recruiter} sourceListingTitle={item.sourceListingTitle} />;
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

type ChatMessage = {
  id: string;
  fromMe: boolean;
  senderName: string;
  body: string;
  atLabel: string;
  rate?: string | null;
  attachments?: OwnerInteraction["attachments"];
};

/**
 * Flattens an interaction's opening message, the counterparty's response, and any
 * follow-up replies into a single chat thread. The opening message carries the
 * proposed rate + work samples so they read as part of the conversation.
 */
function buildConversation(item: OwnerInteraction): ChatMessage[] {
  const messages: ChatMessage[] = [];
  const hasOpening = Boolean(item.message) || (item.attachments?.length ?? 0) > 0;
  if (hasOpening) {
    const openingFromMe = item.direction === "sent";
    messages.push({
      id: `${item.id}-opening`,
      fromMe: openingFromMe,
      senderName: openingFromMe ? "You" : item.counterpartyName,
      body: item.message || "",
      atLabel: item.createdAtLabel,
      rate: item.proposedTerms || null,
      attachments: item.attachments,
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
    });
  });
  return messages;
}

function AttachmentChip({ label, url, onMe }: { label: string; url?: string | null; onMe: boolean }) {
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
  return url ? (
    <a href={url} target="_blank" rel="noreferrer" className={`${base} ${tone} cursor-pointer`}>
      {inner}
    </a>
  ) : (
    <span className={`${base} ${tone}`}>{inner}</span>
  );
}

function MessageBubble({
  message,
  counterpartyAvatarUrl,
  counterpartyHref,
}: {
  message: ChatMessage;
  counterpartyAvatarUrl?: string | null;
  counterpartyHref?: string | null;
}) {
  const me = message.fromMe;
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
            <div className={["flex flex-wrap gap-1.5", message.body || message.rate ? "mt-2.5" : ""].join(" ")}>
              {message.attachments.map((attachment) => (
                <AttachmentChip
                  key={`${message.id}-att-${attachment.label}`}
                  label={attachment.label}
                  url={attachment.url}
                  onMe={me}
                />
              ))}
            </div>
          ) : null}
        </div>
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
  const [actionError, setActionError] = useState<string | null>(null);
  const [filter, setFilter] = useState<WorkspaceFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [pendingActionKey, setPendingActionKey] = useState<string | null>(null);
  const [pendingNote, setPendingNote] = useState("");
  const [replyDraft, setReplyDraft] = useState("");
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
      const applicationStatus =
        action.key === "shortlist" ? "shortlisted" : action.key === "hire" ? "hired" : "rejected";
      const request =
        target.kind === "application"
          ? updateApplicationStatus(
              backendAccessToken,
              target.id,
              applicationStatus
            )
          : updateTalentInterestStatus(
              backendAccessToken,
              target.id,
              action.key === "accept" ? "contacted" : "declined"
            );
      request
        .then(() => commitStatusLocally(target, action))
        .catch(() => {
          setActionError("Couldn't update the status — the backend is unreachable. Try again.");
          setPendingActionKey(null);
          setPendingNote("");
        });
      return;
    }

    commitStatusLocally(target, action, trimmedNote);
  };

  const handleSendReply = (target: OwnerInteraction) => {
    const body = replyDraft.trim();
    if (!body) return;
    setItems((prev) =>
      prev.map((item) =>
        item.id === target.id
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
    setReplyDraft("");
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
  const selectedActive = selected ? !selectedArchived && !liveMode : false;
  const conversation = selected ? buildConversation(selected) : [];
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

  return (
    <div className={`w-full ${WORKSPACE_HEIGHT_CLASSES}`} data-testid="applications-workspace">
      <div className="lg:grid lg:h-full lg:min-h-0 lg:grid-cols-[390px_minmax(0,1fr)]">
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
            allowDemo={allowDemo}
            demoMode={demoMode}
            onToggleDemo={onToggleDemo}
          />
          <FilterBar filter={filter} counts={filterCounts} onSelect={selectFilter} />

          <div className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
            {visibleItems.length === 0 ? (
              <div className="px-4 py-12 text-center text-xs text-white/45">Nothing here yet.</div>
            ) : (
              <div className="divide-y divide-white/[0.05]">
                {visibleItems.map((item) => {
                  const isSelected = item.id === selectedItemId;
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
                          <span className="shrink-0 text-[11px] text-white/38">{item.updatedAtLabel}</span>
                        </div>
                        <div className="mt-0.5 flex items-center gap-2">
                          {item.unread ? (
                            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-white/90" aria-hidden="true" />
                          ) : null}
                          <span
                            className={[
                              "truncate text-sm",
                              item.unread ? "font-semibold text-white" : "font-medium text-white/85",
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
                <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/[0.06] px-3 py-3 sm:px-5">
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
                          {conversation.map((message) => (
                            <MessageBubble
                              key={message.id}
                              message={message}
                              counterpartyAvatarUrl={selected.counterpartyAvatarUrl}
                              counterpartyHref={subtitle?.href ?? null}
                            />
                          ))}
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
                              onClick={() => handleSendReply(selected)}
                              disabled={!replyDraft.trim()}
                              className={
                                replyDraft.trim()
                                  ? "inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-xl bg-white text-black transition-colors hover:bg-white/90"
                                  : "inline-flex h-9 w-9 shrink-0 cursor-not-allowed items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.02] text-white/30"
                              }
                            >
                              <Icon name="send" className="h-4 w-4" />
                            </button>
                          </div>
                          <p className="mt-1.5 text-[11px] text-white/35">Demo only — replies aren’t delivered yet.</p>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 py-1">
                          <Icon name="send" className="h-3.5 w-3.5 shrink-0 text-white/30" />
                          <p className="text-[11px] text-white/40">
                            Messaging isn’t available yet — replies will open up here once it ships.
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
    </div>
  );
}
