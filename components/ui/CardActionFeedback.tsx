"use client";

import React from "react";
import { Icon } from "../Icons";

type IconName = React.ComponentProps<typeof Icon>["name"];

export type CardActionFeedbackTone = "success" | "info" | "error";

export type CardActionFeedbackState = {
  id: number;
  message: string;
  tone: CardActionFeedbackTone;
  icon?: IconName;
  visual?: "check" | "copy";
  actionLabel?: string;
  actionHref?: string;
};

type CardActionFeedbackOptions = {
  visual?: CardActionFeedbackState["visual"];
  actionLabel?: string;
  actionHref?: string;
  durationMs?: number;
};

export function useTransientCardFeedback(timeoutMs = 2600) {
  const [feedback, setFeedback] = React.useState<CardActionFeedbackState | null>(null);
  const timerRef = React.useRef<number | null>(null);

  React.useEffect(
    () => () => {
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
    },
    []
  );

  const showFeedback = React.useCallback(
    (message: string, tone: CardActionFeedbackTone = "success", icon?: IconName, options: CardActionFeedbackOptions = {}) => {
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
      setFeedback({
        id: Date.now(),
        message,
        tone,
        icon,
        visual: options.visual,
        actionLabel: options.actionLabel,
        actionHref: options.actionHref,
      });
      timerRef.current = window.setTimeout(() => setFeedback(null), options.durationMs ?? timeoutMs);
    },
    [timeoutMs]
  );

  return { feedback, showFeedback };
}

export async function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall through to the textarea fallback for non-secure contexts or denied clipboard access.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "-9999px";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  document.body.removeChild(textarea);
  if (!copied) throw new Error("Clipboard copy failed");
}

export default function CardActionFeedback({
  feedback,
  className = "",
}: {
  feedback: CardActionFeedbackState | null;
  className?: string;
}) {
  if (!feedback) return null;

  const icon =
    feedback.icon ??
    (feedback.tone === "error" ? "alert" : feedback.tone === "info" ? "bell" : "check");
  const hasAction = Boolean(feedback.actionHref && feedback.actionLabel);
  const toneClass =
    feedback.tone === "error"
      ? "border-amber-200/22 bg-amber-500/[0.13] text-amber-100 shadow-[0_16px_40px_-24px_rgba(251,191,36,0.65)]"
      : feedback.tone === "info"
        ? "border-sky-200/18 bg-sky-400/[0.12] text-sky-100 shadow-[0_16px_40px_-24px_rgba(56,189,248,0.55)]"
        : "border-emerald-200/30 bg-emerald-400/[0.16] text-emerald-50 shadow-[0_18px_48px_-24px_rgba(52,211,153,0.72)]";

  return (
    <div
      key={feedback.id}
      aria-live="polite"
      className={[
        "pointer-events-none absolute bottom-14 right-5 z-30",
        "animate-[card-feedback-in_180ms_ease-out]",
        className,
      ].join(" ")}
    >
      <div
        className={[
          "inline-flex max-w-[280px] items-center gap-2 rounded-xl border px-3 py-2",
          "backdrop-blur-xl text-xs font-semibold tracking-[0.01em]",
          hasAction ? "pointer-events-auto" : "",
          toneClass,
        ].join(" ")}
      >
        <FeedbackVisual visual={feedback.visual} icon={icon} />
        <span className="line-clamp-2">{feedback.message}</span>
        {feedback.actionHref && feedback.actionLabel ? (
          <a
            href={feedback.actionHref}
            onClick={(event) => event.stopPropagation()}
            className="ml-1 inline-flex shrink-0 cursor-pointer items-center rounded-lg border border-emerald-100/20 bg-white/[0.10] px-2 py-1 text-[11px] font-semibold text-white transition hover:border-emerald-100/35 hover:bg-white/[0.16] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-100/35"
          >
            {feedback.actionLabel}
          </a>
        ) : null}
      </div>
    </div>
  );
}

function FeedbackVisual({ visual, icon }: { visual?: CardActionFeedbackState["visual"]; icon: IconName }) {
  if (visual === "check") {
    return (
      <span className="card-feedback-check-mark relative inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-emerald-100/35 bg-emerald-300/15">
        <span aria-hidden="true" className="card-feedback-check-ring absolute inset-[-3px] rounded-full border border-emerald-200/35" />
        <span aria-hidden="true" className="card-feedback-check-glow absolute inset-[-1px] rounded-full bg-emerald-200/15" />
        <svg viewBox="0 0 16 16" aria-hidden="true" className="relative h-3 w-3 text-emerald-50">
          <path
            d="M3.5 8.2 6.4 11 12.7 4.8"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            className="card-feedback-check-path"
          />
        </svg>
      </span>
    );
  }

  if (visual === "copy") {
    return (
      <span className="relative inline-flex h-4 w-4 shrink-0 items-center justify-center">
        <span className="absolute left-[2px] top-[1px] h-2.5 w-2.5 rounded-[3px] border border-emerald-100/35 bg-emerald-300/10" />
        <span className="card-feedback-copy-front relative h-2.5 w-2.5 overflow-hidden rounded-[3px] border border-emerald-50/70 bg-emerald-300/15">
          <span className="card-feedback-copy-shine absolute inset-y-[-20%] left-[-60%] w-1/2 rotate-12 bg-white/45" />
        </span>
      </span>
    );
  }

  return <Icon name={icon} className="h-3.5 w-3.5 shrink-0" />;
}
