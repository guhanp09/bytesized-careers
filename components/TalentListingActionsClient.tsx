"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Icon } from "./Icons";
import {
  createReport,
  describeActionError,
  isBackendAuthError,
  saveTalentListing,
  sendTalentInterest,
} from "../lib/backendClient";
import { formatCompactNumber } from "../lib/format";
import { IconTooltip, Section } from "./ui";

type ActionState = "idle" | "saving" | "sent" | "error";
const TALENT_MESSAGE_MAX_LENGTH = 600;

function TileShell({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={[
        "rounded-2xl",
        "bg-white/[0.045] border border-white/[0.08]",
        "shadow-[0_18px_55px_-42px_rgba(0,0,0,0.95)]",
        "px-4 py-3",
        "select-none",
        className,
      ].join(" ")}
    >
      {children}
    </div>
  );
}

function StatTile({
  icon,
  value,
  label,
}: {
  icon: "eye" | "user-plus" | "bolt";
  value: string;
  label: string;
}) {
  const tooltipId = React.useId();
  const anchorRef = React.useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = React.useState(false);

  return (
    <div className="relative">
      <div
        tabIndex={0}
        aria-label={label}
        aria-describedby={open ? tooltipId : undefined}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="cursor-default focus-visible:outline-none"
      >
        <TileShell className="h-[54px] flex items-center justify-center">
          <div ref={anchorRef} className="flex items-center justify-center gap-2 text-white/75 transition-colors duration-150 hover:text-white">
            <Icon name={icon} className="h-4 w-4" />
            <span className="text-sm tabular-nums">{value}</span>
          </div>
        </TileShell>
      </div>
      <span className="sr-only">{label}</span>
      <IconTooltip label={label} anchorRef={anchorRef} open={open} id={tooltipId} sideOffset={4} />
    </div>
  );
}

export default function TalentListingActionsClient({
  listingId,
  views = 0,
  interestedRecruitersCount = 0,
}: {
  listingId: string;
  views?: number;
  interestedRecruitersCount?: number;
}) {
  const router = useRouter();
  const { data: session } = useSession();
  const [note, setNote] = React.useState("");
  const [saveState, setSaveState] = React.useState<ActionState>("idle");
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [interestState, setInterestState] = React.useState<ActionState>("idle");
  const [interestError, setInterestError] = React.useState<string | null>(null);
  const [reportState, setReportState] = React.useState<ActionState>("idle");
  const [shareState, setShareState] = React.useState<"idle" | "copied">("idle");

  const loginRedirect = () =>
    router.push(`/auth?mode=login&next=${encodeURIComponent(`/talent/${listingId}`)}`);

  const requireToken = () => {
    const token = session?.backendAccessToken;
    if (!token) {
      loginRedirect();
      return null;
    }
    return token;
  };

  const saveListing = async () => {
    const token = requireToken();
    if (!token) return;
    setSaveState("saving");
    setSaveError(null);
    try {
      await saveTalentListing(token, listingId);
      setSaveState("sent");
    } catch (err) {
      console.error("Save talent listing failed:", err);
      setSaveState("error");
      setSaveError(describeActionError(err, "Couldn’t save this listing right now."));
    }
  };

  const sendInterest = async () => {
    const token = requireToken();
    if (!token) return;
    setInterestState("saving");
    setInterestError(null);
    try {
      await sendTalentInterest(token, listingId, note, null);
      setInterestState("sent");
    } catch (err) {
      console.error("Send talent interest failed:", err);
      setInterestState("error");
      setInterestError(describeActionError(err, "Couldn’t contact talent. Try again."));
      if (isBackendAuthError(err)) loginRedirect();
    }
  };

  const shareListing = async () => {
    try {
      const url = typeof window !== "undefined" ? `${window.location.origin}/talent/${listingId}` : "";
      if (!url) return;
      await navigator.clipboard?.writeText(url);
      setShareState("copied");
      window.setTimeout(() => setShareState("idle"), 1800);
    } catch {
      // Clipboard failure is non-critical; the URL remains shareable.
    }
  };

  const reportListing = async () => {
    if (reportState === "sent" || reportState === "saving") return;
    setReportState("saving");
    try {
      await createReport(
        {
          target_type: "talent_listing",
          target_id: listingId,
          category: "suspicious_or_inaccurate",
          note: null,
        },
        session?.backendAccessToken
      );
      setReportState("sent");
    } catch {
      setReportState("error");
    }
  };

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-white/[0.08] bg-white/[0.06] p-6 shadow-[0_18px_60px_-40px_rgba(0,0,0,0.95)]">
        <div
          className="relative rounded-2xl border border-white/10 bg-white/[0.045] transition focus-within:ring-2 focus-within:ring-white/15"
          data-testid="talent-message-textarea-frame"
        >
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={TALENT_MESSAGE_MAX_LENGTH}
            className="min-h-[112px] w-full resize-none bg-transparent px-3 pb-8 pt-2 text-sm leading-6 text-white placeholder:text-white/35 focus:outline-none"
            placeholder="Add a short message for the candidate."
          />
          <span className="pointer-events-none absolute bottom-2.5 right-3 text-xs font-medium tabular-nums text-white/38">
            {note.length}/{TALENT_MESSAGE_MAX_LENGTH}
          </span>
        </div>

        <button
          type="button"
          onClick={sendInterest}
          disabled={interestState === "saving" || interestState === "sent"}
          className="mt-3 inline-flex h-14 w-full cursor-pointer items-center justify-center gap-2 rounded-2xl bg-white text-lg font-extrabold text-black shadow-[0_18px_40px_-28px_rgba(0,0,0,0.9)] transition-transform duration-150 hover:-translate-y-[1px] hover:bg-white/95 active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-65"
        >
          <Icon name="briefcase" className="h-5 w-5" />
          {interestState === "saving" ? "Sending..." : interestState === "sent" ? "Request sent" : "Hire me"}
        </button>
        {interestState === "error" ? (
          <p className="mt-2 text-xs text-amber-200/80">{interestError || "Couldn’t contact talent. Try again."}</p>
        ) : null}
        {interestState === "sent" ? (
          <p className="mt-2 text-xs text-white/52">
            Your hiring request is now visible in Inbox.
          </p>
        ) : null}

        <div className="mt-4 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={saveListing}
            disabled={saveState === "saving"}
            className="inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-xl bg-white/85 text-sm font-semibold text-black shadow-[0_14px_35px_-26px_rgba(0,0,0,0.95)] transition-transform duration-150 hover:-translate-y-[1px] hover:bg-white active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-65"
          >
            <Icon name="bookmark" className="h-4 w-4" />
            {saveState === "saving" ? "Saving..." : saveState === "sent" ? "Saved" : "Save"}
          </button>
          <button
            type="button"
            onClick={shareListing}
            className="inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-xl bg-white/85 text-sm font-semibold text-black shadow-[0_14px_35px_-26px_rgba(0,0,0,0.95)] transition-transform duration-150 hover:-translate-y-[1px] hover:bg-white active:translate-y-0"
          >
            <Icon name="share" className="h-4 w-4" />
            {shareState === "copied" ? "Copied" : "Share"}
          </button>
        </div>
        {saveState === "error" ? (
          <p className="mt-2 text-xs text-amber-200/80">{saveError || "Couldn’t save this listing right now."}</p>
        ) : null}
        {shareState === "copied" ? <p className="mt-2 text-xs text-white/45">Link copied to your clipboard.</p> : null}

        <div className="mt-4 grid grid-cols-3 gap-3">
          <StatTile icon="eye" value={formatCompactNumber(views)} label="Currently viewing" />
          <StatTile icon="user-plus" value={formatCompactNumber(interestedRecruitersCount)} label="Interested recruiters" />
          <StatTile icon="bolt" value="0%" label="Response rate" />
        </div>
      </section>

      <Section title="Safety & expectations" bodyClassName="mt-3 text-sm leading-relaxed text-white/80">
        Keep communication inside the platform, agree on scope, timeline, revisions, and payment terms before starting.
      </Section>

      <div className="-mt-3 px-1">
        <button
          type="button"
          onClick={reportListing}
          disabled={reportState === "saving" || reportState === "sent"}
          className="inline-flex cursor-pointer items-center gap-2 rounded-md text-xs font-semibold text-white/42 underline-offset-4 transition hover:text-white/72 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/18 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0b0f] disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Icon name="alert" className="h-3.5 w-3.5" />
          {reportState === "saving" ? "Reporting..." : reportState === "sent" ? "Reported" : "Report this listing"}
        </button>
        {reportState === "error" ? (
          <p className="mt-2 text-xs text-white/45">Couldn’t send the report. Try again.</p>
        ) : null}
      </div>
    </div>
  );
}
