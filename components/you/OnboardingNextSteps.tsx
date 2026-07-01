"use client";

import Link from "next/link";

import { Icon } from "../Icons";
import {
  nextStepFor,
  type OnboardingIntent,
  type OwnerProfileMode,
} from "../../lib/onboarding";

type IntentChoice = {
  intent: Exclude<OnboardingIntent, "DECIDE_LATER">;
  icon: "user" | "briefcase" | "users";
  label: string;
  helper: string;
};

const CHOICES: IntentChoice[] = [
  {
    intent: "LOOKING_FOR_WORK",
    icon: "user",
    label: "Find creator work",
    helper: "Build a profile, browse jobs, and get hired by creators and teams.",
  },
  {
    intent: "HIRING_CREATOR_TALENT",
    icon: "briefcase",
    label: "Hire creator talent",
    helper: "Post jobs and reach editors, designers, writers, and strategists.",
  },
  {
    intent: "BOTH",
    icon: "users",
    label: "A bit of both",
    helper: "Do creator work and hire — switch sides anytime from your profile.",
  },
];

type OnboardingNextStepsProps = {
  intentChosen: boolean;
  mode: OwnerProfileMode;
  hasJob: boolean;
  profileComplete: boolean;
  saving?: boolean;
  onChooseIntent: (intent: OnboardingIntent) => void;
  className?: string;
};

export default function OnboardingNextSteps({
  intentChosen,
  mode,
  hasJob,
  profileComplete,
  saving = false,
  onChooseIntent,
  className = "",
}: OnboardingNextStepsProps) {
  // First-run: ask what brings them here. Drives the hub mode + tailored next step.
  if (!intentChosen) {
    return (
      <section
        className={[
          "rounded-3xl border border-white/10 bg-white/[0.05] p-5 shadow-[0_18px_55px_-32px_rgba(0,0,0,0.95)] sm:p-6",
          className,
        ].join(" ")}
        aria-label="Get started"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold tracking-tight text-white/95">
              Welcome to CreatorJobs
            </h2>
            <p className="mt-1 text-sm leading-6 text-white/55">
              What brings you here? Pick one for a tailored setup — you can do both anytime.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onChooseIntent("DECIDE_LATER")}
            disabled={saving}
            className="shrink-0 cursor-pointer rounded-lg px-2 py-1 text-xs font-medium text-white/45 transition-colors hover:text-white/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Decide later
          </button>
        </div>

        <div className="mt-4 grid gap-2.5 sm:grid-cols-3">
          {CHOICES.map((choice) => (
            <button
              key={choice.intent}
              type="button"
              onClick={() => onChooseIntent(choice.intent)}
              disabled={saving}
              className="group flex h-full cursor-pointer flex-col items-start gap-2 rounded-2xl border border-white/[0.08] bg-white/[0.035] p-4 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-white/[0.16] hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.05] text-white/65 transition group-hover:text-white">
                <Icon name={choice.icon} className="h-4 w-4" />
              </span>
              <span className="text-sm font-semibold text-white/90">{choice.label}</span>
              <span className="text-xs leading-5 text-white/50">{choice.helper}</span>
            </button>
          ))}
        </div>
      </section>
    );
  }

  // Intent chosen: surface the single highest-value next action for this mode.
  const step = nextStepFor({ mode, hasJob, profileComplete });
  if (!step) return null;

  return (
    <section
      className={[
        "flex flex-col gap-4 rounded-3xl border border-white/10 bg-white/[0.05] p-5 shadow-[0_18px_55px_-32px_rgba(0,0,0,0.95)] sm:flex-row sm:items-center sm:justify-between sm:p-6",
        className,
      ].join(" ")}
      aria-label="Recommended next step"
    >
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/40">
          Next step
        </p>
        <h2 className="mt-1.5 text-base font-semibold tracking-tight text-white/95">
          {step.headline}
        </h2>
        <p className="mt-1 max-w-xl text-sm leading-6 text-white/55">{step.helper}</p>
      </div>
      <Link
        href={step.ctaHref}
        className="inline-flex h-10 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-black transition hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
      >
        {step.ctaLabel}
        <span aria-hidden="true">→</span>
      </Link>
    </section>
  );
}
