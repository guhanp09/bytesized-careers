from __future__ import annotations

APPLICATION_STATUSES = (
    "new",
    "reviewing",
    "shortlisted",
    "interviewing",
    "hired",
    "rejected",
    "archived",
    "withdrawn",
)

JOB_STATUSES = ("draft", "published", "paused", "closed", "archived")

TALENT_LISTING_STATUSES = ("draft", "published", "paused", "closed", "archived", "featured")

TALENT_INTEREST_STATUSES = ("new", "reviewing", "accepted", "declined", "archived", "withdrawn")

REPORT_TARGET_TYPES = ("job", "talent_listing", "profile", "message", "review")

REPORT_STATUSES = ("open", "dismissed", "action_taken")

# Enforced by AdminReportResolveRequest in app/schemas/admin.py (the old
# free-string action field is gone).
REPORT_ACTIONS = (
    "dismiss",
    "no_action",
    "pause_listing",
    "hide_listing",
    "warn_user",
    "suspend_user",
    "reopen",
    "hide_review",
    "restore_review",
)

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
