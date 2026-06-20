"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Icon } from "../Icons";
import {
  createJob,
  createTalentListing,
  deleteJob,
  deleteTalentListing,
  isBackendAuthError,
  isLocalMocksEnabled,
  listMyJobs,
  listMyTalentListings,
} from "../../lib/backendClient";
import { relativeTimeLabel } from "../../lib/ownerInteractions";
import { classifyDraftLoad } from "../../lib/draftLoad";
import DraftTipTicker from "./DraftTipTicker";
import {
  MOCK_OWNER_DRAFTS,
  buildDuplicateJobPayload,
  buildDuplicateTalentPayload,
  duplicateLocalDraft,
  jobToDraft,
  talentToDraft,
  type DraftItem,
  type DraftKind,
} from "../../lib/ownerDrafts";
import type { CompletionItem } from "../../lib/draftCompletion";

const SECTION_LABEL_CLASSES = "text-[11px] font-semibold uppercase tracking-[0.14em] text-white/40";
const PRIMARY_BUTTON_CLASSES =
  "inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-black transition-colors hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40";
const SECONDARY_BUTTON_CLASSES =
  "inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-xl border border-white/[0.12] bg-white/[0.03] px-3.5 text-sm font-semibold text-white/78 transition-colors hover:bg-white/[0.07] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20";
const GHOST_BUTTON_CLASSES =
  "inline-flex h-9 cursor-pointer items-center justify-center rounded-xl border border-white/15 bg-white/[0.04] px-3.5 text-xs font-semibold text-white/80 transition-colors hover:bg-white/[0.08]";

const FILTERS: Array<{ key: DraftKind; label: string }> = [
  { key: "job", label: "Job listings" },
  { key: "talent", label: "Talent listings" },
];

// Calm, useful guidance shown in the rotating tip strip. No FOMO, no unsupported claims.
const JOB_DRAFT_TIPS = [
  "Clear budget details reduce back-and-forth with candidates.",
  "Responsibilities help talent understand the day-to-day work faster.",
  "Reference examples make it easier for candidates to match your style.",
  "Tools and workflow details help attract better-fit applicants.",
  "A strong brand context helps candidates understand the audience.",
  "Timelines and availability make the listing easier to act on.",
];
const TALENT_DRAFT_TIPS = [
  "Clear rate details reduce back-and-forth with recruiters.",
  "A strong portfolio helps recruiters match you to the right work faster.",
  "Tools and workflow details help attract better-fit roles.",
  "Your niche and experience help recruiters understand your focus.",
  "Reference examples make it easier for recruiters to match your style.",
  "Availability and turnaround make your listing easier to act on.",
];

const jumpHref = (resumeHref: string, jump: string) => `${resumeHref}&section=${encodeURIComponent(jump)}`;

function queueNextLabel(item: DraftItem) {
  const completion = item.completion;
  if (completion.missingRequiredItems.length) {
    return `Next: ${completion.nextShortLabel}`;
  }
  if (completion.missingRecommendedItems.length) {
    return `Improve next: ${completion.nextShortLabel}`;
  }
  return "Ready to review";
}

function EmptyState({ kind }: { kind: DraftKind | "all" }) {
  const copy =
    kind === "job"
      ? { title: "No job drafts yet.", body: "Unfinished job listings you save will appear here.", href: "/post-job", cta: "Create job listing" }
      : kind === "talent"
        ? { title: "No talent drafts yet.", body: "Unfinished talent listings you save will appear here.", href: "/post-talent", cta: "Create talent listing" }
        : { title: "No drafts yet.", body: "Unfinished job and talent listings you save will appear here, ready to resume.", href: "/post-job", cta: "Create job listing" };
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <span className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.03] text-white/45">
        <Icon name="file" className="h-5 w-5" />
      </span>
      <p className="text-base font-semibold text-white/90">{copy.title}</p>
      <p className="mx-auto mt-2 max-w-md text-sm text-white/55">{copy.body}</p>
      <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
        <Link href={copy.href} className={PRIMARY_BUTTON_CLASSES}>
          {copy.cta}
        </Link>
        {kind === "all" ? (
          <Link href="/post-talent" className={GHOST_BUTTON_CLASSES}>
            Create talent listing
          </Link>
        ) : null}
      </div>
    </div>
  );
}

function CompletionPanel({
  label,
  percent,
  tone,
  items,
  resumeHref,
  testId,
}: {
  label: string;
  percent: number;
  tone: "ready" | "strength";
  items: CompletionItem[];
  resumeHref: string;
  testId: string;
}) {
  const barColor = tone === "ready" ? "bg-emerald-300/70" : "bg-white/55";
  return (
    <section
      className="flex min-h-full flex-col rounded-2xl border border-white/[0.09] bg-white/[0.025] p-5"
      data-testid={testId}
    >
      <div>
        <p className={SECTION_LABEL_CLASSES}>{label}</p>
      </div>
      <div className="mt-2">
        <p className="text-4xl font-bold leading-none tabular-nums text-white">{percent}%</p>
      </div>
      <div
        className="mt-3 h-[6px] overflow-hidden rounded-full bg-white/10"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={`${label}: ${percent} percent`}
      >
        <div
          className={`h-full rounded-full ${barColor} transition-[width] duration-500 ease-out motion-reduce:transition-none`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="mt-5">
        <ul className="space-y-1">
          {items.map((item) => (
            <CompletionTodoRow key={item.id} item={item} resumeHref={resumeHref} />
          ))}
        </ul>
      </div>
    </section>
  );
}

function CompletionTodoRow({ item, resumeHref }: { item: CompletionItem; resumeHref: string }) {
  return (
    <li data-complete={item.done ? "true" : "false"}>
      <Link
        href={jumpHref(resumeHref, item.target)}
        className={[
          "group flex min-h-8 items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20",
          item.done ? "text-white/38 hover:bg-white/[0.025] hover:text-white/48" : "text-white/82 hover:bg-white/[0.045] hover:text-white",
        ].join(" ")}
        aria-label={item.done ? `${item.label} completed, edit` : item.label}
      >
        <span
          aria-hidden="true"
          className={[
            "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-all duration-300 motion-reduce:transition-none",
            item.done
              ? "border-emerald-200/20 bg-emerald-200/[0.10] text-emerald-100/75"
              : "border-white/24 bg-transparent text-transparent group-hover:border-white/38",
          ].join(" ")}
        >
          {item.done ? <Icon name="check" className="h-2.5 w-2.5" /> : null}
        </span>
        <span className="min-w-0">
          <span
            className={[
              "relative inline-block text-[13px] transition-colors duration-300 motion-reduce:transition-none",
              item.done ? "text-white/43 line-through decoration-white/25 decoration-1" : "text-white/82",
            ].join(" ")}
          >
            {item.label}
          </span>
        </span>
      </Link>
    </li>
  );
}

export default function DraftsPageClient({
  backendAccessToken,
  allowDemo = false,
}: {
  backendAccessToken?: string;
  allowDemo?: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const demoMode = allowDemo && (searchParams.get("demo") === "1" || searchParams.get("mock") === "1");
  const savedParam = searchParams.get("saved") === "1";
  const savedDraftKindParam = searchParams.get("type");
  const savedDraftKind: DraftKind | null =
    savedDraftKindParam === "job" || savedDraftKindParam === "talent" ? savedDraftKindParam : null;
  const savedDraftId = searchParams.get("draftId") || null;

  const liveMode = Boolean(backendAccessToken) && !isLocalMocksEnabled() && !demoMode;

  const [drafts, setDrafts] = useState<DraftItem[]>(() => (liveMode ? [] : MOCK_OWNER_DRAFTS));
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">(liveMode ? "loading" : "ready");
  const [errorKind, setErrorKind] = useState<"generic" | "auth">("generic");
  const [reloadNonce, setReloadNonce] = useState(0);
  const [filter, setFilter] = useState<DraftKind>(() => savedDraftKind || "job");
  const [selectedId, setSelectedId] = useState<string | null>(() => savedDraftId);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!liveMode || !backendAccessToken) return;
    let cancelled = false;
    Promise.allSettled([listMyJobs(backendAccessToken), listMyTalentListings(backendAccessToken)]).then(
      ([jobResult, talentResult]) => {
        if (cancelled) return;
        const outcome = classifyDraftLoad(jobResult, talentResult, isBackendAuthError);
        // An expired/invalid session (401) must not look like "no drafts" — show a
        // re-auth prompt instead so users who actually have drafts can recover.
        if (outcome.kind === "auth") {
          setErrorKind("auth");
          setLoadState("error");
          return;
        }
        if (outcome.kind === "error") {
          setErrorKind("generic");
          setLoadState("error");
          return;
        }
        const jobDrafts = outcome.jobs
          .filter((job) => (job.status || "").toLowerCase() === "draft")
          .map(jobToDraft);
        const talentDrafts = outcome.listings
          .filter((listing) => (listing.status || "").toLowerCase() === "draft")
          .map(talentToDraft);
        setDrafts([...jobDrafts, ...talentDrafts].sort((a, b) => b.sortKey - a.sortKey));
        if (savedDraftKind) setFilter(savedDraftKind);
        if (savedDraftId) setSelectedId(savedDraftId);
        setLoadState("ready");
      }
    );
    return () => {
      cancelled = true;
    };
  }, [liveMode, backendAccessToken, reloadNonce, savedDraftKind, savedDraftId]);

  const counts = useMemo(
    () => ({
      job: drafts.filter((d) => d.kind === "job").length,
      talent: drafts.filter((d) => d.kind === "talent").length,
    }),
    [drafts]
  );
  const visibleDrafts = useMemo(() => drafts.filter((d) => d.kind === filter), [drafts, filter]);
  const selected = useMemo(
    () => visibleDrafts.find((d) => d.id === selectedId) || visibleDrafts[0] || null,
    [visibleDrafts, selectedId]
  );

  const handleSelect = (id: string) => {
    setSelectedId(id);
    setMobileDetailOpen(true);
    setConfirmingId(null);
    setActionError(null);
  };

  const handleConfirmDelete = (item: DraftItem) => {
    if (deletingId) return;
    if (!liveMode) {
      setDrafts((prev) => prev.filter((d) => d.id !== item.id));
      setSelectedId(null);
      setConfirmingId(null);
      setMobileDetailOpen(false);
      return;
    }
    if (!backendAccessToken) return;
    setDeletingId(item.id);
    const request =
      item.kind === "job" ? deleteJob(backendAccessToken, item.id) : deleteTalentListing(backendAccessToken, item.id);
    request
      .then(() => {
        setDrafts((prev) => prev.filter((d) => d.id !== item.id));
        setSelectedId(null);
        setConfirmingId(null);
        setMobileDetailOpen(false);
      })
      .catch(() => setActionError("Couldn't delete this draft — the backend is unreachable. Try again."))
      .finally(() => setDeletingId(null));
  };

  const handleDuplicate = (item: DraftItem) => {
    if (duplicatingId) return;
    setActionError(null);
    setConfirmingId(null);

    if (!liveMode) {
      const duplicated = duplicateLocalDraft(item);
      setDrafts((prev) => [duplicated, ...prev].sort((a, b) => b.sortKey - a.sortKey));
      setFilter(duplicated.kind);
      setSelectedId(duplicated.id);
      setMobileDetailOpen(true);
      return;
    }

    if (!backendAccessToken) return;
    setDuplicatingId(item.id);
    let request: Promise<DraftItem>;
    try {
      if (item.kind === "job") {
        const payload = buildDuplicateJobPayload(item);
        if (!payload) throw new Error("This job draft cannot be duplicated because its source data is unavailable.");
        request = createJob(payload, { accessToken: backendAccessToken }).then(jobToDraft);
      } else {
        const payload = buildDuplicateTalentPayload(item);
        if (!payload) throw new Error("This talent draft cannot be duplicated because its source data is unavailable.");
        request = createTalentListing(backendAccessToken, payload).then(talentToDraft);
      }
    } catch (error) {
      setDuplicatingId(null);
      setActionError(error instanceof Error ? error.message : "Couldn't duplicate this draft — try again.");
      return;
    }
    request
      .then((duplicated) => {
        setDrafts((prev) => [duplicated, ...prev].sort((a, b) => b.sortKey - a.sortKey));
        setFilter(duplicated.kind);
        setSelectedId(duplicated.id);
        setMobileDetailOpen(true);
      })
      .catch((error) => {
        setActionError(error instanceof Error ? error.message : "Couldn't duplicate this draft — try again.");
      })
      .finally(() => setDuplicatingId(null));
  };

  const savedBanner = savedParam ? (
    <div className="mb-4 rounded-2xl border border-emerald-200/20 bg-emerald-200/[0.08] px-4 py-3 text-sm font-medium text-emerald-50/90">
      <span className="inline-flex items-center gap-2">
        <Icon name="check" className="h-4 w-4 text-emerald-100/75" />
        Draft saved successfully.
      </span>
    </div>
  ) : null;

  // Underlined Job/Talent filters — these only scope the draft list, so they live at
  // the top of the left list column (not as a page-level row above the whole workspace).
  const filterTabs = (
    <div
      className="flex shrink-0 items-center gap-6 border-b border-white/[0.08] px-4"
      role="tablist"
      aria-label="Draft type"
    >
      {FILTERS.map((option) => {
        const isActive = filter === option.key;
        return (
          <button
            key={`drafts-filter-${option.key}`}
            type="button"
            role="tab"
            data-testid={`drafts-filter-${option.key}`}
            aria-selected={isActive}
            onClick={() => {
              setFilter(option.key);
              setSelectedId(null);
              setMobileDetailOpen(false);
              setConfirmingId(null);
            }}
            className={[
              "relative -mb-px inline-flex h-11 cursor-pointer items-center gap-2 border-b-2 px-0.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0b0f]",
              isActive ? "border-white text-white" : "border-transparent text-white/50 hover:text-white/85",
            ].join(" ")}
          >
            {option.label}
            <span className={["text-[12px] tabular-nums", isActive ? "text-white/65" : "text-white/35"].join(" ")}>
              {counts[option.key]}
            </span>
          </button>
        );
      })}
    </div>
  );

  if (liveMode && loadState === "loading") {
    return (
      <div data-testid="drafts-workspace" className="flex min-h-0 flex-1 flex-col">
        {savedBanner}
        <div className="flex w-full flex-1 items-center justify-center px-6 py-16 lg:min-h-0">
          <p className="text-sm text-white/45">Loading drafts…</p>
        </div>
      </div>
    );
  }

  if (liveMode && loadState === "error") {
    const isAuth = errorKind === "auth";
    return (
      <div data-testid="drafts-workspace" className="flex min-h-0 flex-1 flex-col">
        {savedBanner}
        <div className="flex w-full flex-1 items-center justify-center px-6 py-16 lg:min-h-0">
          <div className="text-center" data-testid={isAuth ? "drafts-auth-expired" : "drafts-load-error"}>
            <p className="text-base font-semibold text-white/90">
              {isAuth ? "Your session has expired." : "Couldn’t load drafts."}
            </p>
            <p className="mx-auto mt-2 max-w-md text-sm text-white/55">
              {isAuth
                ? "Sign in again to see your drafts — they’re safe and still saved."
                : "The backend is unreachable right now. Your drafts are safe — try again in a moment."}
            </p>
            {isAuth ? (
              <Link href="/auth?mode=login&next=/drafts" className={`mt-5 ${PRIMARY_BUTTON_CLASSES}`}>
                Sign in again
              </Link>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setErrorKind("generic");
                  setLoadState("loading");
                  setReloadNonce((n) => n + 1);
                }}
                className={`mt-5 ${GHOST_BUTTON_CLASSES}`}
              >
                Retry
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (drafts.length === 0) {
    return (
      <div data-testid="drafts-workspace" className="flex min-h-0 flex-1 flex-col">
        {savedBanner}
        <div className="flex w-full flex-1 items-center justify-center lg:min-h-0">
          <EmptyState kind="all" />
        </div>
      </div>
    );
  }

  const createHref = filter === "job" ? "/post-job" : "/post-talent";
  const createLabel = filter === "job" ? "Create job listing" : "Create talent listing";

  return (
    <div data-testid="drafts-workspace" className="flex min-h-0 flex-1 flex-col">
      {savedBanner}

      <div className="w-full flex-1 overflow-hidden lg:min-h-0">
        <div className="lg:grid lg:h-full lg:grid-cols-[minmax(0,400px)_minmax(0,1fr)]">
          {/* Resume queue */}
          <aside
            data-testid="drafts-list-panel"
            className={[
              "border-white/[0.06] lg:flex lg:min-h-0 lg:flex-col lg:border-r",
              mobileDetailOpen ? "hidden lg:flex" : "block",
            ].join(" ")}
          >
            {filterTabs}
            <div className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
              {visibleDrafts.length === 0 ? (
                <EmptyState kind={filter} />
              ) : (
                <div className="divide-y divide-white/[0.05]">
                  {visibleDrafts.map((item) => (
                    <ResumeQueueRow
                      key={`${item.kind}-${item.id}`}
                      item={item}
                      selected={Boolean(selected && selected.id === item.id)}
                      isSaved={savedDraftId === item.id}
                      onSelect={() => handleSelect(item.id)}
                    />
                  ))}
                </div>
              )}
            </div>
            {visibleDrafts.length > 0 ? (
              <div className="border-t border-white/[0.06] p-3">
                <Link
                  href={createHref}
                  className="flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-white/[0.1] bg-white/[0.02] text-sm font-semibold text-white/75 transition-colors hover:bg-white/[0.06] hover:text-white"
                >
                  <Icon name="plus" className="h-4 w-4" />
                  {createLabel}
                </Link>
              </div>
            ) : null}
          </aside>

          {/* Completion workspace */}
          <section className={["lg:flex lg:min-h-0 lg:flex-col", mobileDetailOpen ? "block" : "hidden lg:flex"].join(" ")}>
            {selected ? (
              <DraftCompletionWorkspace
                key={selected.id}
                selected={selected}
                deleting={deletingId === selected.id}
                duplicating={duplicatingId === selected.id}
                confirming={confirmingId === selected.id}
                actionError={actionError}
                onBack={() => setMobileDetailOpen(false)}
                onResume={() => router.push(selected.resumeHref)}
                onPreview={() => router.push(`${selected.resumeHref}&section=preview`)}
                onDuplicate={() => handleDuplicate(selected)}
                onRequestDelete={() => setConfirmingId(selected.id)}
                onCancelDelete={() => setConfirmingId(null)}
                onConfirmDelete={() => handleConfirmDelete(selected)}
              />
            ) : (
              <div className="hidden h-full items-center justify-center px-6 py-16 text-xs text-white/40 lg:flex">
                Select a draft to open its completion workspace.
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function ResumeQueueRow({
  item,
  selected,
  isSaved,
  onSelect,
}: {
  item: DraftItem;
  selected: boolean;
  isSaved: boolean;
  onSelect: () => void;
}) {
  const c = item.completion;
  const rowIconTone =
    selected
      ? "border-white/16 bg-white/[0.08] text-white/80"
      : "border-white/[0.08] bg-white/[0.04] text-white/55";
  return (
    <button
      type="button"
      data-testid="draft-row"
      aria-pressed={selected}
      onClick={onSelect}
      className={[
        "group flex w-full cursor-pointer flex-col gap-3 border-l-2 px-4 py-4 text-left transition-[background-color,border-color,box-shadow] duration-200",
        selected
          ? "border-l-white/85 bg-white/[0.055] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]"
          : "border-l-transparent hover:bg-white/[0.035]",
        isSaved ? "ring-1 ring-inset ring-emerald-200/20" : "",
      ].join(" ")}
    >
      <div className="flex items-start gap-3">
        <span className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${rowIconTone}`}>
          <Icon name={item.kind === "job" ? "briefcase" : "user"} className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <span className={`block truncate text-sm ${item.untitled ? "font-medium text-white/55" : "font-semibold text-white/88"}`}>
            {item.title}
          </span>
          <p className="mt-0.5 truncate text-[11px] text-white/45">
            {item.kind === "job" ? "Job listing" : "Talent listing"} · {relativeTimeLabel(item.updatedAtIso)}
          </p>
        </div>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-end gap-3">
        <div>
          <p className="text-[11px] text-white/55">Ready {c.requiredPercent}%</p>
          <div className="mt-1 h-[5px] overflow-hidden rounded-full bg-white/10">
            <div
              className={`h-full rounded-full ${c.publishReady ? "bg-emerald-300/70" : "bg-white/65"}`}
              style={{ width: `${c.requiredPercent}%` }}
            />
          </div>
        </div>
        <span className="pb-[3px] text-[11px] text-white/35">+</span>
        <div>
          <p className="text-[11px] text-white/55">Strong {c.recommendedPercent}%</p>
          <div className="mt-1 h-[5px] overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-emerald-300/60" style={{ width: `${c.recommendedPercent}%` }} />
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-[11px] text-white/48">{queueNextLabel(item)}</p>
        <span aria-hidden="true" className="text-base leading-none text-white/30 transition-transform group-hover:translate-x-0.5">›</span>
      </div>
    </button>
  );
}

function DraftCompletionWorkspace({
  selected,
  deleting,
  duplicating,
  confirming,
  actionError,
  onBack,
  onResume,
  onPreview,
  onDuplicate,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
}: {
  selected: DraftItem;
  deleting: boolean;
  duplicating: boolean;
  confirming: boolean;
  actionError: string | null;
  onBack: () => void;
  onResume: () => void;
  onPreview: () => void;
  onDuplicate: () => void;
  onRequestDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}) {
  const c = selected.completion;
  const resumeHref = selected.resumeHref;
  const canPreview = selected.kind === "talent";
  const nextIcon = c.nextBestAction.done
    ? "check"
    : c.nextBestAction.jumpLabel && /budget|rate|compensation/.test(c.nextBestAction.jumpLabel)
      ? "cash"
      : "bolt";
  const tips = selected.kind === "job" ? JOB_DRAFT_TIPS : TALENT_DRAFT_TIPS;

  return (
    <div className="ui-crossfade flex flex-col lg:min-h-0 lg:flex-1" data-testid="draft-detail">
      {/* Header */}
      <header className="border-b border-white/[0.06] px-5 py-4 sm:px-7">
        <button
          type="button"
          onClick={onBack}
          className="mb-2.5 inline-flex h-8 cursor-pointer items-center gap-1.5 text-xs font-semibold text-white/65 transition-colors hover:text-white lg:hidden"
        >
          <span aria-hidden="true">←</span>
          Back to drafts
        </button>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className={`truncate text-lg font-semibold sm:text-xl ${selected.untitled ? "text-white/60" : "text-white"}`}>
                {selected.title}
              </h2>
              <button
                type="button"
                onClick={onResume}
                aria-label="Edit draft title"
                title="Edit draft"
                className="shrink-0 text-white/40 transition-colors hover:text-white/80"
              >
                <Icon name="pencil" className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-1 text-[12px] text-white/45">
              {selected.kind === "job" ? "Job listing" : "Talent listing"} · Last saved {relativeTimeLabel(selected.updatedAtIso)}
            </p>
          </div>
          <div className="relative flex shrink-0 items-center gap-2">
            <button type="button" onClick={onResume} className={`hidden lg:inline-flex ${PRIMARY_BUTTON_CLASSES}`}>
              <Icon name="circle-play" className="h-4 w-4" />
              Resume
            </button>
            {canPreview ? (
              <button type="button" onClick={onPreview} className={`hidden lg:inline-flex ${SECONDARY_BUTTON_CLASSES}`}>
                <Icon name="eye" className="h-4 w-4" />
                Preview
              </button>
            ) : null}
            <button
              type="button"
              aria-label="Duplicate draft"
              title="Duplicate draft"
              onClick={onDuplicate}
              disabled={duplicating || deleting}
              className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.03] text-white/55 transition-colors hover:bg-white/[0.07] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
            >
              <Icon name="copy" className="h-4 w-4" />
            </button>
            <button
              type="button"
              aria-label="Delete draft"
              title="Delete draft"
              onClick={onRequestDelete}
              disabled={duplicating || deleting}
              className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.03] text-white/55 transition-colors hover:border-red-200/25 hover:bg-red-300/[0.08] hover:text-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
            >
              <Icon name="trash" className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      <div className="px-5 py-5 sm:px-7 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
        {actionError ? (
          <p className="mb-4 rounded-xl border border-amber-200/25 bg-amber-200/10 px-4 py-3 text-xs text-amber-100">{actionError}</p>
        ) : null}

        {confirming ? (
          <section data-testid="draft-delete-confirm" className="mb-4 rounded-xl border border-white/[0.12] bg-white/[0.03] p-4">
            <p className="text-sm font-semibold text-white/90">Delete this draft?</p>
            <p className="mt-1 text-xs leading-relaxed text-white/55">
              “{selected.title}” will be removed from your drafts. You can’t undo this.
            </p>
            <div className="mt-3.5 flex items-center gap-2">
              <button
                type="button"
                onClick={onConfirmDelete}
                disabled={deleting}
                className="inline-flex h-9 cursor-pointer items-center justify-center rounded-xl border border-red-300/30 bg-red-300/[0.10] px-3.5 text-xs font-semibold text-red-100 transition-colors hover:bg-red-300/[0.16] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {deleting ? "Deleting…" : "Delete draft"}
              </button>
              <button type="button" onClick={onCancelDelete} disabled={deleting} className={GHOST_BUTTON_CLASSES}>
                Cancel
              </button>
            </div>
          </section>
        ) : null}

        {/* Publish readiness + listing strength to-do systems */}
        <div className="grid gap-4 sm:grid-cols-2">
          <CompletionPanel
            label="Publish readiness"
            percent={c.requiredPercent}
            tone="ready"
            items={c.requiredItems}
            resumeHref={resumeHref}
            testId="draft-required-list"
          />
          <CompletionPanel
            label="Listing strength"
            percent={c.recommendedPercent}
            tone="strength"
            items={c.recommendedItems}
            resumeHref={resumeHref}
            testId="draft-recommended-list"
          />
        </div>

        {/* Next best action */}
        <section
          data-testid="draft-next-action"
          className={`mt-5 rounded-2xl border p-4 ${
            c.nextBestAction.done
              ? "border-emerald-200/20 bg-emerald-200/[0.06]"
              : "border-amber-200/15 bg-gradient-to-r from-amber-200/[0.07] to-transparent"
          }`}
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <span
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
                  c.nextBestAction.done ? "bg-emerald-200/15 text-emerald-200/90" : "bg-amber-200/15 text-amber-100/90"
                }`}
              >
                <Icon name={nextIcon} className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <p className={SECTION_LABEL_CLASSES}>Next best action</p>
                <p className="mt-1 text-sm font-semibold text-white/90">{c.nextBestAction.title}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-white/55">{c.nextBestAction.body}</p>
              </div>
            </div>
            {c.nextBestAction.jump ? (
              <Link href={jumpHref(resumeHref, c.nextBestAction.jump)} className={`shrink-0 ${SECONDARY_BUTTON_CLASSES}`}>
                Jump to {c.nextBestAction.jumpLabel}
                <span aria-hidden="true">→</span>
              </Link>
            ) : (
              <button type="button" onClick={onResume} className={`shrink-0 ${SECONDARY_BUTTON_CLASSES}`}>
                Resume draft
                <span aria-hidden="true">→</span>
              </button>
            )}
          </div>
        </section>

        {selected.failureReason ? (
          <p className="mt-4 rounded-xl border border-red-300/25 bg-red-300/[0.08] px-4 py-3 text-xs leading-relaxed text-red-100/90">
            {selected.failureReason}
          </p>
        ) : null}

        {/* Rotating tip strip — anchors the bottom of the completion workspace. */}
        <DraftTipTicker tips={tips} learnMoreHref="/support" />
      </div>

      {/* Mobile sticky resume */}
      <div className="sticky bottom-0 border-t border-white/[0.08] bg-[#0b0b0f]/95 px-5 py-3 backdrop-blur lg:hidden">
        <button type="button" onClick={onResume} className={`w-full ${PRIMARY_BUTTON_CLASSES}`}>
          <Icon name="circle-play" className="h-4 w-4" />
          Resume
        </button>
      </div>
    </div>
  );
}
