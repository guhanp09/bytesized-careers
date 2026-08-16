"""Email layer for notifications.

Every email the platform intends to send is written to the ``email_outbox``
table inside the caller's transaction. Delivery is not attempted here: the
worker claims committed rows, asks a provider, and records what it said.

There is deliberately only ONE delivery path. This module used to carry a second
one — a mock adapter that marked rows ``mocked``, a status the worker never
produces — and two paths with different vocabularies is how a row ends up in a
state that nothing else understands.

``real_delivery_enabled()`` still decides whether that provider is the real SMTP
one or the mock; see ``app/notifications/runner.build_provider``.

Authentication mail (verification, password reset, invitation) now goes through
the same table via ``queue_auth_email``. It used to send inline after the
transaction committed, which meant a crash in between lost an email nobody knew
was owed, and a provider outage failed a request that had already succeeded.
The local development link capture is unchanged and still immediate.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models import EmailOutbox

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


def real_delivery_enabled() -> bool:
    """Real notification email is only attempted when explicitly switched on."""
    return bool(settings.email_delivery_enabled) and settings.email_mode == "smtp"


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


#: Authentication mail, named so a later suppression rule can tell the mail a
#: person is waiting on from the mail the platform decided to send them.
AUTH_EVENT_KEYS = frozenset({"auth.verification", "auth.password_reset", "auth.invitation"})


def queue_auth_email(
    session: AsyncSession,
    *,
    to_email: str,
    subject: str,
    text_body: str,
    event_key: str,
    cta_url: str | None = None,
    user_id: UUID | None = None,
    dedupe_key: str | None = None,
) -> EmailOutbox:
    """Record an authentication email as durable intent instead of sending it.

    Verification and reset mail used to go out inline, after the transaction had
    already committed. Two things were wrong with that. A crash between the
    commit and the send loses the email with no record that it was owed — the
    account exists and nothing will ever tell its owner how to verify it. And a
    provider outage raises inside the request, so a signup that fully succeeded
    reports failure to the person who made it.

    Writing a row instead makes the send a consequence of the transaction rather
    than a step inside it: if the account exists, so does the intent to mail it,
    and the worker retries on its own schedule.

    Called with the caller's session and deliberately not flushed, so the row
    lands with the domain change or not at all.
    """

    if event_key not in AUTH_EVENT_KEYS:
        # A typo here would file authentication mail under a name nothing else
        # recognises, which is invisible until someone is waiting on an email.
        raise ValueError(f"Unknown authentication email event: {event_key!r}")

    return queue_notification_email(
        session,
        EmailPayload(
            to_email=to_email,
            subject=subject,
            event_key=event_key,
            template_key=event_key.replace(".", "_"),
            body=text_body,
            cta_url=cta_url,
            user_id=user_id,
            dedupe_key=dedupe_key,
        ),
    )
