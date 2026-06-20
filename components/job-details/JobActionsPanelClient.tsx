"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Job } from "../../lib/types";
import {
  applyToJob,
  createReport,
  describeActionError,
  isBackendAuthError,
  saveJob,
} from "../../lib/backendClient";
import JobActionsPanel from "./JobActionsPanel";

export default function JobActionsPanelClient({
  job,
  secondaryBtnBrightness,
  isOwner = false,
}: {
  job: Job;
  secondaryBtnBrightness: number;
  isOwner?: boolean;
}) {
  const router = useRouter();
  const { data: session } = useSession();
  const [applyNote, setApplyNote] = React.useState("");
  const [applyState, setApplyState] = React.useState<"idle" | "saving" | "sent" | "error">("idle");
  const [applyError, setApplyError] = React.useState<string | null>(null);
  const [saveState, setSaveState] = React.useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [reportState, setReportState] = React.useState<"idle" | "sending" | "sent" | "error">("idle");
  const [shareState, setShareState] = React.useState<"idle" | "copied">("idle");

  const loginRedirect = () =>
    router.push(`/auth?mode=login&next=${encodeURIComponent(`/jobs/${job.id}`)}`);

  const requireToken = () => {
    const token = session?.backendAccessToken;
    if (!token) {
      loginRedirect();
      return null;
    }
    return token;
  };

  const onShare = async () => {
    try {
      const url = typeof window !== "undefined" ? `${window.location.origin}/jobs/${job.id}` : "";
      if (!url) return;
      await navigator.clipboard?.writeText(url);
      setShareState("copied");
      window.setTimeout(() => setShareState("idle"), 1800);
    } catch {
      // Clipboard failure is non-critical; sharing remains available through the URL.
    }
  };

  const onSave = async () => {
    const token = requireToken();
    if (!token) return;
    setSaveState("saving");
    setSaveError(null);
    try {
      await saveJob(token, String(job.id));
      setSaveState("saved");
    } catch (err) {
      console.error("Save job failed:", err);
      setSaveState("error");
      setSaveError(describeActionError(err, "Couldn’t save this job right now."));
    }
  };

  const onApply = async () => {
    const token = requireToken();
    if (!token) return;
    setApplyState("saving");
    setApplyError(null);
    try {
      await applyToJob(token, String(job.id), { cover_note: applyNote });
      setApplyState("sent");
    } catch (err) {
      console.error("Apply to job failed:", err);
      setApplyState("error");
      setApplyError(describeActionError(err, "Couldn’t send the application. Try again."));
      // Expired/invalid session: send them to sign in again so a retry can work.
      if (isBackendAuthError(err)) loginRedirect();
    }
  };

  const onReport = async () => {
    if (reportState === "sent" || reportState === "sending") return;
    setReportState("sending");
    try {
      await createReport(
        {
          target_type: "job",
          target_id: String(job.id),
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
    <JobActionsPanel
      job={job}
      onShare={onShare}
      onSave={onSave}
      onApply={onApply}
      onReport={onReport}
      saveState={saveState}
      applyState={applyState}
      applyError={applyError}
      saveError={saveError}
      reportState={reportState}
      applyNote={applyNote}
      onApplyNoteChange={setApplyNote}
      secondaryBtnBrightness={secondaryBtnBrightness}
      shareState={shareState}
      isOwner={isOwner}
    />
  );
}
