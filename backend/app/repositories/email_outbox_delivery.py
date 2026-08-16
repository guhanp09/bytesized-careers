"""What happens to an outbox row after a provider has been asked to send it.

Three outcomes, and the difference between them is the whole point:

* **sent** — the provider accepted it. Terminal. The row records the provider's
  own identifier so a later bounce or complaint can be traced back to it.
* **retryable** — the provider was unreachable, rate-limited, or failed in a way
  that a later attempt might survive. The row goes back to `queued` with a
  future `next_attempt_at`, and the attempt count moves.
* **terminal** — the address is malformed, the recipient is suppressed, or the
  provider rejected the message on its merits. Retrying cannot change the
  answer, so the row stops.

Collapsing retryable and terminal into one "failed" is the mistake this exists
to prevent. Retrying a permanently rejected address forever is how a queue
becomes a loop that never drains and a reputation problem with the provider.

Backoff is exponential from a base delay and stops at a ceiling. It is
deterministic — no jitter — because jitter that cannot be injected cannot be
tested, and the spread it buys is not worth an untestable scheduler at this
size. If contention ever justifies jitter, inject the source.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import EmailOutbox

#: Provider attempts before a row is given up on. Bounded so a permanently
#: broken destination cannot occupy a worker forever.
MAX_ATTEMPTS = 5

#: First retry waits this long; each subsequent one doubles.
BASE_RETRY_SECONDS = 60

#: However many attempts have failed, never wait longer than this.
MAX_RETRY_SECONDS = 3600


def _now() -> datetime:
    return datetime.now(UTC)


def retry_delay_seconds(attempts: int) -> int:
    """Backoff for a row that has already failed `attempts` times.

    Deliberately a pure function of the attempt count: the schedule can be
    asserted directly, and two workers computing it reach the same answer.
    """

    if attempts < 1:
        return BASE_RETRY_SECONDS
    delay = BASE_RETRY_SECONDS * (2 ** (attempts - 1))
    return min(delay, MAX_RETRY_SECONDS)


async def mark_sent(
    session: AsyncSession,
    row_id: uuid.UUID,
    *,
    provider_message_id: str | None = None,
    now: datetime | None = None,
) -> None:
    """Record a delivered message. Terminal, and never claimable again.

    The lease is cleared as well as the status. Leaving a lease on a sent row
    would be harmless today — `claim_due_emails` filters on status first — but it
    would make the table lie about what is in flight.
    """

    moment = now or _now()
    await session.execute(
        update(EmailOutbox)
        .where(EmailOutbox.id == row_id)
        .values(
            status="sent",
            attempts=EmailOutbox.attempts + 1,
            provider_message_id=provider_message_id,
            processed_at=moment,
            error=None,
            leased_by=None,
            leased_until=None,
            next_attempt_at=None,
        )
        .execution_options(synchronize_session=False)
    )


async def mark_retryable_failure(
    session: AsyncSession,
    row_id: uuid.UUID,
    *,
    error: str,
    now: datetime | None = None,
) -> bool:
    """Schedule another attempt, or give up if the budget is spent.

    Returns whether the row will be tried again. `False` means it was retired to
    a terminal failure, which is the honest outcome once the ceiling is reached —
    the alternative is a row retried forever and never reported.

    Takes an id and re-reads the attempt count rather than trusting a passed-in
    ORM object. That is not fussiness: every write here uses
    `synchronize_session=False`, so an instance the caller is holding — including
    one handed back by the claim's RETURNING — keeps whatever `attempts` it was
    loaded with. A worker looping on a stale zero would never reach the ceiling
    and the retry bound would silently not exist.

    Re-reading is safe here in a way it is not in `claim_due_emails`: the caller
    already holds the lease on this row, so exclusivity is established and there
    is no second writer to race. The claim has no such guarantee, which is why it
    must stay a single statement.
    """

    moment = now or _now()
    current = await session.execute(
        select(EmailOutbox.attempts).where(EmailOutbox.id == row_id)
    )
    attempts = (current.scalar_one_or_none() or 0) + 1

    if attempts >= MAX_ATTEMPTS:
        await session.execute(
            update(EmailOutbox)
            .where(EmailOutbox.id == row_id)
            .values(
                status="failed",
                attempts=attempts,
                error=f"{error} (gave up after {attempts} attempts)",
                processed_at=moment,
                leased_by=None,
                leased_until=None,
                next_attempt_at=None,
            )
            .execution_options(synchronize_session=False)
        )
        return False

    await session.execute(
        update(EmailOutbox)
        .where(EmailOutbox.id == row_id)
        .values(
            # Back to queued, not a separate "retrying" state: the row is once
            # again something a worker may take, and `next_attempt_at` already
            # says when. A second state would have to be kept in step with that
            # timestamp and could disagree with it.
            status="queued",
            attempts=attempts,
            error=error,
            next_attempt_at=moment + timedelta(seconds=retry_delay_seconds(attempts)),
            # The lease is dropped so the row is not held until expiry by a
            # worker that has already finished with it.
            leased_by=None,
            leased_until=None,
        )
        .execution_options(synchronize_session=False)
    )
    return True


async def mark_terminal_failure(
    session: AsyncSession,
    row_id: uuid.UUID,
    *,
    error: str,
    now: datetime | None = None,
) -> None:
    """Stop trying. For rejections a later attempt cannot fix."""

    moment = now or _now()
    await session.execute(
        update(EmailOutbox)
        .where(EmailOutbox.id == row_id)
        .values(
            status="failed",
            attempts=EmailOutbox.attempts + 1,
            error=error,
            processed_at=moment,
            leased_by=None,
            leased_until=None,
            next_attempt_at=None,
        )
        .execution_options(synchronize_session=False)
    )


async def mark_suppressed(
    session: AsyncSession,
    row_id: uuid.UUID,
    *,
    reason: str,
    now: datetime | None = None,
) -> None:
    """Do not send, and do not treat it as a failure.

    Separate from terminal failure because the two mean different things to an
    operator reading the table: a suppressed row was withheld on purpose — a
    bounced or unsubscribed address — while a failed one was attempted and
    rejected. `attempts` is deliberately not incremented, because nothing was
    attempted.
    """

    moment = now or _now()
    await session.execute(
        update(EmailOutbox)
        .where(EmailOutbox.id == row_id)
        .values(
            status="skipped",
            error=reason,
            processed_at=moment,
            leased_by=None,
            leased_until=None,
            next_attempt_at=None,
        )
        .execution_options(synchronize_session=False)
    )
