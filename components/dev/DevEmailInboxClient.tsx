"use client";

import { useEffect, useState } from "react";

import { Icon } from "../Icons";

type DevEmail = {
  id: string;
  to: string;
  subject: string;
  type: "verification" | "password_reset" | "other";
  typeLabel: string;
  createdAt: string | null;
  actionUrl: string | null;
  preview: string | null;
};

type DevEmailResponse = {
  items?: unknown;
  error?: unknown;
  detail?: unknown;
};

const ACTION_URL_RE = /https?:\/\/[^\s<>"']+/;
const STRING_KEYS = ["url", "href", "value", "text", "message", "email", "label", "subject"];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const asString = (value: unknown): string | null => {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const normalized = asString(item);
      if (normalized) return normalized;
    }
  }
  if (isRecord(value)) {
    for (const key of STRING_KEYS) {
      const normalized = asString(value[key]);
      if (normalized) return normalized;
    }
  }
  return null;
};

const extractActionUrl = (...values: Array<unknown>) => {
  for (const value of values) {
    const normalized = asString(value);
    if (!normalized) continue;
    const match = ACTION_URL_RE.exec(normalized);
    if (match) return match[0].replace(/[.,)]$/, "");
  }
  return null;
};

const normalizeType = (typeValue: unknown, subject: string): DevEmail["type"] => {
  const normalized = `${asString(typeValue) || ""} ${subject}`.toLowerCase();
  if (normalized.includes("reset")) return "password_reset";
  if (normalized.includes("verify") || normalized.includes("verification")) return "verification";
  return "other";
};

const getTypeLabel = (type: DevEmail["type"]) => {
  if (type === "password_reset") return "Password reset";
  if (type === "verification") return "Email verification";
  return "Auth email";
};

const getErrorMessage = (payload: DevEmailResponse, fallback: string) =>
  asString(payload.error) || asString(payload.detail) || fallback;

const normalizeEmail = (raw: unknown, index: number): DevEmail => {
  const record = isRecord(raw) ? raw : {};
  const subject = asString(record.subject) || asString(record.title) || "Auth email";
  const type = normalizeType(record.type, subject);
  const to =
    asString(record.to) ||
    asString(record.to_email) ||
    asString(record.recipient) ||
    asString(record.email) ||
    "Unknown recipient";
  const createdAt = asString(record.createdAt) || asString(record.created_at) || asString(record.created);
  const body =
    asString(record.body) ||
    asString(record.text_body) ||
    asString(record.textBody) ||
    asString(record.preview) ||
    null;
  const preview = asString(record.preview) || body;
  const actionUrl = extractActionUrl(
    record.actionUrl,
    record.action_url,
    record.link,
    record.verificationUrl,
    record.verification_url,
    record.resetUrl,
    record.reset_url,
    body,
    preview
  );
  const id = asString(record.id) || `${to}-${createdAt || index}-${subject}`;

  return {
    id,
    to,
    subject,
    type,
    typeLabel: getTypeLabel(type),
    createdAt: createdAt || null,
    actionUrl,
    preview,
  };
};

const extractItems = (payload: unknown) => {
  if (Array.isArray(payload)) return payload;
  if (isRecord(payload) && Array.isArray(payload.items)) return payload.items;
  return [];
};

const formatTime = (value?: string | null) => {
  if (!value) return "Just now";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
};

const getOpenLabel = (email: DevEmail) =>
  email.type === "password_reset"
    ? "Open reset link"
    : email.type === "verification"
      ? "Open verification link"
      : "Open link";

export default function DevEmailInboxClient() {
  const [emails, setEmails] = useState<DevEmail[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const loadEmails = async () => {
    setStatus("loading");
    setMessage(null);
    try {
      const response = await fetch("/api/dev/emails", { cache: "no-store" });
      const data = (await response.json()) as DevEmailResponse;
      if (!response.ok) {
        throw new Error(getErrorMessage(data, "Could not load development emails."));
      }
      setEmails(extractItems(data).map(normalizeEmail));
      setStatus("ready");
    } catch (error) {
      setEmails([]);
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Could not load development emails.");
    }
  };

  useEffect(() => {
    void loadEmails();
  }, []);

  const clearInbox = async () => {
    setMessage(null);
    try {
      const response = await fetch("/api/dev/emails", { method: "DELETE" });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as DevEmailResponse;
        throw new Error(getErrorMessage(data, "Could not clear the development inbox."));
      }
      setEmails([]);
      setMessage("Development inbox cleared.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not clear the development inbox.");
    }
  };

  const copyLink = async (email: DevEmail) => {
    if (!email.actionUrl) return;
    try {
      await navigator.clipboard.writeText(email.actionUrl);
    } catch {
      const textArea = document.createElement("textarea");
      textArea.value = email.actionUrl;
      textArea.setAttribute("readonly", "");
      textArea.style.position = "fixed";
      textArea.style.left = "-9999px";
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand("copy");
      document.body.removeChild(textArea);
    }
    setCopiedId(email.id);
    window.setTimeout(() => setCopiedId(null), 1500);
  };

  return (
    <div className="mt-8 space-y-4">
      <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-white">Recent auth emails</p>
          <p className="mt-1 text-xs leading-5 text-white/55">
            Captured only when the backend is running outside production with EMAIL_MODE=log.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={loadEmails}
            className="inline-flex h-9 cursor-pointer items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] px-3 text-xs font-semibold text-white/75 transition-colors hover:bg-white/[0.08] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={clearInbox}
            className="inline-flex h-9 cursor-pointer items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] px-3 text-xs font-semibold text-white/65 transition-colors hover:bg-white/[0.08] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
          >
            Clear inbox
          </button>
        </div>
      </div>

      {message && status !== "error" ? (
        <div className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white/70">
          {message}
        </div>
      ) : null}

      {status === "loading" ? (
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 text-sm text-white/55">
          Loading development emails...
        </div>
      ) : null}

      {status === "ready" && emails.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 text-sm text-white/60">
          No development emails captured yet. Sign up, resend verification, or request a password reset.
        </div>
      ) : null}

      {status === "error" ? (
        <div className="rounded-2xl border border-amber-200/20 bg-amber-200/10 p-5 text-sm text-amber-100">
          {message || "Development email inbox is unavailable."}
        </div>
      ) : null}

      <div className="space-y-3">
        {emails.map((email, index) => {
          const stableId = email.id || `${email.to}-${index}`;
          const copied = copiedId === stableId;
          return (
            <article
              key={stableId}
              className="rounded-2xl border border-white/10 bg-[#111116] p-4 transition-colors hover:border-white/18"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-subtle">
                    <Icon name="inbox" className="h-3.5 w-3.5" />
                    {email.typeLabel}
                  </div>
                  <p className="mt-2 truncate text-sm font-semibold text-white">To: {email.to}</p>
                  <p className="mt-1 truncate text-xs text-white/60">Subject: {email.subject}</p>
                  <p className="mt-1 text-xs text-muted">Created: {formatTime(email.createdAt)}</p>
                  {email.preview ? (
                    <p className="mt-3 line-clamp-3 text-sm leading-6 text-white/55">{email.preview}</p>
                  ) : null}
                </div>
                {email.actionUrl ? (
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <a
                      href={email.actionUrl}
                      className="inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-xl bg-white px-3 text-xs font-semibold text-black transition-colors hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/35"
                    >
                      {getOpenLabel(email)}
                      <Icon name="external-link" className="h-3.5 w-3.5" />
                    </a>
                    <button
                      type="button"
                      onClick={() => copyLink(email)}
                      className="inline-flex h-9 cursor-pointer items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] px-3 text-xs font-semibold text-white/75 transition-colors hover:bg-white/[0.08] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
                    >
                      {copied ? "Copied" : "Copy link"}
                    </button>
                  </div>
                ) : (
                  <p className="shrink-0 text-xs text-subtle">No action link found</p>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
