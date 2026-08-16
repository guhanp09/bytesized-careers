"""Who may still be mailed, and why not.

Two rules do most of the work here, and the distinction between them is the
whole point of the module:

* a HARD BOUNCE means the mailbox does not exist. Nothing can be delivered
  there, so nothing more is sent — including password resets, because a reset
  link to a mailbox that rejects it helps nobody and costs the sending domain
  its reputation.
* a COMPLAINT means a real person marked our mail as spam. That is about the
  mail the platform decided to send them, not about the mail they themselves
  ask for. Suppressing a password reset because someone once reported a job
  alert would lock them out of their own account.

So a complaint suppresses everything except authentication mail, and a hard
bounce suppresses everything. Soft bounces are deliberately absent: they are
transient, and the outbox already retries.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as postgresql_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.email_suppression import EmailSuppression
from app.notifications.email import AUTH_EVENT_KEYS

HARD_BOUNCE = "hard_bounce"
COMPLAINT = "complaint"
MANUAL = "manual"

#: Every reason the platform acts on. A provider category outside this set is
#: still recorded — see `record_suppression` — but it suppresses nothing until
#: someone decides what it means.
BLOCKING_REASONS = frozenset({HARD_BOUNCE, COMPLAINT, MANUAL})

#: Soft bounces are not here on purpose. "Mailbox full" and "greylisted" are
#: temporary, and the outbox retry schedule already handles temporary.
TRANSIENT_REASONS = frozenset({"soft_bounce", "deferred", "throttled"})


def normalize_email(value: str) -> str:
    return value.strip().casefold()


def _now() -> datetime:
    return datetime.now(UTC)


@dataclass(frozen=True)
class SuppressionDecision:
    """Whether to send, and the sentence explaining why not."""

    allowed: bool
    reason: str | None = None


def decide(
    suppression: EmailSuppression | None,
    *,
    event_key: str,
) -> SuppressionDecision:
    """Pure rule, so it can be read in one place and tested without fixtures.

    Authentication mail survives a complaint and not a hard bounce. The
    asymmetry is deliberate: a complaint is a judgement about mail we chose to
    send, and a hard bounce is a fact about the mailbox.
    """

    if suppression is None or suppression.released_at is not None:
        return SuppressionDecision(allowed=True)

    reason = suppression.reason
    if reason not in BLOCKING_REASONS:
        # Recorded but not understood. Refusing to send on a category nobody has
        # ruled on would silently drop mail for a reason no one chose.
        return SuppressionDecision(allowed=True)

    if reason == COMPLAINT and event_key in AUTH_EVENT_KEYS:
        return SuppressionDecision(allowed=True)

    return SuppressionDecision(allowed=False, reason=f"Address is suppressed ({reason}).")


async def find_suppression(session: AsyncSession, email: str) -> EmailSuppression | None:
    found = await session.execute(
        select(EmailSuppression).where(EmailSuppression.email == normalize_email(email))
    )
    return found.scalar_one_or_none()


async def may_send(session: AsyncSession, *, email: str, event_key: str) -> SuppressionDecision:
    return decide(await find_suppression(session, email), event_key=event_key)


async def record_suppression(
    session: AsyncSession,
    *,
    email: str,
    reason: str,
    source: str | None = None,
    detail: str | None = None,
    provider_message_id: str | None = None,
    now: datetime | None = None,
) -> EmailSuppression | None:
    """Record that an address should not be mailed, once.

    Providers redeliver webhooks — that is the contract, not a fault — so this
    has to be idempotent by construction rather than by checking first. An
    INSERT ... ON CONFLICT DO NOTHING keeps a second delivery of the same event
    from either raising on the unique index or overwriting the original reason
    with a later, vaguer one.

    Returns None for a transient category: those are the provider saying "try
    later", which the outbox already does.
    """

    if reason in TRANSIENT_REASONS:
        return None

    address = normalize_email(email)
    values = {
        "email": address,
        "reason": reason,
        "source": source,
        "detail": detail,
        "provider_message_id": provider_message_id,
        "created_at": now or _now(),
    }

    dialect = session.bind.dialect.name if session.bind is not None else ""
    if dialect == "postgresql":
        statement = postgresql_insert(EmailSuppression).values(**values)
    else:
        statement = sqlite_insert(EmailSuppression).values(**values)
    await session.execute(statement.on_conflict_do_nothing(index_elements=["email"]))

    return await find_suppression(session, address)


async def release_suppression(
    session: AsyncSession,
    *,
    email: str,
    reason: str,
    now: datetime | None = None,
) -> EmailSuppression | None:
    """Lift a suppression without forgetting it happened.

    The row stays, with `released_at` set, because "this address bounced in
    March" is the context for a support conversation in April. Deleting it would
    leave no way to answer why mail stopped.
    """

    suppression = await find_suppression(session, email)
    if suppression is None or suppression.released_at is not None:
        return suppression

    suppression.released_at = now or _now()
    suppression.released_reason = reason
    await session.flush()
    return suppression
