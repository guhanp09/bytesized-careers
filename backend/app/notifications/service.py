"""Notification dispatch service.

`dispatch_notification(...)` is the single entry point flows call. It:
  1. looks the event up in the registry,
  2. writes an in-app `Notification` row (the bell + /notifications page),
  3. queues an email payload to the outbox when the event has email enabled by
     default (the worker, not the request, chooses mock or SMTP delivery),
validating the event's required payload before queueing email.

It never raises on a notification problem — a notification must not break the user
action that triggered it. Rows are added to the caller's session and commit with
the surrounding transaction.
"""

from __future__ import annotations

import logging
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Notification, User
from app.notifications.email import EmailPayload, queue_notification_email
from app.notifications.registry import get_event, missing_payload_fields

logger = logging.getLogger(__name__)


async def dispatch_notification(
    session: AsyncSession,
    *,
    event_key: str,
    recipient_user_id: UUID | None,
    title: str,
    body: str | None = None,
    actor_user_id: UUID | None = None,
    category: str = "system",
    resource_type: str | None = None,
    resource_id: str | None = None,
    action_url: str | None = None,
    payload: dict | None = None,
    recipient_email: str | None = None,
    dedupe_key: str | None = None,
    strict_outbox: bool = False,
) -> Notification | None:
    """Create an in-app notification and optional durable email intent.

    Returns the created `Notification`, or `None` when there is no recipient.
    """
    if recipient_user_id is None:
        return None

    if dedupe_key:
        existing = (
            await session.execute(
                select(Notification).where(Notification.dedupe_key == dedupe_key)
            )
        ).scalar_one_or_none()
        if existing is not None:
            return existing

    event = get_event(event_key)
    if event is None:
        # Unknown events still produce an in-app notification so nothing silently
        # disappears, but they never emit email.
        logger.warning("notification_event_unregistered", extra={"event_key": event_key})

    notification = Notification(
        user_id=recipient_user_id,
        actor_user_id=actor_user_id,
        type=event_key,
        category=category,
        priority=event.priority if event else "normal",
        title=title,
        body=body,
        resource_type=resource_type,
        resource_id=resource_id,
        action_url=action_url,
        metadata_json=payload or {},
        dedupe_key=dedupe_key,
    )
    session.add(notification)

    if event is not None and event.wired and event.email_enabled_by_default():
        # Email is best-effort: a queue failure must never lose the in-app
        # notification (already added above) or break the user's action.
        try:
            await _queue_email_for_event(
                session,
                event_key=event_key,
                recipient_user_id=recipient_user_id,
                recipient_email=recipient_email,
                subject=title,
                body=body,
                action_url=action_url,
                payload=payload or {},
                dedupe_key=f"{dedupe_key}:email" if dedupe_key else None,
            )
        except Exception:
            if strict_outbox:
                raise
            logger.exception("notification_email_queue_failed", extra={"event_key": event_key})

    return notification


async def _queue_email_for_event(
    session: AsyncSession,
    *,
    event_key: str,
    recipient_user_id: UUID,
    recipient_email: str | None,
    subject: str,
    body: str | None,
    action_url: str | None,
    payload: dict,
    dedupe_key: str | None,
) -> None:
    missing = missing_payload_fields(event_key, payload)
    if missing:
        logger.warning(
            "notification_email_skipped_missing_payload",
            extra={"event_key": event_key, "missing": missing},
        )
        return

    to_email = recipient_email
    if to_email is None:
        recipient = await session.get(User, recipient_user_id)
        to_email = recipient.email if recipient is not None else None
    if not to_email:
        logger.warning("notification_email_skipped_no_email", extra={"event_key": event_key})
        return

    queue_notification_email(
        session,
        EmailPayload(
            to_email=to_email,
            subject=subject,
            event_key=event_key,
            template_key=event_key,
            body=body,
            cta_url=action_url,
            user_id=recipient_user_id,
            metadata=payload,
            dedupe_key=dedupe_key,
        ),
    )
