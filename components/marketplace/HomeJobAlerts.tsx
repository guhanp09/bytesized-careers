"use client";

import { Icon } from "../Icons";
import { Reveal } from "../ui";
import { useJobAlerts } from "./useJobAlerts";
import { markJobAlertsSubscribed } from "../../lib/jobAlertsPopup";

export function HomeJobAlerts() {
  // Subscribing here also stops the popup from nagging (shared subscribed flag).
  const { email, setEmail, status, submit: handleSubmit, onEditClearError } = useJobAlerts(markJobAlertsSubscribed);

  return (
    <section className="space-y-6" data-testid="home-job-alerts">
      <Reveal>
        <div className="mx-auto flex max-w-xl flex-col items-center text-center">
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.06] text-white">
            <Icon name="mail" className="h-5 w-5" />
          </span>
          <h2 className="mt-5 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            Get job alerts in your inbox
          </h2>
          <p className="mt-3 max-w-md text-sm leading-6 text-white/55">
            Creator-native jobs matching your skills, delivered to your inbox. No spam.
          </p>

          {status === "success" ? (
            <p
              role="status"
              data-testid="job-alerts-success"
              className="mt-6 inline-flex items-center gap-2 rounded-xl border border-emerald-200/20 bg-emerald-200/[0.08] px-4 py-3 text-sm font-medium text-emerald-50/90"
            >
              <Icon name="check" className="h-4 w-4 text-emerald-200/80" />
              You&rsquo;re subscribed. We&rsquo;ll send relevant creator jobs to your inbox.
            </p>
          ) : (
            <form onSubmit={handleSubmit} noValidate className="mt-6 w-full max-w-md">
              <div className="flex flex-col gap-2.5 sm:flex-row">
                <label htmlFor="job-alerts-email" className="sr-only">
                  Email address
                </label>
                <input
                  id="job-alerts-email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value);
                    onEditClearError();
                  }}
                  placeholder="your@email.com"
                  aria-invalid={status === "invalid"}
                  aria-describedby="job-alerts-status"
                  className="h-11 flex-1 rounded-xl border border-white/10 bg-white/[0.04] px-4 text-sm text-white outline-none transition-colors placeholder:text-subtle focus:border-white/25 focus:bg-white/[0.06]"
                />
                <button
                  type="submit"
                  disabled={status === "loading"}
                  className="home-cta-sheen inline-flex h-11 shrink-0 cursor-pointer items-center justify-center rounded-xl bg-white px-6 text-sm font-semibold text-[#0b0b0f] transition-colors hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {status === "loading" ? "Subscribing…" : "Subscribe"}
                </button>
              </div>
              <p
                id="job-alerts-status"
                role="alert"
                aria-live="polite"
                className={`mt-2.5 min-h-[1.25rem] text-xs ${status === "invalid" || status === "error" ? "text-amber-200/80" : "text-transparent"}`}
              >
                {status === "invalid"
                  ? "Enter a valid email address."
                  : status === "error"
                    ? "Something went wrong. Please try again."
                    : " "}
              </p>
            </form>
          )}
        </div>
      </Reveal>
    </section>
  );
}
