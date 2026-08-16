"""Taking ownership of an import, once, by exactly one worker.

The defect worth preventing is not exotic. Read a draft, decide in Python that
it looks free, write "processing" onto it — two callers both read it as free,
both write, and one import becomes two provider calls, two bills, and two
results racing to overwrite each other's draft. The project has already paid for
this shape twice (RATE-001, invite redemption), so the claim is one statement
and there is a structural test below that says so.

The second thing tested here is drift. The eligibility rule exists twice, once
as pure Python for the caller to reason about and once as SQL so the database
can decide it atomically. Two expressions of one rule diverge quietly, and the
divergence is invisible until the wrong row is claimed — so both are driven over
the same matrix of row states and required to agree.
"""

from __future__ import annotations

import inspect
import uuid
from datetime import UTC, datetime, timedelta

import pytest
import pytest_asyncio
from sqlalchemy import delete

from app.core.job_import_execution import (
    LEASE_SECONDS,
    MAX_ATTEMPTS,
    ExecutionSnapshot,
    may_start_attempt,
)
from app.models import JobImportDraft, JobImportSource, User
from app.repositories import job_import_execution_repository as execution_repository
from app.repositories.job_import_execution_repository import (
    claim_draft_for_processing,
    claim_stranded_drafts,
    release_expired_claim,
)

NOW = datetime(2026, 6, 1, 12, 0, 0, tzinfo=UTC)


@pytest_asyncio.fixture
async def owner(db_session) -> User:
    user = User(email=f"import-owner-{uuid.uuid4().hex[:8]}@example.test")
    db_session.add(user)
    await db_session.flush()
    return user


@pytest_asyncio.fixture
async def source(db_session, owner: User) -> JobImportSource:
    row = JobImportSource(
        owner_user_id=owner.id,
        source_type="pasted_text",
        original_text="Video editor wanted.",
        content_fingerprint=uuid.uuid4().hex,
    )
    db_session.add(row)
    await db_session.flush()
    return row


async def _draft(db_session, owner: User, source: JobImportSource, **overrides) -> JobImportDraft:
    values: dict = {
        "owner_user_id": owner.id,
        "source_id": source.id,
        "target_listing_schema_version": 3,
        "processing_status": "awaiting_processing",
    }
    values.update(overrides)
    row = JobImportDraft(**values)
    db_session.add(row)
    await db_session.flush()
    return row


class TestClaimingOne:
    async def test_an_eligible_draft_is_claimed_and_leased(
        self, db_session, owner, source
    ) -> None:
        draft = await _draft(db_session, owner, source)

        claimed = await claim_draft_for_processing(
            db_session, draft.id, worker_id="worker-a", now=NOW
        )

        assert claimed is not None
        await db_session.refresh(draft)
        assert draft.processing_status == "processing"
        assert draft.processing_worker_id == "worker-a"
        assert draft.processing_attempts == 1
        assert draft.processing_lease_expires_at is not None

    async def test_a_second_worker_gets_nothing(self, db_session, owner, source) -> None:
        """The property the whole module exists for."""

        draft = await _draft(db_session, owner, source)

        first = await claim_draft_for_processing(
            db_session, draft.id, worker_id="worker-a", now=NOW
        )
        second = await claim_draft_for_processing(
            db_session, draft.id, worker_id="worker-b", now=NOW
        )

        assert first is not None
        assert second is None
        await db_session.refresh(draft)
        # And the loser did not consume an attempt on the winner's behalf.
        assert draft.processing_attempts == 1
        assert draft.processing_worker_id == "worker-a"

    async def test_a_lapsed_lease_can_be_taken_over(self, db_session, owner, source) -> None:
        """The recovery path: the first worker died, so its claim lapsed."""

        draft = await _draft(
            db_session,
            owner,
            source,
            processing_status="processing",
            processing_worker_id="worker-a",
            processing_lease_expires_at=NOW - timedelta(seconds=1),
            processing_attempts=1,
        )

        claimed = await claim_draft_for_processing(
            db_session, draft.id, worker_id="worker-b", now=NOW
        )

        assert claimed is not None
        await db_session.refresh(draft)
        assert draft.processing_worker_id == "worker-b"
        assert draft.processing_attempts == 2

    async def test_the_attempt_ceiling_is_enforced_by_the_claim(
        self, db_session, owner, source
    ) -> None:
        """Counting at claim rather than at failure is what bounds a crash loop:
        a process that dies mid-attempt reports nothing."""

        draft = await _draft(
            db_session,
            owner,
            source,
            processing_status="processing_failed",
            processing_attempts=MAX_ATTEMPTS,
        )

        assert (
            await claim_draft_for_processing(
                db_session, draft.id, worker_id="worker-a", now=NOW
            )
            is None
        )

    async def test_a_retry_that_is_not_due_is_not_claimed(
        self, db_session, owner, source
    ) -> None:
        draft = await _draft(
            db_session,
            owner,
            source,
            processing_status="processing_failed",
            processing_attempts=1,
            processing_next_attempt_at=NOW + timedelta(seconds=60),
        )

        assert (
            await claim_draft_for_processing(
                db_session, draft.id, worker_id="worker-a", now=NOW
            )
            is None
        )
        assert (
            await claim_draft_for_processing(
                db_session, draft.id, worker_id="worker-a", now=NOW + timedelta(seconds=61)
            )
            is not None
        )

    async def test_claiming_clears_the_stale_retry_schedule(
        self, db_session, owner, source
    ) -> None:
        """A running row is not also due; leaving it set would make the next
        sweep treat a live attempt as owed."""

        draft = await _draft(
            db_session,
            owner,
            source,
            processing_status="processing_failed",
            processing_attempts=1,
            processing_next_attempt_at=NOW - timedelta(seconds=1),
        )

        await claim_draft_for_processing(db_session, draft.id, worker_id="w", now=NOW)

        await db_session.refresh(draft)
        assert draft.processing_next_attempt_at is None

    async def test_a_deleted_draft_is_never_claimed(self, db_session, owner, source) -> None:
        draft = await _draft(db_session, owner, source, deleted_at=NOW)

        assert (
            await claim_draft_for_processing(
                db_session, draft.id, worker_id="worker-a", now=NOW
            )
            is None
        )

    @pytest.mark.parametrize(
        "status", ["awaiting_recruiter_review", "ready_to_apply", "applied_to_native_draft"]
    )
    async def test_a_finished_draft_is_never_re_run(
        self, db_session, owner, source, status: str
    ) -> None:
        """Re-running a succeeded import spends again and overwrites a draft the
        recruiter may already have edited."""

        draft = await _draft(db_session, owner, source, processing_status=status)

        assert (
            await claim_draft_for_processing(
                db_session, draft.id, worker_id="worker-a", now=NOW
            )
            is None
        )


class TestSweepingTheStranded:
    @pytest_asyncio.fixture(autouse=True)
    async def _empty_table(self, db_session):
        """The sweep asks the whole table, so other tests' drafts would be
        claimed too and the counts below would mean nothing."""

        await db_session.execute(delete(JobImportDraft))
        await db_session.flush()
        yield

    async def test_it_finds_the_draft_nobody_is_working_on(
        self, db_session, owner, source
    ) -> None:
        """This is what makes "preparing your draft" stop being forever."""

        await _draft(
            db_session,
            owner,
            source,
            processing_status="processing",
            processing_lease_expires_at=NOW - timedelta(minutes=10),
        )

        claimed = await claim_stranded_drafts(db_session, worker_id="sweeper", now=NOW)

        assert len(claimed) == 1

    async def test_it_leaves_a_live_attempt_alone(self, db_session, owner, source) -> None:
        """Reclaiming a merely-slow attempt is how one import becomes two bills."""

        await _draft(
            db_session,
            owner,
            source,
            processing_status="processing",
            processing_lease_expires_at=NOW + timedelta(seconds=30),
        )

        assert await claim_stranded_drafts(db_session, worker_id="sweeper", now=NOW) == []

    async def test_it_respects_the_batch_limit(self, db_session, owner, source) -> None:
        for _ in range(4):
            await _draft(db_session, owner, source)

        claimed = await claim_stranded_drafts(
            db_session, worker_id="sweeper", limit=2, now=NOW
        )

        assert len(claimed) == 2

    async def test_two_sweeps_never_take_the_same_row(
        self, db_session, owner, source
    ) -> None:
        await _draft(db_session, owner, source)

        first = await claim_stranded_drafts(db_session, worker_id="sweeper-a", now=NOW)
        second = await claim_stranded_drafts(db_session, worker_id="sweeper-b", now=NOW)

        assert len(first) == 1
        assert second == []


class TestReleasingALapsedClaim:
    async def test_a_lapsed_claim_can_be_given_up(self, db_session, owner, source) -> None:
        draft = await _draft(
            db_session,
            owner,
            source,
            processing_status="processing",
            processing_worker_id="worker-a",
            processing_lease_expires_at=NOW - timedelta(seconds=1),
        )

        assert await release_expired_claim(db_session, draft.id, now=NOW) is True
        await db_session.refresh(draft)
        assert draft.processing_worker_id is None

    async def test_a_live_claim_is_not_released(self, db_session, owner, source) -> None:
        """Another worker may already own it; clearing that would invite the
        duplicate this module exists to prevent."""

        draft = await _draft(
            db_session,
            owner,
            source,
            processing_status="processing",
            processing_worker_id="worker-b",
            processing_lease_expires_at=NOW + timedelta(seconds=60),
        )

        assert await release_expired_claim(db_session, draft.id, now=NOW) is False
        await db_session.refresh(draft)
        assert draft.processing_worker_id == "worker-b"


class TestTheSqlRuleAndThePythonRuleAgree:
    """Two expressions of one rule drift, and the drift is invisible.

    Every combination below is written to the database, offered to the claim,
    and independently judged by the pure rule. A disagreement means one of them
    is deciding something the other does not — which is how the wrong row gets
    claimed months later.
    """

    STATES = [
        "awaiting_processing",
        "processing",
        "processing_failed",
        "awaiting_recruiter_review",
        "ready_to_apply",
        "applied_to_native_draft",
        "discarded",
    ]
    LEASES = [None, NOW - timedelta(seconds=1), NOW + timedelta(seconds=60)]
    ATTEMPTS = [0, 1, MAX_ATTEMPTS]
    RETRIES = [None, NOW - timedelta(seconds=1), NOW + timedelta(seconds=60)]

    async def test_they_agree_on_every_combination(self, db_session, owner, source) -> None:
        disagreements: list[str] = []

        for status in self.STATES:
            for lease in self.LEASES:
                for attempts in self.ATTEMPTS:
                    for retry_at in self.RETRIES:
                        draft = await _draft(
                            db_session,
                            owner,
                            source,
                            processing_status=status,
                            processing_lease_expires_at=lease,
                            processing_attempts=attempts,
                            processing_next_attempt_at=retry_at,
                        )
                        sql_says = (
                            await claim_draft_for_processing(
                                db_session, draft.id, worker_id="w", now=NOW
                            )
                            is not None
                        )
                        python_says = may_start_attempt(
                            ExecutionSnapshot(
                                processing_status=status,
                                processing_attempts=attempts,
                                processing_lease_expires_at=lease,
                                processing_next_attempt_at=retry_at,
                            ),
                            now=NOW,
                        )
                        if sql_says != python_says:
                            disagreements.append(
                                f"{status} lease={lease} attempts={attempts} "
                                f"retry={retry_at}: sql={sql_says} python={python_says}"
                            )

        assert not disagreements, "\n".join(disagreements)

    async def test_the_matrix_covers_both_answers(self, db_session, owner, source) -> None:
        """Guards the guard: if every combination were ineligible the test above
        would pass while proving nothing."""

        outcomes = {
            may_start_attempt(
                ExecutionSnapshot(
                    processing_status=status,
                    processing_attempts=attempts,
                    processing_lease_expires_at=lease,
                    processing_next_attempt_at=retry_at,
                ),
                now=NOW,
            )
            for status in self.STATES
            for lease in self.LEASES
            for attempts in self.ATTEMPTS
            for retry_at in self.RETRIES
        }

        assert outcomes == {True, False}


class TestTheClaimIsOneStatement:
    """Structural, because behaviour cannot show this on SQLite.

    A read-then-write rewrite passes every behavioural test above under a single
    connection — the race needs real concurrency to appear, and that needs
    PostgreSQL. What can be checked here is that the code never takes the shape
    that has the race.
    """

    def test_it_does_not_select_then_decide_then_write(self) -> None:
        source_text = inspect.getsource(claim_draft_for_processing)

        assert "update(JobImportDraft)" in source_text
        assert ".returning(" in source_text
        # A select inside the single-row claim would mean a decision was made in
        # Python between reading and writing.
        assert "select(" not in source_text

    def test_the_predicate_is_reused_rather_than_restated(self) -> None:
        """One predicate, used by both claims. Restating it in each is how the
        single-row path and the sweep end up disagreeing."""

        for function in (claim_draft_for_processing, claim_stranded_drafts):
            assert "processing_eligible(now)" in inspect.getsource(function)

    def test_the_batch_claim_rechecks_eligibility_in_the_write(self) -> None:
        """The subquery only proposes candidates. Without the second predicate
        the write would take whatever the read proposed, race and all."""

        source_text = inspect.getsource(claim_stranded_drafts)

        assert source_text.count("processing_eligible(now)") == 2

    def test_postgres_skips_locked_rows(self) -> None:
        source_text = inspect.getsource(claim_stranded_drafts)

        assert "skip_locked=True" in source_text

    def test_the_module_exposes_no_read_then_write_helper(self) -> None:
        """A convenience "find then claim" would be used, and would be wrong."""

        exported = [
            name
            for name in dir(execution_repository)
            if name.startswith(("find_", "get_")) and not name.startswith("_")
        ]

        assert exported == []


def test_the_lease_is_long_enough_to_survive_a_slow_provider_call() -> None:
    assert LEASE_SECONDS >= 180
