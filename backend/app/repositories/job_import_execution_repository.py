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
from datetime import datetime, timedelta

from sqlalchemy import and_, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.job_import_execution import (
    IN_FLIGHT_STATUS,
    LEASE_SECONDS,
    MAX_ATTEMPTS,
    STARTABLE_STATUSES,
    attempts_remain,
    lease_deadline,
    retry_delay_seconds,
)
from app.models import JobImportDraft


def processing_eligible(moment: datetime, *, honour_retry_schedule: bool = True):
    """SQL for "an attempt may start on this row now".

    Deliberately excludes ownership and the kill switch: those are the caller's
    questions, asked in different places for different reasons, and folding them
    in here would hide an authorization check inside a queue query.
    """

    conditions = [
        JobImportDraft.deleted_at.is_(None),
        JobImportDraft.processing_attempts < MAX_ATTEMPTS,
        # Nobody holds it. The lease alone decides ownership, which is why a
        # row whose status still says `awaiting_processing` is not free while
        # someone is already working on it.
        or_(
            JobImportDraft.processing_lease_expires_at.is_(None),
            JobImportDraft.processing_lease_expires_at <= moment,
        ),
        # And the work is still wanted. A finished import must not be re-run:
        # it would spend again and overwrite a draft the recruiter may have
        # edited since.
        JobImportDraft.processing_status.in_(
            tuple(STARTABLE_STATUSES | {IN_FLIGHT_STATUS})
        ),
    ]
    if honour_retry_schedule:
        # Only the sweep waits. See `may_start_attempt` for why a person asking
        # again is not the thing backoff is protecting against.
        conditions.append(
            or_(
                JobImportDraft.processing_next_attempt_at.is_(None),
                JobImportDraft.processing_next_attempt_at <= moment,
            )
        )
    return and_(*conditions)


def _claim_values(worker_id: str, now: datetime, lease_seconds: int) -> dict:
    """Ownership only. The claim deliberately does NOT write processing_status.

    That column belongs to the import lifecycle, whose own transition — with its
    own allowed-from set — runs immediately after this. Writing it here made
    that transition illegal from its own starting state, which is a good
    illustration of why the two axes are kept apart.
    """

    return {
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
    honour_retry_schedule: bool = False,
) -> JobImportDraft | None:
    """Take ownership of one specific draft, or return None.

    `honour_retry_schedule` defaults to False because this is the path a person
    takes: they pressed the button, and a machine's backoff is not a reason to
    refuse them. The sweep below defaults the other way.

    None means somebody else owns it, it has spent its attempts, its retry is
    not due, or it is finished — the caller cannot tell which, and does not need
    to: in every case the answer is "do not call the provider".
    """

    claimed = await session.execute(
        update(JobImportDraft)
        .where(JobImportDraft.id == draft_id)
        .where(processing_eligible(now, honour_retry_schedule=honour_retry_schedule))
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


async def count_live_owner_leases(
    session: AsyncSession, owner_user_id: uuid.UUID, *, now: datetime
) -> int:
    """Count only inside the caller's quota-write/claim transaction.

    This read is NOT independently safe admission. consume_import_quota's user
    row UPDATE serializes callers until begin_processing commits. The caller
    counts AFTER its tentative claim and rolls the entire transaction back if
    over capacity. Neither deleted_at nor status releases running provider work:
    hiding a draft must not create another allowance while its call is in flight.
    """
    return int(
        await session.scalar(
            select(func.count(JobImportDraft.id)).where(
                JobImportDraft.owner_user_id == owner_user_id,
                JobImportDraft.processing_lease_expires_at > now,
            )
        )
        or 0
    )


async def settle_finished_attempt(
    session: AsyncSession,
    draft_id: uuid.UUID,
    *,
    worker_id: str | None = None,
) -> None:
    """Let go of a lease once the attempt has produced its outcome.

    Scoped to this worker when a `worker_id` is given, so a worker whose lease
    lapsed mid-attempt cannot clear the lease of whoever took over from it.

    The lease is cleared and no retry is scheduled: whatever this attempt
    settled on — a draft, or a failure that will not be retried — is the answer,
    and leaving a live lease behind would make the row look busy forever.
    """

    statement = update(JobImportDraft).where(JobImportDraft.id == draft_id)
    if worker_id is not None:
        statement = statement.where(JobImportDraft.processing_worker_id == worker_id)

    await session.execute(
        statement.values(
            processing_worker_id=None,
            processing_lease_expires_at=None,
            processing_next_attempt_at=None,
        ).execution_options(synchronize_session=False)
    )


async def schedule_retry_after_failure(
    session: AsyncSession,
    draft_id: uuid.UUID,
    *,
    now: datetime,
    worker_id: str | None = None,
) -> datetime | None:
    """Release the lease and say when this import may be tried again.

    Returns the scheduled time, or None when the attempts are spent — in which
    case the row is simply left without a retry time, and no sweep will pick it
    up again. That is the intended end: an import that has failed five times
    will fail the sixth, and each attempt costs a provider call.

    The attempt count is re-read here rather than carried in from the caller.
    That is safe for the same narrow reason it was in the email outbox: the
    caller holds the lease, so nothing else is writing this row. It would NOT be
    safe in the claim, where the whole question is who gets to write.
    """

    found = await session.execute(
        select(JobImportDraft.processing_attempts).where(JobImportDraft.id == draft_id)
    )
    attempts = found.scalar_one_or_none()
    if attempts is None:
        return None

    next_attempt_at = (
        now + timedelta(seconds=retry_delay_seconds(attempts))
        if attempts_remain(attempts)
        else None
    )

    statement = update(JobImportDraft).where(JobImportDraft.id == draft_id)
    if worker_id is not None:
        statement = statement.where(JobImportDraft.processing_worker_id == worker_id)

    await session.execute(
        statement.values(
            processing_worker_id=None,
            processing_lease_expires_at=None,
            processing_next_attempt_at=next_attempt_at,
        ).execution_options(synchronize_session=False)
    )
    return next_attempt_at


async def settle_as_failed(
    session: AsyncSession,
    draft_id: uuid.UUID,
    *,
    now: datetime,
    worker_id: str,
) -> datetime | None:
    """Write the truthful end state onto an attempt nobody finished.

    Scoped to `worker_id` so this can only settle a row this sweep actually
    claimed. Without that, a slow sweep could overwrite the state of an attempt
    that has since been taken over and succeeded.

    The status is set here rather than through the import service because the
    service's transitions all take an owner and an attempt id, and a sweep has
    neither: the recruiter is gone and the attempt that would have reported is
    the one that died.
    """

    found = await session.execute(
        select(JobImportDraft.processing_attempts).where(JobImportDraft.id == draft_id)
    )
    attempts = found.scalar_one_or_none()
    if attempts is None:
        return None

    next_attempt_at = (
        now + timedelta(seconds=retry_delay_seconds(attempts))
        if attempts_remain(attempts)
        else None
    )
    await session.execute(
        update(JobImportDraft)
        .where(JobImportDraft.id == draft_id)
        .where(JobImportDraft.processing_worker_id == worker_id)
        .values(
            processing_status="processing_failed",
            processing_worker_id=None,
            processing_lease_expires_at=None,
            processing_next_attempt_at=next_attempt_at,
        )
        .execution_options(synchronize_session=False)
    )
    return next_attempt_at


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
