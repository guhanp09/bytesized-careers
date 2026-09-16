"""Local exercise/cleanup proof; never reported as actual PostgreSQL contention."""

import asyncio
from uuid import uuid4

import pytest
from sqlalchemy import select

from app.models import JobImportDraft, JobImportSource, User
from app.models.job_import_quota import JobImportQuotaCounter
from scripts import exercise_import_admission as drill
from tests.conftest import TestSessionLocal


async def _ids():
    async with TestSessionLocal() as session:
        return [
            set(await session.scalars(select(key)))
            for key in [
                User.id,
                JobImportSource.id,
                JobImportDraft.id,
                JobImportQuotaCounter.user_id,
            ]
        ]


@pytest.fixture
async def sentinel():
    # Deliberately looks like another run's fixture: cleanup must use UUIDs,
    # not the email prefix shared by these accounts.
    async with TestSessionLocal() as session:
        owner = User(email=f"import-drill-{uuid4().hex}@example.test")
        session.add(owner)
        await session.flush()
        source = JobImportSource(
            owner_user_id=owner.id,
            source_type="pasted_text",
            original_text="Unrelated existing fixture",
            content_fingerprint=uuid4().hex,
        )
        session.add(source)
        await session.flush()
        session.add(
            JobImportDraft(
                owner_user_id=owner.id,
                source_id=source.id,
                target_listing_schema_version=3,
                processing_status="awaiting_processing",
            )
        )
        session.add(JobImportQuotaCounter(user_id=owner.id, used=7))
        await session.commit()
    return await _ids()


async def test_owned_exercise_runs_locally_and_preserves_all_preexisting_rows(sentinel):
    async with asyncio.timeout(15):
        result = await drill.exercise(TestSessionLocal)
    assert result == {
        "passed": True,
        "contenders": 8,
        "admitted": 2,
        "refused": 6,
        "quota_used": 2,
        "owner_isolation": True,
        "capacity_reusable": True,
        "duplicate_admitted": 1,
        "duplicate_refused": 7,
        "cleanup_verified": True,
    }
    assert await _ids() == sentinel


async def test_assertion_failure_cleans_only_owned_fixtures(sentinel, monkeypatch):
    async def failed_race(*_args):
        raise AssertionError("deliberate drill failure")

    monkeypatch.setattr(drill, "_race", failed_race)
    with pytest.raises(AssertionError, match="deliberate drill failure"):
        await drill.exercise(TestSessionLocal)
    assert await _ids() == sentinel


async def test_cancellation_cleans_only_owned_fixtures(sentinel, monkeypatch):
    entered = asyncio.Event()

    async def stalled_race(*_args):
        entered.set()
        await asyncio.Event().wait()

    monkeypatch.setattr(drill, "_race", stalled_race)
    task = asyncio.create_task(drill.exercise(TestSessionLocal))
    try:
        await asyncio.wait_for(entered.wait(), timeout=5)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
    finally:
        if not task.done():
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
    assert await _ids() == sentinel


async def test_failed_contender_cancels_and_awaits_siblings(monkeypatch):
    sibling_started = asyncio.Event()
    sibling_cleaned = asyncio.Event()

    async def contender(_factory, _owner, draft, *, barrier):
        if draft == "fail":
            await sibling_started.wait()
            raise RuntimeError("owned failure")
        sibling_started.set()
        try:
            await asyncio.Event().wait()
        finally:
            sibling_cleaned.set()

    monkeypatch.setattr(drill, "_admit", contender)
    with pytest.raises(RuntimeError, match="owned failure"):
        await drill._race(None, None, ["fail", "sibling"])
    assert sibling_cleaned.is_set()


@pytest.mark.parametrize(
    "url",
    [
        "",
        "sqlite+aiosqlite:///./dev.db",
        "postgresql+asyncpg://creatorjobs_test:secret@hosted.example:5432/creatorjobs_interaction_test",
        "postgresql+asyncpg://creatorjobs_test:secret@127.0.0.1:55439/production",
        "postgresql+asyncpg://creatorjobs_test:secret@127.0.0.1:55439/creatorjobs_interaction_test?host=hosted.example",
    ],
)
def test_cli_refuses_unsafe_target_before_engine_or_env_rebinding(url, monkeypatch, capsys):
    monkeypatch.setenv("POSTGRES_TEST_DATABASE_URL", url)
    monkeypatch.setenv("DATABASE_URL", "unchanged-sentinel")

    async def must_not_run():
        pytest.fail("unsafe target reached database code")

    monkeypatch.setattr(drill, "_run_owned", must_not_run)
    assert drill.main() == 2
    import os

    assert os.environ["DATABASE_URL"] == "unchanged-sentinel"
    output = capsys.readouterr().out
    assert "secret" not in output
    assert "hosted.example" not in output
