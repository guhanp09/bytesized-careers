from __future__ import annotations

from typing import Final

P0_LISTING_SCHEMA_VERSION: Final = 2
CREATOR_DOMAIN_LISTING_SCHEMA_VERSION: Final = 3
CURRENT_LISTING_SCHEMA_VERSION: Final = CREATOR_DOMAIN_LISTING_SCHEMA_VERSION

ENGAGEMENT_TYPES: Final[tuple[str, ...]] = (
    "one_time_project",
    "ongoing_freelance",
    "retainer",
    "part_time",
    "full_time",
    "fixed_term",
    "internship",
)

COMPENSATION_MODES: Final[tuple[str, ...]] = ("fixed", "range", "negotiable", "approximate")

COMPENSATION_UNITS: Final[tuple[str, ...]] = (
    "per hour",
    "per day",
    "per deliverable",
    "per video",
    "per short",
    "per thumbnail",
    "per script",
    "per episode",
    "per post",
    "per project",
    "per week",
    "per month",
    "per year",
    "commission",
    "mixed",
    "custom",
)

TURNAROUND_UNITS: Final[tuple[str, ...]] = (
    "hours",
    "business_days",
    "calendar_days",
    "weeks",
)

TURNAROUND_BASES: Final[tuple[str, ...]] = (
    "per_deliverable",
    "batch",
    "first_draft",
    "final_delivery",
)

WORK_MODES: Final[tuple[str, ...]] = ("remote", "hybrid", "onsite")

# This is deliberately a curated compatibility projection, not a role inference
# mechanism. Existing jobs are never assigned a role from their legacy category.
ROLE_TO_LEGACY_CATEGORY: Final[dict[str, str | None]] = {
    "video-editor": "Editing",
    "long-form-editor": "Editing",
    "shorts-editor": "Shorts",
    "podcast-producer": "Editing",
    "audio-engineer": "Editing",
    "videographer": "Editing",
    "thumbnail-designer": "Thumbnails",
    "graphic-designer": "Design",
    "motion-designer": "Motion Graphics",
    "brand-designer": "Design",
    "illustrator": "Design",
    "scriptwriter": "Writing",
    "copywriter": "Writing",
    "newsletter-writer": "Writing",
    "content-strategist": "Marketing",
    "seo-specialist": "Marketing",
    "social-media-manager": "Marketing",
    "paid-ads-specialist": "Marketing",
    "channel-manager": "Channel Manager",
    "community-manager": "Channel Manager",
    "project-manager": "Channel Manager",
    "ugc-creator": "Marketing",
    "animator": "Motion Graphics",
    "researcher": "Research",
    "voice-over-artist": "Voice Over",
    "other-creator-role": None,
}

OTHER_CREATOR_ROLE_SLUG: Final = "other-creator-role"


def legacy_category_for_role_slug(slug: str) -> str | None:
    return ROLE_TO_LEGACY_CATEGORY.get(slug.strip().lower())
