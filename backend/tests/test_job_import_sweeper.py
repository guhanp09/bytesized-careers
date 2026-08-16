"""The sweep that ends "preparing your draft" for a recruiter who never came back.

The read-time assessment settles a stranded row when somebody reads it. The row
this sweep exists for is the one nobody reads: it stays marked `processing` for
as long as the database does, describing work that stopped happening.

Two properties are load-bearing and both are tested for the case that breaks
them.

It must never call the provider. Re-running an import unattended spends money on
behalf of someone who is not there to see the result — and it is also what makes
the sweep safe to run while the kill switch is off, which is precisely when
somebody is trying to stop provider work.

It must not touch a live attempt. A sweep that reclaims a merely-slow import
turns one import into two provider calls and two bills.
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime, timedelta

import pytest
import pytest_asyncio
from sqlalchemy import delete

from app.core import config
from app.core.job_import_execution import MAX_ATTEMPTS
from app.models import JobImportDraft, JobImportSource, User
from app.services.job_import_sweeper import (
    run_import_sweeper_forever,
    sweep_stranded_imports_once,
)

NOW = datetime(2026, 6, 1, 12, 0, 0, tzinfo=UTC)


@pytest_asyncio.fixture(autouse=True)
async def _empty_drafts(db_session):
    """The sweep asks the whole table, so other tests' rows would be claimed."""

    await db_session.execute(delete(JobImportDraft))
    await db_session.flush()
    yield


@pytest_asyncio.fixture
async def owner(db_session) -> User:
    user = User(email=f"sweep-owner-{uuid.uuid4().hex[:8]}@example.test")
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


async def _stranded(db_session, owner, source, **overrides) -> JobImportDraft:
    """Exactly the row a killed worker leaves behind."""

    values: dict = {
        "owner_user_id": owner.id,
        "source_id": source.id,
        "target_listing_schema_version": 3,
        "processing_status": "processing",
        "processing_lease_expires_at": NOW - timedelta(minutes=10),
        "processing_attempts": 1,
    }
    values.update(overrides)
    row = JobImportDraft(**values)
    db_session.add(row)
    await db_session.flush()
    return row


class TestItSettlesWhatNobodyFinished:
    async def test_a_stranded_import_stops_claiming_to_be_in_progress(
        self, db_session, owner, source
    ) -> None:
        draft = await _stranded(db_session, owner, source)

        result = await sweep_stranded_imports_once(db_session, now=NOW)

        assert result.settled == 1
        await db_session.refresh(draft)
        assert draft.processing_status == "processing_failed"
        assert draft.processing_lease_expires_at is None
        assert draft.processing_worker_id is None

    async def test_it_says_when_the_import_may_be_tried_again(
        self, db_session, owner, source
    ) -> None:
        draft = await _stranded(db_session, owner, source)

        result = await sweep_stranded_imports_once(db_session, now=NOW)

        assert result.retry_scheduled == 1
        await db_session.refresh(draft)
        assert draft.processing_next_attempt_at is not None

    async def test_an_import_out_of_attempts_gets_no_further_retry(
        self, db_session, owner, source
    ) -> None:
        """The intended end. A sixth attempt fails the same way and costs again."""

        draft = await _stranded(
            db_session, owner, source, processing_attempts=MAX_ATTEMPTS - 1
        )

        result = await sweep_stranded_imports_once(db_session, now=NOW)

        assert result.exhausted == 1
        await db_session.refresh(draft)
        assert draft.processing_status == "processing_failed"
        assert draft.processing_next_attempt_at is None

    async def test_it_leaves_a_live_attempt_alone(self, db_session, owner, source) -> None:
        """Reclaiming a merely-slow import is two provider calls and two bills."""

        draft = await _stranded(
            db_session,
            owner,
            source,
            processing_lease_expires_at=NOW + timedelta(minutes=1),
        )

        result = await sweep_stranded_imports_once(db_session, now=NOW)

        assert result.claimed == 0
        await db_session.refresh(draft)
        assert draft.processing_status == "processing"

    async def test_it_leaves_a_finished_import_alone(
        self, db_session, owner, source
    ) -> None:
        draft = await _stranded(
            db_session, owner, source, processing_status="ready_to_apply"
        )

        result = await sweep_stranded_imports_once(db_session, now=NOW)

        assert result.claimed == 0
        await db_session.refresh(draft)
        assert draft.processing_status == "ready_to_apply"

    async def test_it_respects_the_batch_limit(self, db_session, owner, source) -> None:
        for _ in range(4):
            await _stranded(db_session, owner, source)

        result = await sweep_stranded_imports_once(db_session, limit=2, now=NOW)

        assert result.claimed == 2


class TestItNeverCallsTheProvider:
    async def test_no_provider_is_constructed_or_invoked(
        self, db_session, owner, source, monkeypatch
    ) -> None:
        """Counted, not inferred. Unattended spend is the failure this avoids,
        and it is also what makes the sweep safe while the switch is off."""

        calls: list[str] = []

        def explode(*_args, **_kwargs):
            calls.append("provider")
            raise AssertionError("the sweep must not build a provider")

        monkeypatch.setattr("app.api.deps.get_job_import_provider", explode)
        await _stranded(db_session, owner, source)

        await sweep_stranded_imports_once(db_session, now=NOW)

        assert calls == []

    async def test_it_still_settles_while_the_kill_switch_is_off(
        self, db_session, owner, source, monkeypatch
    ) -> None:
        """An incident switch stops provider work. It should not force rows to
        keep claiming they are in progress while the feature is paused."""

        monkeypatch.setattr(config.settings, "job_import_enabled", False)
        draft = await _stranded(db_session, owner, source)

        result = await sweep_stranded_imports_once(db_session, now=NOW)

        assert result.settled == 1
        await db_session.refresh(draft)
        assert draft.processing_status == "processing_failed"


class TestTheLoop:
    async def test_it_stops_when_asked(self, monkeypatch) -> None:
        passes = 0
        stop = asyncio.Event()

        class _Session:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *_exc):
                return None

            async def commit(self):
                return None

        async def fake_pass(_session, **_kwargs):
            nonlocal passes
            passes += 1
            stop.set()
            return None

        monkeypatch.setattr(
            "app.services.job_import_sweeper.sweep_stranded_imports_once", fake_pass
        )

        await asyncio.wait_for(
            run_import_sweeper_forever(
                _Session, interval_seconds=0.01, stop=stop
            ),
            timeout=5,
        )

        assert passes == 1

    async def test_a_failing_pass_does_not_end_the_loop(self, monkeypatch) -> None:
        """A sweeper that dies on one bad row is the failure it exists to fix."""

        attempts: list[int] = []
        stop = asyncio.Event()

        class _Session:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *_exc):
                return None

            async def commit(self):
                return None

        async def fake_pass(_session, **_kwargs):
            attempts.append(len(attempts) + 1)
            if len(attempts) == 1:
                raise RuntimeError("database went away")
            stop.set()
            return None

        monkeypatch.setattr(
            "app.services.job_import_sweeper.sweep_stranded_imports_once", fake_pass
        )

        await asyncio.wait_for(
            run_import_sweeper_forever(_Session, interval_seconds=0.01, stop=stop),
            timeout=5,
        )

        assert attempts == [1, 2]

    async def test_the_session_factory_is_injected(self) -> None:
        """Not imported. A worker that reaches for the configured engine itself
        cannot be pointed at a disposable database by a test — which is exactly
        how a test once wrote a row into dev.db.
        """

        import inspect

        source_text = inspect.getsource(run_import_sweeper_forever)
        module_source = inspect.getsource(
            __import__("app.services.job_import_sweeper", fromlist=["x"])
        )

        assert "session_factory()" in source_text
        assert "from app.db.session import" not in module_source
        assert "SessionLocal" not in module_source


@pytest.mark.parametrize("attempts", [0, 1, MAX_ATTEMPTS - 1])
async def test_settling_always_releases_the_lease(
    db_session, owner, source, attempts: int
) -> None:
    """Whatever the outcome, the row must stop looking busy — that is the whole
    state this mechanism exists to end."""

    draft = await _stranded(db_session, owner, source, processing_attempts=attempts)

    await sweep_stranded_imports_once(db_session, now=NOW)

    await db_session.refresh(draft)
    assert draft.processing_lease_expires_at is None
