// Pure helpers for the inline /you onboarding (role-aware next-best-action).
// Kept free of React/network so they can be unit-tested in isolation and keep
// the YouHubClient wiring thin.

export type OnboardingIntent =
  | "LOOKING_FOR_WORK"
  | "HIRING_CREATOR_TALENT"
  | "BOTH"
  | "DECIDE_LATER";

export type OwnerProfileMode = "talent" | "hiring";

export type OnboardingNextStep = {
  key: "post-job" | "create-listing";
  headline: string;
  helper: string;
  ctaLabel: string;
  ctaHref: string;
};

/**
 * The hub mode a given intent should open in. Returns null for intents with no
 * strong opinion (BOTH / DECIDE_LATER / unknown), so callers can keep their own
 * default (talent) and never override a user's manual mode switch.
 */
export function intentToMode(intent: OnboardingIntent | null | undefined): OwnerProfileMode | null {
  if (intent === "HIRING_CREATOR_TALENT") return "hiring";
  if (intent === "LOOKING_FOR_WORK") return "talent";
  return null;
}

/**
 * Whether the user has explicitly made (or deferred) an onboarding choice. Every
 * explicit choice is recorded with a server timestamp, so a missing timestamp
 * means "never prompted" — which includes all pre-existing users, so they get the
 * one-time prompt on their next visit. Choosing (or "Decide later") sets the
 * timestamp and the prompt never returns. Intentionally ignores the intent value:
 * a default DECIDE_LATER with no timestamp is "not yet chosen".
 */
export function hasChosenIntent(selectedAt: string | null | undefined): boolean {
  return Boolean(selectedAt);
}

/**
 * The single highest-value next action for the workspace the user is looking at.
 * Keys on the visible mode (not raw intent) so a "Both" user gets the right nudge
 * for whichever side they've toggled to. Returns null once that side is set up,
 * so the nudge fades on its own.
 */
export function nextStepFor(params: {
  mode: OwnerProfileMode;
  hasJob: boolean;
  profileComplete: boolean;
}): OnboardingNextStep | null {
  const { mode, hasJob, profileComplete } = params;

  if (mode === "hiring") {
    if (hasJob) return null;
    return {
      key: "post-job",
      headline: "You're set up to hire.",
      helper: "Post your first job to start receiving applications from creator talent.",
      ctaLabel: "Post a job",
      ctaHref: "/post-job",
    };
  }

  if (profileComplete) return null;
  return {
    key: "create-listing",
    headline: "Let's get you discovered.",
    helper: "Finish your profile and create a talent listing so recruiters can find and hire you.",
    ctaLabel: "Create talent listing",
    ctaHref: "/post-talent",
  };
}
