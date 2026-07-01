"use client";

import Link from "next/link";
import React from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  deleteJob,
  deleteTalentListing,
  updateJob,
  updateTalentListing,
} from "../lib/backendClient";
import ConfirmDialog from "./ui/ConfirmDialog";

type ListingKind = "job" | "talent";

export default function OwnerListingControlsClient({
  kind,
  id,
  status,
  editHref,
  inboxHref,
}: {
  kind: ListingKind;
  id: string;
  status?: string | null;
  editHref: string;
  inboxHref: string;
}) {
  const router = useRouter();
  const { data: session } = useSession();
  const [currentStatus, setCurrentStatus] = React.useState(status || "published");
  const [busyAction, setBusyAction] = React.useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const mutate = async (action: "published" | "paused" | "closed" | "archived") => {
    const token = session?.backendAccessToken;
    if (!token) return;
    setBusyAction(action);
    setError(null);
    try {
      if (action === "archived") {
        if (kind === "job") {
          await deleteJob(token, id);
        } else {
          await deleteTalentListing(token, id);
        }
        setConfirmOpen(false);
        // The listing is gone — refreshing this page would 404. Send the owner back
        // to their hub (jobs grid for jobs; overview for talent listings).
        router.push(kind === "job" ? "/you?tab=jobs" : "/you");
        return;
      } else if (kind === "job") {
        await updateJob(token, id, { status: action });
        setCurrentStatus(action);
      } else {
        await updateTalentListing(token, id, { status: action });
        setCurrentStatus(action);
      }
      router.refresh();
    } catch {
      setError("Couldn’t update this listing.");
    } finally {
      setBusyAction(null);
    }
  };

  const isArchived = currentStatus === "archived";
  const isPaused = currentStatus === "paused";
  const isClosed = currentStatus === "closed";
  const activeLabel = kind === "job" ? "View applicants" : "View interests";
  const statusLabel = currentStatus[0]?.toUpperCase() + currentStatus.slice(1);
  const deleteLabel = kind === "job" ? "Delete job" : "Delete listing";

  // Deleting asks for confirmation first; non-destructive status changes apply directly.
  const requestAction = (action: "published" | "paused" | "closed" | "archived") => {
    if (action === "archived") {
      setConfirmOpen(true);
      return;
    }
    void mutate(action);
  };

  return (
    <section className="rounded-3xl border border-white/[0.08] bg-white/[0.055] p-5 text-sm text-white/70 shadow-[0_18px_55px_-42px_rgba(0,0,0,0.95)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/36">Owner controls</p>
          <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-white/78">
            <span className="h-2 w-2 rounded-full bg-white/60" />
            {statusLabel}
          </div>
          <p className="mt-3 text-sm leading-6 text-white/55">
            Edit this listing, pause it, or review incoming marketplace messages without leaving the page.
          </p>
        </div>
        <Link
          href={editHref}
          className="cursor-pointer rounded-xl border border-white/[0.1] px-3 py-2 text-xs font-semibold text-white/74 transition hover:bg-white/[0.07] hover:text-white"
        >
          Edit
        </Link>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Link
          href={inboxHref}
          className="cursor-pointer rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-white/72 transition hover:bg-white/[0.08] hover:text-white"
        >
          {activeLabel}
        </Link>
        {!isArchived && isPaused ? (
          <button
            type="button"
            disabled={busyAction !== null}
            onClick={() => requestAction("published")}
            className="cursor-pointer rounded-xl border border-white/[0.1] bg-white/[0.04] px-3 py-2 text-xs font-semibold text-white/72 transition hover:bg-white/[0.08] hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            Publish
          </button>
        ) : null}
        {!isArchived && !isPaused && !isClosed ? (
          <button
            type="button"
            disabled={busyAction !== null}
            onClick={() => requestAction("paused")}
            className="cursor-pointer rounded-xl border border-white/[0.1] bg-white/[0.04] px-3 py-2 text-xs font-semibold text-white/72 transition hover:bg-white/[0.08] hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            Pause
          </button>
        ) : null}
        {kind === "job" && !isArchived && !isClosed ? (
          <button
            type="button"
            disabled={busyAction !== null}
            onClick={() => requestAction("closed")}
            className="cursor-pointer rounded-xl border border-white/[0.1] bg-white/[0.04] px-3 py-2 text-xs font-semibold text-white/72 transition hover:bg-white/[0.08] hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            Close
          </button>
        ) : null}
        {!isArchived ? (
          <button
            type="button"
            disabled={busyAction !== null}
            onClick={() => requestAction("archived")}
            className="cursor-pointer rounded-xl border border-white/[0.1] bg-white/[0.04] px-3 py-2 text-xs font-semibold text-white/55 transition hover:bg-white/[0.08] hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {deleteLabel}
          </button>
        ) : null}
      </div>

      {error ? <p className="mt-3 text-xs text-amber-100/75">{error}</p> : null}

      <ConfirmDialog
        open={confirmOpen}
        title={kind === "job" ? "Delete this job?" : "Delete this listing?"}
        body={
          kind === "job"
            ? "It will be removed from the marketplace and can’t be undone. Applications you’ve already received stay in your inbox."
            : "It will be removed from the marketplace and can’t be undone. Hiring requests you’ve already received stay in your inbox."
        }
        confirmLabel={deleteLabel}
        destructive
        busy={busyAction === "archived"}
        onConfirm={() => void mutate("archived")}
        onCancel={() => setConfirmOpen(false)}
      />
    </section>
  );
}
