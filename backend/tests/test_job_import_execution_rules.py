"""The rules that decide whether an import attempt may start.

The failure these exist to prevent has a specific shape. An import used to be a
request-thread operation: if the process died mid-call the draft stayed in
`processing`, and nothing on the server had any reason to look at it again. The
recruiter's screen said "preparing your draft" forever, which is worse than an
error — it is indistinguishable from slow success, so nobody reports it and
nothing retries it.

Two properties do the work, and each is tested for the case that breaks it.

A lease must EXPIRE rather than be released, because a process that crashes
releases nothing. And it must not expire too eagerly, because reclaiming an
attempt that is merely slow turns one import into two provider calls and two
bills.

No database and no fixtures here: these are pure rules, and a test that needs a
session to check arithmetic is a test that will be skipped when it matters.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from app.core.job_import_execution import (
    BASE_RETRY_SECONDS,
    LEASE_SECONDS,
    MAX_ATTEMPTS,
    MAX_RETRY_SECONDS,
    ExecutionSnapshot,
    attempts_remain,
    is_stranded,
    lease_deadline,
    lease_is_live,
    may_start_attempt,
    retry_delay_seconds,
)

NOW = datetime(2026, 6, 1, 12, 0, 0, tzinfo=UTC)


def _snapshot(**overrides) -> ExecutionSnapshot:
    values: dict = {"processing_status": "awaiting_processing"}
    values.update(overrides)
    return ExecutionSnapshot(**values)


class TestAStrandedAttemptIsRecoverable:
    def test_processing_with_a_lapsed_lease_is_stranded(self) -> None:
        """The "loading forever" state, and the only one time can reveal."""

        snapshot = _snapshot(
            processing_status="processing",
            processing_lease_expires_at=NOW - timedelta(seconds=1),
        )

        assert is_stranded(snapshot, now=NOW) is True
        assert may_start_attempt(snapshot, now=NOW) is True

    def test_processing_with_no_lease_at_all_is_stranded(self) -> None:
        """Rows written before this existed have no lease, and they are exactly
        the stranded ones worth finding."""

        snapshot = _snapshot(processing_status="processing")

        assert is_stranded(snapshot, now=NOW) is True

    def test_a_live_lease_is_left_alone(self) -> None:
        """Reclaiming a slow attempt makes one import into two provider calls."""

        snapshot = _snapshot(
            processing_status="processing",
            processing_lease_expires_at=NOW + timedelta(seconds=1),
        )

        assert is_stranded(snapshot, now=NOW) is False
        assert may_start_attempt(snapshot, now=NOW) is False

    def test_the_lease_outlives_a_slow_provider_call(self) -> None:
        """The provider ceiling is 90s and one retry is allowed, so a lease
        shorter than that would declare a live attempt dead underneath itself."""

        assert LEASE_SECONDS > (90 * 2)

    def test_lease_deadline_is_in_the_future(self) -> None:
        assert lease_deadline(NOW) == NOW + timedelta(seconds=LEASE_SECONDS)

    def test_a_naive_timestamp_is_read_as_utc(self) -> None:
        """SQLite drops tzinfo. Comparing naive with aware raises, and it would
        raise inside the sweep that is supposed to be fixing things."""

        snapshot = _snapshot(
            processing_status="processing",
            processing_lease_expires_at=(NOW + timedelta(seconds=60)).replace(tzinfo=None),
        )

        assert lease_is_live(snapshot, now=NOW) is True


class TestWhatMayStart:
    @pytest.mark.parametrize("status", ["awaiting_processing", "processing_failed"])
    def test_a_startable_status_may_start(self, status: str) -> None:
        assert may_start_attempt(_snapshot(processing_status=status), now=NOW) is True

    @pytest.mark.parametrize(
        "status",
        [
            "awaiting_recruiter_review",
            "ready_to_apply",
            "applied_to_native_draft",
            "discarded",
            "superseded",
        ],
    )
    def test_a_finished_draft_never_starts_again(self, status: str) -> None:
        """A succeeded import must not be re-run: it would spend a second time
        and overwrite a draft the recruiter may already have edited."""

        assert may_start_attempt(_snapshot(processing_status=status), now=NOW) is False

    def test_a_scheduled_retry_waits_its_turn(self) -> None:
        snapshot = _snapshot(
            processing_status="processing_failed",
            processing_attempts=1,
            processing_next_attempt_at=NOW + timedelta(seconds=10),
        )

        assert may_start_attempt(snapshot, now=NOW) is False
        assert may_start_attempt(snapshot, now=NOW + timedelta(seconds=11)) is True

    def test_the_attempt_ceiling_stops_it(self) -> None:
        """An import that has failed five times will fail the sixth, and the
        difference between bounded and unbounded retries is a bill."""

        snapshot = _snapshot(
            processing_status="processing_failed", processing_attempts=MAX_ATTEMPTS
        )

        assert attempts_remain(MAX_ATTEMPTS) is False
        assert may_start_attempt(snapshot, now=NOW) is False

    def test_the_ceiling_applies_to_a_stranded_attempt_too(self) -> None:
        """Otherwise a draft that strands on every attempt retries forever."""

        snapshot = _snapshot(
            processing_status="processing",
            processing_attempts=MAX_ATTEMPTS,
            processing_lease_expires_at=NOW - timedelta(hours=1),
        )

        assert may_start_attempt(snapshot, now=NOW) is False

    def test_one_attempt_short_of_the_ceiling_still_runs(self) -> None:
        assert attempts_remain(MAX_ATTEMPTS - 1) is True


class TestBackoff:
    def test_it_grows_and_then_stops_growing(self) -> None:
        delays = [retry_delay_seconds(n) for n in range(1, 12)]

        assert delays[0] == BASE_RETRY_SECONDS
        assert delays == sorted(delays)
        assert max(delays) == MAX_RETRY_SECONDS

    def test_a_zeroth_attempt_still_gets_a_delay(self) -> None:
        """Defensive: a caller passing 0 must not produce a zero-second retry,
        which is a hot loop against a provider that just failed."""

        assert retry_delay_seconds(0) == BASE_RETRY_SECONDS

    def test_every_delay_is_positive(self) -> None:
        assert all(retry_delay_seconds(n) > 0 for n in range(0, 20))
