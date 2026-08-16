"""Claiming an import for processing without two workers taking the same one.

The obvious implementation is wrong, and it is wrong in a way this codebase has
already paid for twice. Reading a draft, deciding in Python that it looks
free, then writing "processing" onto it is a check-then-act race: two callers
both read it as free, both write, and one import becomes two provider calls,
two bills, and two results racing to overwrite each other's draft. That is the
defect RATE-001 is blocked on and the one invite redemption had.

So the claim is one statement. The predicate that decides eligibility and the
write that takes ownership are evaluated together by the database. On PostgreSQL
the candidate row is locked with SKIP LOCKED so a second worker steps over it
rather than queueing behind it.

The attempt counter is incremented AT CLAIM, not at failure. A process that dies
mid-attempt never reports anything, so counting failures would let a crash loop
retry forever — and the attempt may well have reached the provider and been
billed before the process died. Counting claims makes the ceiling mean "how many
times we have started this", which is the number that bounds spend.

The eligibility predicate here mirrors `may_start_attempt` in
`app/core/job_import_execution.py`. Two expressions of one rule can drift, so a
test drives both over the same matrix of row states and requires them to agree.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import and_, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.job_import_execution import (
    IN_FLIGHT_STATUS,
    LEASE_SECONDS,
    MAX_ATTEMPTS,
    STARTABLE_STATUSES,
    lease_deadline,
)
from app.models import JobImportDraft


def processing_eligible(moment: datetime):
    """SQL for "an attempt may start on this row now".

    Deliberately excludes ownership and the kill switch: those are the caller's
    questions, asked in different places for different reasons, and folding them
    in here would hide an authorization check inside a queue query.
    """

    return and_(
        JobImportDraft.deleted_at.is_(None),
        JobImportDraft.processing_attempts < MAX_ATTEMPTS,
        or_(
            JobImportDraft.processing_next_attempt_at.is_(None),
            JobImportDraft.processing_next_attempt_at <= moment,
        ),
        or_(
            JobImportDraft.processing_status.in_(tuple(STARTABLE_STATUSES)),
            # A stranded attempt: marked as running, with nobody running it.
            and_(
                JobImportDraft.processing_status == IN_FLIGHT_STATUS,
                or_(
                    JobImportDraft.processing_lease_expires_at.is_(None),
                    JobImportDraft.processing_lease_expires_at <= moment,
                ),
            ),
        ),
    )


def _claim_values(worker_id: str, now: datetime, lease_seconds: int) -> dict:
    return {
        "processing_status": IN_FLIGHT_STATUS,
        "processing_worker_id": worker_id,
        "processing_lease_expires_at": lease_deadline(now, seconds=lease_seconds),
        "processing_attempts": JobImportDraft.processing_attempts + 1,
        # The row is running now, so a previously scheduled retry no longer
        # describes it. Leaving it set would make the next sweep think a live
        # attempt was also due.
        "processing_next_attempt_at": None,
    }


async def claim_draft_for_processing(
    session: AsyncSession,
    draft_id: uuid.UUID,
    *,
    worker_id: str,
    now: datetime,
    lease_seconds: int = LEASE_SECONDS,
) -> JobImportDraft | None:
    """Take ownership of one specific draft, or return None.

    None means somebody else owns it, it has spent its attempts, its retry is
    not due, or it is finished — the caller cannot tell which, and does not need
    to: in every case the answer is "do not call the provider".
    """

    claimed = await session.execute(
        update(JobImportDraft)
        .where(JobImportDraft.id == draft_id)
        .where(processing_eligible(now))
        .values(**_claim_values(worker_id, now, lease_seconds))
        .returning(JobImportDraft)
        .execution_options(synchronize_session=False)
    )
    return claimed.scalar_one_or_none()


async def claim_stranded_drafts(
    session: AsyncSession,
    *,
    worker_id: str,
    limit: int = 5,
    now: datetime,
    lease_seconds: int = LEASE_SECONDS,
) -> list[JobImportDraft]:
    """Take a batch of imports nobody is working on.

    This is what makes "preparing your draft" end. Its whole population is rows
    whose owner went away, which is why it can only be found by a clock and
    never by a flag the dead process would have had to set.
    """

    candidates = (
        select(JobImportDraft.id)
        .where(processing_eligible(now))
        .order_by(JobImportDraft.created_at)
        .limit(limit)
    )
    if session.bind is not None and session.bind.dialect.name == "postgresql":
        candidates = candidates.with_for_update(skip_locked=True)

    claimed = await session.execute(
        update(JobImportDraft)
        .where(JobImportDraft.id.in_(candidates.scalar_subquery()))
        # Re-checked inside the write. The subquery selected candidates; this is
        # what makes taking them atomic rather than merely likely.
        .where(processing_eligible(now))
        .values(**_claim_values(worker_id, now, lease_seconds))
        .returning(JobImportDraft)
        .execution_options(synchronize_session=False)
    )
    return list(claimed.scalars().all())


async def release_expired_claim(
    session: AsyncSession,
    draft_id: uuid.UUID,
    *,
    now: datetime,
) -> bool:
    """Give up a lease this worker no longer trusts, without touching a live one.

    Used when a worker notices its own lease lapsed while it was busy: another
    worker may already have taken the row, and writing a result over that would
    be the duplicate this module exists to prevent.
    """

    released = await session.execute(
        update(JobImportDraft)
        .where(JobImportDraft.id == draft_id)
        .where(JobImportDraft.processing_lease_expires_at <= now)
        .values(processing_worker_id=None, processing_lease_expires_at=None)
        .returning(JobImportDraft.id)
        .execution_options(synchronize_session=False)
    )
    return released.scalar_one_or_none() is not None
