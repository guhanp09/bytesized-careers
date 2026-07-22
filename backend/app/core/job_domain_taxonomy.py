from __future__ import annotations

from typing import Final


DELIVERABLE_TYPES: Final[tuple[str, ...]] = (
    "long_form_video",
    "short",
    "thumbnail",
    "script",
    "podcast_episode",
    "community_post",
    "social_post",
    "newsletter",
    "livestream",
    "audio_asset",
    "design_asset",
    "research_brief",
    "voice_over",
    "other",
)

DELIVERABLE_FREQUENCIES: Final[tuple[str, ...]] = (
    "one_time",
    "per_day",
    "per_week",
    "per_month",
    "per_video",
    "per_episode",
    "every_two_weeks",
    "ongoing",
    "other",
)

OUTPUT_COMPENSATION_UNITS: Final[frozenset[str]] = frozenset(
    {
        "per deliverable",
        "per video",
        "per short",
        "per thumbnail",
        "per script",
        "per episode",
        "per post",
    }
)

SKILL_KEYS: Final[tuple[str, ...]] = (
    "video_editing",
    "short_form_editing",
    "storytelling",
    "motion_graphics",
    "color_grading",
    "audio_editing",
    "thumbnail_design",
    "graphic_design",
    "scriptwriting",
    "copywriting",
    "research",
    "seo",
    "channel_strategy",
    "community_management",
    "project_management",
    "ugc_creation",
    "voice_over",
)

REVISION_POLICIES: Final[tuple[str, ...]] = (
    "fixed",
    "unlimited",
    "negotiable",
    "not_applicable",
)

SOURCE_INPUT_TYPES: Final[tuple[str, ...]] = (
    "raw_footage",
    "script",
    "research",
    "creative_brief",
    "brand_guidelines",
    "reference_videos",
    "thumbnail_assets",
    "music_or_stock_subscription",
    "voice_over",
    "project_files",
    "analytics_access",
    "account_access",
    "product_footage",
    "other",
)

SENSITIVE_SOURCE_INPUT_TYPES: Final[frozenset[str]] = frozenset(
    {"analytics_access", "account_access"}
)

CREATIVE_AUTONOMY_LEVELS: Final[tuple[str, ...]] = (
    "follow_established_style",
    "guided_by_references",
    "collaborative_direction",
    "own_creative_approach",
    "varies_by_assignment",
    "not_applicable",
)

LANGUAGE_PRIORITIES: Final[tuple[str, ...]] = ("required", "preferred")
LANGUAGE_PROFICIENCIES: Final[tuple[str, ...]] = (
    "native_or_fluent",
    "professional",
    "conversational",
    "basic",
)
LANGUAGE_PURPOSES: Final[tuple[str, ...]] = (
    "speaking",
    "writing",
    "reading",
    "content_understanding",
    "audience_fluency",
)

TRIAL_STATUSES: Final[tuple[str, ...]] = ("none", "paid", "unpaid", "undecided")
TRIAL_EFFORT_UNITS: Final[tuple[str, ...]] = ("hours", "days", "deliverables")
TRIAL_COMPENSATION_BASES: Final[tuple[str, ...]] = (
    "flat",
    "per_hour",
    "per_deliverable",
    "custom",
)
TRIAL_WORK_USAGE: Final[tuple[str, ...]] = (
    "evaluation_only",
    "may_use_privately",
    "may_publish",
)
TRIAL_PORTFOLIO_PERMISSIONS: Final[tuple[str, ...]] = (
    "allowed",
    "not_allowed",
    "with_permission",
)
TRIAL_ATTRIBUTION_TERMS: Final[tuple[str, ...]] = (
    "credited",
    "not_credited",
    "not_applicable",
    "to_be_agreed",
)

START_TIMINGS: Final[tuple[str, ...]] = (
    "immediate",
    "within_two_weeks",
    "specific_date",
    "flexible",
)
DURATION_TYPES: Final[tuple[str, ...]] = (
    "ongoing",
    "fixed_period",
    "project_based",
    "until_date",
    "flexible",
)
DURATION_UNITS: Final[tuple[str, ...]] = ("weeks", "months")

HIRING_PROCESS_STAGES: Final[tuple[str, ...]] = (
    "application_review",
    "portfolio_review",
    "screening_call",
    "interview",
    "assessment",
    "paid_trial",
    "unpaid_trial",
    "final_discussion",
    "offer",
    "other",
)

EMPLOYER_CONTEXT_TYPES: Final[tuple[str, ...]] = (
    "creator",
    "agency",
    "brand",
    "production_house",
    "other",
)
