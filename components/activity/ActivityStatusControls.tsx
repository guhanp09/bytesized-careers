"use client";

import React from "react";
import { useSession } from "next-auth/react";
import {
  updateApplicationStatus,
  updateTalentInterestStatus,
  type BackendJobApplication,
  type BackendTalentInterest,
} from "../../lib/backendClient";

type StatusKind = "application" | "interest";

const APPLICATION_STATUSES: BackendJobApplication["status"][] = [
  "new",
  "reviewing",
  "shortlisted",
  "interviewing",
  "hired",
  "rejected",
  "archived",
];

const INTEREST_STATUSES: BackendTalentInterest["status"][] = [
  "new",
  "reviewing",
  "contacted",
  "declined",
  "archived",
];

const labelFor = (value: string) =>
  value
    .split("_")
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");

export default function ActivityStatusControls({
  kind,
  id,
  status,
}: {
  kind: StatusKind;
  id: string;
  status: string;
}) {
  const { data: session } = useSession();
  const [current, setCurrent] = React.useState(status);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const options = kind === "application" ? APPLICATION_STATUSES : INTEREST_STATUSES;

  const updateStatus = async (next: string) => {
    const token = session?.backendAccessToken;
    if (!token || next === current) return;
    setBusy(true);
    setError(null);
    try {
      if (kind === "application") {
        const updated = await updateApplicationStatus(token, id, next as BackendJobApplication["status"]);
        setCurrent(updated.status);
      } else {
        const updated = await updateTalentInterestStatus(token, id, next as BackendTalentInterest["status"]);
        setCurrent(updated.status);
      }
    } catch {
      setError("Status could not be updated right now.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-start gap-1">
      <select
        value={current}
        disabled={busy || !session?.backendAccessToken}
        onChange={(event) => void updateStatus(event.target.value)}
        className="h-9 cursor-pointer rounded-xl border border-white/[0.1] bg-white/[0.05] px-3 text-xs font-semibold text-white/75 outline-none transition hover:border-white/[0.18] hover:bg-white/[0.08] focus-visible:ring-2 focus-visible:ring-white/15 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {labelFor(option)}
          </option>
        ))}
      </select>
      {error ? <p className="text-[11px] text-amber-100/75">{error}</p> : null}
    </div>
  );
}
