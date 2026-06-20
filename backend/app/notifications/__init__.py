"""Notification architecture: a central event registry, a dispatch service that
writes in-app notifications, and an email-outbox layer that mocks delivery until a
production domain + provider are ready.

Public surface:
    from app.notifications import dispatch_notification, EVENT_REGISTRY, get_event
"""

from app.notifications.registry import (
    CHANNEL_EMAIL,
    CHANNEL_IN_APP,
    EVENT_REGISTRY,
    NotificationEvent,
    get_event,
    missing_payload_fields,
)
from app.notifications.service import dispatch_notification

__all__ = [
    "CHANNEL_EMAIL",
    "CHANNEL_IN_APP",
    "EVENT_REGISTRY",
    "NotificationEvent",
    "dispatch_notification",
    "get_event",
    "missing_payload_fields",
]
