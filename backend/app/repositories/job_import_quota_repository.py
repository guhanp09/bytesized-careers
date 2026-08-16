"""Spending one unit of a person's import quota, atomically.

The naive version reads the counter, decides in Python whether there is room,
and writes the increment. Under any concurrency that lets everyone through at
once: ten simultaneous requests all read "3 used of 20" and all proceed. A quota
that can be exceeded by asking quickly is not a quota, and the thing it is
protecting here is provider spend.

So consuming a unit is ONE statement. The window reset lives inside it too,
expressed as a CASE rather than as a separate "if the window is old, reset it"
step — because that step is another read-then-write, and two requests arriving
at the moment a window rolls over would both reset it and both start from one.

Enforcement is per user rather than per draft on purpose: the cost being bounded
is the provider's, and one person with fifty drafts is the case a per-draft
limit would miss entirely.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import case, or_, update
from sqlalchemy.dialects.postgresql import insert as postgresql_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.job_import_quota import JobImportQuotaCounter


@dataclass(frozen=True)
class QuotaOutcome:
    """Whether the unit was spent, and what the counter says now."""

    allowed: bool
    used: int
    limit: int

    @property
    def remaining(self) -> int:
        return max(0, self.limit - self.used)


async def _ensure_counter(
    session: AsyncSession, user_id: uuid.UUID, *, now: datetime
) -> None:
    """Create the row if it is missing, without racing another creator.

    ON CONFLICT DO NOTHING rather than "select, then insert if absent": two
    first-ever requests from the same person would otherwise both insert and one
    would fail on the primary key.
    """

    values = {"user_id": user_id, "used": 0, "window_started_at": now, "updated_at": now}
    dialect = session.bind.dialect.name if session.bind is not None else ""
    insert = postgresql_insert if dialect == "postgresql" else sqlite_insert
    await session.execute(
        insert(JobImportQuotaCounter).values(**values).on_conflict_do_nothing(
            index_elements=["user_id"]
        )
    )


async def consume_import_quota(
    session: AsyncSession,
    user_id: uuid.UUID,
    *,
    limit: int,
    window: timedelta,
    now: datetime,
) -> QuotaOutcome:
    """Spend one unit, or report that there is none to spend.

    The single UPDATE means "increment if there is room, and roll the window
    forward if it has expired". No row comes back when neither applies, which is
    the refusal — decided by the database rather than by whichever request read
    the counter first.
    """

    await _ensure_counter(session, user_id, now=now)
    cutoff = now - window

    window_expired = JobImportQuotaCounter.window_started_at <= cutoff
    consumed = await session.execute(
        update(JobImportQuotaCounter)
        .where(JobImportQuotaCounter.user_id == user_id)
        .where(
            or_(
                # A stale window is always allowed: it is a new period.
                window_expired,
                JobImportQuotaCounter.used < limit,
            )
        )
        .values(
            used=case((window_expired, 1), else_=JobImportQuotaCounter.used + 1),
            window_started_at=case(
                (window_expired, now), else_=JobImportQuotaCounter.window_started_at
            ),
            updated_at=now,
        )
        .returning(JobImportQuotaCounter.used)
        .execution_options(synchronize_session=False)
    )
    used = consumed.scalar_one_or_none()

    if used is None:
        return QuotaOutcome(allowed=False, used=limit, limit=limit)
    return QuotaOutcome(allowed=True, used=int(used), limit=limit)


async def release_import_quota(
    session: AsyncSession,
    user_id: uuid.UUID,
    *,
    now: datetime,
) -> None:
    """Give a unit back when the attempt it was taken for never happened.

    Refunded rather than left spent, because the unit represents a provider call
    and a request that was refused downstream — a disabled feature, a draft
    already finished — made none. Clamped at zero so a double refund cannot
    manufacture quota.
    """

    await session.execute(
        update(JobImportQuotaCounter)
        .where(JobImportQuotaCounter.user_id == user_id)
        .where(JobImportQuotaCounter.used > 0)
        .values(used=JobImportQuotaCounter.used - 1, updated_at=now)
        .execution_options(synchronize_session=False)
    )
