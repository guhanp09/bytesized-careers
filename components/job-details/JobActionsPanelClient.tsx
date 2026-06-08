"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Job } from "../../lib/types";
import { applyToJob, createReport, saveJob } from "../../lib/backendClient";
import JobActionsPanel from "./JobActionsPanel";

export default function JobActionsPanelClient({
  job,
  secondaryBtnBrightness,
}: {
  job: Job;
  secondaryBtnBrightness: number;
}) {
  const router = useRouter();
  const { data: session } = useSession();
  const [applyNote, setApplyNote] = React.useState("");
  const [applyState, setApplyState] = React.useState<"idle" | "saving" | "sent" | "error">("idle");
  const [saveState, setSaveState] = React.useState<"idle" | "saving" | "saved" | "error">("idle");
  const [reportState, setReportState] = React.useState<"idle" | "sending" | "sent" | "error">("idle");
  const [shareState, setShareState] = React.useState<"idle" | "copied">("idle");

  const requireToken = () => {
    const token = session?.backendAccessToken;
    if (!token) {
      router.push(`/auth?mode=login&next=${encodeURIComponent(`/jobs/${job.id}`)}`);
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
    try {
      await saveJob(token, String(job.id));
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  };

  const onApply = async () => {
    const token = requireToken();
    if (!token) return;
    setApplyState("saving");
    try {
      await applyToJob(token, String(job.id), { cover_note: applyNote });
      setApplyState("sent");
    } catch {
      setApplyState("error");
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
      reportState={reportState}
      applyNote={applyNote}
      onApplyNoteChange={setApplyNote}
      secondaryBtnBrightness={secondaryBtnBrightness}
      shareState={shareState}
    />
  );
}
