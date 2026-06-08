"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Icon } from "./Icons";
import { createReport, listMyJobs, saveTalentListing, sendTalentInterest } from "../lib/backendClient";
import { formatCompactNumber } from "../lib/format";
import type { Job } from "../lib/types";
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
  icon: "user-plus" | "eye" | "image";
  value: string;
  label: string;
}) {
  return (
    <div className="relative">
      <div className="peer">
        <TileShell className="h-[54px] flex items-center justify-center">
          <div className="flex items-center justify-center gap-2 text-white/75 transition-colors duration-150 hover:text-white">
            <Icon name={icon} className="h-4 w-4" />
            <span className="text-sm tabular-nums">{value}</span>
          </div>
        </TileShell>
      </div>
      <span className="sr-only">{label}</span>
      <IconTooltip label={label} className="-top-6" />
    </div>
  );
}

export default function TalentListingActionsClient({
  listingId,
  views = 0,
  workSamplesCount = 0,
  interestedRecruitersCount = 0,
}: {
  listingId: string;
  views?: number;
  workSamplesCount?: number;
  interestedRecruitersCount?: number;
}) {
  const router = useRouter();
  const { data: session } = useSession();
  const [note, setNote] = React.useState("");
  const [saveState, setSaveState] = React.useState<ActionState>("idle");
  const [interestState, setInterestState] = React.useState<ActionState>("idle");
  const [reportState, setReportState] = React.useState<ActionState>("idle");
  const [shareState, setShareState] = React.useState<"idle" | "copied">("idle");
  const [myJobs, setMyJobs] = React.useState<Job[]>([]);
  const [jobsLoading, setJobsLoading] = React.useState(false);
  const [selectedJobId, setSelectedJobId] = React.useState("");

  React.useEffect(() => {
    const token = session?.backendAccessToken;
    if (!token) {
      setMyJobs([]);
      setSelectedJobId("");
      return;
    }
    let cancelled = false;
    setJobsLoading(true);
    void listMyJobs(token)
      .then((jobs) => {
        if (cancelled) return;
        const activeJobs = jobs.filter((job) => !["closed", "archived"].includes(String(job.status || "")));
        setMyJobs(activeJobs);
        setSelectedJobId((current) => current || activeJobs[0]?.id || "");
      })
      .catch(() => {
        if (cancelled) return;
        setMyJobs([]);
        setSelectedJobId("");
      })
      .finally(() => {
        if (!cancelled) setJobsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [session?.backendAccessToken]);

  const requireToken = () => {
    const token = session?.backendAccessToken;
    if (!token) {
      router.push(`/auth?mode=login&next=${encodeURIComponent(`/talent/${listingId}`)}`);
      return null;
    }
    return token;
  };

  const saveListing = async () => {
    const token = requireToken();
    if (!token) return;
    setSaveState("saving");
    try {
      await saveTalentListing(token, listingId);
      setSaveState("sent");
    } catch {
      setSaveState("error");
    }
  };

  const sendInterest = async () => {
    const token = requireToken();
    if (!token) return;
    setInterestState("saving");
    try {
      await sendTalentInterest(token, listingId, note, selectedJobId || null);
      setInterestState("sent");
    } catch {
      setInterestState("error");
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

        {myJobs.length ? (
          <label className="mt-3 block">
            <span className="text-xs font-semibold text-white/45">Attach a job</span>
            <select
              value={selectedJobId}
              onChange={(event) => setSelectedJobId(event.target.value)}
              disabled={jobsLoading || interestState === "saving" || interestState === "sent"}
              className="mt-1 h-11 w-full cursor-pointer rounded-2xl border border-white/10 bg-white/[0.045] px-3 text-sm text-white outline-none transition hover:bg-white/[0.065] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {myJobs.map((job) => (
                <option key={job.id} value={job.id}>
                  {job.title}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <button
          type="button"
          onClick={sendInterest}
          disabled={interestState === "saving" || interestState === "sent"}
          className="mt-3 inline-flex h-14 w-full cursor-pointer items-center justify-center gap-2 rounded-2xl bg-white text-lg font-extrabold text-black shadow-[0_18px_40px_-28px_rgba(0,0,0,0.9)] transition-transform duration-150 hover:-translate-y-[1px] hover:bg-white/95 active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-65"
        >
          <Icon name="send" className="h-5 w-5" />
          {interestState === "saving"
            ? "Sending..."
            : interestState === "sent"
              ? selectedJobId
                ? "Invite sent"
                : "Contacted"
              : myJobs.length
                ? "Invite to job"
                : "Contact talent"}
        </button>
        {interestState === "error" ? (
          <p className="mt-2 text-xs text-white/52">Couldn’t contact talent. Try again.</p>
        ) : null}
        {interestState === "sent" ? (
          <p className="mt-2 text-xs text-white/52">
            {selectedJobId ? "The invite is now visible in Activity." : "Your contact request is now visible in Activity."}
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
        {saveState === "error" ? <p className="mt-2 text-xs text-white/45">Couldn’t save this listing right now.</p> : null}
        {shareState === "copied" ? <p className="mt-2 text-xs text-white/45">Link copied to your clipboard.</p> : null}

        <div className="mt-4 grid grid-cols-3 gap-3">
          <StatTile icon="user-plus" value={formatCompactNumber(interestedRecruitersCount)} label="Interested recruiters" />
          <StatTile icon="eye" value={formatCompactNumber(views)} label="Views" />
          <StatTile icon="image" value={formatCompactNumber(workSamplesCount)} label="Work samples" />
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
