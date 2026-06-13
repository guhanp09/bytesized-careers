"use client";

import Link from "next/link";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { Icon } from "../Icons";
import { TagPill } from "../ui";
import {
  MOCK_OWNER_INTERACTIONS,
  interactionKindLabel,
  interactionStatusLabel,
  isArchivedInteraction,
  type InteractionStatus,
  type InteractionJobSnapshot,
  type InteractionRecruiterSnapshot,
  type InteractionTalentSnapshot,
  type InteractionThreadMessage,
  type OwnerInteraction,
} from "../../lib/ownerInteractions";

type WorkspaceMode = "talent" | "hiring";
type WorkspaceFilter = "all" | "sent" | "received" | "archived";

type ApplicationsWorkspaceProps = {
  mode: WorkspaceMode;
  interactions?: OwnerInteraction[];
};

type HeaderAction = {
  key: string;
  label: string;
  icon: "check" | "x" | "send";
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

const WORKSPACE_HEIGHT_CLASSES = "lg:h-[clamp(560px,calc(100vh_-_230px),900px)]";
const SECTION_LABEL_CLASSES = "text-[11px] font-semibold text-white/40";
const CARD_LINK_CLASSES =
  "shrink-0 cursor-pointer text-xs font-semibold text-white/50 underline-offset-2 transition-colors hover:text-white hover:underline";
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
        "inline-flex shrink-0 items-center rounded-full border font-semibold",
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

function detailContextLine(item: OwnerInteraction): string {
  if (item.kind === "application" && item.direction === "received") {
    return `Applied to ${item.job?.title || "your job listing"}`;
  }
  if (item.kind === "application" && item.direction === "sent") {
    return item.job?.channelName ? `Application to ${item.job.channelName}` : "Your application";
  }
  if (item.kind === "hiring_request" && item.direction === "received") {
    return item.sourceListingTitle
      ? `Request on your listing · ${item.sourceListingTitle}`
      : "Hiring request to you";
  }
  return item.contextLabel || item.talent?.headline || "Your hiring request";
}

function messageHeading(item: OwnerInteraction): string {
  if (item.kind === "application") {
    return item.direction === "sent" ? "Your application" : "Application message";
  }
  return item.direction === "sent" ? "Your request" : "Request message";
}

function headerActionsFor(item: OwnerInteraction): HeaderAction[] {
  if (isArchivedInteraction(item)) return [];
  const name = firstNameOf(item.counterpartyName);
  const reply: HeaderAction = { key: "reply", label: `Reply to ${name}`, icon: "send", flow: "reply" };

  if (item.kind === "application" && item.direction === "sent") {
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
    return [
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
        allowNote: true,
      },
      reply,
    ];
  }
  if (item.kind === "application" && item.direction === "received") {
    const actions: HeaderAction[] = [];
    if (item.status !== "shortlisted") {
      actions.push({
        key: "shortlist",
        label: "Shortlist",
        icon: "check",
        primary: true,
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
      allowNote: true,
    });
    actions.push(reply);
    return actions;
  }
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

function IconActionButton({
  label,
  icon,
  primary,
  destructive,
  onClick,
}: {
  label: string;
  icon: HeaderAction["icon"];
  primary?: boolean;
  destructive?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={[
        "group/action relative inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20",
        primary
          ? "bg-white text-black hover:bg-white/90"
          : destructive
            ? "border border-white/[0.12] bg-white/[0.04] text-white/75 hover:border-red-300/30 hover:bg-red-300/10 hover:text-red-200"
            : "border border-white/[0.12] bg-white/[0.04] text-white/75 hover:bg-white/[0.09] hover:text-white",
      ].join(" ")}
    >
      <Icon name={icon} className="h-4 w-4" />
      <span className="pointer-events-none absolute right-0 top-full z-10 mt-2 whitespace-nowrap rounded-lg border border-white/10 bg-[#111216] px-2 py-1 text-[11px] font-semibold text-white/72 opacity-0 shadow-[0_14px_35px_-22px_rgba(0,0,0,1)] transition-opacity group-hover/action:opacity-100 group-focus-visible/action:opacity-100">
        {label}
      </span>
    </button>
  );
}

function JobSnapshotSection({ job, label }: { job: InteractionJobSnapshot; label: string }) {
  const identityLine = [job.channelName, job.listingStatus].filter(Boolean).join(" · ");
  return (
    <section>
      <div className="flex items-center justify-between gap-3">
        <p className={SECTION_LABEL_CLASSES}>{label}</p>
        {job.jobId ? (
          <Link href={`/jobs/${job.jobId}`} className={CARD_LINK_CLASSES}>
            View full job
          </Link>
        ) : null}
      </div>
      <div className="mt-2.5 flex items-start gap-3">
        {job.channelName ? (
          <InteractionAvatar
            name={job.channelName}
            src={job.channelLogoUrl}
            shape="rounded"
            sizeClasses="h-10 w-10"
          />
        ) : null}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-white/92">{job.title}</p>
          {identityLine ? <p className="mt-0.5 text-xs text-white/55">{identityLine}</p> : null}
          <div className="mt-2.5 flex flex-wrap items-center gap-x-3.5 gap-y-1.5 text-xs text-white/62">
            <span className="inline-flex items-center gap-1.5">
              <Icon name="cash" className="h-3.5 w-3.5 text-white/45" />
              {job.budget}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Icon name="clock" className="h-3.5 w-3.5 text-white/45" />
              {job.workMode}
            </span>
            {job.location ? (
              <span className="inline-flex items-center gap-1.5">
                <Icon name="pin" className="h-3.5 w-3.5 text-white/45" />
                {job.location}
              </span>
            ) : null}
            {job.experience ? (
              <span className="inline-flex items-center gap-1.5">
                <Icon name="cap" className="h-3.5 w-3.5 text-white/45" />
                {job.experience}
              </span>
            ) : null}
          </div>
          {job.tags.length > 0 ? (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {job.tags.slice(0, 5).map((tag) => (
                <TagPill key={`${job.title}-tag-${tag}`}>{tag}</TagPill>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function TalentSnapshotSection({ talent, label }: { talent: InteractionTalentSnapshot; label: string }) {
  return (
    <section>
      <div className="flex items-center justify-between gap-3">
        <p className={SECTION_LABEL_CLASSES}>{label}</p>
        {talent.profileSlug ? (
          <Link href={`/u/${talent.profileSlug}?view=talent`} className={CARD_LINK_CLASSES}>
            View full profile
          </Link>
        ) : null}
      </div>
      <div className="mt-3 flex items-start gap-3.5">
        <InteractionAvatar name={talent.name} src={talent.avatarUrl} sizeClasses="h-11 w-11" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-white/92">{talent.name}</p>
          <p className="mt-0.5 text-xs text-white/60">{talent.headline}</p>
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
    </section>
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
  return (
    <section>
      <div className="flex items-center justify-between gap-3">
        <p className={SECTION_LABEL_CLASSES}>Recruiter</p>
        {recruiter.profileSlug ? (
          <Link href={`/u/${recruiter.profileSlug}?view=hiring`} className={CARD_LINK_CLASSES}>
            View recruiter profile
          </Link>
        ) : null}
      </div>
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
    </section>
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

function primarySnapshotFor(item: OwnerInteraction): ReactNode {
  if (item.kind === "application" && item.direction === "sent" && item.job) {
    return <JobSnapshotSection job={item.job} label="Job you applied to" />;
  }
  if (item.kind === "application" && item.direction === "received" && item.talent) {
    return <TalentSnapshotSection talent={item.talent} label="Candidate" />;
  }
  if (item.kind === "hiring_request" && item.direction === "received" && item.recruiter) {
    return (
      <RecruiterSnapshotSection recruiter={item.recruiter} sourceListingTitle={item.sourceListingTitle} />
    );
  }
  if (item.kind === "hiring_request" && item.direction === "sent" && item.talent) {
    return <TalentSnapshotSection talent={item.talent} label="Talent" />;
  }
  return null;
}

function sideSnapshotFor(item: OwnerInteraction): ReactNode {
  if (item.kind === "application" && item.direction === "received" && item.job) {
    return <JobSnapshotSection job={item.job} label="Your job listing" />;
  }
  return null;
}

export default function ApplicationsWorkspace({ mode, interactions }: ApplicationsWorkspaceProps) {
  const [items, setItems] = useState<OwnerInteraction[]>(() => interactions ?? MOCK_OWNER_INTERACTIONS);
  const [filter, setFilter] = useState<WorkspaceFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [pendingActionKey, setPendingActionKey] = useState<string | null>(null);
  const [pendingNote, setPendingNote] = useState("");
  const [replyDraft, setReplyDraft] = useState("");
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

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
  };

  const handleSelect = (id: string) => {
    setSelectedId(id);
    setMobileDetailOpen(true);
    resetComposition();
    setItems((prev) =>
      prev.map((item) => (item.id === id && item.unread ? { ...item, unread: false } : item))
    );
  };

  const applyStatusAction = (target: OwnerInteraction, action: HeaderAction, note?: string) => {
    if (!action.nextStatus || !action.eventLabel) return;
    const trimmedNote = note?.trim();
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

  const focusComposer = () => {
    composerRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    composerRef.current?.focus({ preventScroll: true });
  };

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

  const headerActions = selected ? headerActionsFor(selected) : [];
  const pendingAction = headerActions.find(
    (action) => action.flow === "confirm" && action.key === pendingActionKey
  );
  const replyTemplates = selected ? quickReplyTemplates(selected) : [];
  const selectedActive = selected ? !isArchivedInteraction(selected) : false;
  const thread: InteractionThreadMessage[] = selected
    ? [...(selected.response ? [selected.response] : []), ...(selected.replies || [])]
    : [];

  return (
    <div className={`w-full ${WORKSPACE_HEIGHT_CLASSES}`} data-testid="applications-workspace">
      <div className="lg:grid lg:h-full lg:grid-cols-[360px_minmax(0,1fr)]">
        <aside
          className={[
            "border-white/[0.06] lg:flex lg:min-h-0 lg:flex-col lg:border-r",
            mobileDetailOpen ? "hidden lg:flex" : "block",
          ].join(" ")}
        >
          <div className="border-b border-white/[0.06] px-4">
            <div className="flex items-end gap-5 overflow-x-auto">
              {FILTER_OPTIONS.map((option) => {
                const isActive = filter === option.key;
                const count = filterCounts[option.key];
                return (
                  <button
                    key={`applications-filter-${option.key}`}
                    type="button"
                    data-testid={`applications-filter-${option.key}`}
                    aria-pressed={isActive}
                    onClick={() => {
                      setFilter(option.key);
                      setMobileDetailOpen(false);
                      resetComposition();
                    }}
                    className={[
                      "group/filter relative h-10 shrink-0 cursor-pointer whitespace-nowrap px-0.5 text-[13px] font-semibold transition-colors",
                      isActive ? "text-white" : "text-white/50 hover:text-white/80",
                    ].join(" ")}
                  >
                    {option.label}
                    {count > 0 ? (
                      <span
                        className={`ml-1.5 text-[11px] font-medium ${isActive ? "text-white/55" : "text-white/32"}`}
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
          </div>

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
            <div className="flex flex-col lg:min-h-0 lg:flex-1" data-testid="applications-detail">
              <header className="border-b border-white/[0.06] px-5 py-4 sm:px-7">
                <button
                  type="button"
                  onClick={() => setMobileDetailOpen(false)}
                  className="mb-2.5 inline-flex h-8 cursor-pointer items-center gap-1.5 text-xs font-semibold text-white/65 transition-colors hover:text-white lg:hidden"
                >
                  <span aria-hidden="true">←</span>
                  Back to list
                </button>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                  <div className="min-w-0">
                    <p className="text-[11px] font-medium text-white/42">
                      {interactionKindLabel(selected)} · {selected.createdAtLabel}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-3">
                      <h2 className="text-lg font-semibold text-white sm:text-xl">{selected.title}</h2>
                      <StatusPill status={selected.status} size="md" />
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2.5 text-xs text-white/55">
                      <InteractionAvatar
                        name={selected.counterpartyName}
                        src={selected.counterpartyAvatarUrl}
                        sizeClasses="h-6 w-6"
                      />
                      <span className="min-w-0 truncate">{detailContextLine(selected)}</span>
                      <span className="text-white/30">•</span>
                      <span className="shrink-0">Updated {selected.updatedAtLabel}</span>
                    </div>
                  </div>
                  {headerActions.length > 0 ? (
                    <div className="flex shrink-0 items-center gap-2 sm:pt-1">
                      {headerActions.map((action) => (
                        <IconActionButton
                          key={`${selected.id}-action-${action.key}`}
                          label={action.label}
                          icon={action.icon}
                          primary={action.primary}
                          destructive={action.destructive}
                          onClick={() => {
                            if (action.flow === "reply") {
                              focusComposer();
                              return;
                            }
                            if (action.flow === "instant") {
                              applyStatusAction(selected, action);
                              return;
                            }
                            setPendingActionKey(action.key);
                            setPendingNote("");
                          }}
                        />
                      ))}
                    </div>
                  ) : null}
                </div>
              </header>

              <div className="px-5 py-6 sm:px-7 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
                {pendingAction ? (
                  <section className="mb-6 rounded-xl border border-white/[0.12] bg-white/[0.04] p-4">
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

                <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_300px]">
                  <div className="min-w-0 divide-y divide-white/[0.06] xl:pr-8">
                    <section className="pb-6">{primarySnapshotFor(selected)}</section>

                    <section className="py-6">
                      <h3 className={SECTION_LABEL_CLASSES}>{messageHeading(selected)}</h3>
                      <p className="mt-2.5 whitespace-pre-line text-sm leading-relaxed text-white/85">
                        {selected.message}
                      </p>
                      {selected.proposedTerms ? (
                        <p className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-white/[0.09] bg-white/[0.03] px-2.5 py-1.5 text-xs text-white/70">
                          <Icon name="cash" className="h-3.5 w-3.5 text-white/45" />
                          {selected.proposedTerms}
                        </p>
                      ) : null}
                      {selected.attachments && selected.attachments.length > 0 ? (
                        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
                          {selected.attachments.map((attachment) =>
                            attachment.url ? (
                              <a
                                key={`${selected.id}-attachment-${attachment.label}`}
                                href={attachment.url}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-white/65 underline-offset-2 hover:text-white hover:underline"
                              >
                                <Icon name="external-link" className="h-3 w-3" />
                                {attachment.label}
                              </a>
                            ) : (
                              <span
                                key={`${selected.id}-attachment-${attachment.label}`}
                                className="text-xs text-white/55"
                              >
                                {attachment.label}
                              </span>
                            )
                          )}
                        </div>
                      ) : null}
                    </section>

                    {thread.length > 0 ? (
                      <section className="py-6">
                        <h3 className={SECTION_LABEL_CLASSES}>Conversation</h3>
                        <div className="mt-3 space-y-2.5">
                          {thread.map((message, index) => (
                            <div
                              key={`${selected.id}-thread-${index}`}
                              className="rounded-xl border border-white/[0.07] bg-white/[0.025] px-3.5 py-3"
                            >
                              <p className="text-[11px] font-semibold text-white/45">
                                {message.from} · {message.atLabel}
                              </p>
                              <p className="mt-1 text-[13px] leading-relaxed text-white/78">{message.body}</p>
                            </div>
                          ))}
                        </div>
                      </section>
                    ) : null}

                    {selectedActive ? (
                      <section className="pt-6">
                        <p className={SECTION_LABEL_CLASSES}>
                          Reply to {firstNameOf(selected.counterpartyName)}
                        </p>
                        <textarea
                          ref={composerRef}
                          value={replyDraft}
                          onChange={(event) => setReplyDraft(event.target.value)}
                          rows={3}
                          aria-label="Reply message"
                          placeholder={`Write a message to ${firstNameOf(selected.counterpartyName)}…`}
                          className="mt-2.5 w-full resize-none rounded-xl border border-white/[0.08] bg-white/[0.03] px-3.5 py-3 text-[13px] leading-relaxed text-white/85 placeholder:text-white/35 transition-colors focus:border-white/25 focus:outline-none"
                        />
                        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap gap-1.5">
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
                          <button
                            type="button"
                            onClick={() => handleSendReply(selected)}
                            disabled={!replyDraft.trim()}
                            className={
                              replyDraft.trim()
                                ? "inline-flex h-8 cursor-pointer items-center justify-center rounded-lg bg-white px-3.5 text-xs font-semibold text-black transition-colors hover:bg-white/90"
                                : "inline-flex h-8 cursor-not-allowed items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.02] px-3.5 text-xs font-semibold text-white/30"
                            }
                          >
                            Send
                          </button>
                        </div>
                        <p className="mt-2 text-[11px] text-white/35">
                          Demo only — replies aren’t delivered yet.
                        </p>
                      </section>
                    ) : null}
                  </div>

                  <div className="mt-6 space-y-7 border-t border-white/[0.06] pt-6 xl:mt-0 xl:border-l xl:border-t-0 xl:pl-8 xl:pt-0">
                    {sideSnapshotFor(selected)}
                    <InteractionTimeline item={selected} />
                  </div>
                </div>
              </div>
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
