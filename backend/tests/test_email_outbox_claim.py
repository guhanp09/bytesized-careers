"""Who owns an outbox row, and when they stop owning it.

The property that matters is that two workers never both deliver the same
email. On PostgreSQL that rests on SKIP LOCKED, which SQLite does not model, so
the true concurrency proof is recorded as BLOCKED_ENVIRONMENT until a disposable
PostgreSQL is available.

What *is* provable here is everything the lock does not decide: which rows are
eligible at all, that a claim is a single statement rather than a read followed
by a write, that a held lease excludes others, that an expired one does not, and
that terminal rows never come back. Those are the rules a race would exploit, so
getting them wrong makes the lock irrelevant anyway.

Time is injected throughout. A test that sleeps to observe a lease expiring is
slow, flaky, and proves less than one that simply asks what is eligible at a
given moment.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest

from app.models import EmailOutbox
from app.repositories.email_outbox_repository import (
    DEFAULT_LEASE_SECONDS,
    claim_due_emails,
    release_lease,
)

T0 = datetime(2026, 6, 1, 12, 0, 0, tzinfo=UTC)


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


class TestWhatIsEligible:
    async def test_a_fresh_queued_row_is_claimable(self, db_session) -> None:
        row = await _queue(db_session)

        claimed = await claim_due_emails(db_session, worker_id="w1", now=T0)

        assert [c.id for c in claimed] == [row.id]
        assert claimed[0].leased_by == "w1"

    @pytest.mark.parametrize("status", ["sent", "mocked", "failed", "skipped"])
    async def test_a_terminal_row_is_never_claimed(self, db_session, status: str) -> None:
        # Re-delivering a sent email is the worst failure this subsystem has.
        await _queue(db_session, status=status)

        assert await claim_due_emails(db_session, worker_id="w1", now=T0) == []

    async def test_a_retry_that_is_not_due_yet_is_not_claimed(self, db_session) -> None:
        await _queue(db_session, next_attempt_at=T0 + timedelta(minutes=5))

        assert await claim_due_emails(db_session, worker_id="w1", now=T0) == []

    async def test_a_retry_becomes_claimable_once_due(self, db_session) -> None:
        row = await _queue(db_session, next_attempt_at=T0 + timedelta(minutes=5))

        claimed = await claim_due_emails(db_session, worker_id="w1", now=T0 + timedelta(minutes=5))

        assert [c.id for c in claimed] == [row.id]

    async def test_a_row_with_no_schedule_is_treated_as_due(self, db_session) -> None:
        # Rows written before 0060 have next_attempt_at NULL and must not be
        # stranded by the new predicate.
        row = await _queue(db_session, next_attempt_at=None)

        claimed = await claim_due_emails(db_session, worker_id="w1", now=T0)

        assert [c.id for c in claimed] == [row.id]


class TestLeaseOwnership:
    async def test_a_held_lease_excludes_another_worker(self, db_session) -> None:
        await _queue(db_session)

        first = await claim_due_emails(db_session, worker_id="w1", now=T0)
        second = await claim_due_emails(db_session, worker_id="w2", now=T0 + timedelta(seconds=1))

        assert len(first) == 1
        assert second == [], "a second worker took a row that was already owned"

    async def test_an_expired_lease_is_reclaimable(self, db_session) -> None:
        # A worker that dies holding a lease must not strand the email forever.
        await _queue(db_session)
        await claim_due_emails(db_session, worker_id="dead-worker", now=T0)

        after_expiry = T0 + timedelta(seconds=DEFAULT_LEASE_SECONDS + 1)
        reclaimed = await claim_due_emails(db_session, worker_id="w2", now=after_expiry)

        assert len(reclaimed) == 1
        assert reclaimed[0].leased_by == "w2"

    async def test_a_lease_is_not_reclaimable_one_second_early(self, db_session) -> None:
        await _queue(db_session)
        await claim_due_emails(db_session, worker_id="w1", now=T0)

        just_before = T0 + timedelta(seconds=DEFAULT_LEASE_SECONDS - 1)

        assert await claim_due_emails(db_session, worker_id="w2", now=just_before) == []

    async def test_releasing_returns_the_row_immediately(self, db_session) -> None:
        # Clean shutdown should not make the next worker wait out a lease that
        # nobody is using.
        row = await _queue(db_session)
        await claim_due_emails(db_session, worker_id="w1", now=T0)

        await release_lease(db_session, row.id)
        claimed = await claim_due_emails(db_session, worker_id="w2", now=T0 + timedelta(seconds=1))

        assert [c.id for c in claimed] == [row.id]

    async def test_releasing_cannot_resurrect_a_sent_row(self, db_session) -> None:
        row = await _queue(db_session, status="sent", leased_by="w1")

        await release_lease(db_session, row.id)

        assert await claim_due_emails(db_session, worker_id="w2", now=T0) == []


class TestClaimShape:
    async def test_a_claim_takes_no_more_than_asked(self, db_session) -> None:
        for _ in range(5):
            await _queue(db_session)

        claimed = await claim_due_emails(db_session, worker_id="w1", limit=2, now=T0)

        assert len(claimed) == 2

    async def test_two_workers_split_the_backlog_disjointly(self, db_session) -> None:
        for _ in range(4):
            await _queue(db_session)

        first = await claim_due_emails(db_session, worker_id="w1", limit=2, now=T0)
        second = await claim_due_emails(db_session, worker_id="w2", limit=2, now=T0)

        assert len(first) == 2 and len(second) == 2
        assert set(c.id for c in first).isdisjoint(c.id for c in second), (
            "the same row was handed to two workers"
        )

    async def test_the_oldest_intent_goes_first(self, db_session) -> None:
        # Without an order a backlog can starve its own head.
        old = await _queue(db_session, created_at=T0 - timedelta(hours=2))
        await _queue(db_session, created_at=T0 - timedelta(minutes=1))

        claimed = await claim_due_emails(db_session, worker_id="w1", limit=1, now=T0)

        assert [c.id for c in claimed] == [old.id]

    async def test_claiming_does_not_consume_an_attempt(self, db_session) -> None:
        # Attempts count provider calls. Taking a lease is not one, or a worker
        # restarting would burn the retry budget without ever sending anything.
        await _queue(db_session)

        claimed = await claim_due_emails(db_session, worker_id="w1", now=T0)

        assert claimed[0].attempts == 0

    async def test_claiming_leaves_the_delivery_record_alone(self, db_session) -> None:
        row = await _queue(db_session)

        claimed = await claim_due_emails(db_session, worker_id="w1", now=T0)

        assert claimed[0].status == "queued"
        assert claimed[0].processed_at is None
        assert claimed[0].provider_message_id is None
        assert claimed[0].dedupe_key == row.dedupe_key


class TestTheClaimIsOneStatement:
    """Structural, because the alternative implementation is subtly wrong.

    A select-then-decide-then-update claim passes every behavioural test above
    while still handing one row to two workers under real contention. The only
    way to keep that from creeping back is to assert on the shape.
    """

    def test_it_does_not_read_then_write(self) -> None:
        from pathlib import Path

        source = Path(
            "app/repositories/email_outbox_repository.py"
        ).read_text(encoding="utf8")
        body = source[source.index("async def claim_due_emails"):source.index("async def release_lease")]

        # Exactly one statement reaches the database in the claim.
        assert body.count("await session.execute") == 1, (
            "the claim executes more than once, which reintroduces check-then-act"
        )
        assert "update(EmailOutbox)" in body
        assert ".returning(" in body

    def test_it_asks_postgres_to_skip_contended_rows(self) -> None:
        from pathlib import Path

        source = Path(
            "app/repositories/email_outbox_repository.py"
        ).read_text(encoding="utf8")

        assert "skip_locked=True" in source
        assert 'dialect.name == "postgresql"' in source
