"""Email layer for notifications.

Phase 1 keeps real delivery OFF. Every notification email is written to the
``email_outbox`` table and handed to an adapter:

* MockEmailAdapter (default) — marks the row ``mocked`` and logs it; never sends.
* SmtpEmailAdapter (deferred) — only used when ``EMAIL_DELIVERY_ENABLED=true`` and
  ``EMAIL_MODE=smtp``; reuses the existing SMTP path in ``email_service``.

This keeps auth emails (verification / password reset) completely separate and
unchanged — they continue through ``email_service.send_auth_email``.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models import EmailOutbox
from app.services.email_service import EmailDeliveryError, send_auth_email

logger = logging.getLogger(__name__)


@dataclass
class EmailPayload:
    to_email: str
    subject: str
    event_key: str
    template_key: str
    body: str | None = None
    cta_url: str | None = None
    user_id: UUID | None = None
    metadata: dict = field(default_factory=dict)
    dedupe_key: str | None = None


def _now() -> datetime:
    return datetime.now(UTC)


def real_delivery_enabled() -> bool:
    """Real notification email is only attempted when explicitly switched on."""
    return bool(settings.email_delivery_enabled) and settings.email_mode == "smtp"


def _process_outbox_row(row: EmailOutbox) -> None:
    if not real_delivery_enabled():
        row.status = "mocked"
        row.processed_at = _now()
        logger.info(
            "notification_email_mocked",
            extra={"event_key": row.event_key, "to": row.to_email, "subject": row.subject},
        )
        return

    try:  # pragma: no cover - real delivery is off by default and not exercised in tests
        send_auth_email(to_email=row.to_email, subject=row.subject, text_body=row.body or row.preview or "")
        row.status = "sent"
    except EmailDeliveryError as exc:  # pragma: no cover
        row.status = "failed"
        row.error = str(exc)
    row.processed_at = _now()


def queue_notification_email(session: AsyncSession, payload: EmailPayload) -> EmailOutbox:
    """Persist durable delivery intent inside the caller's transaction.

    Delivery is deliberately not attempted here. A worker processes committed
    rows later, so SMTP/push failures can never roll back the domain action.
    """
    body = (payload.body or "").strip() or None
    row = EmailOutbox(
        user_id=payload.user_id,
        to_email=payload.to_email,
        event_key=payload.event_key,
        template_key=payload.template_key,
        subject=payload.subject,
        preview=(body[:600] if body else None),
        body=body,
        cta_url=payload.cta_url,
        metadata_json=payload.metadata or {},
        dedupe_key=payload.dedupe_key,
        status="queued",
    )
    session.add(row)
    return row
