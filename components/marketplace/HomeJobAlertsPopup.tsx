"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Icon } from "../Icons";
import { useJobAlerts } from "./useJobAlerts";
import {
  isJobAlertsPopupEligible,
  markJobAlertsDismissed,
  markJobAlertsShownThisSession,
  markJobAlertsSubscribed,
} from "../../lib/jobAlertsPopup";

// When to consider showing it (whichever fires first): the user goes to leave the
// tab (exit-intent, desktop) or has spent a while reading (delay, the mobile path).
const SHOW_DELAY_MS = 25_000;
// A reusable programmatic trigger (e.g. a "get job alerts" link elsewhere) — also
// how the e2e test opens it deterministically. Still subject to the frequency caps.
const OPEN_EVENT = "cj:job-alerts";

export function HomeJobAlertsPopup() {
  const [open, setOpen] = useState(false);
  const openedRef = useRef(false);
  const closeTimer = useRef<number | null>(null);

  const handleClose = useCallback(() => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    setOpen(false);
  }, []);

  const { email, setEmail, status, submit, onEditClearError } = useJobAlerts(() => {
    markJobAlertsSubscribed();
    // Let the confirmation land, then close on its own.
    closeTimer.current = window.setTimeout(handleClose, 2600);
  });

  const dismiss = useCallback(() => {
    markJobAlertsDismissed();
    handleClose();
  }, [handleClose]);

  // Show once when a trigger fires and the caps allow it.
  const tryOpen = useCallback(() => {
    if (openedRef.current) return;
    if (!isJobAlertsPopupEligible()) return;
    openedRef.current = true;
    markJobAlertsShownThisSession();
    setOpen(true);
  }, []);

  // Arm the triggers on mount.
  useEffect(() => {
    if (!isJobAlertsPopupEligible()) return; // never arm if it can't show
    const delay = window.setTimeout(tryOpen, SHOW_DELAY_MS);
    // Exit-intent: the cursor leaves the viewport past the top edge.
    const onMouseLeave = (event: MouseEvent) => {
      if (event.clientY <= 0) tryOpen();
    };
    const onOpenEvent = () => tryOpen();
    document.documentElement.addEventListener("mouseleave", onMouseLeave);
    window.addEventListener(OPEN_EVENT, onOpenEvent);
    return () => {
      window.clearTimeout(delay);
      document.documentElement.removeEventListener("mouseleave", onMouseLeave);
      window.removeEventListener(OPEN_EVENT, onOpenEvent);
    };
  }, [tryOpen]);

  // Escape dismisses while open.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, dismiss]);

  useEffect(() => () => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
  }, []);

  if (!open) return null;

  return createPortal(
    <div
      className="ui-modal-backdrop fixed inset-0 z-[9998] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={dismiss}
      data-testid="job-alerts-popup-backdrop"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="job-alerts-popup-title"
        data-testid="job-alerts-popup"
        onClick={(event) => event.stopPropagation()}
        className="ui-modal-panel relative w-full max-w-md rounded-2xl border border-white/12 bg-[#0e0e13] p-6 text-center shadow-[0_40px_120px_-30px_rgba(0,0,0,1)] sm:p-7"
      >
        <button
          type="button"
          onClick={dismiss}
          data-testid="job-alerts-popup-close"
          aria-label="Close"
          className="absolute right-3 top-3 inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-muted transition-colors hover:bg-white/[0.07] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/25"
        >
          <Icon name="x" className="h-4 w-4" />
        </button>

        {status === "success" ? (
          <div className="flex flex-col items-center py-2">
            <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-emerald-200/25 bg-emerald-200/[0.1] text-emerald-100">
              <Icon name="check" className="h-6 w-6" />
            </span>
            <p
              role="status"
              data-testid="job-alerts-popup-success"
              className="mt-5 text-lg font-semibold text-white"
            >
              You&rsquo;re on the list
            </p>
            <p className="mt-2 text-sm leading-6 text-white/55">
              We&rsquo;ll email you creator jobs that match your skills. No spam.
            </p>
          </div>
        ) : (
          <>
            <span className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.06] text-white">
              <Icon name="mail" className="h-5 w-5" />
            </span>
            <h2 id="job-alerts-popup-title" className="mt-5 text-xl font-semibold tracking-tight text-white sm:text-2xl">
              Get first pick of creator jobs
            </h2>
            <p className="mx-auto mt-2.5 max-w-sm text-sm leading-6 text-white/55">
              New creator-native roles that match your skills, in your inbox before they fill. No spam, unsubscribe
              anytime.
            </p>

            <form onSubmit={submit} noValidate className="mt-5 w-full">
              <div className="flex flex-col gap-2.5">
                <label htmlFor="job-alerts-popup-email" className="sr-only">
                  Email address
                </label>
                <input
                  id="job-alerts-popup-email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  autoFocus
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value);
                    onEditClearError();
                  }}
                  placeholder="your@email.com"
                  aria-invalid={status === "invalid"}
                  aria-describedby="job-alerts-popup-status"
                  className="h-11 w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 text-center text-sm text-white outline-none transition-colors placeholder:text-subtle focus:border-white/25 focus:bg-white/[0.06]"
                />
                <button
                  type="submit"
                  disabled={status === "loading"}
                  className="home-cta-sheen inline-flex h-11 w-full cursor-pointer items-center justify-center rounded-xl bg-white px-6 text-sm font-semibold text-[#0b0b0f] transition-colors hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {status === "loading" ? "Subscribing…" : "Get job alerts"}
                </button>
              </div>
              <p
                id="job-alerts-popup-status"
                role="alert"
                aria-live="polite"
                className={`mt-2.5 min-h-[1.25rem] text-xs ${status === "invalid" || status === "error" ? "text-amber-200/80" : "text-transparent"}`}
              >
                {status === "invalid"
                  ? "Enter a valid email address."
                  : status === "error"
                    ? "Something went wrong. Please try again."
                    : " "}
              </p>
            </form>

            <button
              type="button"
              onClick={dismiss}
              data-testid="job-alerts-popup-later"
              className="mt-1 cursor-pointer text-xs font-medium text-subtle underline-offset-4 transition-colors hover:text-white/70 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/25"
            >
              Maybe later
            </button>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
