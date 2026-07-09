"use client";

import { useState } from "react";

export type JobAlertsStatus = "idle" | "loading" | "success" | "invalid" | "error";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Shared job-alerts subscribe logic, reused by the inline home section and the
 * popup so both hit the same handler and behave identically. `onSuccess` lets a
 * surface react (e.g. remember the subscription so the popup stops nagging).
 */
export function useJobAlerts(onSuccess?: () => void) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<JobAlertsStatus>("idle");

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (status === "loading") return; // guard against duplicate rapid submits
    const value = email.trim();
    if (!EMAIL_RE.test(value)) {
      setStatus("invalid");
      return;
    }
    setStatus("loading");
    try {
      const res = await fetch("/api/job-alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: value }),
      });
      if (res.ok) {
        setStatus("success");
        onSuccess?.();
      } else if (res.status === 400) {
        setStatus("invalid");
      } else {
        setStatus("error");
      }
    } catch {
      setStatus("error");
    }
  };

  /** Clear a validation/error state as the user edits. */
  const onEditClearError = () => {
    if (status === "invalid" || status === "error") setStatus("idle");
  };

  return { email, setEmail, status, setStatus, submit, onEditClearError };
}
