"""Central registry of notification events.

Every notification the platform can emit is declared here once, so in-app and
email channels stay in sync and new events are added in a single place. Adding an
event = add a `NotificationEvent` entry, then call `dispatch_notification(...)`
from the flow that triggers it.

Channels:
    in_app  -> a row in the `notifications` table (the bell + /notifications page)
    email   -> a row in the `email_outbox` table (mocked until delivery is enabled)

`default_channels` decides what is enabled out of the box. `wired=False` marks an
event that is defined but has no real trigger yet (e.g. messaging, which has no
backend) — declared so the contract is clear, but never dispatched.
"""

from __future__ import annotations

from dataclasses import dataclass

CHANNEL_IN_APP = "in_app"
CHANNEL_EMAIL = "email"

CATEGORY_TRANSACTIONAL = "transactional"
CATEGORY_LIFECYCLE = "lifecycle"
CATEGORY_DIGEST = "digest"

PRIORITY_HIGH = "high"
PRIORITY_NORMAL = "normal"
PRIORITY_LOW = "low"


@dataclass(frozen=True)
class NotificationEvent:
    key: str
    category: str
    recipient: str  # human description of who receives it
    actor: str | None  # who/what causes it
    channels: tuple[str, ...]  # channels this event is allowed to use
    default_channels: tuple[str, ...]  # channels enabled by default
    priority: str = PRIORITY_NORMAL
    required_payload: tuple[str, ...] = ()
    immediate: bool = True  # immediate vs digestible
    wired: bool = True  # True if a real trigger exists in code today
    notes: str = ""

    def email_enabled_by_default(self) -> bool:
        return CHANNEL_EMAIL in self.default_channels

    def in_app_enabled_by_default(self) -> bool:
        return CHANNEL_IN_APP in self.default_channels


_BOTH = (CHANNEL_IN_APP, CHANNEL_EMAIL)

_EVENTS: tuple[NotificationEvent, ...] = (
    # ---- Applications ----
    NotificationEvent(
        key="application_submitted",
        category=CATEGORY_TRANSACTIONAL,
        recipient="Applicant (self-confirmation)",
        actor=None,
        channels=_BOTH,
        default_channels=(CHANNEL_IN_APP,),  # self-confirmation: in-app only, no email noise
        priority=PRIORITY_NORMAL,
        required_payload=("job_title",),
        notes="Confirms the applicant's own submission. Source: marketplace.apply_to_job.",
    ),
    NotificationEvent(
        key="new_applicant",
        category=CATEGORY_TRANSACTIONAL,
        recipient="Recruiter / job owner",
        actor="Applicant",
        channels=_BOTH,
        default_channels=_BOTH,
        priority=PRIORITY_HIGH,
        required_payload=("job_title",),
        notes="A talent applied to the recruiter's job. Source: marketplace.apply_to_job.",
    ),
    NotificationEvent(
        key="application_status_changed",
        category=CATEGORY_TRANSACTIONAL,
        recipient="Applicant",
        actor="Recruiter / job owner",
        channels=_BOTH,
        default_channels=_BOTH,
        priority=PRIORITY_HIGH,
        required_payload=("status",),
        notes="Shortlisted / declined / hired etc. Source: marketplace.update_application_status.",
    ),
    NotificationEvent(
        key="application_withdrawn",
        category=CATEGORY_TRANSACTIONAL,
        recipient="Recruiter / job owner",
        actor="Applicant",
        channels=_BOTH,
        default_channels=(CHANNEL_IN_APP,),  # withdrawal is low-value for email
        priority=PRIORITY_NORMAL,
        notes="An applicant withdrew their application. Source: marketplace.withdraw_application.",
    ),
    # ---- Hiring requests (talent interest) ----
    NotificationEvent(
        key="talent_interest_received",
        category=CATEGORY_TRANSACTIONAL,
        recipient="Talent (listing owner)",
        actor="Recruiter",
        channels=_BOTH,
        default_channels=_BOTH,
        priority=PRIORITY_HIGH,
        notes="A recruiter sent a hiring request / job invite. Source: marketplace.send_talent_interest.",
    ),
    NotificationEvent(
        key="talent_interest_status_changed",
        category=CATEGORY_TRANSACTIONAL,
        recipient="Recruiter",
        actor="Talent (listing owner)",
        channels=_BOTH,
        default_channels=(CHANNEL_IN_APP,),
        priority=PRIORITY_NORMAL,
        required_payload=("status",),
        notes="Talent responded to a hiring request. Source: marketplace.update_talent_interest_status.",
    ),
    NotificationEvent(
        key="talent_interest_withdrawn",
        category=CATEGORY_TRANSACTIONAL,
        recipient="Talent (listing owner)",
        actor="Recruiter",
        channels=_BOTH,
        default_channels=(CHANNEL_IN_APP,),  # withdrawal is low-value for email
        priority=PRIORITY_NORMAL,
        notes="A recruiter withdrew their hiring request. Source: marketplace.withdraw_talent_interest.",
    ),
    # ---- Jobs / listings ----
    NotificationEvent(
        key="job_posted_successfully",
        category=CATEGORY_TRANSACTIONAL,
        recipient="Recruiter / poster (self)",
        actor=None,
        channels=_BOTH,
        default_channels=_BOTH,
        priority=PRIORITY_NORMAL,
        required_payload=("job_title",),
        notes="A job went live (status published). Source: job_service.create_job.",
    ),
    NotificationEvent(
        key="talent_listing_created",
        category=CATEGORY_TRANSACTIONAL,
        recipient="Talent (self)",
        actor=None,
        channels=(CHANNEL_IN_APP,),
        default_channels=(CHANNEL_IN_APP,),
        priority=PRIORITY_LOW,
        notes="Self-confirmation. Source: marketplace.create_talent_listing.",
    ),
    NotificationEvent(
        key="launch_free_checkout_completed",
        category=CATEGORY_TRANSACTIONAL,
        recipient="User (self)",
        actor=None,
        channels=(CHANNEL_IN_APP,),
        default_channels=(CHANNEL_IN_APP,),
        priority=PRIORITY_LOW,
        notes="Free-during-launch confirmation. Source: marketplace.complete_launch_free_checkout.",
    ),
    # ---- Messaging ----
    NotificationEvent(
        key="message_received",
        category=CATEGORY_TRANSACTIONAL,
        recipient="Conversation participant",
        actor="Other participant",
        channels=_BOTH,
        default_channels=(CHANNEL_IN_APP,),  # in-app for now; email digesting can come later
        priority=PRIORITY_HIGH,
        notes="A participant sent a real message. Source: messaging_service.post_message.",
    ),
)

EVENT_REGISTRY: dict[str, NotificationEvent] = {event.key: event for event in _EVENTS}


def get_event(key: str) -> NotificationEvent | None:
    return EVENT_REGISTRY.get(key)


def missing_payload_fields(key: str, payload: dict | None) -> list[str]:
    """Return required payload fields absent from `payload` for the given event.

    Empty list = valid (or unknown event, which the service handles separately).
    """
    event = get_event(key)
    if event is None:
        return []
    data = payload or {}
    return [field for field in event.required_payload if not data.get(field)]
