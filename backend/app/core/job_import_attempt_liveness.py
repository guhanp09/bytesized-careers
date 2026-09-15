"""Whether a draft that says it is processing still has anyone working on it.

Every deliberate failure path writes a truthful status, and there is an
``except`` clause for each of them. None of that survives the process dying.
A worker killed mid-extraction — a deploy, an OOM, a machine restart — leaves a
row saying ``processing`` with nothing anywhere that will ever finish it. Every
subsequent read reports work in progress, truthfully as far as the row knows,
and the recruiter watches a spinner for a job nobody is doing.

The row carries enough to tell. ``begin_processing`` stamps
``processing_started_at`` into the draft's provider metadata, and the server's
own budget bounds how long an attempt can legitimately take: one extraction of
at most ``openai_request_timeout_seconds``, plus the retries the adapter is
allowed. Past that ceiling, plus a margin for the work either side of the call,
an attempt is not slow — it is gone.

This is deliberately not a timeout. A timeout stops work; this only describes
work that has already stopped. It is the last line of the terminal-state
guarantee, and the only one that holds when no ``except`` clause can run.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

#: Room for everything in an attempt that is not the provider call itself.
#:
#: Building the request, recording the result, reconciliation and question
#: planning. Generous on purpose: declaring a live attempt dead would fail an
#: import that was about to succeed, which is far worse than reporting an
#: abandoned one a minute late.
ATTEMPT_OVERHEAD_SECONDS: float = 120.0

# Shared with provider construction and retry backoff. Budgeting raw settings
# below the viable floor would declare a legitimately running attempt abandoned.
MIN_VIABLE_EXTRACTION_TIMEOUT_SECONDS: float = 45.0
MAX_PROVIDER_RETRY_DELAY_SECONDS: float = 2.0


def maximum_provider_seconds(*, request_timeout_seconds: float, max_retries: int) -> float:
    retries = max(0, int(max_retries))
    timeout = max(MIN_VIABLE_EXTRACTION_TIMEOUT_SECONDS, float(request_timeout_seconds))
    return timeout * (1 + retries) + MAX_PROVIDER_RETRY_DELAY_SECONDS * retries


@dataclass(frozen=True)
class AttemptLiveness:
    """What a ``processing`` row's own metadata says about its attempt."""

    #: True when the attempt has outlived any budget it could have had.
    abandoned: bool
    #: Seconds since the attempt began, when that is knowable.
    age_seconds: float | None = None
    #: The ceiling it was measured against.
    budget_seconds: float | None = None
    reason: str = ""


def maximum_attempt_seconds(
    *,
    request_timeout_seconds: float,
    max_retries: int,
) -> float:
    """The longest an honest attempt can take, from the server's own settings.

    Derived rather than configured, so raising the provider timeout cannot
    silently start declaring live attempts dead.
    """

    return maximum_provider_seconds(
        request_timeout_seconds=request_timeout_seconds, max_retries=max_retries
    ) + ATTEMPT_OVERHEAD_SECONDS


def _started_at(provider_metadata: Any) -> datetime | None:
    if not isinstance(provider_metadata, dict):
        return None
    raw = provider_metadata.get("processing_started_at")
    if not isinstance(raw, str) or not raw.strip():
        return None
    try:
        parsed = datetime.fromisoformat(raw)
    except ValueError:
        return None
    # Older rows were written without an offset. Treating a naive stamp as UTC
    # matches how it was produced.
    return parsed if parsed.tzinfo is not None else parsed.replace(tzinfo=UTC)


def assess_attempt(
    *,
    processing_status: str,
    provider_metadata: Any,
    request_timeout_seconds: float,
    max_retries: int,
    now: datetime | None = None,
) -> AttemptLiveness:
    """Decide whether a ``processing`` draft still has a live attempt behind it.

    Only ``processing`` is assessed. Every other status has already settled, and
    re-deciding a settled draft is how a completed import would get overwritten.
    """

    if processing_status != "processing":
        return AttemptLiveness(abandoned=False, reason="not processing")

    started = _started_at(provider_metadata)
    if started is None:
        # No stamp, so nothing to measure. Guessing "abandoned" here would fail
        # imports whose metadata predates the stamp, and the row is not evidence
        # either way.
        return AttemptLiveness(abandoned=False, reason="no recorded start time")

    moment = now or datetime.now(UTC)
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=UTC)
    budget = maximum_attempt_seconds(
        request_timeout_seconds=request_timeout_seconds,
        max_retries=max_retries,
    )
    age = (moment - started).total_seconds()
    if age < 0:
        # Clock skew between writer and reader. Not evidence of abandonment.
        return AttemptLiveness(
            abandoned=False, age_seconds=age, budget_seconds=budget, reason="clock skew"
        )
    if age <= budget:
        return AttemptLiveness(
            abandoned=False,
            age_seconds=age,
            budget_seconds=budget,
            reason="within the attempt budget",
        )
    return AttemptLiveness(
        abandoned=True,
        age_seconds=age,
        budget_seconds=budget,
        reason="no attempt can still be running after this long",
    )


def stale_attempt_timedelta(
    *,
    request_timeout_seconds: float,
    max_retries: int,
) -> timedelta:
    """The same ceiling, for callers that want it as a duration."""

    return timedelta(
        seconds=maximum_attempt_seconds(
            request_timeout_seconds=request_timeout_seconds,
            max_retries=max_retries,
        )
    )
