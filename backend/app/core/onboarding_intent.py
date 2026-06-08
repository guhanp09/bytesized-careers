from __future__ import annotations

from typing import Literal

OnboardingIntent = Literal[
    "LOOKING_FOR_WORK",
    "HIRING_CREATOR_TALENT",
    "BOTH",
    "DECIDE_LATER",
]

ONBOARDING_INTENT_LOOKING_FOR_WORK: OnboardingIntent = "LOOKING_FOR_WORK"
ONBOARDING_INTENT_HIRING_CREATOR_TALENT: OnboardingIntent = "HIRING_CREATOR_TALENT"
ONBOARDING_INTENT_BOTH: OnboardingIntent = "BOTH"
ONBOARDING_INTENT_DECIDE_LATER: OnboardingIntent = "DECIDE_LATER"

ONBOARDING_INTENTS: set[OnboardingIntent] = {
    ONBOARDING_INTENT_LOOKING_FOR_WORK,
    ONBOARDING_INTENT_HIRING_CREATOR_TALENT,
    ONBOARDING_INTENT_BOTH,
    ONBOARDING_INTENT_DECIDE_LATER,
}


def normalize_onboarding_intent(value: str | None) -> OnboardingIntent:
    normalized = (value or ONBOARDING_INTENT_DECIDE_LATER).strip().upper()
    if normalized in ONBOARDING_INTENTS:
        return normalized  # type: ignore[return-value]
    return ONBOARDING_INTENT_DECIDE_LATER


def onboarding_intent_from_legacy_account_type(value: str | None) -> OnboardingIntent:
    normalized = (value or "").strip().upper()
    if normalized == "EMPLOYER":
        return ONBOARDING_INTENT_HIRING_CREATOR_TALENT
    if normalized == "BOTH":
        return ONBOARDING_INTENT_BOTH
    if normalized == "TALENT":
        return ONBOARDING_INTENT_LOOKING_FOR_WORK
    return ONBOARDING_INTENT_DECIDE_LATER
