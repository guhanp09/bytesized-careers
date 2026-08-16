"""Claiming outbox rows without two workers taking the same one.

The whole reason this is a repository function rather than a few lines in a
worker loop is that the obvious implementation is wrong. Selecting eligible
rows, deciding in Python which to take, then updating them is a check-then-act
race: two workers read the same row as free, both write their own lease, and the
email goes out twice. That is the same defect RATE-001 is blocked on, and it is
worth not repeating it here.

So the claim is one statement. The predicate that decides eligibility and the
write that takes ownership are evaluated together by the database, and on
PostgreSQL the row is locked with SKIP LOCKED so a second worker steps over it
rather than waiting behind it.

Eligibility has three parts, and each exists for a failure that actually
happens:

* `status = 'queued'` — a sent row is never re-sent, and a terminally failed or
  suppressed one is never retried.
* `next_attempt_at` in the past — backoff is stored on the row, so a retry that
  is not due yet is simply not eligible. No worker needs to remember anything.
* `leased_until` in the past or null — a worker that crashed holding a lease
  strands nothing, because ownership expires on a clock rather than on the dead
  worker admitting it died.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import EmailOutbox

#: How long a worker owns a row before it becomes reclaimable. Long enough that
#: an ordinary provider call finishes inside it, short enough that a crash does
#: not hold mail hostage.
DEFAULT_LEASE_SECONDS = 120

#: Status values that mean "this row is waiting to be delivered". Everything
#: else — sent, mocked, failed, skipped — is terminal as far as claiming goes.
CLAIMABLE_STATUS = "queued"


def _now() -> datetime:
    return datetime.now(UTC)


def eligible_predicate(now: datetime):
    """The three conditions that make a row available, as one SQL expression.

    Exposed separately so tests can assert on the predicate itself rather than
    only on the behaviour of a worker built around it.
    """

    return (
        (EmailOutbox.status == CLAIMABLE_STATUS)
        & or_(EmailOutbox.next_attempt_at.is_(None), EmailOutbox.next_attempt_at <= now)
        & or_(EmailOutbox.leased_until.is_(None), EmailOutbox.leased_until <= now)
    )


async def claim_due_emails(
    session: AsyncSession,
    *,
    worker_id: str,
    limit: int = 10,
    lease_seconds: int = DEFAULT_LEASE_SECONDS,
    now: datetime | None = None,
) -> list[EmailOutbox]:
    """Take ownership of up to `limit` deliverable rows, atomically.

    Returns the rows this caller now owns. An empty list means there was nothing
    due — not that someone else is ahead, since a contended row is skipped
    rather than waited on.

    `now` is injectable so retry and expiry behaviour can be tested without
    sleeping. Production passes nothing and gets the wall clock.
    """

    moment = now or _now()
    leased_until = moment + timedelta(seconds=lease_seconds)

    candidates = (
        select(EmailOutbox.id)
        .where(eligible_predicate(moment))
        # Oldest intent first. Without an order, a backlog can starve its own
        # head while workers keep picking up whatever the planner returns.
        .order_by(EmailOutbox.created_at)
        .limit(limit)
    )

    if session.bind is not None and session.bind.dialect.name == "postgresql":
        # The lock is what makes concurrent workers disjoint. SKIP LOCKED means
        # a second worker passes over a row someone already holds instead of
        # blocking until the first transaction ends.
        candidates = candidates.with_for_update(skip_locked=True)

    statement = (
        update(EmailOutbox)
        .where(EmailOutbox.id.in_(candidates.scalar_subquery()))
        # Re-stating eligibility here is not redundant on engines without row
        # locking: it keeps the claim correct even if the subquery's snapshot is
        # no longer true by the time the write applies.
        .where(eligible_predicate(moment))
        .values(leased_by=worker_id, leased_until=leased_until)
        .returning(EmailOutbox)
        .execution_options(synchronize_session=False)
    )

    result = await session.execute(statement)
    return list(result.scalars().all())


async def release_lease(session: AsyncSession, row_id: uuid.UUID) -> None:
    """Hand a row back without consuming an attempt.

    For a worker shutting down cleanly: the row was claimed but never handed to
    a provider, so it should become available immediately rather than waiting
    out its lease.
    """

    await session.execute(
        update(EmailOutbox)
        .where(EmailOutbox.id == row_id, EmailOutbox.status == CLAIMABLE_STATUS)
        .values(leased_by=None, leased_until=None)
        .execution_options(synchronize_session=False)
    )
