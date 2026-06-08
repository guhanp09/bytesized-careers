from __future__ import annotations

APPLICATION_STATUSES = (
    "new",
    "reviewing",
    "shortlisted",
    "interviewing",
    "hired",
    "rejected",
    "archived",
)

JOB_STATUSES = ("draft", "published", "paused", "closed", "archived")

TALENT_LISTING_STATUSES = ("draft", "published", "paused", "closed", "archived", "featured")

TALENT_INTEREST_STATUSES = ("new", "reviewing", "contacted", "declined", "archived")

REPORT_TARGET_TYPES = ("job", "talent_listing", "profile")

REPORT_STATUSES = ("open", "dismissed", "action_taken")

REPORT_ACTIONS = ("dismiss", "hide_listing", "pause_listing", "mark_verified", "mark_rejected")

ENTITLEMENT_KINDS = ("job_post", "talent_listing", "featured_job", "featured_talent_listing")

NOTIFICATION_CATEGORIES = (
    "activity",
    "application",
    "talent",
    "checkout",
    "moderation",
    "profile",
    "system",
)

WORK_MODES = ("remote", "hybrid", "onsite")

