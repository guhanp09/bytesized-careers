"""What an outbox row becomes after a delivery attempt.

The distinction these tests defend is between a failure worth retrying and one
that is not. Treating them alike gives you either a queue that gives up on a
transient network blip, or one that retries a malformed address forever — and
the second is worse, because it looks like it is working.

Attempt counting is checked closely for the same reason: it is the only thing
standing between "bounded retries" and an infinite loop, and it is easy to
increment in the wrong place. Claiming must not consume one; a provider call
must consume exactly one.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest_asyncio
from sqlalchemy import delete, select

from app.models import EmailOutbox
from app.repositories.email_outbox_delivery import (
    BASE_RETRY_SECONDS,
    MAX_ATTEMPTS,
    MAX_RETRY_SECONDS,
    mark_retryable_failure,
    mark_sent,
    mark_suppressed,
    mark_terminal_failure,
    retry_delay_seconds,
)
from app.repositories.email_outbox_repository import claim_due_emails

T0 = datetime(2026, 6, 1, 12, 0, 0, tzinfo=UTC)

@pytest_asyncio.fixture(autouse=True)
async def _isolate_outbox(db_session):
    """Start each test from an empty outbox.

    `claim_due_emails` asks the whole table what is due, which is correct for a
    worker and unhelpful for a test: rows another test left behind show up in the
    result and assertions about "nothing was claimable" become assertions about
    the rest of the suite. These tests pass in isolation and failed only in the
    full run, which is exactly that shape.
    """
    await db_session.execute(delete(EmailOutbox))
    await db_session.flush()
    yield



async def _queue(session, **overrides) -> EmailOutbox:
    row = EmailOutbox(
        to_email=overrides.pop("to_email", f"{uuid.uuid4().hex[:8]}@example.test"),
        event_key=overrides.pop("event_key", "test_event"),
        template_key=overrides.pop("template_key", "test_template"),
        subject=overrides.pop("subject", "Subject"),
        status=overrides.pop("status", "queued"),
        **overrides,
    )
    session.add(row)
    await session.flush()
    return row


def _as_utc(value: datetime | None) -> datetime | None:
    """SQLite drops tzinfo on `DateTime(timezone=True)`.

    The stored instant is right; only the awareness is lost, and that is true of
    every timestamp column in this project rather than anything new here.
    PostgreSQL keeps it. Normalising in the test keeps the assertion about the
    moment rather than about the driver.
    """
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=UTC)


async def _reload(session, row_id) -> EmailOutbox:
    session.expire_all()
    found = await session.execute(select(EmailOutbox).where(EmailOutbox.id == row_id))
    return found.scalar_one()


class TestBackoffSchedule:
    def test_the_first_retry_waits_the_base_delay(self) -> None:
        assert retry_delay_seconds(1) == BASE_RETRY_SECONDS

    def test_each_retry_doubles(self) -> None:
        assert retry_delay_seconds(2) == BASE_RETRY_SECONDS * 2
        assert retry_delay_seconds(3) == BASE_RETRY_SECONDS * 4

    def test_it_stops_growing_at_the_ceiling(self) -> None:
        # Unbounded doubling would eventually schedule a retry past any sensible
        # horizon, which is indistinguishable from dropping the mail.
        assert retry_delay_seconds(50) == MAX_RETRY_SECONDS

    def test_it_is_deterministic(self) -> None:
        # Two workers computing the schedule must agree, and a test must be able
        # to assert the answer.
        assert retry_delay_seconds(3) == retry_delay_seconds(3)


class TestSuccess:
    async def test_a_sent_row_is_terminal(self, db_session) -> None:
        row = await _queue(db_session)

        await mark_sent(db_session, row.id, provider_message_id="prov-1", now=T0)

        assert await claim_due_emails(db_session, worker_id="w", now=T0 + timedelta(days=1)) == []

    async def test_it_records_what_the_provider_called_the_message(self, db_session) -> None:
        # Without this a bounce webhook cannot be matched to the message.
        row = await _queue(db_session)

        await mark_sent(db_session, row.id, provider_message_id="prov-abc", now=T0)

        assert (await _reload(db_session, row.id)).provider_message_id == "prov-abc"

    async def test_it_consumes_exactly_one_attempt(self, db_session) -> None:
        row = await _queue(db_session)

        await mark_sent(db_session, row.id, now=T0)

        assert (await _reload(db_session, row.id)).attempts == 1

    async def test_it_clears_the_lease(self, db_session) -> None:
        row = await _queue(db_session)
        await claim_due_emails(db_session, worker_id="w1", now=T0)

        await mark_sent(db_session, row.id, now=T0)

        reloaded = await _reload(db_session, row.id)
        assert reloaded.leased_by is None and reloaded.leased_until is None


class TestRetryableFailure:
    async def test_it_schedules_a_future_attempt(self, db_session) -> None:
        row = await _queue(db_session)

        again = await mark_retryable_failure(db_session, row.id, error="smtp timeout", now=T0)

        assert again is True
        reloaded = await _reload(db_session, row.id)
        assert reloaded.status == "queued"
        assert _as_utc(reloaded.next_attempt_at) == T0 + timedelta(seconds=BASE_RETRY_SECONDS)

    async def test_the_row_is_not_claimable_before_its_next_attempt(self, db_session) -> None:
        row = await _queue(db_session)
        await mark_retryable_failure(db_session, row.id, error="smtp timeout", now=T0)

        just_before = T0 + timedelta(seconds=BASE_RETRY_SECONDS - 1)

        assert await claim_due_emails(db_session, worker_id="w", now=just_before) == []

    async def test_the_row_is_claimable_once_due(self, db_session) -> None:
        row = await _queue(db_session)
        await mark_retryable_failure(db_session, row.id, error="smtp timeout", now=T0)

        due = T0 + timedelta(seconds=BASE_RETRY_SECONDS)
        claimed = await claim_due_emails(db_session, worker_id="w", now=due)

        assert [c.id for c in claimed] == [row.id]

    async def test_a_retry_reuses_the_row_rather_than_creating_another(self, db_session) -> None:
        row = await _queue(db_session)

        await mark_retryable_failure(db_session, row.id, error="smtp timeout", now=T0)

        found = await db_session.execute(select(EmailOutbox).where(EmailOutbox.id == row.id))
        all_rows = await db_session.execute(select(EmailOutbox))
        assert found.scalar_one() is not None
        assert len(all_rows.scalars().all()) == 1, "a retry duplicated the intent"

    async def test_the_attempt_count_moves_once_per_failure(self, db_session) -> None:
        row = await _queue(db_session)

        await mark_retryable_failure(db_session, row.id, error="one", now=T0)
        assert (await _reload(db_session, row.id)).attempts == 1

        refreshed = await _reload(db_session, row.id)
        await mark_retryable_failure(db_session, refreshed.id, error="two", now=T0)
        assert (await _reload(db_session, row.id)).attempts == 2

    async def test_it_gives_up_at_the_ceiling(self, db_session) -> None:
        # The row must stop being retried and start being reportable.
        row = await _queue(db_session, attempts=MAX_ATTEMPTS - 1)

        again = await mark_retryable_failure(db_session, row.id, error="still failing", now=T0)

        assert again is False
        reloaded = await _reload(db_session, row.id)
        assert reloaded.status == "failed"
        assert "gave up" in (reloaded.error or "")

    async def test_a_row_that_gave_up_is_never_claimed_again(self, db_session) -> None:
        row = await _queue(db_session, attempts=MAX_ATTEMPTS - 1)
        await mark_retryable_failure(db_session, row.id, error="still failing", now=T0)

        assert await claim_due_emails(db_session, worker_id="w", now=T0 + timedelta(days=7)) == []


class TestTerminalFailure:
    async def test_it_is_never_retried(self, db_session) -> None:
        # A malformed address does not become valid by waiting.
        row = await _queue(db_session)

        await mark_terminal_failure(db_session, row.id, error="invalid recipient", now=T0)

        assert await claim_due_emails(db_session, worker_id="w", now=T0 + timedelta(days=7)) == []

    async def test_it_records_why(self, db_session) -> None:
        row = await _queue(db_session)

        await mark_terminal_failure(db_session, row.id, error="invalid recipient", now=T0)

        assert (await _reload(db_session, row.id)).error == "invalid recipient"


class TestSuppression:
    async def test_a_suppressed_row_is_not_a_failure(self, db_session) -> None:
        # An operator reading the table should be able to tell "withheld on
        # purpose" from "attempted and rejected".
        row = await _queue(db_session)

        await mark_suppressed(db_session, row.id, reason="recipient unsubscribed", now=T0)

        reloaded = await _reload(db_session, row.id)
        assert reloaded.status == "skipped"
        assert reloaded.status != "failed"

    async def test_it_consumes_no_attempt(self, db_session) -> None:
        # Nothing was sent, so nothing was attempted.
        row = await _queue(db_session)

        await mark_suppressed(db_session, row.id, reason="hard bounce on file", now=T0)

        assert (await _reload(db_session, row.id)).attempts == 0

    async def test_it_is_never_claimed_again(self, db_session) -> None:
        row = await _queue(db_session)
        await mark_suppressed(db_session, row.id, reason="unsubscribed", now=T0)

        assert await claim_due_emails(db_session, worker_id="w", now=T0 + timedelta(days=7)) == []


class TestTheWholeRetryLoopTerminates:
    async def test_a_permanently_failing_row_stops_on_its_own(self, db_session) -> None:
        """The property that makes 'bounded retries' true rather than aspirational."""
        row = await _queue(db_session)
        moment = T0

        for _ in range(MAX_ATTEMPTS + 3):
            claimed = await claim_due_emails(db_session, worker_id="w", now=moment)
            if not claimed:
                break
            still_going = await mark_retryable_failure(
                db_session, claimed[0].id, error="provider down", now=moment
            )
            if not still_going:
                break
            moment = moment + timedelta(seconds=MAX_RETRY_SECONDS + 1)

        reloaded = await _reload(db_session, row.id)
        assert reloaded.status == "failed"
        assert reloaded.attempts == MAX_ATTEMPTS
        # And it stays stopped.
        assert await claim_due_emails(db_session, worker_id="w", now=moment + timedelta(days=30)) == []
