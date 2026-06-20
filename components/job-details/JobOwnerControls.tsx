"use client";

import Link from "next/link";
import React from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { deleteJob, updateJob } from "../../lib/backendClient";
import { Icon } from "../Icons";

type OwnerAction = "published" | "paused" | "closed" | "archived";

// Only non-default states get a visible label — "Published" is the normal state
// and announcing it just adds clutter to the title card.
const STATUS_LABEL: Record<string, string> = {
  paused: "Paused",
  closed: "Closed",
  archived: "Archived",
  draft: "Draft",
};

/**
 * Recessed, owner-only management layer for the job-detail title card.
 *
 * Kept deliberately quiet so the title stays the hero: a single ghost Edit icon
 * plus an overflow menu for everything else (view applicants, pause, close,
 * archive). A small status chip appears only when the listing is not in the
 * normal published state.
 */
export default function JobOwnerControls({
  jobId,
  status,
  editHref,
  applicantsHref,
}: {
  jobId: string;
  status?: string | null;
  editHref: string;
  applicantsHref: string;
}) {
  const router = useRouter();
  const { data: session } = useSession();
  const [currentStatus, setCurrentStatus] = React.useState((status || "published").toLowerCase());
  const [busy, setBusy] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const mutate = async (action: OwnerAction) => {
    const token = session?.backendAccessToken;
    if (!token) {
      router.push(`/auth?mode=login&next=${encodeURIComponent(`/jobs/${jobId}`)}`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (action === "archived") {
        await deleteJob(token, jobId);
      } else {
        await updateJob(token, jobId, { status: action });
      }
      setCurrentStatus(action);
      setMenuOpen(false);
      router.refresh();
    } catch {
      setError("Couldn’t update this listing. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const confirmAndMutate = (action: OwnerAction) => {
    if (action === "archived") {
      const confirmed = window.confirm("Archive this job? It will no longer be visible to talent.");
      if (!confirmed) return;
    }
    void mutate(action);
  };

  const isArchived = currentStatus === "archived";
  const isPaused = currentStatus === "paused";
  const isClosed = currentStatus === "closed";
  const statusLabel = STATUS_LABEL[currentStatus];
  const statusDotClass = isPaused ? "bg-amber-300/80" : "bg-white/35";

  const iconBtn =
    "inline-flex h-8 w-8 items-center justify-center rounded-lg text-white/45 transition hover:bg-white/[0.06] hover:text-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/15 disabled:cursor-not-allowed disabled:opacity-50";
  const menuItem =
    "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-white/75 transition hover:bg-white/[0.07] hover:text-white disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <div className="relative flex items-center gap-0.5" data-testid="job-owner-controls">
      {statusLabel ? (
        <span className="mr-1 inline-flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/60">
          <span className={["h-1.5 w-1.5 rounded-full", statusDotClass].join(" ")} aria-hidden="true" />
          {statusLabel}
        </span>
      ) : null}

      <Link href={editHref} aria-label="Edit job" title="Edit job" className={iconBtn}>
        <Icon name="pencil" className="h-[18px] w-[18px]" />
      </Link>

      <div className="relative">
        <button
          type="button"
          aria-label="More owner actions"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          title="More"
          onClick={() => setMenuOpen((open) => !open)}
          className={iconBtn}
        >
          <Icon name="more" className="h-[18px] w-[18px]" />
        </button>

        {menuOpen ? (
          <>
            <button
              type="button"
              aria-hidden="true"
              tabIndex={-1}
              className="fixed inset-0 z-40 cursor-default"
              onClick={() => setMenuOpen(false)}
            />
            <div
              role="menu"
              aria-label="Manage listing"
              className="absolute right-0 z-50 mt-2 w-52 rounded-2xl border border-white/[0.1] bg-[#15151b] p-1.5 shadow-[0_24px_60px_-30px_rgba(0,0,0,0.95)]"
            >
              <Link
                href={applicantsHref}
                role="menuitem"
                onClick={() => setMenuOpen(false)}
                className={menuItem}
              >
                <Icon name="users" className="h-4 w-4 text-white/50" />
                View applicants
              </Link>

              <div className="my-1 h-px bg-white/[0.07]" />

              {isPaused || isClosed ? (
                <button
                  type="button"
                  role="menuitem"
                  disabled={busy}
                  onClick={() => confirmAndMutate("published")}
                  className={menuItem}
                >
                  <Icon name="check" className="h-4 w-4 text-white/50" />
                  Republish
                </button>
              ) : null}
              {!isPaused && !isClosed && !isArchived ? (
                <button
                  type="button"
                  role="menuitem"
                  disabled={busy}
                  onClick={() => confirmAndMutate("paused")}
                  className={menuItem}
                >
                  <Icon name="pause" className="h-4 w-4 text-white/50" />
                  Pause listing
                </button>
              ) : null}
              {!isClosed && !isArchived ? (
                <button
                  type="button"
                  role="menuitem"
                  disabled={busy}
                  onClick={() => confirmAndMutate("closed")}
                  className={menuItem}
                >
                  <Icon name="x" className="h-4 w-4 text-white/50" />
                  Close listing
                </button>
              ) : null}
              {!isArchived ? (
                <button
                  type="button"
                  role="menuitem"
                  disabled={busy}
                  onClick={() => confirmAndMutate("archived")}
                  className={menuItem}
                >
                  <Icon name="archive" className="h-4 w-4 text-white/50" />
                  Archive job
                </button>
              ) : null}
            </div>
          </>
        ) : null}
      </div>

      {error ? (
        <div
          role="alert"
          className="absolute right-0 top-full z-50 mt-2 whitespace-nowrap rounded-lg border border-amber-300/25 bg-amber-300/10 px-2.5 py-1.5 text-[11px] font-medium text-amber-100/90"
        >
          {error}
        </div>
      ) : null}
    </div>
  );
}
