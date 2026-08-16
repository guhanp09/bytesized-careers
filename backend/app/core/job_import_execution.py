"""When an import attempt may start, and when a running one stops being credible.

An import used to be a request-thread operation. If the process handling it went
away — a deploy, an OOM, a dropped connection — the draft stayed in `processing`
and nothing on the server had any reason to look at it again. The recruiter's
screen said "preparing your draft" indefinitely, which is the worst kind of
failure: it is indistinguishable from success that is merely slow, so nobody
reports it and nothing retries it.

The rules live here, apart from the database, for the same reason the
conversation state machine does: they are the part worth reading in one place,
and they can be tested without fixtures or a session.

Two of them carry the weight.

A lease EXPIRES rather than being released. A worker that dies releases nothing,
so ownership has to lapse on a clock or stranded work stays stranded forever.

Attempts are BOUNDED. An import that fails the same way five times will fail the
sixth, and the difference between a bounded retry and an unbounded one is the
difference between a delay and a bill.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

#: Longer than the provider ceiling (90s) plus one retry, so an attempt that is
#: merely slow is never declared dead underneath itself — reclaiming a live
#: attempt is how one import becomes two provider calls and two bills.
LEASE_SECONDS = 300

#: Five, matching the email outbox. An import that has failed five times is not
#: about to succeed, and each attempt costs a provider call.
MAX_ATTEMPTS = 5

#: Backoff base and ceiling. Deterministic, with no jitter: a scheduled time is
#: easier to reason about when reading a stuck row, and the contention jitter
#: exists to spread is already handled by the atomic claim.
BASE_RETRY_SECONDS = 30
MAX_RETRY_SECONDS = 900

#: The statuses from which an extraction attempt may begin. `processing` is
#: absent on purpose: a draft already being worked on is claimed by its lease,
#: never by its status.
STARTABLE_STATUSES = frozenset({"awaiting_processing", "processing_failed"})

#: What "an attempt is in flight" looks like on a row.
IN_FLIGHT_STATUS = "processing"


def _as_utc(moment: datetime | None) -> datetime | None:
    """SQLite drops tzinfo on timezone-aware columns; the instant is still right.

    Comparing a naive datetime with an aware one raises, and the raise would
    happen inside a sweep that is supposed to be recovering from failures.
    """

    if moment is None:
        return None
    if moment.tzinfo is None:
        return moment.replace(tzinfo=UTC)
    return moment


def lease_deadline(now: datetime, *, seconds: int = LEASE_SECONDS) -> datetime:
    return now + timedelta(seconds=seconds)


def retry_delay_seconds(attempts: int) -> int:
    """Exponential, capped. `attempts` is the number already made."""

    if attempts < 1:
        return BASE_RETRY_SECONDS
    delay = BASE_RETRY_SECONDS * (2 ** (attempts - 1))
    return min(delay, MAX_RETRY_SECONDS)


def attempts_remain(attempts: int) -> bool:
    return attempts < MAX_ATTEMPTS


@dataclass(frozen=True)
class ExecutionSnapshot:
    """The execution-relevant part of a draft, without the draft.

    A dataclass rather than the ORM object so these rules can be exercised
    directly, and so a test cannot accidentally pass because some unrelated
    column happened to be set.
    """

    processing_status: str
    processing_attempts: int = 0
    processing_lease_expires_at: datetime | None = None
    processing_next_attempt_at: datetime | None = None


def lease_is_live(snapshot: ExecutionSnapshot, *, now: datetime) -> bool:
    """Someone is working on this, and their claim has not lapsed."""

    expires_at = _as_utc(snapshot.processing_lease_expires_at)
    return expires_at is not None and expires_at > now


def is_stranded(snapshot: ExecutionSnapshot, *, now: datetime) -> bool:
    """Marked as running, with nobody running it.

    This is the state that produced "loading forever". It is not a failure the
    row can describe on its own — only the passage of time makes it visible,
    which is exactly why it needs a clock and not a flag.
    """

    if snapshot.processing_status != IN_FLIGHT_STATUS:
        return False
    return not lease_is_live(snapshot, now=now)


def may_start_attempt(snapshot: ExecutionSnapshot, *, now: datetime) -> bool:
    """Whether an extraction attempt may begin for this draft right now.

    Deliberately excludes the kill switch and ownership. Those are different
    questions asked by different callers, and folding them in here would make
    this function answer three things and be trusted for none of them.
    """

    if not attempts_remain(snapshot.processing_attempts):
        return False

    next_attempt_at = _as_utc(snapshot.processing_next_attempt_at)
    if next_attempt_at is not None and next_attempt_at > now:
        return False

    if snapshot.processing_status in STARTABLE_STATUSES:
        return True

    # A stranded in-flight attempt is startable again precisely because its
    # lease lapsed. Anything else — succeeded, applied, discarded — is not.
    return is_stranded(snapshot, now=now)
